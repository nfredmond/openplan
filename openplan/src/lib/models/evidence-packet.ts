type EvidencePacketKpiItem = {
  name?: string;
  label?: string;
  value?: number | null;
  unit?: string | null;
  geometry_ref?: string | null;
};

export type NormalizedEvidencePacket = {
  packet_version: string;
  generated_at: string;
  run_id: string;
  model_id: string;
  model_title: string;
  engine: string;
  inputs: {
    query_text: string | null;
    corridor_geojson: unknown | null;
    input_snapshot: Record<string, unknown>;
    network_package: Record<string, unknown> | null;
    zone_count: number | null;
    skim_config: Record<string, unknown> | null;
  };
  assumptions: {
    snapshot: Record<string, unknown>;
    query_text: string | null;
    corridor_geojson_hash: string | null;
  };
  outputs: {
    kpi_summary: Record<string, EvidencePacketKpiItem[]>;
    artifacts: Array<{
      type: string;
      file_url: string | null;
      hash: string | null;
      size_bytes: number | null;
    }>;
    stages: Array<{
      name: string;
      status: string;
      duration_s: number | null;
    }>;
    result_summary: Record<string, unknown>;
    engine_summary: Record<string, unknown> | null;
  };
  caveats: string[];
  provenance: {
    platform: string;
    engine_version: string;
    run_started_at: string | null;
    run_completed_at: string | null;
    run_status: string | null;
    fallback_reason: string | null;
    source_packet_format: string;
  };
};

type NormalizeEvidencePacketOptions = {
  rawPacket?: unknown;
  modelId: string;
  modelRunId: string;
  modelTitle: string;
  runRecord: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  stages: Array<Record<string, unknown>>;
  kpis: Array<Record<string, unknown>>;
  generatedAt?: string;
  fallbackReason?: string | null;
};

type EvidenceHighlight = {
  label: string;
  value: string;
  detail: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

export function buildEvidenceKpiSummary(kpis: Array<Record<string, unknown>>) {
  const summary: Record<string, EvidencePacketKpiItem[]> = {};

  for (const row of kpis) {
    const category = asString(row.kpi_category) ?? "general";
    if (!summary[category]) {
      summary[category] = [];
    }

    summary[category].push({
      name: asString(row.kpi_name) ?? undefined,
      label: asString(row.kpi_label) ?? undefined,
      value: asNumber(row.value),
      unit: asString(row.unit),
      geometry_ref: asString(row.geometry_ref),
    });
  }

  return summary;
}

export function buildEvidenceStageSummaries(stages: Array<Record<string, unknown>>) {
  return stages.map((stage) => {
    const started = asString(stage.started_at);
    const completed = asString(stage.completed_at);
    const startedMs = started ? new Date(started).getTime() : null;
    const completedMs = completed ? new Date(completed).getTime() : null;
    const durationS =
      startedMs !== null && completedMs !== null && Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, Math.round((completedMs - startedMs) / 1000))
        : null;

    return {
      name: asString(stage.stage_name) ?? "Unnamed stage",
      status: asString(stage.status) ?? "unknown",
      duration_s: durationS,
    };
  });
}

export function buildEvidenceArtifactList(artifacts: Array<Record<string, unknown>>) {
  return artifacts.map((artifact) => ({
    type: asString(artifact.artifact_type) ?? "artifact",
    file_url: asString(artifact.file_url),
    hash: asString(artifact.content_hash),
    size_bytes: asNumber(artifact.file_size_bytes),
  }));
}

