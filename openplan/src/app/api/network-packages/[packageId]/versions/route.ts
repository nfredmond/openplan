import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const { packageId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("network_package_versions")
    .select("*")
    .eq("package_id", packageId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const { packageId } = await params;
  const supabase = await createClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { version_name, status, s3_prefix, manifest_json } = body;

  if (!version_name) {
    return NextResponse.json({ error: "Missing required field: version_name" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_package_versions")
    .insert({
      package_id: packageId,
      version_name,
      status: status || "draft",
      s3_prefix,
      manifest_json: manifest_json || {}
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
