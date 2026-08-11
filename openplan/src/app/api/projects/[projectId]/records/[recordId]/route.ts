import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { requireWorkspaceWriteAccess } from "@/lib/auth/workspace-write-gate";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { isOnRoster, loadWorkspaceRoster, type RosterServiceClient } from "@/lib/workspaces/roster";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  recordId: z.string().uuid(),
});

/**
 * STATUS IS NOW OPTIONAL ON THE FOUR ASSIGNABLE TYPES, and that is the one
 * subtle thing about this schema.
 *
 * It was required, because a transition was the only edit this route made. With
 * assignment added, requiring it would force the reassignment UI to send the
 * status it happens to be holding — which is a stale-write hazard by
 * construction: two planners open the same board, one advances the status, the
 * other reassigns, and the second write silently rolls the first one back.
 *
 * THE REASSIGNMENT UI IS `src/components/projects/record-assignee-control.tsx`,
 * named here because this sentence asserted it for a while before it existed:
 * `assigneeUserId` shipped with route tests and no sender, so assignment was
 * create-time only and a departed member's work could be handed to nobody.
 * `every-api-route-has-a-caller` could not see it — the route had callers, the
 * FIELD had none — which is why
 * `src/test/every-record-patch-field-is-sent-by-a-caller.test.ts` now derives
 * this schema's accepted fields and requires each one to have a sender.
 *
 * So each field is written ONLY when present, and `atLeastOneFieldToWrite`
 * below refuses a body that would otherwise be an expensive no-op. Risks keep a
 * required status: they carry no assignee (no due date, so no personal queue
 * could ever surface them), which leaves status as their only editable field.
 */
const updateRecordSchema = z.discriminatedUnion("recordType", [
  z.object({
    recordType: z.literal("milestone"),
    status: z.enum(["not_started", "scheduled", "in_progress", "blocked", "complete"]).optional(),
    note: z.string().trim().max(2000).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    recordType: z.literal("submittal"),
    status: z.enum(["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"]).optional(),
    note: z.string().trim().max(4000).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    recordType: z.literal("deliverable"),
    status: z.enum(["not_started", "in_progress", "blocked", "complete"]).optional(),
    // NUMERIC(14,2) not-to-exceed budget; only written when provided.
    budgetAmount: z.number().min(0).max(999_999_999_999.99).nullable().optional(),
    percentComplete: z.number().min(0).max(100).nullable().optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
  }),
  // Risks and issues were creatable from day one and movable by nobody: the
  // create route accepted both vocabularies, this route knew neither, so a
  // register filled up with `open` rows that no planner could retire. Status is
  // the only field either branch writes — a risk's mitigation text and an
  // issue's owner are editing, not transition, and belong to their own change.
  z.object({
    recordType: z.literal("risk"),
    status: z.enum(["open", "watch", "mitigated", "closed"]),
  }),
  z.object({
    recordType: z.literal("issue"),
    status: z.enum(["open", "in_progress", "blocked", "resolved"]).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
  }),
]).superRefine((value, ctx) => {
  // A PATCH that names no field is not a partial update, it is a request that
  // would answer 200 having changed nothing but `updated_at`. Say so instead.
  const writes =
    value.status !== undefined ||
    ("assigneeUserId" in value && value.assigneeUserId !== undefined) ||
    ("note" in value && value.note !== undefined) ||
    ("budgetAmount" in value && value.budgetAmount !== undefined) ||
    ("percentComplete" in value && value.percentComplete !== undefined);

  if (!writes) {
    ctx.addIssue({
      code: "custom",
      message: "Nothing to update: send a status, an assignee, or a field this record type accepts.",
    });
  }
});

