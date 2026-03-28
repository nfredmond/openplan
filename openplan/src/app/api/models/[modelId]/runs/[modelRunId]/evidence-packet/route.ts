import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";
import { normalizeEvidencePacket } from "@/lib/models/evidence-packet";
import { getBehavioralDemandDefaultCaveats, getManagedRunModeDefinition } from "@/lib/models/run-modes";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

type ArtifactRow = {
  artifact_type: string;
  file_url: string | null;
  content_hash: string | null;
  file_size_bytes: number | null;
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

// GET /api/models/[modelId]/runs/[modelRunId]/evidence-packet
// Return the worker-authored evidence packet when available, with a synthesized fallback.
export async function GET(request: NextRequest, context: RouteContext) {
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

  const access = await loadModelAccess(
    supabase,
    parsedParams.data.modelId,
    user.id,
    "models.read"
  );

  if (access.error) {
    return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  }
  if (!access.model) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 });
  }
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("*")
    .eq("id", parsedParams.data.modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();

  if (runError || !run) {
    return NextResponse.json({ error: "Model run not found." }, { status: 404 });
  }

  const [{ data: stages }, { data: artifacts }, { data: kpis }] = await Promise.all([
    supabase
      .from("model_run_stages")
      .select("*")
      .eq("run_id", parsedParams.data.modelRunId)
      .order("created_at", { ascending: true }),
    supabase
      .from("model_run_artifacts")
      .select("*")
      .eq("run_id", parsedParams.data.modelRunId)
      .order("created_at", { ascending: true }),
    supabase
      .from("model_run_kpis")
      .select("*")
      .eq("run_id", parsedParams.data.modelRunId)
      .order("kpi_category", { ascending: true }),
  ]);

  const artifactRows = (artifacts ?? []) as Array<Record<string, unknown>>;
  const stageRows = (stages ?? []) as Array<Record<string, unknown>>;
  const kpiRows = (kpis ?? []) as Array<Record<string, unknown>>;
  const evidenceArtifact = artifactRows.find(
    (artifact) =>
      artifact.artifact_type === "evidence_packet" &&
      typeof artifact.file_url === "string" &&
      Boolean(artifact.file_url)
  ) as ArtifactRow | undefined;

  const runRecord = run as Record<string, unknown>;
  const runMode = getManagedRunModeDefinition(typeof runRecord.engine_key === "string" ? runRecord.engine_key : null);
  const caveats: string[] = ["Model outputs are from an uncalibrated prototype engine."];

  if (runRecord.engine_key === "behavioral_demand") {
    caveats.push(runMode.runtimeExpectation, runMode.caveatSummary, ...getBehavioralDemandDefaultCaveats());
  }

  const hasTransitSkims = artifactRows.some(
    (artifact) =>
      artifact.artifact_type === "skim_matrix" &&
      typeof artifact.file_url === "string" &&
      artifact.file_url.includes("transit")
  );
  if (!hasTransitSkims) {
    caveats.push(
      "Transit skims are not included in this run (no transit network data or transit mode not configured)."
    );
  }

  const failedStages = stageRows.filter(
    (stage) => stage.status === "failed"
  );
  if (failedStages.length > 0) {
    caveats.push(
      `${failedStages.length} stage(s) failed during execution. Results may be incomplete.`
    );
  }

  if (kpiRows.length === 0) {
    caveats.push("No KPIs were extracted for this run.");
  }

  let storedPacket: unknown | undefined;
  let fallbackReason: string | null = null;

  if (evidenceArtifact?.file_url) {
    try {
      storedPacket = await loadJsonArtifact(evidenceArtifact.file_url);
    } catch (error) {
      console.warn("Failed to load stored evidence packet artifact", {
        modelRunId: parsedParams.data.modelRunId,
        fileUrl: evidenceArtifact.file_url,
        error,
      });
      fallbackReason = "Stored evidence artifact could not be loaded; synthesized fallback returned.";
    }
  } else {
    fallbackReason = "No stored evidence artifact was available; synthesized fallback returned.";
  }

  const evidencePacket = normalizeEvidencePacket({
    rawPacket: storedPacket,
    modelId: parsedParams.data.modelId,
    modelRunId: parsedParams.data.modelRunId,
    modelTitle: access.model.title ?? "Untitled model",
    runRecord,
    artifacts: artifactRows,
    stages: stageRows,
    kpis: kpiRows,
    fallbackReason,
  });

  evidencePacket.caveats = Array.from(new Set([...evidencePacket.caveats, ...caveats]));

  return NextResponse.json(evidencePacket);
}
