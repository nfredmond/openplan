import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { assistantActionAuditIdentity, withAssistantActionAudit } from "@/lib/observability/action-audit";
import {
  type AssistantApprovalVerification,
  readAssistantExecutionSource, verifyAssistantActionApproval,
} from "@/lib/assistant/action-approval-server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { requireWorkspaceWriteAccess } from "@/lib/auth/workspace-write-gate";
import { refuseOutOfScopeAgentRequest } from "@/lib/assistant/agent-request-scope";
import { isOnRoster, loadWorkspaceRoster, type RosterServiceClient } from "@/lib/workspaces/roster";

/**
 * ASSIGNING WORK TO A PERSON. Four of the seven record types carry an optional
 * `assigneeUserId` (20260811000006). Two rules govern it, and both are enforced
 * below rather than in the database:
 *
 * 1. THE ASSIGNEE MUST BE A MEMBER OF THIS PROJECT'S WORKSPACE. Postgres cannot
 *    express that as a CHECK (it spans three tables), so the write path owns it.
 *    The check goes through `loadWorkspaceRoster`, which reads with the service
 *    role behind its own caller-membership check — an RLS read of
 *    workspace_members returns ONE row (members_read_own), so validating a
 *    teammate against it would refuse every teammate but the caller. That exact
 *    bug shipped once already, on /api/invoicing/staff.
 * 2. THE PLANNER AGENT MAY NOT ASSIGN ANYONE. The `create_project_record`
 *    action's payload is title/type/status/notes on a submittal and nothing
 *    else; a request carrying those PLUS an assignee hashes identically to what
 *    a planner approved, because the hash covers the ACTION the route rebuilds,
 *    not the body it received. `refuseOutOfScopeAgentRequest` is the answer to
 *    that, and the allowed key list below is copied from the action's own
 *    effect in src/lib/runtime/action-registry.ts.
 *
 * AND NO ASSIGNMENT ACTION WAS REGISTERED — refused deliberately, argued here
 * so the next session inherits the argument instead of re-running it. An
 * assignee id LOOKS like the safe payload shape the registry already accepts
 * (an id the model verified against a workspace row, no authored prose). It is
 * not, for the reason the RTP horizon-band refusal established: the
 * consequential content is the PAIRING. Assigning work is authoring a
 * commitment on a named colleague's behalf — it puts a person's name on a dated
 * obligation, it lands in that person's work queue and their reminder digest,
 * and the approver's only control is noticing that a plausible teammate is the
 * wrong teammate. An agent working a queue of unassigned records also has a
 * standing incentive to empty it, which is the completion-signal shape that
 * refused the RTP band assignment. If a shape is ever argued, it is a
 * copy-forward: reassigning to the person already named on a sibling record,
 * with the route reading the id off that row rather than off the payload.
 */

