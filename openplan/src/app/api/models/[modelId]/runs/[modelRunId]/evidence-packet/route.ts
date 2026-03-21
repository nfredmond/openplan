import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
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
  const evidenceArtifact = artifactRows.find(
    (artifact) =>
      artifact.artifact_type === "evidence_packet" &&
      typeof artifact.file_url === "string" &&
      Boolean(artifact.file_url)
  ) as ArtifactRow | undefined;

  if (evidenceArtifact?.file_url) {
    try {
      const storedPacket = await loadJsonArtifact(evidenceArtifact.file_url);
      if (storedPacket && typeof storedPacket === "object") {
        return NextResponse.json(storedPacket);
      }
    } catch (error) {
      console.warn("Failed to load stored evidence packet artifact", {
        modelRunId: parsedParams.data.modelRunId,
        fileUrl: evidenceArtifact.file_url,
        error,
      });
    }
  }

  const caveats: string[] = [
    "Model outputs are from an uncalibrated prototype engine.",
  ];

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

  const failedStages = (stages ?? []).filter(
    (stage: Record<string, unknown>) => stage.status === "failed"
  );
  if (failedStages.length > 0) {
    caveats.push(
      `${failedStages.length} stage(s) failed during execution. Results may be incomplete.`
    );
  }

  if ((kpis ?? []).length === 0) {
    caveats.push("No KPIs were extracted for this run.");
  }

  const kpiSummary: Record<string, unknown[]> = {};
  for (const kpi of kpis ?? []) {
    const row = kpi as Record<string, unknown>;
    const category = row.kpi_category as string;
    if (!kpiSummary[category]) kpiSummary[category] = [];
    kpiSummary[category].push({
      name: row.kpi_name,
      label: row.kpi_label,
      value: row.value,
      unit: row.unit,
      geometry_ref: row.geometry_ref,
    });
  }

  const stageSummaries = (stages ?? []).map((stage: Record<string, unknown>) => {
    const started = stage.started_at
      ? new Date(stage.started_at as string).getTime()
      : null;
    const completed = stage.completed_at
      ? new Date(stage.completed_at as string).getTime()
      : null;
    const durationS = started && completed ? Math.round((completed - started) / 1000) : null;
    return {
      name: stage.stage_name,
      status: stage.status,
      duration_s: durationS,
    };
  });

  const runRecord = run as Record<string, unknown>;
  const evidencePacket = {
    packet_version: "1.0-fallback",
    generated_at: new Date().toISOString(),
    run_id: parsedParams.data.modelRunId,
    model_id: parsedParams.data.modelId,
    model_title: access.model.title,
    engine: runRecord.engine_key ?? "deterministic",
    inputs: {
      query_text: runRecord.query_text ?? null,
      corridor_geojson: runRecord.corridor_geojson ?? null,
      input_snapshot: runRecord.input_snapshot_json ?? {},
    },
    assumptions: {
      snapshot: runRecord.assumption_snapshot_json ?? {},
    },
    outputs: {
      kpi_summary: kpiSummary,
      artifacts: artifactRows.map((artifact) => ({
        type: artifact.artifact_type,
        file_url: artifact.file_url,
        hash: artifact.content_hash ?? null,
        size_bytes: artifact.file_size_bytes ?? null,
      })),
      stages: stageSummaries,
      result_summary: runRecord.result_summary_json ?? {},
    },
    caveats,
    provenance: {
      platform: "OpenPlan",
      engine_version: `${runRecord.engine_key ?? "deterministic"}-prototype-v1`,
      run_started_at: runRecord.started_at,
      run_completed_at: runRecord.completed_at,
      run_status: runRecord.status,
      fallback_reason: evidenceArtifact?.file_url
        ? "Stored evidence artifact could not be loaded; synthesized fallback returned."
        : "No stored evidence artifact was available; synthesized fallback returned.",
    },
  };

  return NextResponse.json(evidencePacket);
}
