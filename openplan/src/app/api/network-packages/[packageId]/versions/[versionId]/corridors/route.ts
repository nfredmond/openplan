import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/network-packages/[packageId]/versions/[versionId]/corridors
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const { versionId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("network_corridors")
    .select("*")
    .eq("package_version_id", versionId)
    .order("corridor_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/network-packages/[packageId]/versions/[versionId]/corridors
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
