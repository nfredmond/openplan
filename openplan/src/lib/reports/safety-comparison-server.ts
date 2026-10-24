import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { loadReportAccess, type ReportAccessRow } from "./api";
import { sameSafetyRevision } from "./safety-plan-persistence";
import { safetyComparisonCommandSchema, safetyComparisonPointerSchema, safetyComparisonReceiptSchema, SAFETY_COMPARISON_MIGRATION } from "@/lib/safety/candidate-comparison";
import { SAFETY_COMPARISON_RECORD_SELECT, readSafetyComparisonRecord, buildSafetyComparisonSnapshot } from "./safety-comparison-snapshot";
import { renderSafetyComparisonHtml } from "./safety-comparison-render";
import { renderReportPdf } from "./pdf";
import { createApiAuditLogger } from "@/lib/observability/audit";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const safetyComparisonPatchSchema = z.object({ safetyComparison: safetyComparisonCommandSchema }).strict();
const revision = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const safetyComparisonGenerateSchema = z.object({
  requestId: z.string().uuid(), revisionId: z.string().uuid(), contentHash: hash,
  expectedReportRevision: revision, expectedProjectRevision: revision,
  format: z.enum(["html", "pdf"]),
}).strict();
export const comparisonGenerationReceiptSchema = z.object({
  schema: z.literal("openplan.safety-comparison-generation.v2"), requestId: z.string().uuid(), requestHash: hash,
  artifactId: z.string().uuid(), reportId: z.string().uuid(), projectId: z.string().uuid(), workspaceId: z.string().uuid(),
  revisionId: z.string().uuid(), contentHash: hash, snapshotHash: hash,
  sourceProjectRevision: revision, projectRevision: revision, sourceReportRevision: revision, reportRevision: revision,
}).strict();

/** Only database refusal proves rollback. Unknown responses keep the original request and objects. */
function failed(error: { code?: string; message: string }) {
  const pending = looksLikePendingSchema(error.message);
  const conflict = ["40001", "55P03"].includes(error.code ?? "");
  const rejected = ["23514", "42501", "P0002"].includes(error.code ?? "");
  return NextResponse.json({ error: pending ? `Safety comparison requires migration ${SAFETY_COMPARISON_MIGRATION}.` : conflict ? "Source revision or mutation fence changed. No partial write is accepted. Reopen the source after this rejected request." : rejected ? "The comparison command refused its source, permission or immutable-record contract." : "Outcome unknown. Retain and retry this exact request; do not create a new request.", outcome: pending || conflict || rejected ? "refused" : "outcome_unknown" }, { status: pending ? 503 : conflict ? 409 : error.code === "42501" ? 403 : rejected ? 422 : 500 });
}
export async function saveSafetyComparison(request: NextRequest, report: ReportAccessRow, actorId: string, payload: unknown) {
  const audit = createApiAuditLogger("reports.safety-comparison.save", request);
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Safety comparison writes require a person. No scoped approved assistant action exists.", outcome: "refused" }, { status: 403 });
  const parsed = safetyComparisonPatchSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Use an exclusive Safety comparison command. Legacy report, section and run-link edits cannot be mixed.", outcome: "refused", issues: parsed.error.issues }, { status: 400 });
  const command = parsed.data.safetyComparison;
  const commandText = JSON.stringify(command);
  try {
    const result = await createServiceRoleClient().rpc("save_safety_comparison", { p_actor: actorId, p_report: report.id, p_command_text: commandText });
    if (result.error) return failed(result.error);
    const receipt = safetyComparisonReceiptSchema.safeParse(result.data);
    if (!receipt.success || receipt.data.reportId !== report.id || receipt.data.projectId !== report.project_id || receipt.data.workspaceId !== report.workspace_id || receipt.data.requestId !== command.requestId || receipt.data.requestHash !== digest(commandText) || !sameSafetyRevision(receipt.data.beforeReportRevision, command.expectedReportRevision) || !sameSafetyRevision(receipt.data.beforeProjectRevision, command.expectedProjectRevision)) return failed({ message: "Invalid receipt" });
    audit.info("comparison_receipt_retained", { reportId: report.id, actorId, requestId: command.requestId, revisionId: receipt.data.revisionId, contentHash: receipt.data.contentHash });
    return NextResponse.json({ saved: true, receipt: receipt.data });
  } catch { return failed({ message: "Uncertain transport" }); }
}

