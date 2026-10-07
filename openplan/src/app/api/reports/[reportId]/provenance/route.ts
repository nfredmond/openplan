import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadReportAdoption } from "@/lib/land-use-plans/report-adoption";
import { loadAdoptedReportSnapshot } from "@/lib/land-use-plans/report-snapshot";
import { loadImplementationReportSnapshot } from "@/lib/land-use-plans/implementation-report-snapshot";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadReportAccess } from "@/lib/reports/api";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ reportId: z.string().uuid() });
type Context = { params: Promise<{ reportId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("reports.provenance", request);
  audit.info("report_provenance_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadReportAccess(supabase, params.data.reportId, user.id);
  if (access.error) return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  if (!access.report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: artifact, error } = await supabase.from("report_artifacts")
    .select("id, artifact_kind, generated_at, metadata_json")
    .eq("report_id", access.report.id).order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to load report provenance" }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "Report has no artifact" }, { status: 404 });
  const report = access.report;
  const metadata = artifact.metadata_json && typeof artifact.metadata_json === "object" && !Array.isArray(artifact.metadata_json)
    ? artifact.metadata_json as Record<string, unknown> : {};
  // A direct download must pass the same retained-record checks as the page.
  // The plan link and metadata also prevent a changed report type from bypassing them.
  if (report.land_use_plan_id || report.report_type === "land_use_plan_packet"
    || report.report_type === "land_use_plan_implementation_report" || metadata.landUsePlanId
    || metadata.kind === "land_use_plan_implementation_report") {
    let verified = false;
    if (report.report_type === "land_use_plan_implementation_report") {
      verified = Boolean(await loadImplementationReportSnapshot(supabase, { ...report, report_type: report.report_type }, metadata));
    } else {
      const retained = await loadAdoptedReportSnapshot(supabase, report, metadata);
      if (retained) {
        const adoption = await loadReportAdoption({ supabase, metadata, planId: retained.identity.id,
          versionId: retained.versionId, contentHash: retained.contentHash });
        verified = adoption.status !== "invalid";
      }
    }
    if (!verified) return NextResponse.json({ error: "The saved report could not be verified. No source file was downloaded." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return new NextResponse(JSON.stringify({ report, artifact }, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="openplan-report-${access.report.id}-provenance.json"`, "cache-control": "no-store" } });
}