export function normalizeEvidencePacket({
  rawPacket,
  modelId,
  modelRunId,
  modelTitle,
  runRecord,
  artifacts,
  stages,
  kpis,
  generatedAt,
  fallbackReason = null,
}: NormalizeEvidencePacketOptions): NormalizedEvidencePacket {
  const nowIso = generatedAt ?? new Date().toISOString();
  const raw = asRecord(rawPacket) ?? {};
  const rawInputs = asRecord(raw.inputs) ?? {};
  const rawAssumptions = asRecord(raw.assumptions) ?? {};
  const rawOutputs = asRecord(raw.outputs) ?? {};
  const rawProvenance = asRecord(raw.provenance) ?? {};

  const normalizedArtifacts = buildEvidenceArtifactList(artifacts);
  const normalizedStages = buildEvidenceStageSummaries(stages);
  const normalizedKpis = buildEvidenceKpiSummary(kpis);

  const rawNetwork = asRecord(raw.network);
  const rawDemand = asRecord(raw.demand);
  const rawSkims = asRecord(raw.skims);
  const rawConvergence = asRecord(raw.convergence);

  const engineSummary = {
    ...(asRecord(rawOutputs.engine_summary) ?? {}),
    ...(rawNetwork ? { network: rawNetwork } : {}),
    ...(rawDemand ? { demand: rawDemand } : {}),
    ...(rawSkims ? { skims: rawSkims } : {}),
    ...(rawConvergence ? { convergence: rawConvergence } : {}),
    ...(asNumber(raw.loaded_links) !== null ? { loaded_links: asNumber(raw.loaded_links) } : {}),
    ...(asNumber(raw.largest_component_pct) !== null ? { largest_component_pct: asNumber(raw.largest_component_pct) } : {}),
    ...(asString(raw.network_source) ? { network_source: asString(raw.network_source) } : {}),
    ...(asString(raw.algorithm) ? { algorithm: asString(raw.algorithm) } : {}),
    ...(asString(raw.vdf) ? { vdf: asString(raw.vdf) } : {}),
    ...(asString(raw.model_area) ? { model_area: asString(raw.model_area) } : {}),
    ...(Array.isArray(raw.bbox) ? { bbox: raw.bbox } : {}),
  };

  const normalizedResultSummary = {
    ...(asRecord(runRecord.result_summary_json) ?? {}),
    ...(asRecord(rawOutputs.result_summary) ?? {}),
  };

  const networkPackage =
    (asRecord(rawInputs.network_package) ?? null) ||
    (Object.keys(engineSummary).length > 0
      ? {
          source: asString(raw.network_source),
          model_area: asString(raw.model_area),
          bbox: Array.isArray(raw.bbox) ? raw.bbox : null,
        }
      : null);

  const sourcePacketFormat =
    raw.inputs || raw.outputs || raw.provenance ? "planner-v1" : Object.keys(raw).length > 0 ? "worker-legacy" : "synthesized";

  return {
    packet_version: asString(raw.packet_version) ?? "1.0",
    generated_at: asString(raw.generated_at) ?? asString(raw.created_at) ?? nowIso,
    run_id: asString(raw.run_id) ?? (asString(runRecord.id) ?? modelRunId),
    model_id: asString(raw.model_id) ?? modelId,
    model_title: asString(raw.model_title) ?? modelTitle,
    engine: asString(raw.engine) ?? asString(runRecord.engine_key) ?? "deterministic",
    inputs: {
      query_text: asString(rawInputs.query_text) ?? asString(runRecord.query_text),
      corridor_geojson: rawInputs.corridor_geojson ?? runRecord.corridor_geojson ?? null,
      input_snapshot: (asRecord(rawInputs.input_snapshot) ?? asRecord(runRecord.input_snapshot_json) ?? {}),
      network_package: networkPackage,
      zone_count: asNumber(rawInputs.zone_count) ?? asNumber(rawNetwork?.zones),
      skim_config: (asRecord(rawInputs.skim_config) ?? asRecord(runRecord.skim_config_json) ?? null),
    },
    assumptions: {
      snapshot: asRecord(rawAssumptions.snapshot) ?? asRecord(runRecord.assumption_snapshot_json) ?? {},
      query_text: asString(rawAssumptions.query_text) ?? asString(runRecord.query_text),
      corridor_geojson_hash: asString(rawAssumptions.corridor_geojson_hash),
    },
    outputs: {
      kpi_summary: (() => {
        const provided = asRecord(rawOutputs.kpi_summary);
        if (!provided) {
          return normalizedKpis;
        }

        const mapped: Record<string, EvidencePacketKpiItem[]> = {};
        for (const [category, value] of Object.entries(provided)) {
          mapped[category] = asArray(value).map((item) => {
            const row = asRecord(item) ?? {};
            return {
              name: asString(row.name) ?? undefined,
              label: asString(row.label) ?? undefined,
              value: asNumber(row.value),
              unit: asString(row.unit),
              geometry_ref: asString(row.geometry_ref),
            };
          });
        }
        return mapped;
      })(),
      artifacts: (() => {
        const providedArtifacts = asArray(rawOutputs.artifacts);
        if (providedArtifacts.length === 0) {
          return normalizedArtifacts;
        }

        return providedArtifacts.map((artifact) => {
          const row = asRecord(artifact) ?? {};
          return {
            type: asString(row.type) ?? asString(row.artifact_type) ?? "artifact",
            file_url: asString(row.file_url) ?? asString((row as Record<string, unknown>).file),
            hash: asString(row.hash) ?? asString(row.content_hash),
            size_bytes: asNumber(row.size_bytes) ?? asNumber(row.file_size_bytes),
          };
        });
      })(),
      stages: (() => {
        const providedStages = asArray(rawOutputs.stages);
        if (providedStages.length === 0) {
          return normalizedStages;
        }

        return providedStages.map((stage) => {
          const row = asRecord(stage) ?? {};
          return {
            name: asString(row.name) ?? asString(row.stage_name) ?? "Unnamed stage",
            status: asString(row.status) ?? "unknown",
            duration_s: asNumber(row.duration_s),
          };
        });
      })(),
      result_summary: normalizedResultSummary,
      engine_summary: Object.keys(engineSummary).length > 0 ? engineSummary : null,
    },
    caveats: dedupeStrings([
      ...asArray(raw.caveats).map((value) => asString(value)),
      fallbackReason,
    ]),
    provenance: {
      platform: asString(rawProvenance.platform) ?? "OpenPlan",
      engine_version:
        asString(rawProvenance.engine_version) ??
        `${asString(runRecord.engine_key) ?? asString(raw.engine) ?? "deterministic"}-prototype-v1`,
      run_started_at: asString(rawProvenance.run_started_at) ?? asString(runRecord.started_at),
      run_completed_at: asString(rawProvenance.run_completed_at) ?? asString(runRecord.completed_at),
      run_status: asString(rawProvenance.run_status) ?? asString(runRecord.status),
      fallback_reason: fallbackReason,
      source_packet_format: sourcePacketFormat,
    },
  };
}

