import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadReportAccess } from "@/lib/reports/api";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { SAFETY_COMPARISON_ACQUISITION_SELECT, SAFETY_COMPARISON_PROJECT_SELECT, safetyComparisonPointerSchema } from "@/lib/safety/candidate-comparison";
import { SAFETY_COMPARISON_RECORD_SELECT, readSafetyComparisonRecord, readSafetyArtifactSnapshot } from "@/lib/reports/safety-comparison-snapshot";
import { sameSafetyRevision } from "@/lib/reports/safety-revision";
import { renderSafetyComparisonCsv } from "@/lib/reports/safety-comparison-render";

type Context = { params: Promise<{ reportId: string }> };
/** Current access and exact projections; history export always names its immutable revision. */
export async function GET(request: NextRequest, context: Context) {
  const { reportId } = await context.params;
  if (!z.string().uuid().safeParse(reportId).success) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadReportAccess(client, reportId, user.id);
  if (access.error) return NextResponse.json({ error: "Report access could not be read" }, { status: 500 });
  const { report, membership } = access;
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  if (!membership || !canAccessWorkspaceAction("reports.read", membership.role)) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  if (!report.project_id || report.report_type !== "project_status" || report.land_use_plan_id) return NextResponse.json({ error: "Open a standard project-status report for this comparison." }, { status: 422 });
  const requestedRevision = request.nextUrl.searchParams.get("revisionId");
  const pointer = safetyComparisonPointerSchema.safeParse(report.metadata_json?.safetyComparisonV2);
  if (report.metadata_json?.safetyComparisonV2 !== undefined && !pointer.success) return NextResponse.json({ error: "Unsupported or malformed comparison pointer. No legacy fallback is permitted." }, { status: 422 });
  const revisionId = requestedRevision ?? (pointer.success ? pointer.data.revisionId : null);
  if (revisionId && !z.string().uuid().safeParse(revisionId).success) return NextResponse.json({ error: "Invalid comparison revision" }, { status: 400 });
  const comparisonResult = revisionId ? await client.from("report_safety_comparison_revisions").select(SAFETY_COMPARISON_RECORD_SELECT)
    .eq("id", revisionId).eq("report_id", reportId).eq("workspace_id", report.workspace_id).eq("project_id", report.project_id).maybeSingle() : null;
  const comparison = comparisonResult ? readSafetyComparisonRecord(comparisonResult.data) : null;
  if (comparisonResult && (comparisonResult.error || !comparison || (pointer.success && revisionId === pointer.data.revisionId && comparison.content_hash !== pointer.data.hash))) return NextResponse.json({ error: "The immutable comparison could not be read or verified." }, { status: 503 });
  if (request.nextUrl.searchParams.get("format") === "csv") {
    if (!requestedRevision || !comparison) return NextResponse.json({ error: "CSV export requires an exact retained revision." }, { status: 422 });
    return new NextResponse(renderSafetyComparisonCsv(comparison), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="safety-input-comparison-${comparison.id}.csv"`, "cache-control": "private, no-store" } });
  }
  const before = request.nextUrl.searchParams.get("before");
  const artifactBefore = request.nextUrl.searchParams.get("artifactBefore");
  if (before && !z.string().uuid().safeParse(before).success) return NextResponse.json({ error: "Invalid acquisition cursor" }, { status: 400 });
  if (artifactBefore && !z.string().uuid().safeParse(artifactBefore).success) return NextResponse.json({ error: "Invalid artifact cursor" }, { status: 400 });
  let acquisitionsQuery = client.from("safety_crash_ingests").select(SAFETY_COMPARISON_ACQUISITION_SELECT)
    .eq("workspace_id", report.workspace_id).eq("project_id", report.project_id).eq("status", "ready").order("id", { ascending: false }).limit(51);
  if (before) acquisitionsQuery = acquisitionsQuery.lt("id", before);
  let artifactQuery = client.from("report_artifacts").select("id, artifact_kind, generated_at, metadata_json").eq("report_id", reportId)
    .order("id", { ascending: false }).limit(51);
  if (artifactBefore) artifactQuery = artifactQuery.lt("id", artifactBefore);
  const [project, acquisitions, artifacts] = await Promise.all([
    client.from("projects").select(SAFETY_COMPARISON_PROJECT_SELECT).eq("id", report.project_id).eq("workspace_id", report.workspace_id).maybeSingle(),
    acquisitionsQuery,
    artifactQuery,
  ]);
  if (project.error || acquisitions.error || artifacts.error || !project.data) return NextResponse.json({ error: "Comparison sources unavailable. The additive Safety comparison migration may be pending." }, { status: 503 });
  const projectRow = project.data;
  const selectedId = comparison?.payload.inputs.acquisitionId ?? request.nextUrl.searchParams.get("ingestId");
  if (selectedId && !z.string().uuid().safeParse(selectedId).success) return NextResponse.json({ error: "Invalid selected acquisition" }, { status: 400 });
  const selected = selectedId ? await client.from("safety_crash_ingests").select(SAFETY_COMPARISON_ACQUISITION_SELECT)
    .eq("id", selectedId).eq("workspace_id", report.workspace_id).eq("project_id", report.project_id).eq("status", "ready").maybeSingle() : null;
  if (selected && (selected.error || !selected.data)) return NextResponse.json({ error: "The selected acquisition is unavailable in this exact project." }, { status: 422 });
  const rows = acquisitions.data ?? [];
  const artifactPage = (artifacts.data ?? []).slice(0,50);
  const v2Ids = artifactPage.filter(a => readSafetyArtifactSnapshot(a.metadata_json).kind === "v2").map(a => a.id);
  const custody = v2Ids.length ? await client.from("report_safety_comparison_generations").select("artifact_id, receipt")
    .eq("report_id", reportId).eq("workspace_id", report.workspace_id).in("artifact_id", v2Ids) : null;
  const artifactRows = artifactPage.map(artifact => {
    const recognized = readSafetyArtifactSnapshot(artifact.metadata_json);
    const receipt = (custody?.data ?? []).find(row => row.artifact_id === artifact.id)?.receipt as Record<string, unknown> | undefined;
    const freshness = recognized.kind === "invalid" ? "invalid_source" : recognized.kind !== "v2" ? "legacy" : !receipt || custody?.error ? "unavailable_custody"
      : recognized.snapshot.comparison.id !== comparison?.id || receipt.snapshotHash !== recognized.snapshot.hash || !sameSafetyRevision(receipt.reportRevision, report.updated_at) || !sameSafetyRevision(receipt.projectRevision, projectRow.updated_at) ? "historical" : "current";
    return { ...artifact, freshness };
  });
  return NextResponse.json({ actorId: user.id, report, project: projectRow, comparison, selectedAcquisition: selected?.data ?? null,
    acquisitions: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null,
    artifacts: artifactRows, artifactNextCursor: (artifacts.data?.length ?? 0)>50 ? artifactPage[49].id : null,
    canWrite: canAccessWorkspaceAction("reports.write", membership.role), historical: Boolean(requestedRevision && requestedRevision !== (pointer.success ? pointer.data.revisionId : null)) }, { headers: { "cache-control": "private, no-store" } });
}