type RouteContext = {
  params: Promise<{ projectId: string; recordId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.records.update", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid record id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = updateRecordSchema.safeParse(payload);

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

    // Seeing the project is not permission to advance its records: the write
    // policy behind every table below asks only for membership.
    const writeAccess = await requireWorkspaceWriteAccess(supabase, user.id, project.workspace_id);
    if (!writeAccess.ok) return writeAccess.response;

    // Reassignment carries the same membership rule as first assignment, and
    // for the same reason it is enforced here rather than by a CHECK: the
    // question spans projects, workspace_members and the record itself.
    // Clearing an assignee (explicit null) needs no lookup — nobody is being
    // named. See the POST route's header for why the roster is read with the
    // service role.
    const nextAssigneeUserId =
      "assigneeUserId" in parsed.data ? parsed.data.assigneeUserId ?? null : null;
    if (nextAssigneeUserId) {
      const roster = await loadWorkspaceRoster(
        createServiceRoleClient() as unknown as RosterServiceClient,
        user.id,
        project.workspace_id,
        { resolveEmails: false }
      );

      if (!roster.ok) {
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

      if (!isOnRoster(roster.members, nextAssigneeUserId)) {
        audit.warn("assignee_not_a_member", {
          projectId: project.id,
          workspaceId: project.workspace_id,
          assigneeUserId: nextAssigneeUserId,
        });
        return NextResponse.json(
          { error: "The assignee is not a member of this project's workspace" },
          { status: 400 }
        );
      }
    }

    const updatedAt = new Date().toISOString();
    /**
     * Only the fields the request actually named. `assigneeUserId: null` is a
     * real instruction ("unassign"), which is why the test is against
     * `undefined` and never against falsiness.
     */
    const assigneeUpdate =
      "assigneeUserId" in parsed.data && parsed.data.assigneeUserId !== undefined
        ? { assignee_user_id: parsed.data.assigneeUserId }
        : {};

    if (parsed.data.recordType === "milestone") {
      const { data, error } = await supabase
        .from("project_milestones")
        .update({
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...(parsed.data.note !== undefined ? { notes: parsed.data.note.trim() || null } : {}),
          ...assigneeUpdate,
          updated_at: updatedAt,
        })
        .eq("id", parsedParams.data.recordId)
        .eq("project_id", project.id)
        .select("id, title, summary, milestone_type, phase_code, status, owner_label, assignee_user_id, target_date, actual_date, notes, created_at, updated_at")
        .maybeSingle();

      if (error && isWriteFailure(error)) {
        audit.error("project_record_update_failed", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "milestone",
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to update milestone", details: error.message }, { status: 500 });
      }

      // The read above verified the PROJECT, never this record: the recordId
      // arrives from the URL and is written straight at. So zero rows is the
      // ordinary answer to "does this record exist here", not a policy defect.
      if (writeMatchedNoRows({ data, error }) || !data) {
        audit.warn("project_record_update_matched_no_rows", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "milestone",
        });
        return noRowsMatchedResponse({ subject: "milestone", targetWasVerified: false });
      }

      audit.info("project_record_updated", {
        projectId: project.id,
        recordId: data.id,
        recordType: "milestone",
        status: parsed.data.status ?? null,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ recordType: "milestone", record: data });
    }

    if (parsed.data.recordType === "deliverable") {
      const { data, error } = await supabase
        .from("project_deliverables")
        .update({
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...(parsed.data.budgetAmount !== undefined ? { budget_amount: parsed.data.budgetAmount } : {}),
          ...(parsed.data.percentComplete !== undefined ? { percent_complete: parsed.data.percentComplete } : {}),
          ...assigneeUpdate,
          updated_at: updatedAt,
        })
        .eq("id", parsedParams.data.recordId)
        .eq("project_id", project.id)
        .select("id, title, summary, owner_label, assignee_user_id, due_date, status, budget_amount, percent_complete, created_at, updated_at")
        .maybeSingle();

      if (error && isWriteFailure(error)) {
        audit.error("project_record_update_failed", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "deliverable",
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to update deliverable", details: error.message }, { status: 500 });
      }

      if (writeMatchedNoRows({ data, error }) || !data) {
        audit.warn("project_record_update_matched_no_rows", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "deliverable",
        });
        return noRowsMatchedResponse({ subject: "deliverable", targetWasVerified: false });
      }

      audit.info("project_record_updated", {
        projectId: project.id,
        recordId: data.id,
        recordType: "deliverable",
        status: parsed.data.status ?? null,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ recordType: "deliverable", record: data });
    }

    if (parsed.data.recordType === "risk") {
      const { data, error } = await supabase
        .from("project_risks")
        .update({
          status: parsed.data.status,
          updated_at: updatedAt,
        })
        .eq("id", parsedParams.data.recordId)
        .eq("project_id", project.id)
        // The same columns the risk lane renders. Keeping the projections
        // aligned is why the panel can re-render from this response.
        .select("id, title, description, severity, status, mitigation, created_at, updated_at")
        .maybeSingle();

      if (error && isWriteFailure(error)) {
        audit.error("project_record_update_failed", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "risk",
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to update risk", details: error.message }, { status: 500 });
      }

      if (writeMatchedNoRows({ data, error }) || !data) {
        audit.warn("project_record_update_matched_no_rows", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "risk",
        });
        return noRowsMatchedResponse({ subject: "risk", targetWasVerified: false });
      }

      audit.info("project_record_updated", {
        projectId: project.id,
        recordId: data.id,
        recordType: "risk",
        status: parsed.data.status ?? null,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ recordType: "risk", record: data });
    }

    if (parsed.data.recordType === "issue") {
      const { data, error } = await supabase
        .from("project_issues")
        .update({
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...assigneeUpdate,
          updated_at: updatedAt,
        })
        .eq("id", parsedParams.data.recordId)
        .eq("project_id", project.id)
        .select("id, title, description, severity, status, owner_label, assignee_user_id, created_at, updated_at")
        .maybeSingle();

      if (error && isWriteFailure(error)) {
        audit.error("project_record_update_failed", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "issue",
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to update issue", details: error.message }, { status: 500 });
      }

      if (writeMatchedNoRows({ data, error }) || !data) {
        audit.warn("project_record_update_matched_no_rows", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "issue",
        });
        return noRowsMatchedResponse({ subject: "issue", targetWasVerified: false });
      }

      audit.info("project_record_updated", {
        projectId: project.id,
        recordId: data.id,
        recordType: "issue",
        status: parsed.data.status ?? null,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ recordType: "issue", record: data });
    }

    const { data, error } = await supabase
      .from("project_submittals")
      .update({
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.note !== undefined ? { notes: parsed.data.note.trim() || null } : {}),
        ...assigneeUpdate,
        updated_at: updatedAt,
      })
      .eq("id", parsedParams.data.recordId)
      .eq("project_id", project.id)
      .select("id, title, submittal_type, status, agency_label, assignee_user_id, reference_number, due_date, submitted_at, review_cycle, notes, created_at, updated_at")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("project_record_update_failed", {
        projectId: project.id,
        recordId: parsedParams.data.recordId,
        recordType: "submittal",
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to update submittal", details: error.message }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error }) || !data) {
      audit.warn("project_record_update_matched_no_rows", {
        projectId: project.id,
        recordId: parsedParams.data.recordId,
        recordType: "submittal",
      });
      return noRowsMatchedResponse({ subject: "submittal", targetWasVerified: false });
    }

    audit.info("project_record_updated", {
      projectId: project.id,
      recordId: data.id,
      recordType: "submittal",
      status: parsed.data.status ?? null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ recordType: "submittal", record: data });
  } catch (error) {
    audit.error("projects_records_update_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while updating project record" }, { status: 500 });
  }
}
