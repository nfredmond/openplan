import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { readWgs84Viewport } from "@/lib/geo/wgs84-bounds";
import { loadPublicDesignationMap } from "@/lib/land-use-plans/public-map";
import { loadAdoptedReportSnapshot } from "@/lib/land-use-plans/report-snapshot";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadReportAccess } from "@/lib/reports/api";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ reportId: z.string().uuid(), designationId: z.string().uuid() });
type Context = { params: Promise<{ reportId: string; designationId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("reports.land-use-map", request);
  audit.info("report_land_use_map_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Map not found" }, { status: 404 });
  const bbox = readWgs84Viewport(request.nextUrl.searchParams.get("bbox")?.split(",").map(value => value.trim() ? Number(value) : Number.NaN));
  if (!bbox) return NextResponse.json({ error: "Pass a valid bbox=west,south,east,north" }, { status: 400 });
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadReportAccess(supabase, params.data.reportId, auth.data.user.id);
  if (access.error) return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  if (!access.report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const artifactResult = await supabase.from("report_artifacts")
    .select("metadata_json").eq("report_id", access.report.id).order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (artifactResult.error) return NextResponse.json({ error: "Report file could not be read" }, { status: 503 });
  const metadata = artifactResult.data?.metadata_json;
  const snapshot = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? await loadAdoptedReportSnapshot(supabase, access.report, metadata as Record<string, unknown>) : null;
  if (!snapshot) return NextResponse.json({ error: "Report version could not be verified" }, { status: 503 });
  const map = await loadPublicDesignationMap(snapshot.frozen, params.data.designationId, bbox, { client: supabase, workspaceId: access.report.workspace_id });
  if (!map.ok) return NextResponse.json({ error: map.reason === "not_found" ? "Map not found" : "Map could not be verified" }, { status: map.reason === "not_found" ? 404 : 503 });
  return NextResponse.json({ ...map.payload, reportId: access.report.id, versionId: snapshot.versionId, contentHash: snapshot.contentHash }, { headers: { "cache-control": "private, no-store" } });
}
