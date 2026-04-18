import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

// GET /api/network-packages/[packageId]/versions/[versionId]/corridors
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const audit = createApiAuditLogger("network_corridors.list", req);
  const { versionId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("network_corridors")
    .select("*")
    .eq("package_version_id", versionId)
    .order("corridor_name", { ascending: true });

  if (error) {
    audit.error("network_corridors_list_failed", {
      versionId,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/network-packages/[packageId]/versions/[versionId]/corridors
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const audit = createApiAuditLogger("network_corridors.create", req);
  const { versionId } = await params;
  const supabase = await createClient();
  const body = await req.json();

  const { data, error } = await supabase
    .from("network_corridors")
    .insert({
      package_version_id: versionId,
      corridor_name: body.corridor_name,
      corridor_type: body.corridor_type ?? "highway",
      geometry_geojson: body.geometry_geojson ?? null,
      direction: body.direction ?? "both",
      properties: body.properties ?? {},
    })
    .select()
    .single();

  if (error) {
    audit.error("network_corridor_insert_failed", {
      versionId,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
