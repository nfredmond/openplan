import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";
import {
  loadJsonArtifact,
  resolveRunWorkDir,
  workerLocalRoot,
} from "../volumes/artifact-source";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = { params: Promise<{ modelId: string; modelRunId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });

  const { modelId, modelRunId } = parsed.data;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await loadModelAccess(supabase, modelId, user.id, "models.read");
  if (access.error) return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  if (!access.model) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const { data: run } = await supabase
    .from("model_runs")
    .select("id, status")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Model run not found" }, { status: 404 });
  if (run.status !== "succeeded") {
    return NextResponse.json({ error: "Run has not completed yet", status: run.status }, { status: 400 });
  }

  const { data: artifacts, error } = await supabase
    .from("model_run_artifacts")
    .select("artifact_type, file_url")
    .eq("run_id", modelRunId)
    .eq("artifact_type", "demand_model_agreement_geojson")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: "Failed to load agreement artifact" }, { status: 500 });
  const fileUrl = artifacts?.[0]?.file_url;
  if (typeof fileUrl !== "string" || !fileUrl) {
    return NextResponse.json({ error: "Agreement GeoJSON is not available for this run" }, { status: 404 });
  }

  try {
    const localRoot = workerLocalRoot();
    const geojson = await loadJsonArtifact(fileUrl, {
      bucket: "run-artifacts",
      objectPathPrefix: `model-runs/${modelRunId}/`,
      localRoot: localRoot ? resolveRunWorkDir(localRoot, modelRunId) : undefined,
    });
    return NextResponse.json(geojson);
  } catch {
    return NextResponse.json({ error: "Agreement GeoJSON could not be read" }, { status: 404 });
  }
}
