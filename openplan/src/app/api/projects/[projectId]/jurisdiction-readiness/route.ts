import { NextRequest, NextResponse } from "next/server";
import { buildJurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";
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
    .select("id, place_label, place_country_code, place_subdivision_code")
    .eq("id", projectId)
    .maybeSingle();
  if (read.error) {
    audit.error("project_jurisdiction_readiness_failed", { projectId, message: read.error.message });
    return NextResponse.json({ error: "Project jurisdiction could not be read" }, { status: 500 });
  }
  if (!read.data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const payload = buildJurisdictionReadinessPayload(
    {
      countryCode: read.data.place_country_code ?? null,
      subdivisionCode: read.data.place_subdivision_code ?? null,
      label: read.data.place_label ?? null,
    },
    jurisdictionReadinessRegistrySha256(),
  );
  const download = new URL(request.url).searchParams.get("download") === "1";
  audit.info("project_jurisdiction_readiness_read", {
    projectId,
    jurisdictionId: payload.jurisdiction.id,
    download,
    registrySha256: payload.registrySha256,
  });
  return NextResponse.json(payload, {
    headers: download
      ? { "content-disposition": `attachment; filename="jurisdiction-readiness-${projectId}.json"` }
      : undefined,
  });
}
