import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  recordId: z.string().uuid(),
});

const updateRecordSchema = z.discriminatedUnion("recordType", [
  z.object({
    recordType: z.literal("milestone"),
    status: z.enum(["not_started", "scheduled", "in_progress", "blocked", "complete"]),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    recordType: z.literal("submittal"),
    status: z.enum(["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"]),
    note: z.string().trim().max(4000).optional(),
  }),
]);

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

    const updatedAt = new Date().toISOString();

    if (parsed.data.recordType === "milestone") {
      const { data, error } = await supabase
        .from("project_milestones")
        .update({
          status: parsed.data.status,
          ...(parsed.data.note !== undefined ? { notes: parsed.data.note.trim() || null } : {}),
          updated_at: updatedAt,
        })
        .eq("id", parsedParams.data.recordId)
        .eq("project_id", project.id)
        .select("id, title, summary, milestone_type, phase_code, status, owner_label, target_date, actual_date, notes, created_at, updated_at")
        .maybeSingle();

      if (error) {
        audit.error("project_record_update_failed", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "milestone",
          message: error.message,
        });
        return NextResponse.json({ error: "Failed to update milestone", details: error.message }, { status: 500 });
      }

      if (!data) {
        audit.warn("record_not_found", {
          projectId: project.id,
          recordId: parsedParams.data.recordId,
          recordType: "milestone",
        });
        return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
      }

      audit.info("project_record_updated", {
        projectId: project.id,
        recordId: data.id,
        recordType: "milestone",
        status: parsed.data.status,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ recordType: "milestone", record: data });
    }

    const { data, error } = await supabase
      .from("project_submittals")
      .update({
        status: parsed.data.status,
        ...(parsed.data.note !== undefined ? { notes: parsed.data.note.trim() || null } : {}),
        updated_at: updatedAt,
      })
      .eq("id", parsedParams.data.recordId)
      .eq("project_id", project.id)
      .select("id, title, submittal_type, status, agency_label, reference_number, due_date, submitted_at, review_cycle, notes, created_at, updated_at")
      .maybeSingle();

    if (error) {
      audit.error("project_record_update_failed", {
        projectId: project.id,
        recordId: parsedParams.data.recordId,
        recordType: "submittal",
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to update submittal", details: error.message }, { status: 500 });
    }

    if (!data) {
      audit.warn("record_not_found", {
        projectId: project.id,
        recordId: parsedParams.data.recordId,
        recordType: "submittal",
      });
      return NextResponse.json({ error: "Submittal not found" }, { status: 404 });
    }

    audit.info("project_record_updated", {
      projectId: project.id,
      recordId: data.id,
      recordType: "submittal",
      status: parsed.data.status,
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
