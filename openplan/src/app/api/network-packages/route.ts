import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("network_packages.list", request);
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspace_id");

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspace_id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_packages")
    .select("*, versions:network_package_versions(*)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    audit.error("network_packages_list_failed", {
      workspaceId,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("network_packages.create", request);
  const supabase = await createClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspace_id, name, description, region_code, bbox } = body;

  if (!workspace_id || !name) {
    return NextResponse.json({ error: "Missing required fields (workspace_id, name)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_packages")
    .insert({
      workspace_id,
      name,
      description,
      region_code,
      bbox
    })
    .select()
    .single();

  if (error) {
    audit.error("network_package_insert_failed", {
      workspaceId: workspace_id,
      name,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  audit.info("network_package_created", {
    workspaceId: workspace_id,
    packageId: (data as { id?: string } | null)?.id ?? null,
  });

  return NextResponse.json({ data });
}
