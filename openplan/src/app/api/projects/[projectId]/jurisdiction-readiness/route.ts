import { PROJECT_JURISDICTION_COLUMNS } from "@/lib/projects/project-jurisdiction";
import { NextRequest, NextResponse } from "next/server";
import { buildProjectJurisdictionReadinessPayload, buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const audit = createApiAuditLogger("projects.jurisdiction_readiness.read", request);
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await supabase
    .from("projects")
    .select(PROJECT_JURISDICTION_COLUMNS)
    .eq("id", projectId)
    .maybeSingle();
  if (read.error) {
    audit.error("project_jurisdiction_readiness_failed", { projectId, message: read.error.message });
    return NextResponse.json({ error: "Project jurisdiction could not be read" }, { status: 500 });
  }
  if (!read.data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  let payload;
  try { payload = (download ? buildProjectJurisdictionReadinessExportPayload : buildProjectJurisdictionReadinessPayload)(read.data, jurisdictionReadinessRegistrySha256()); }
  catch {
    return NextResponse.json({ error: "Saved project jurisdiction is invalid or was not read. Readiness is unavailable." }, { status: 500 });
  }
  audit.info("project_jurisdiction_readiness_read", {
    projectId,
    contextSource: payload.contextSource,
    download,
    registrySha256: payload.registrySha256,
  });
  return NextResponse.json(payload, {
    headers: download
      ? { "Cache-Control": "private, no-store", "content-disposition": `attachment; filename="jurisdiction-readiness-${projectId}.json"` }
      : { "Cache-Control": "private, no-store" },
  });
}
