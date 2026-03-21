import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

async function loadAuthorizedRun(
  modelId: string,
  modelRunId: string,
  permission: "models.read" | "models.write"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const access = await loadModelAccess(supabase, modelId, user.id, permission);
  if (access.error) {
    return { errorResponse: NextResponse.json({ error: "Failed to load model" }, { status: 500 }) } as const;
  }
  if (!access.model) {
    return { errorResponse: NextResponse.json({ error: "Model not found" }, { status: 404 }) } as const;
  }
  if (!access.membership || !access.allowed) {
    return { errorResponse: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) } as const;
  }

  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("id, model_id")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();

  if (runError) {
    return { errorResponse: NextResponse.json({ error: "Failed to load model run" }, { status: 500 }) } as const;
  }
  if (!run) {
    return { errorResponse: NextResponse.json({ error: "Model run not found" }, { status: 404 }) } as const;
  }

  return { supabase, access, run } as const;
}

// GET /api/models/[modelId]/runs/[modelRunId]/skims
// List skim artifacts for a specific authorized model run.
export async function GET(_req: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const auth = await loadAuthorizedRun(
    parsedParams.data.modelId,
    parsedParams.data.modelRunId,
    "models.read"
  );
  if ("errorResponse" in auth) {
    return auth.errorResponse;
  }

  const { data, error } = await auth.supabase
    .from("model_run_artifacts")
    .select("*")
    .eq("run_id", parsedParams.data.modelRunId)
    .eq("artifact_type", "skim_matrix")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    run_id: parsedParams.data.modelRunId,
    skim_count: (data ?? []).length,
    skims: data ?? [],
  });
}

// POST /api/models/[modelId]/runs/[modelRunId]/skims
// Register a generated skim artifact for an authorized model run.
export async function POST(req: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const auth = await loadAuthorizedRun(
    parsedParams.data.modelId,
    parsedParams.data.modelRunId,
    "models.write"
  );
  if ("errorResponse" in auth) {
    return auth.errorResponse;
  }

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

  const { data, error } = await auth.supabase
    .from("model_run_artifacts")
    .insert({
      run_id: parsedParams.data.modelRunId,
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

  return NextResponse.json(
    {
      message: `Skim artifact registered: ${period}_${mode}`,
      artifact: data,
    },
    { status: 201 }
  );
}
