import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/network-packages/[packageId]/versions/[versionId]/connectors
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const { versionId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("network_connectors")
    .select("*, network_zones(zone_id_external, name)")
    .eq("package_version_id", versionId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/network-packages/[packageId]/versions/[versionId]/connectors
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const { versionId } = await params;
  const supabase = await createClient();
  const body = await req.json();

  const { data, error } = await supabase
    .from("network_connectors")
    .insert({
      zone_id: body.zone_id,
      package_version_id: versionId,
      target_node_id: body.target_node_id ?? null,
      connector_type: body.connector_type ?? "auto",
      impedance_minutes: body.impedance_minutes ?? 0,
      geometry_geojson: body.geometry_geojson ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
