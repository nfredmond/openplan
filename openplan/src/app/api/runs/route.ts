import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const workspaceIdSchema = z.string().uuid();
const runIdSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const parsed = workspaceIdSchema.safeParse(workspaceId);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspaceId" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select(
      "id, workspace_id, title, query_text, corridor_geojson, metrics, result_geojson, summary_text, created_at"
    )
    .eq("workspace_id", parsed.data)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch runs",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ runs: data ?? [] }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("id");
  const parsed = runIdSchema.safeParse(runId);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("runs").delete().eq("id", parsed.data);

  if (error) {
    return NextResponse.json(
      {
        error: "Failed to delete run",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
