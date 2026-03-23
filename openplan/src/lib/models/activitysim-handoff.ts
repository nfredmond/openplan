import { existsSync } from "node:fs";
import path from "node:path";

export type ActivitySimHandoffArtifact = {
  artifactType: string;
  fileUrl: string | null;
  contentHash: string | null;
  fileSizeBytes: number | null;
  stageName: string | null;
};

export type ActivitySimHandoffCheck = {
  key: string;
  label: string;
  status: "ready" | "missing" | "partial";
  detail: string;
};

export type ActivitySimHandoffPayload = {
  schemaVersion: "openplan-activitysim-handoff.v1";
  generatedAt: string;
  modelRunId: string;
  modelId: string;
  engineKey: string | null;
  pipelineKey: string | null;
  summary: string;
  runStatus: string | null;
  readyChecks: ActivitySimHandoffCheck[];
  missingRequirements: string[];
  aequilibraeArtifacts: ActivitySimHandoffArtifact[];
  canonicalInputs: Array<{
    label: string;
    path: string;
    exists: boolean;
  }>;
  populationInputs: Array<{
    label: string;
    path: string;
    exists: boolean;
  }>;
  runtimeInputs: Array<{
    label: string;
    path: string;
    exists: boolean;
  }>;
  notes: string[];
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

function makeInputProbe(label: string, absolutePath: string) {
  return {
    label,
    path: absolutePath,
    exists: existsSync(absolutePath),
  };
}

export function getDefaultActivitySimInputProbes(repoRoot: string) {
  const pilotRoot = path.resolve(repoRoot, "..", "data", "pilot-nevada-county");
  const packageRoot = path.join(pilotRoot, "package");
  const syntheticRoot = path.join(pilotRoot, "synthetic_population");
  const activitysimRoot = path.join(pilotRoot, "activitysim");

  return {
    canonicalInputs: [
      makeInputProbe("Zone attributes", path.join(packageRoot, "zone_attributes.csv")),
      makeInputProbe("Zone centroids", path.join(packageRoot, "zone_centroids.geojson")),
      makeInputProbe("Zones", path.join(packageRoot, "zones.geojson")),
      makeInputProbe("Pilot package manifest", path.join(packageRoot, "manifest.json")),
    ],
    populationInputs: [
      makeInputProbe("Synthetic tract marginals", path.join(syntheticRoot, "tract_marginals.csv")),
      makeInputProbe("Synthetic households", path.join(syntheticRoot, "seed_households.csv")),
      makeInputProbe("Synthetic persons", path.join(syntheticRoot, "seed_persons.csv")),
    ],
    runtimeInputs: [
      makeInputProbe("ActivitySim settings", path.join(activitysimRoot, "settings.yaml")),
      makeInputProbe("ActivitySim land use", path.join(activitysimRoot, "land_use.csv")),
      makeInputProbe("ActivitySim households", path.join(activitysimRoot, "households.csv")),
      makeInputProbe("ActivitySim persons", path.join(activitysimRoot, "persons.csv")),
    ],
  };
}

export function buildActivitySimHandoffPayload({
  modelId,
  modelRunId,
  runRecord,
  artifacts,
  stages,
  repoRoot,
  rawManifest,
}: {
  modelId: string;
  modelRunId: string;
  runRecord: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  stages: Array<Record<string, unknown>>;
  repoRoot: string;
  rawManifest?: unknown;
}): ActivitySimHandoffPayload {
  const raw = asRecord(rawManifest) ?? {};
  const orchestration = asRecord(asRecord(runRecord.input_snapshot_json)?.orchestration) ?? {};

  const artifactRows = artifacts.map((artifact) => ({
    artifactType: asString(artifact.artifact_type) ?? "artifact",
    fileUrl: asString(artifact.file_url),
    contentHash: asString(artifact.content_hash),
    fileSizeBytes: asNumber(artifact.file_size_bytes),
    stageName: asString(asRecord(artifact.metadata_json)?.stage_name),
  }));

  const aequilibraeArtifacts = artifactRows.filter((artifact) =>
    ["demand_matrix", "skim_matrix", "link_volumes", "evidence_packet", "volumes_geojson", "activitysim_handoff_manifest"].includes(
      artifact.artifactType
    )
  );

  const probes = getDefaultActivitySimInputProbes(repoRoot);
  const hasSkims = aequilibraeArtifacts.some((artifact) => artifact.artifactType === "skim_matrix");
  const hasDemand = aequilibraeArtifacts.some((artifact) => artifact.artifactType === "demand_matrix");
  const hasEvidence = aequilibraeArtifacts.some((artifact) => artifact.artifactType === "evidence_packet");
  const canonicalReady = probes.canonicalInputs.every((probe) => probe.exists);
  const populationReady = probes.populationInputs.some((probe) => probe.label === "Synthetic households" && probe.exists)
    && probes.populationInputs.some((probe) => probe.label === "Synthetic persons" && probe.exists);
  const runtimeReady = probes.runtimeInputs.every((probe) => probe.exists);
  const handoffStage = stages.find((stage) => asString(stage.stage_name) === "ActivitySim Handoff Package");

  const readyChecks: ActivitySimHandoffCheck[] = [
    {
      key: "aequilibrae-skims",
      label: "AequilibraE skim artifact",
      status: hasSkims ? "ready" : "missing",
      detail: hasSkims ? "Run has at least one OMX skim artifact available for adapter packaging." : "No skim_matrix artifact is registered yet.",
    },
    {
      key: "aequilibrae-demand",
      label: "AequilibraE demand matrix",
      status: hasDemand ? "ready" : "missing",
      detail: hasDemand ? "Run has the prototype demand OMX needed for the first handoff lane." : "No demand_matrix artifact is registered yet.",
    },
    {
      key: "canonical-landuse",
      label: "Canonical network / zone package",
      status: canonicalReady ? "ready" : "partial",
      detail: canonicalReady
        ? "Pilot package includes zone, centroid, and manifest inputs."
        : "Some canonical pilot package inputs are still missing from the repo checkout.",
    },
    {
      key: "synthetic-population",
      label: "Synthetic population inputs",
      status: populationReady ? "ready" : "partial",
      detail: populationReady
        ? "Synthetic household and person seed files are available locally."
        : "Population marginals exist, but household/person seed outputs are not fully present yet.",
    },
    {
      key: "activitysim-runtime",
      label: "ActivitySim runtime bundle",
      status: runtimeReady ? "ready" : "missing",
      detail: runtimeReady
        ? "Settings + land use + households + persons files are present for a local ActivitySim run."
        : "Runtime settings and/or packaged CSV inputs are still missing, so the lane is handoff-only today.",
    },
    {
      key: "handoff-stage",
      label: "Handoff stage registration",
      status: handoffStage ? (asString(handoffStage.status) === "succeeded" ? "ready" : "partial") : "partial",
      detail: handoffStage
        ? `Run stage recorded as ${asString(handoffStage.status) ?? "unknown"}.`
        : "No explicit ActivitySim handoff stage row was found; synthesized manifest returned instead.",
    },
    {
      key: "evidence",
      label: "Evidence packet",
      status: hasEvidence ? "ready" : "missing",
      detail: hasEvidence ? "Evidence packet available for traceability and QA." : "No evidence packet artifact is registered yet.",
    },
  ];

  const missingRequirements = [
    !hasSkims ? "Generate AequilibraE skim artifacts for the run." : null,
    !hasDemand ? "Generate or register the AequilibraE demand OMX artifact." : null,
    !populationReady ? "Produce households/persons seed files from the Nevada County synthetic population builder." : null,
    !runtimeReady ? "Add an ActivitySim settings bundle (settings.yaml, land_use.csv, households.csv, persons.csv)." : null,
  ].filter((value): value is string => Boolean(value));

  const notes = [
    asString(raw.summary),
    asString(orchestration.honestCapability),
    "This handoff describes the current adapter posture. It does not claim that ActivitySim itself has executed unless runtime inputs are present and a future worker lane is wired.",
  ].filter((value): value is string => Boolean(value));

  const readyCount = readyChecks.filter((check) => check.status === "ready").length;
  const summary =
    missingRequirements.length === 0
      ? "ActivitySim handoff inputs are fully present for this prototype lane."
      : `${readyCount}/${readyChecks.length} handoff checks are ready. The lane currently stops at adapter packaging, not full ActivitySim runtime execution.`;

  return {
    schemaVersion: "openplan-activitysim-handoff.v1",
    generatedAt: asString(raw.generatedAt) ?? new Date().toISOString(),
    modelRunId,
    modelId,
    engineKey: asString(raw.engineKey) ?? asString(runRecord.engine_key),
    pipelineKey: asString(raw.pipelineKey) ?? asString(orchestration.pipelineKey),
    summary,
    runStatus: asString(runRecord.status),
    readyChecks,
    missingRequirements,
    aequilibraeArtifacts,
    canonicalInputs: probes.canonicalInputs,
    populationInputs: probes.populationInputs,
    runtimeInputs: probes.runtimeInputs,
    notes,
  };
}

export function normalizeStoredActivitySimHandoff(rawManifest: unknown): ActivitySimHandoffPayload | null {
  const raw = asRecord(rawManifest);
  if (!raw) return null;

  const requiredKeys = [raw.schemaVersion, raw.modelRunId, raw.modelId];
  if (requiredKeys.some((value) => typeof value !== "string")) {
    return null;
  }

  return raw as unknown as ActivitySimHandoffPayload;
}
