import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import {
  normalizeEvidencePacket,
  type NormalizedEvidencePacketScenarioBasis,
} from "@/lib/models/evidence-packet";
import { getBehavioralDemandDefaultCaveats, getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

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

type ScenarioSetRow = {
  id: string;
  title: string | null;
  status: string | null;
};

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  label: string | null;
  entry_type: string | null;
  status: string | null;
};

type ScenarioSpineRow = {
  updated_at?: string | null;
  snapshot_at?: string | null;
};

function latestTimestamp(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (typeof value === "string" ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

async function loadScenarioBasis({
  supabase,
  scenarioSetId,
  scenarioEntryId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  scenarioSetId: string | null;
  scenarioEntryId: string | null;
}): Promise<{
  scenarioBasis: NormalizedEvidencePacketScenarioBasis | null;
  warning: string | null;
}> {
  if (!scenarioSetId && !scenarioEntryId) {
    return { scenarioBasis: null, warning: null };
  }

  const scenarioEntryResult = scenarioEntryId
    ? await supabase
        .from("scenario_entries")
        .select("id, scenario_set_id, label, entry_type, status")
        .eq("id", scenarioEntryId)
        .maybeSingle()
    : { data: null, error: null };

  if (scenarioEntryResult.error) {
    return {
      scenarioBasis: null,
      warning: "Scenario entry provenance could not be loaded for this run.",
    };
  }

  const scenarioEntry = (scenarioEntryResult.data ?? null) as ScenarioEntryRow | null;
  const effectiveScenarioSetId = scenarioSetId ?? scenarioEntry?.scenario_set_id ?? null;

  if (!effectiveScenarioSetId) {
    return {
      scenarioBasis: {
        scenario_set: null,
        scenario_entry: scenarioEntry
          ? {
              id: scenarioEntry.id,
              label: scenarioEntry.label,
              entry_type: scenarioEntry.entry_type,
              status: scenarioEntry.status,
            }
          : null,
        shared_spine: null,
      },
      warning: null,
    };
  }

  const [scenarioSetResult, assumptionSetsResult, dataPackagesResult, indicatorSnapshotsResult] = await Promise.all([
    supabase
      .from("scenario_sets")
      .select("id, title, status")
      .eq("id", effectiveScenarioSetId)
      .maybeSingle(),
    supabase
      .from("scenario_assumption_sets")
      .select("updated_at")
      .eq("scenario_set_id", effectiveScenarioSetId),
    supabase
      .from("scenario_data_packages")
      .select("updated_at")
      .eq("scenario_set_id", effectiveScenarioSetId),
    supabase
      .from("scenario_indicator_snapshots")
      .select("snapshot_at")
      .eq("scenario_set_id", effectiveScenarioSetId),
  ]);

  if (scenarioSetResult.error) {
    return {
      scenarioBasis: null,
      warning: "Scenario set provenance could not be loaded for this run.",
    };
  }

  const scenarioSpinePending = [
    assumptionSetsResult.error,
    dataPackagesResult.error,
    indicatorSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));

  if (
    !scenarioSpinePending &&
    (assumptionSetsResult.error || dataPackagesResult.error || indicatorSnapshotsResult.error)
  ) {
    return {
      scenarioBasis: {
        scenario_set: (scenarioSetResult.data ?? null) as ScenarioSetRow | null,
        scenario_entry: scenarioEntry
          ? {
              id: scenarioEntry.id,
              label: scenarioEntry.label,
              entry_type: scenarioEntry.entry_type,
              status: scenarioEntry.status,
            }
          : null,
        shared_spine: null,
      },
      warning: "Scenario shared spine provenance could not be fully loaded for this run.",
    };
  }

  const assumptionSets = scenarioSpinePending
    ? []
    : ((assumptionSetsResult.data ?? []) as ScenarioSpineRow[]);
  const dataPackages = scenarioSpinePending
    ? []
    : ((dataPackagesResult.data ?? []) as ScenarioSpineRow[]);
  const indicatorSnapshots = scenarioSpinePending
    ? []
    : ((indicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]);

  return {
    scenarioBasis: {
      scenario_set: (scenarioSetResult.data ?? null) as ScenarioSetRow | null,
      scenario_entry: scenarioEntry
        ? {
            id: scenarioEntry.id,
            label: scenarioEntry.label,
            entry_type: scenarioEntry.entry_type,
            status: scenarioEntry.status,
          }
        : null,
      shared_spine: {
        schema_pending: scenarioSpinePending,
        assumption_set_count: assumptionSets.length,
        data_package_count: dataPackages.length,
        indicator_snapshot_count: indicatorSnapshots.length,
        latest_assumption_set_updated_at: latestTimestamp(
          assumptionSets.map((row) => row.updated_at ?? null)
        ),
        latest_data_package_updated_at: latestTimestamp(
          dataPackages.map((row) => row.updated_at ?? null)
        ),
        latest_indicator_snapshot_at: latestTimestamp(
          indicatorSnapshots.map((row) => row.snapshot_at ?? null)
        ),
      },
    },
    warning: null,
  };
}

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
  const audit = createApiAuditLogger("model_runs.evidence_packet", request);
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
    audit.error("model_access_lookup_failed", { modelId: parsedParams.data.modelId });
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
    if (runError) {
      audit.error("model_run_lookup_failed", {
        modelRunId: parsedParams.data.modelRunId,
        message: runError.message,
        code: runError.code ?? null,
      });
    }
    return NextResponse.json({ error: "Model run not found." }, { status: 404 });
  }

  const [{ data: stages }, { data: artifacts }, { data: kpis }, scenarioBasisResult] = await Promise.all([
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
    loadScenarioBasis({
      supabase,
      scenarioSetId:
        typeof run.scenario_set_id === "string"
          ? run.scenario_set_id
          : typeof access.model.scenario_set_id === "string"
            ? access.model.scenario_set_id
            : null,
      scenarioEntryId: typeof run.scenario_entry_id === "string" ? run.scenario_entry_id : null,
    }),
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

  if (scenarioBasisResult.warning) {
    caveats.push(scenarioBasisResult.warning);
  }

  let storedPacket: unknown | undefined;
  let fallbackReason: string | null = null;

  if (evidenceArtifact?.file_url) {
    try {
      storedPacket = await loadJsonArtifact(evidenceArtifact.file_url);
    } catch (error) {
      audit.warn("evidence_packet_artifact_load_failed", {
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
    scenarioBasis: scenarioBasisResult.scenarioBasis,
  });

  evidencePacket.caveats = Array.from(new Set([...evidencePacket.caveats, ...caveats]));

  return NextResponse.json(evidencePacket);
}
