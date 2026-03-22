import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

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
    dueDate: z.string().trim().max(30).optional(),
    status: z.enum(["not_started", "in_progress", "blocked", "complete"]).optional(),
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

    const payload = await request.json().catch(() => null);
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
          target_date: parsed.data.targetDate?.trim() || null,
          actual_date: parsed.data.actualDate?.trim() || null,
          notes: parsed.data.notes?.trim() || null,
          created_by: user.id,
        })
        .select("id, title, summary, milestone_type, phase_code, status, owner_label, target_date, actual_date, notes, created_at")
        .single();

      if (error) {
        audit.error("milestone_insert_failed", {
          message: error.message,
          code: error.code ?? null,
          projectId: project.id,
        });
        return NextResponse.json({ error: "Failed to create milestone", details: error.message }, { status: 500 });
      }

      return NextResponse.json({ recordType: "milestone", record: data }, { status: 201 });
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
          reference_number: parsed.data.referenceNumber?.trim() || null,
          due_date: parsed.data.dueDate?.trim() || null,
          submitted_at: parsed.data.submittedAt?.trim() || null,
          review_cycle: parsed.data.reviewCycle ?? 1,
          notes: parsed.data.notes?.trim() || null,
          created_by: user.id,
        })
        .select("id, title, submittal_type, status, agency_label, reference_number, due_date, submitted_at, review_cycle, notes, created_at")
        .single();

      if (error) {
        audit.error("submittal_insert_failed", {
          message: error.message,
          code: error.code ?? null,
          projectId: project.id,
        });
        return NextResponse.json({ error: "Failed to create submittal", details: error.message }, { status: 500 });
      }

      return NextResponse.json({ recordType: "submittal", record: data }, { status: 201 });
    }

    if (parsed.data.recordType === "deliverable") {
      const { data, error } = await supabase
        .from("project_deliverables")
        .insert({
          project_id: project.id,
          title: parsed.data.title,
          summary: parsed.data.summary?.trim() || null,
          owner_label: parsed.data.ownerLabel?.trim() || null,
          due_date: parsed.data.dueDate?.trim() || null,
          status: parsed.data.status ?? "not_started",
          created_by: user.id,
        })
        .select("id, title, summary, owner_label, due_date, status, created_at")
        .single();

      if (error) {
        audit.error("deliverable_insert_failed", {
          message: error.message,
          code: error.code ?? null,
          projectId: project.id,
        });
        return NextResponse.json({ error: "Failed to create deliverable", details: error.message }, { status: 500 });
      }

      return NextResponse.json({ recordType: "deliverable", record: data }, { status: 201 });
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

      if (error) {
        audit.error("risk_insert_failed", { message: error.message, code: error.code ?? null, projectId: project.id });
        return NextResponse.json({ error: "Failed to create risk", details: error.message }, { status: 500 });
      }

      return NextResponse.json({ recordType: "risk", record: data }, { status: 201 });
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
          created_by: user.id,
        })
        .select("id, title, description, severity, status, owner_label, created_at")
        .single();

      if (error) {
        audit.error("issue_insert_failed", { message: error.message, code: error.code ?? null, projectId: project.id });
        return NextResponse.json({ error: "Failed to create issue", details: error.message }, { status: 500 });
      }

      return NextResponse.json({ recordType: "issue", record: data }, { status: 201 });
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

      if (error) {
        audit.error("decision_insert_failed", { message: error.message, code: error.code ?? null, projectId: project.id });
        return NextResponse.json({ error: "Failed to create decision", details: error.message }, { status: 500 });
      }

      return NextResponse.json({ recordType: "decision", record: data }, { status: 201 });
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

    if (error) {
      audit.error("meeting_insert_failed", { message: error.message, code: error.code ?? null, projectId: project.id });
      return NextResponse.json({ error: "Failed to create meeting", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ recordType: "meeting", record: data }, { status: 201 });
  } catch (error) {
    audit.error("projects_records_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while creating project record" }, { status: 500 });
  }
}
