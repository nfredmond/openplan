import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.object({
  reportingPeriodStart: z.string().date(),
  reportingPeriodEnd: z.string().date(),
  title: z.string().trim().min(1).max(180),
  summary: z.string().max(20_000).nullable().optional(),
}).strict().refine((value) => value.reportingPeriodEnd >= value.reportingPeriodStart, {
  message: "Reporting period end must not precede its start",
  path: ["reportingPeriodEnd"],
});
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.implementation-reports", request);
  audit.info("land_use_plan_implementation_report_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid implementation report", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  if (!access.plan.current_adopted_version_id) return NextResponse.json({ error: "Adopt the plan before generating an implementation report" }, { status: 409 });
  const { data: version, error: versionError } = await access.supabase.from("land_use_plan_versions")
    .select("id, content_hash, state").eq("id", access.plan.current_adopted_version_id).eq("state", "adopted").maybeSingle();
  if (versionError) return NextResponse.json({ error: "Failed to verify the adopted version" }, { status: 500 });
  if (!version?.content_hash) return NextResponse.json({ error: "The adopted version is not frozen" }, { status: 409 });
  const { data: actions, error: actionsError } = await access.supabase.from("land_use_plan_implementation_actions")
    .select("id, title, description, responsible_party, due_on, status, project_id, program_id, evidence_document_id, updated_at")
    .eq("version_id", version.id).order("id");
  if (actionsError) return NextResponse.json({ error: "Failed to read implementation status" }, { status: 500 });
  const snapshot = {
    planId: access.plan.id,
    adoptedVersionId: version.id,
    adoptedVersionContentHash: version.content_hash,
    reportingPeriodStart: parsed.data.reportingPeriodStart,
    reportingPeriodEnd: parsed.data.reportingPeriodEnd,
    actions: actions ?? [],
  };
  const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

  const { data: report, error: reportError } = await access.supabase.from("reports").insert({
    workspace_id: access.plan.workspace_id,
    project_id: null,
    land_use_plan_id: access.plan.id,
    title: parsed.data.title,
    report_type: "board_packet",
    status: "generated",
    summary: parsed.data.summary ?? `Implementation status for ${parsed.data.reportingPeriodStart} through ${parsed.data.reportingPeriodEnd}.`,
    created_by: access.userId,
    generated_at: new Date().toISOString(),
    latest_artifact_kind: "html",
  }).select("id").single();
  if (reportError) return NextResponse.json({ error: "Failed to create implementation report" }, { status: 500 });
  const { error: artifactError } = await access.supabase.from("report_artifacts").insert({
    report_id: report.id,
    artifact_kind: "html",
    generated_by: access.userId,
    metadata_json: { kind: "land_use_plan_implementation_report", contentHash, snapshot },
  });
  if (artifactError) {
    const cleanup = await access.supabase.from("reports").delete().eq("id", report.id).select("id");
    if (cleanup.error) audit.error("land_use_plan_implementation_report_cleanup_failed", { error: cleanup.error });
    return NextResponse.json({ error: "Failed to freeze implementation report artifact" }, { status: 500 });
  }
  const { data: implementationReport, error } = await access.supabase.from("land_use_plan_implementation_reports").insert({
    workspace_id: access.plan.workspace_id,
    plan_id: access.plan.id,
    adopted_version_id: version.id,
    reporting_period_start: parsed.data.reportingPeriodStart,
    reporting_period_end: parsed.data.reportingPeriodEnd,
    summary: parsed.data.summary ?? null,
    action_status_snapshot: actions ?? [],
    content_hash: contentHash,
    report_id: report.id,
    generated_by: access.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Report artifact was created but the plan register could not record it" }, { status: 500 });
  return NextResponse.json({ implementationReportId: implementationReport.id, reportId: report.id, contentHash }, { status: 201 });
}
