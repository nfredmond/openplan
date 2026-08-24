import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadReportAccess(supabase, params.data.reportId, user.id);
  if (access.error) return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  if (!access.report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: artifact, error } = await supabase.from("report_artifacts")
    .select("id, artifact_kind, generated_at, metadata_json")
    .eq("report_id", access.report.id).order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to load report provenance" }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "Report has no artifact" }, { status: 404 });
  return new NextResponse(JSON.stringify({ report: access.report, artifact }, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="openplan-report-${access.report.id}-provenance.json"`, "cache-control": "no-store" } });
}