function formatCompactNumber(value: number | null) {
  if (value === null) return null;
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${Math.round(value).toLocaleString()}`;
  if (Number.isInteger(value)) return `${value}`;
  return `${Math.round(value * 10) / 10}`;
}

export function buildEvidenceHighlights(packet: NormalizedEvidencePacket): EvidenceHighlight[] {
  const engineSummary = packet.outputs.engine_summary ?? {};
  const network = asRecord(engineSummary.network) ?? {};
  const demand = asRecord(engineSummary.demand) ?? {};
  const skims = asRecord(engineSummary.skims) ?? {};
  const convergence = asRecord(engineSummary.convergence) ?? {};

  const highlights: EvidenceHighlight[] = [];
  const zones = asNumber(packet.inputs.zone_count) ?? asNumber(network.zones);
  if (zones !== null) {
    highlights.push({
      label: "Zones",
      value: formatCompactNumber(zones) ?? "0",
      detail: "Dynamic tract centroids carried into the model package.",
    });
  }

  const links = asNumber(network.links);
  if (links !== null) {
    highlights.push({
      label: "Links",
      value: formatCompactNumber(links) ?? "0",
      detail: "Network links available to the assignment graph.",
    });
  }

  const trips = asNumber(demand.total_trips);
  if (trips !== null) {
    highlights.push({
      label: "Trips",
      value: formatCompactNumber(trips) ?? "0",
      detail: "Estimated daily demand loaded into the run.",
    });
  }

  const avgTravelTime = asNumber(skims.avg_time_min);
  if (avgTravelTime !== null) {
    highlights.push({
      label: "Avg travel time",
      value: `${Math.round(avgTravelTime * 10) / 10} min`,
      detail: "Average skimmed OD travel time across reachable pairs.",
    });
  }

  const loadedLinks = asNumber(engineSummary.loaded_links);
  if (loadedLinks !== null) {
    highlights.push({
      label: "Loaded links",
      value: formatCompactNumber(loadedLinks) ?? "0",
      detail: "Links that received non-zero assigned demand.",
    });
  }

  const rgap = asNumber(convergence.final_gap);
  if (rgap !== null) {
    highlights.push({
      label: "Relative gap",
      value: rgap < 0.01 ? rgap.toFixed(4) : rgap.toFixed(3),
      detail: "Assignment convergence indicator from the traffic solver.",
    });
  }

  return highlights.slice(0, 6);
}

export function labelForEngineKey(engineKey: string | null | undefined) {
  if (engineKey === "aequilibrae") return "AequilibraE";
  if (engineKey === "deterministic_corridor_v1") return "Deterministic Corridor";
  if (!engineKey) return "Unknown engine";
  return engineKey
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function labelForArtifactType(artifactType: string | null | undefined) {
  if (!artifactType) return "Artifact";
  if (artifactType === "behavioral_prototype_manifest_json") return "Behavioral Prototype Manifest";
  if (artifactType === "behavioral_runtime_manifest_json") return "Behavioral Runtime Manifest";
  if (artifactType === "behavioral_runtime_summary_json") return "Behavioral Runtime Summary";
  if (artifactType === "behavioral_ingestion_summary_json") return "Behavioral Ingestion Summary";
  if (artifactType === "behavioral_kpi_summary_json") return "Behavioral KPI Summary";
  if (artifactType === "behavioral_kpi_packet_md") return "Behavioral KPI Packet";
  if (artifactType === "activitysim_bundle_manifest_json") return "ActivitySim Bundle Manifest";
  return artifactType
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatFileSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDurationSeconds(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  return leftoverMinutes > 0 ? `${hours}h ${leftoverMinutes}m` : `${hours}h`;
}

export function summarizeEvidenceCategories(packet: NormalizedEvidencePacket) {
  return Object.entries(packet.outputs.kpi_summary)
    .map(([category, items]) => ({
      category,
      count: items.length,
      topItems: items.slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