/** V2 never falls through to legacy generation or the old report-only agent approval. */
export async function generateSafetyComparison(request: NextRequest, reportId: string, raw: unknown) {
  const audit = createApiAuditLogger("reports.safety-comparison.generate", request);
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Safety comparison generation requires a person. Existing v1 approval does not bind this comparison.", outcome: "refused" }, { status: 403 });
  const parsed = safetyComparisonGenerateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid explicit comparison generation command", outcome: "refused" }, { status: 400 });
  const command = parsed.data; const commandText = JSON.stringify(command); const requestHash = digest(commandText);
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", outcome: "refused" }, { status: 401 });
    const access = await loadReportAccess(client, reportId, user.id);
    if (access.error) return failed(access.error);
    if (!access.report) return NextResponse.json({ error: "Report not found", outcome: "refused" }, { status: 404 });
    if (!access.membership || !canAccessWorkspaceAction("reports.write", access.membership.role)) return NextResponse.json({ error: "Workspace access denied", outcome: "refused" }, { status: 403 });
    const report = access.report;
    const prior = await client.from("report_safety_comparison_generations").select("command_hash, receipt")
      .eq("report_id", reportId).eq("workspace_id", report.workspace_id).eq("actor_id", user.id).eq("request_id", command.requestId).maybeSingle();
    if (prior.error) return failed(prior.error);
    if (prior.data) {
      if (prior.data.command_hash !== requestHash) return failed({ code: "23514", message: "Changed request" });
      // RPC rechecks current access and resolves only the receipt, even after a newer save.
      const replay = await createServiceRoleClient().rpc("persist_safety_comparison_generation", { p_actor: user.id, p_report: reportId, p_command_text: commandText, p_artifact: {} });
      if (replay.error) return failed(replay.error);
      const receipt = comparisonGenerationReceiptSchema.safeParse(replay.data);
      if (!receipt.success || receipt.data.requestHash !== requestHash || receipt.data.artifactId !== command.requestId || receipt.data.reportId !== reportId || receipt.data.workspaceId !== report.workspace_id || receipt.data.revisionId !== command.revisionId || receipt.data.contentHash !== command.contentHash) return failed({ message: "Invalid replay receipt" });
      return NextResponse.json({ generated: true, replayed: true, receipt: receipt.data });
    }
    const pointer = safetyComparisonPointerSchema.safeParse(report.metadata_json?.safetyComparisonV2);
    if (!pointer.success || pointer.data.revisionId !== command.revisionId || pointer.data.hash !== command.contentHash) return failed({ code: "40001", message: "Current comparison changed" });
    const result = await client.from("report_safety_comparison_revisions").select(SAFETY_COMPARISON_RECORD_SELECT)
      .eq("id", command.revisionId).eq("report_id", reportId).eq("project_id", report.project_id!).eq("workspace_id", report.workspace_id).maybeSingle();
    if (result.error) return failed(result.error);
    const comparison = readSafetyComparisonRecord(result.data);
    if (!comparison) return failed({ code: "23514", message: "Invalid immutable comparison" });
    const generatedAt = new Date().toISOString();
    const snapshot = buildSafetyComparisonSnapshot({ artifactId: command.requestId, reportId, projectId: comparison.project_id, workspaceId: comparison.workspace_id,
      generatedAt, reportUpdatedAt: command.expectedReportRevision, projectUpdatedAt: command.expectedProjectRevision, comparison });
    const html = renderSafetyComparisonHtml(comparison);
    const rendered = command.format === "pdf" ? await renderReportPdf(html, { title: comparison.payload.inputs.title, generatedAt, footerLabel: "Safety input comparison, effects unassessed" }) : null;
    const bytes = rendered ? Buffer.from(rendered.bytes) : Buffer.from(html, "utf8");
    const bytesHash = digest(bytes);
    const path = `${report.workspace_id}/${reportId}/${command.requestId}-${bytesHash}.${command.format}`;
    const service = createServiceRoleClient();
    const upload = await service.storage.from("report-artifacts").upload(path, bytes, { contentType: command.format === "pdf" ? "application/pdf" : "text/html", upsert: false });
    // Content-addressed retries may find the original bytes. Never overwrite or delete.
    if (upload.error) {
      const existing = await service.storage.from("report-artifacts").download(path);
      if (existing.error || !existing.data || digest(new Uint8Array(await existing.data.arrayBuffer())) !== bytesHash) return failed({ message: "Upload custody unknown" });
    }
    const artifact = { id: command.requestId, report_id: reportId, artifact_kind: command.format, storage_path: path, generated_by: user.id, generated_at: generatedAt,
      metadata_json: { safetyPlanSnapshotV2: snapshot, htmlContent: html, sha256: bytesHash, pdfEngine: rendered?.engine ?? null } };
    const persisted = await service.rpc("persist_safety_comparison_generation", { p_actor: user.id, p_report: reportId, p_command_text: commandText, p_artifact: artifact });
    if (persisted.error) return failed(persisted.error);
    const receipt = comparisonGenerationReceiptSchema.safeParse(persisted.data);
    if (!receipt.success || receipt.data.requestHash !== requestHash || receipt.data.artifactId !== command.requestId || receipt.data.reportId !== reportId || receipt.data.projectId !== comparison.project_id || receipt.data.workspaceId !== comparison.workspace_id || receipt.data.revisionId !== comparison.id || receipt.data.contentHash !== comparison.content_hash || receipt.data.snapshotHash !== snapshot.hash || !sameSafetyRevision(receipt.data.sourceProjectRevision, command.expectedProjectRevision) || !sameSafetyRevision(receipt.data.sourceReportRevision, command.expectedReportRevision)) return failed({ message: "Uncertain generation receipt" });
    audit.info("comparison_artifact_retained", { reportId, actorId: user.id, artifactId: receipt.data.artifactId, revisionId: comparison.id, contentHash: comparison.content_hash, snapshotHash: snapshot.hash });
    return NextResponse.json({ generated: true, receipt: receipt.data });
  } catch { return failed({ message: "Uncertain generation transport" }); }
}

export async function patchSafetyComparison(request: NextRequest, reportId: string, payload: unknown) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", outcome: "refused" }, { status: 401 });
  const access = await loadReportAccess(client, reportId, user.id);
  if (access.error) return failed(access.error);
  if (!access.report) return NextResponse.json({ error: "Report not found", outcome: "refused" }, { status: 404 });
  if (!access.membership || !canAccessWorkspaceAction("reports.write", access.membership.role)) return NextResponse.json({ error: "Workspace access denied", outcome: "refused" }, { status: 403 });
  return saveSafetyComparison(request, access.report, user.id, payload);
}
