import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";
import {
  buildActivitySimHandoffPayload,
  normalizeStoredActivitySimHandoff,
} from "@/lib/models/activitysim-handoff";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

async function loadJsonArtifact(fileUrl: string): Promise<unknown> {
  if (fileUrl.startsWith("local://")) {
    const payload = await readFile(fileUrl.slice("local://".length), "utf8");
    return JSON.parse(payload);
  }

  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    const res = await fetch(fileUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Artifact fetch failed (${res.status})`);
    }
    return res.json();
  }

  const payload = await readFile(fileUrl, "utf8");
  return JSON.parse(payload);
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await loadModelAccess(supabase, parsedParams.data.modelId, user.id, "models.read");

  if (access.error) {
    return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  }
  if (!access.model) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 });
  }
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const [{ data: run, error: runError }, { data: artifacts }, { data: stages }] = await Promise.all([
    supabase
      .from("model_runs")
      .select("*")
      .eq("id", parsedParams.data.modelRunId)
      .eq("model_id", access.model.id)
      .maybeSingle(),
    supabase
      .from("model_run_artifacts")
      .select("*")
      .eq("run_id", parsedParams.data.modelRunId)
      .order("created_at", { ascending: true }),
    supabase
      .from("model_run_stages")
      .select("*")
      .eq("run_id", parsedParams.data.modelRunId)
      .order("sort_order", { ascending: true }),
  ]);

  if (runError || !run) {
    return NextResponse.json({ error: "Model run not found." }, { status: 404 });
  }

  const artifactRows = (artifacts ?? []) as Array<Record<string, unknown>>;
  const storedManifestArtifact = artifactRows.find(
    (artifact) => artifact.artifact_type === "activitysim_handoff_manifest" && typeof artifact.file_url === "string"
  );

  let storedManifest: unknown | undefined;
  if (storedManifestArtifact && typeof storedManifestArtifact.file_url === "string") {
    try {
      storedManifest = await loadJsonArtifact(storedManifestArtifact.file_url);
    } catch (error) {
      console.warn("Failed to load stored ActivitySim handoff manifest", {
        modelRunId: parsedParams.data.modelRunId,
        fileUrl: storedManifestArtifact.file_url,
        error,
      });
    }
  }

  const normalizedStored = normalizeStoredActivitySimHandoff(storedManifest);
  if (normalizedStored) {
    return NextResponse.json(normalizedStored);
  }

  const repoRoot = process.cwd();
  const runRecord = run as Record<string, unknown>;
  const inputSnapshot = (runRecord.input_snapshot_json as Record<string, unknown> | null | undefined) ?? {};
  const orchestration = (inputSnapshot.orchestration as Record<string, unknown> | null | undefined) ?? {};

  const payload = buildActivitySimHandoffPayload({
    modelId: parsedParams.data.modelId,
    modelRunId: parsedParams.data.modelRunId,
    runRecord,
    artifacts: artifactRows,
    stages: (stages ?? []) as Array<Record<string, unknown>>,
    repoRoot,
    rawManifest: storedManifest ?? {
      pipelineKey: typeof orchestration.pipelineKey === "string" ? orchestration.pipelineKey : null,
      summary: typeof orchestration.honestCapability === "string" ? orchestration.honestCapability : null,
      engineKey: typeof runRecord.engine_key === "string" ? runRecord.engine_key : null,
    },
  });

  const packageRoot = path.resolve(repoRoot, "..", "data", "pilot-nevada-county");

  return NextResponse.json({
    ...payload,
    notes: Array.from(new Set([...payload.notes, `Pilot input root: ${packageRoot}`])),
  });
}
