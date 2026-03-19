import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/models/[modelId]/runs/[modelRunId]/skims
// List skim artifacts for a specific model run
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ modelId: string; modelRunId: string }> }
) {
  const { modelRunId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("model_run_artifacts")
    .select("*")
    .eq("run_id", modelRunId)
    .eq("artifact_type", "skim_matrix")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    run_id: modelRunId,
    skim_count: (data ?? []).length,
    skims: data ?? [],
  });
}

// POST /api/models/[modelId]/runs/[modelRunId]/skims
// Register a generated skim artifact (called by worker after skim computation)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ modelId: string; modelRunId: string }> }
) {
  const { modelRunId } = await params;
  const supabase = await createClient();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const period = (body.period as string) ?? "am_peak";
  const mode = (body.mode as string) ?? "auto";
  const fileUrl = body.file_url as string;
  const fileSizeBytes = (body.file_size_bytes as number) ?? null;
  const contentHash = (body.content_hash as string) ?? null;
  const stageId = (body.stage_id as string) ?? null;

  if (!fileUrl) {
    return NextResponse.json({ error: "file_url is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("model_run_artifacts")
    .insert({
      run_id: modelRunId,
      stage_id: stageId,
      artifact_type: "skim_matrix",
      file_url: fileUrl,
      file_size_bytes: fileSizeBytes,
      content_hash: contentHash,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    message: `Skim artifact registered: ${period}_${mode}`,
    artifact: data,
  }, { status: 201 });
}
