import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

// GET /api/network-packages/[packageId]/versions/[versionId]/zones
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const audit = createApiAuditLogger("network_zones.list", req);
  const { versionId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("network_zones")
    .select("*")
    .eq("package_version_id", versionId)
    .order("zone_id_external", { ascending: true });

  if (error) {
    audit.error("network_zones_list_failed", {
      versionId,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/network-packages/[packageId]/versions/[versionId]/zones
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const audit = createApiAuditLogger("network_zones.create", req);
  const { versionId } = await params;
  const supabase = await createClient();
  const body = await req.json();

  const { data, error } = await supabase
    .from("network_zones")
    .insert({
      package_version_id: versionId,
      zone_id_external: body.zone_id_external ?? null,
      zone_type: body.zone_type ?? "taz",
      name: body.name ?? null,
      centroid_lat: body.centroid_lat ?? null,
      centroid_lng: body.centroid_lng ?? null,
      geometry_geojson: body.geometry_geojson ?? null,
      properties: body.properties ?? {},
    })
    .select()
    .single();

  if (error) {
    audit.error("network_zone_insert_failed", {
      versionId,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