/** Exactly the keys `create_project_record`'s effect sends to this endpoint. */
const CREATE_PROJECT_RECORD_ACTION_KEYS = [
  "recordType",
  "title",
  "submittalType",
  "status",
  "notes",
] as const;

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const createRecordSchema = z.discriminatedUnion("recordType", [
  z.object({
    recordType: z.literal("milestone"),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(2000).optional(),
    milestoneType: z.enum(["authorization", "agreement", "schedule", "hearing", "invoice", "deliverable", "decision", "permit", "closeout", "other"]).optional(),
    phaseCode: z.enum(["initiation", "procurement", "environmental", "outreach", "programming", "ps_e", "row_utilities", "advertise_award", "construction", "closeout", "other"]).optional(),
    status: z.enum(["not_started", "scheduled", "in_progress", "blocked", "complete"]).optional(),
    ownerLabel: z.string().trim().max(120).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    targetDate: z.string().trim().max(30).optional(),
    actualDate: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  z.object({
    recordType: z.literal("submittal"),
    title: z.string().trim().min(1).max(160),
    submittalType: z.enum(["authorization_packet", "invoice_backup", "environmental_package", "hearing_record", "ps_e", "reimbursement", "progress_report", "other"]).optional(),
    status: z.enum(["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"]).optional(),
    agencyLabel: z.string().trim().max(160).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    referenceNumber: z.string().trim().max(160).optional(),
    dueDate: z.string().trim().max(30).optional(),
    submittedAt: z.string().trim().max(40).optional(),
    reviewCycle: z.number().int().min(1).max(10).optional(),
    notes: z.string().trim().max(4000).optional(),
  }),
  z.object({
    recordType: z.literal("deliverable"),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(2000).optional(),
    ownerLabel: z.string().trim().max(120).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    dueDate: z.string().trim().max(30).optional(),
    status: z.enum(["not_started", "in_progress", "blocked", "complete"]).optional(),
    // NUMERIC(14,2): not-to-exceed budget for this deliverable.
    budgetAmount: z.number().min(0).max(999_999_999_999.99).nullable().optional(),
    percentComplete: z.number().min(0).max(100).nullable().optional(),
  }),
  z.object({
    recordType: z.literal("risk"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["open", "watch", "mitigated", "closed"]).optional(),
    mitigation: z.string().trim().max(2000).optional(),
  }),
  z.object({
    recordType: z.literal("issue"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["open", "in_progress", "blocked", "resolved"]).optional(),
    ownerLabel: z.string().trim().max(120).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    recordType: z.literal("decision"),
    title: z.string().trim().min(1).max(160),
    rationale: z.string().trim().min(1).max(2000),
    status: z.enum(["proposed", "approved", "rejected"]).optional(),
    impactSummary: z.string().trim().max(2000).optional(),
    decidedAt: z.string().trim().max(40).optional(),
  }),
  z.object({
    recordType: z.literal("meeting"),
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(4000).optional(),
    meetingAt: z.string().trim().max(40).optional(),
    attendeesSummary: z.string().trim().max(500).optional(),
  }),
]);

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.records.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = createRecordSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", parsedParams.data.projectId)
      .single();

    if (projectError || !project) {
      audit.warn("project_not_found", {
        projectId: parsedParams.data.projectId,
        message: projectError?.message ?? null,
      });
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // The project-record tables inherit the project's role-blind write policy,
    // so RLS admits any member — including a viewer. Authorize explicitly, and
    // before the assistant-approval path, so a viewer cannot reach the write
    // through the Planner Agent either.
    const writeAccess = await requireWorkspaceWriteAccess(supabase, user.id, project.workspace_id);
    if (!writeAccess.ok) return writeAccess.response;

    const performInsert = async (): Promise<{ recordType: string; record: unknown }> => {
      if (parsed.data.recordType === "milestone") {
        const { data, error } = await supabase
          .from("project_milestones")
          .insert({
            project_id: project.id,
            title: parsed.data.title,
            summary: parsed.data.summary?.trim() || null,
            milestone_type: parsed.data.milestoneType ?? "schedule",
            phase_code: parsed.data.phaseCode ?? "initiation",
            status: parsed.data.status ?? "not_started",
            owner_label: parsed.data.ownerLabel?.trim() || null,
            // Absent stays absent: sending the key as null on a deployment
            // behind 20260811000006 would fail the whole insert.
            ...(parsed.data.assigneeUserId !== undefined ? { assignee_user_id: parsed.data.assigneeUserId } : {}),
            target_date: parsed.data.targetDate?.trim() || null,
            actual_date: parsed.data.actualDate?.trim() || null,
            notes: parsed.data.notes?.trim() || null,
            created_by: user.id,
          })
          .select("id, title, summary, milestone_type, phase_code, status, owner_label, assignee_user_id, target_date, actual_date, notes, created_at")
          .single();
        if (error) throw new Error(error.message);
        return { recordType: "milestone", record: data };
      }

      if (parsed.data.recordType === "submittal") {
        const { data, error } = await supabase
          .from("project_submittals")
          .insert({
            project_id: project.id,
            title: parsed.data.title,
            submittal_type: parsed.data.submittalType ?? "other",
            status: parsed.data.status ?? "draft",
            agency_label: parsed.data.agencyLabel?.trim() || null,
            ...(parsed.data.assigneeUserId !== undefined ? { assignee_user_id: parsed.data.assigneeUserId } : {}),
            reference_number: parsed.data.referenceNumber?.trim() || null,
            due_date: parsed.data.dueDate?.trim() || null,
            submitted_at: parsed.data.submittedAt?.trim() || null,
            review_cycle: parsed.data.reviewCycle ?? 1,
            notes: parsed.data.notes?.trim() || null,
            created_by: user.id,
          })
          .select("id, title, submittal_type, status, agency_label, assignee_user_id, reference_number, due_date, submitted_at, review_cycle, notes, created_at")
          .single();
        if (error) throw new Error(error.message);
        return { recordType: "submittal", record: data };
      }

      if (parsed.data.recordType === "deliverable") {
        const { data, error } = await supabase
          .from("project_deliverables")
          .insert({
            project_id: project.id,
            title: parsed.data.title,
            summary: parsed.data.summary?.trim() || null,
            owner_label: parsed.data.ownerLabel?.trim() || null,
            ...(parsed.data.assigneeUserId !== undefined ? { assignee_user_id: parsed.data.assigneeUserId } : {}),
            due_date: parsed.data.dueDate?.trim() || null,
            status: parsed.data.status ?? "not_started",
            // Only sent when provided — an absent field must not become 0.
            ...(parsed.data.budgetAmount !== undefined ? { budget_amount: parsed.data.budgetAmount } : {}),
            ...(parsed.data.percentComplete !== undefined ? { percent_complete: parsed.data.percentComplete } : {}),
            created_by: user.id,
          })
          .select("id, title, summary, owner_label, assignee_user_id, due_date, status, budget_amount, percent_complete, created_at")
          .single();
        if (error) throw new Error(error.message);
        return { recordType: "deliverable", record: data };
      }

      if (parsed.data.recordType === "risk") {
        const { data, error } = await supabase
          .from("project_risks")
          .insert({
            project_id: project.id,
            title: parsed.data.title,
            description: parsed.data.description?.trim() || null,
            severity: parsed.data.severity ?? "medium",
            status: parsed.data.status ?? "open",
            mitigation: parsed.data.mitigation?.trim() || null,
            created_by: user.id,
          })
          .select("id, title, description, severity, status, mitigation, created_at")
          .single();
        if (error) throw new Error(error.message);
        return { recordType: "risk", record: data };
      }

      if (parsed.data.recordType === "issue") {
        const { data, error } = await supabase
          .from("project_issues")
          .insert({
            project_id: project.id,
            title: parsed.data.title,
            description: parsed.data.description?.trim() || null,
            severity: parsed.data.severity ?? "medium",
            status: parsed.data.status ?? "open",
            owner_label: parsed.data.ownerLabel?.trim() || null,
            ...(parsed.data.assigneeUserId !== undefined ? { assignee_user_id: parsed.data.assigneeUserId } : {}),
            created_by: user.id,
          })
          .select("id, title, description, severity, status, owner_label, assignee_user_id, created_at")
          .single();
        if (error) throw new Error(error.message);
        return { recordType: "issue", record: data };
      }

      if (parsed.data.recordType === "decision") {
        const { data, error } = await supabase
          .from("project_decisions")
          .insert({
            project_id: project.id,
            title: parsed.data.title,
            rationale: parsed.data.rationale,
            status: parsed.data.status ?? "proposed",
            impact_summary: parsed.data.impactSummary?.trim() || null,
            decided_at: parsed.data.decidedAt?.trim() || null,
            created_by: user.id,
          })
          .select("id, title, rationale, status, impact_summary, decided_at, created_at")
          .single();
        if (error) throw new Error(error.message);
        return { recordType: "decision", record: data };
      }

      const { data, error } = await supabase
        .from("project_meetings")
        .insert({
          project_id: project.id,
          title: parsed.data.title,
          notes: parsed.data.notes?.trim() || null,
          meeting_at: parsed.data.meetingAt?.trim() || null,
          attendees_summary: parsed.data.attendeesSummary?.trim() || null,
          created_by: user.id,
        })
        .select("id, title, notes, meeting_at, attendees_summary, created_at")
        .single();
      if (error) throw new Error(error.message);
      return { recordType: "meeting", record: data };
    };

    const serviceSupabase = createServiceRoleClient();
    let approval: AssistantApprovalVerification | null = null;
    const executionSource = readAssistantExecutionSource(request);

    if (executionSource === "planner_agent_quick_link" && parsed.data.recordType !== "submittal") {
      return NextResponse.json(
        { error: "Planner Agent project-record execution only supports reimbursement submittals" },
        { status: 403 }
      );
    }

    // A narrow action may not ride a wide route. Assigning a person is the
    // field this closes today, but the check is over the whole body on purpose:
    // anything the endpoint accepts and the action does not send is something a
    // planner did not approve.
    const outOfScope = refuseOutOfScopeAgentRequest({
      executionSource,
      body: payload,
      allowedKeys: CREATE_PROJECT_RECORD_ACTION_KEYS,
      actionKind: "create_project_record",
    });
    if (outOfScope) {
      audit.warn("agent_request_out_of_scope", { rejectedKeys: outOfScope.rejectedKeys });
      return NextResponse.json(
        { error: outOfScope.error, details: outOfScope.details },
        { status: 403 }
      );
    }

    // An assignee has to be a member of THIS project's workspace. Only asked
    // when one was actually sent — an unassigned record costs no lookup.
    const assigneeUserId =
      "assigneeUserId" in parsed.data ? parsed.data.assigneeUserId ?? null : null;
    if (assigneeUserId) {
      const roster = await loadWorkspaceRoster(
        serviceSupabase as unknown as RosterServiceClient,
        user.id,
        project.workspace_id,
        { resolveEmails: false }
      );

      if (!roster.ok) {
        // A failed roster read is a failed read. Answering 400 here would
        // accuse a real teammate of not belonging to the workspace.
        audit.error("assignee_roster_read_failed", {
          projectId: project.id,
          workspaceId: project.workspace_id,
          reason: roster.reason,
          message: roster.message,
        });
        return NextResponse.json(
          { error: "Could not verify that the assignee is a member of this workspace" },
          { status: 500 }
        );
      }

      if (!isOnRoster(roster.members, assigneeUserId)) {
        audit.warn("assignee_not_a_member", {
          projectId: project.id,
          workspaceId: project.workspace_id,
          assigneeUserId,
        });
        return NextResponse.json(
          { error: "The assignee is not a member of this project's workspace" },
          { status: 400 }
        );
      }
    }

    if (parsed.data.recordType === "submittal") {
      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase,
          userId: user.id,
          workspaceId: project.workspace_id,
          action: {
            kind: "create_project_record",
            projectId: project.id,
            recordType: "submittal",
            title: parsed.data.title,
            ...(parsed.data.submittalType ? { submittalType: parsed.data.submittalType } : {}),
            ...(parsed.data.status ? { status: parsed.data.status } : {}),
            ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
          },
        });
      } catch (approvalError) {
        return NextResponse.json(
          { error: approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed" },
          { status: 403 }
        );
      }
    }

    let result: { recordType: string; record: unknown };
    try {
      result = await withAssistantActionAudit(
        serviceSupabase,
        {
          actionKind: "create_project_record",
          workspaceId: project.workspace_id,
          userId: user.id,
          ...(approval ? assistantActionAuditIdentity(approval) : {}),
          inputSummary: {
            projectId: project.id,
            recordType: parsed.data.recordType,
            title: parsed.data.title,
          },
        },
        performInsert
      );
    } catch (insertErr) {
      const message = insertErr instanceof Error ? insertErr.message : String(insertErr);
      audit.error("project_record_insert_failed", {
        projectId: project.id,
        recordType: parsed.data.recordType,
        message,
      });
      return NextResponse.json(
        { error: `Failed to create ${parsed.data.recordType}`, details: message },
        { status: 500 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    audit.error("projects_records_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while creating project record" }, { status: 500 });
  }
}
