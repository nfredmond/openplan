import { createHash } from "node:crypto";

import {
  jsonValuesEqual,
  sortedCompactJson,
} from "@/lib/models/demand-agreement-artifact";

export const GUIDED_MODEL_METHODS = ["aequilibrae", "activitysim"] as const;
export const GUIDED_SCENARIO_ROLES = ["baseline", "build"] as const;

export type GuidedModelMethod = (typeof GUIDED_MODEL_METHODS)[number];
export type GuidedScenarioRole = (typeof GUIDED_SCENARIO_ROLES)[number];

export type GuidedRunJob = {
  method: GuidedModelMethod;
  scenario: GuidedScenarioRole;
  modelId: string;
  scenarioEntryId: string;
  assumptionsJson: Record<string, unknown>;
};

export type GuidedRunRow = {
  id: string;
  model_id: string;
  scenario_entry_id: string | null;
  engine_key: string;
  status: string;
  assumption_snapshot_json?: Record<string, unknown> | null;
};

export type ModelRunArtifactRow = {
  id: string;
  run_id: string;
  stage_id: string | null;
  artifact_type: string;
  file_url: string | null;
  file_size_bytes: number | string | null;
  content_hash: string | null;
  metadata_json?: Record<string, unknown> | null;
  created_at: string;
};

export type ModelRunStageRow = {
  id: string;
  run_id: string;
  stage_name: string;
  status: string;
};

export type ModelRunKpiRow = {
  id: string;
  run_id: string;
  kpi_name: string;
  breakdown_json?: Record<string, unknown> | null;
  created_at: string;
};

export type GuidedRunEvidence = GuidedRunJob & {
  runId: string;
  artifactId: string;
  artifactType: "link_volumes" | "activitysim_link_volumes";
  artifactSha256: string;
  assignmentProfileSha256: string;
  networkSettingsSha256: string;
  networkStateSha256: string;
  scenarioAssumptionsJson: Record<string, unknown>;
};

export type ScenarioComparisonModelRunLinkRow = {
  comparison_snapshot_id: string;
  model_run_id: string;
  model_run_artifact_id: string | null;
  method: string;
  scenario_role: string;
  artifact_type: string;
  artifact_sha256: string;
  assignment_profile_sha256: string | null;
  network_settings_sha256: string | null;
  network_state_sha256: string | null;
  scenario_assumptions_json: Record<string, unknown> | null;
};

const SHA256 = /^[0-9a-f]{64}$/;

export function guidedArtifactType(method: GuidedModelMethod): GuidedRunEvidence["artifactType"] {
  return method === "aequilibrae" ? "link_volumes" : "activitysim_link_volumes";
}

export function guidedEngineKey(method: GuidedModelMethod): "aequilibrae" | "behavioral_demand" {
  return method === "aequilibrae" ? "aequilibrae" : "behavioral_demand";
}

export function guidedArtifactStageName(method: GuidedModelMethod): string {
  return method === "aequilibrae" ? "Artifact Extraction" : "ActivitySim Network Assignment";
}

export function guidedRunJobKey(job: GuidedRunJob): string {
  return `${job.method}:${job.scenario}:${job.modelId}:${job.scenarioEntryId}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validArtifactBytes(artifact: ModelRunArtifactRow): boolean {
  const size = typeof artifact.file_size_bytes === "string"
    ? Number(artifact.file_size_bytes)
    : artifact.file_size_bytes;
  return typeof artifact.file_url === "string" &&
    artifact.file_url.trim().length > 0 &&
    typeof size === "number" &&
    Number.isSafeInteger(size) &&
    size > 0 &&
    typeof artifact.content_hash === "string" &&
    SHA256.test(artifact.content_hash);
}

function newestFirst(first: { created_at: string; id: string }, second: { created_at: string; id: string }): number {
  const created = second.created_at.localeCompare(first.created_at);
  return created !== 0 ? created : second.id.localeCompare(first.id);
}

function artifactDigests(artifact: ModelRunArtifactRow): {
  assignmentProfileSha256: string;
  networkSettingsSha256: string;
  networkStateSha256: string;
} | null {
  const metadata = artifact.metadata_json;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const profile = metadata.assignment_profile;
  const profilePayload = metadata.assignment_profile_payload_json;
  const profileDigest = metadata.assignment_profile_digest;
  const settings = metadata.network_settings;
  const settingsPayload = metadata.network_settings_payload_json;
  const settingsDigest = metadata.network_settings_digest;
  const state = metadata.network_state_record;
  const stateDigest = metadata.network_state_digest;
  if (
    typeof profilePayload !== "string" ||
    typeof profileDigest !== "string" ||
    typeof settingsPayload !== "string" ||
    typeof settingsDigest !== "string" ||
    typeof stateDigest !== "string" ||
    !SHA256.test(profileDigest) ||
    !SHA256.test(settingsDigest) ||
    !SHA256.test(stateDigest)
  ) return null;
  try {
    if (!jsonValuesEqual(JSON.parse(profilePayload), profile) || sha256(profilePayload) !== profileDigest) return null;
    if (!jsonValuesEqual(JSON.parse(settingsPayload), settings) || sha256(settingsPayload) !== settingsDigest) return null;
    if (sha256(sortedCompactJson(state)) !== stateDigest) return null;
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      (state as Record<string, unknown>).network_settings_digest !== settingsDigest
    ) return null;
  } catch {
    return null;
  }
  return {
    assignmentProfileSha256: profileDigest,
    networkSettingsSha256: settingsDigest,
    networkStateSha256: stateDigest,
  };
}

/**
 * Return only the deterministic latest method artifact for a run, and only
 * when its bytes, succeeded stage, and recomputable solver/network identity
 * all agree. A corrupt retry is not allowed to expose an older valid row.
 */
export function verifiedGuidedArtifact(
  artifacts: readonly ModelRunArtifactRow[],
  stages: readonly ModelRunStageRow[],
  runId: string,
  method: GuidedModelMethod,
): (ModelRunArtifactRow & {
  assignmentProfileSha256: string;
  networkSettingsSha256: string;
  networkStateSha256: string;
}) | null {
  const expectedType = guidedArtifactType(method);
  const latest = artifacts
    .filter((artifact) => artifact.run_id === runId && artifact.artifact_type === expectedType)
    .sort(newestFirst)[0];
  if (!latest || !validArtifactBytes(latest) || !latest.stage_id) return null;
  const stage = stages.find((candidate) => candidate.id === latest.stage_id && candidate.run_id === runId);
  if (!stage || stage.status !== "succeeded" || stage.stage_name !== guidedArtifactStageName(method)) return null;
  const digests = artifactDigests(latest);
  return digests ? { ...latest, ...digests } : null;
}

/** Select the newest row for each exact method and scenario pair. */
export function latestGuidedRuns(
  jobs: readonly GuidedRunJob[],
  orderedNewestFirst: readonly GuidedRunRow[],
): Map<string, GuidedRunRow> {
  const latest = new Map<string, GuidedRunRow>();
  for (const job of jobs) {
    const row = orderedNewestFirst.find(
      (run) => run.model_id === job.modelId && run.scenario_entry_id === job.scenarioEntryId,
    );
    if (row) latest.set(guidedRunJobKey(job), row);
  }
  return latest;
}

export function collectGuidedRunEvidence(
  jobs: readonly GuidedRunJob[],
  orderedNewestFirst: readonly GuidedRunRow[],
  artifacts: readonly ModelRunArtifactRow[],
  stages: readonly ModelRunStageRow[],
): GuidedRunEvidence[] {
  const latest = latestGuidedRuns(jobs, orderedNewestFirst);
  const evidence: GuidedRunEvidence[] = [];
  for (const job of jobs) {
    const run = latest.get(guidedRunJobKey(job));
    if (
      !run ||
      run.status !== "succeeded" ||
      run.engine_key !== guidedEngineKey(job.method) ||
      !jsonValuesEqual(run.assumption_snapshot_json ?? {}, job.assumptionsJson)
    ) continue;
    const artifact = verifiedGuidedArtifact(artifacts, stages, run.id, job.method);
    if (!artifact?.content_hash) continue;
    evidence.push({
      ...job,
      runId: run.id,
      artifactId: artifact.id,
      artifactType: guidedArtifactType(job.method),
      artifactSha256: artifact.content_hash,
      assignmentProfileSha256: artifact.assignmentProfileSha256,
      networkSettingsSha256: artifact.networkSettingsSha256,
      networkStateSha256: artifact.networkStateSha256,
      scenarioAssumptionsJson: job.assumptionsJson,
    });
  }
  return evidence;
}

export function guidedEvidenceSharesExactNetwork(current: readonly GuidedRunEvidence[]): boolean {
  if (current.length !== 4) return false;
  return [
    "assignmentProfileSha256",
    "networkSettingsSha256",
    "networkStateSha256",
  ].every((field) => new Set(current.map((item) => item[field as keyof GuidedRunEvidence])).size === 1);
}

export function snapshotHasExactGuidedEvidence(
  snapshotId: string,
  links: readonly ScenarioComparisonModelRunLinkRow[],
  current: readonly GuidedRunEvidence[],
): boolean {
  if (!guidedEvidenceSharesExactNetwork(current)) return false;
  const snapshotLinks = links.filter((link) => link.comparison_snapshot_id === snapshotId);
  if (snapshotLinks.length !== 4) return false;
  return current.every((item) => snapshotLinks.some((link) =>
    link.model_run_id === item.runId &&
    link.model_run_artifact_id === item.artifactId &&
    link.method === item.method &&
    link.scenario_role === item.scenario &&
    link.artifact_type === item.artifactType &&
    link.artifact_sha256 === item.artifactSha256 &&
    link.assignment_profile_sha256 === item.assignmentProfileSha256 &&
    link.network_settings_sha256 === item.networkSettingsSha256 &&
    link.network_state_sha256 === item.networkStateSha256 &&
    jsonValuesEqual(link.scenario_assumptions_json, item.scenarioAssumptionsJson)
  ));
}

export function verifiedActivitySimPreflight(params: {
  run: GuidedRunRow;
  artifacts: readonly ModelRunArtifactRow[];
  stages: readonly ModelRunStageRow[];
  kpis: readonly ModelRunKpiRow[];
}): "preflight_only" | "executed" | null {
  const { run, artifacts, stages, kpis } = params;
  if (run.status !== "succeeded" || run.engine_key !== "behavioral_demand") return null;
  const evidence = artifacts
    .filter((artifact) => artifact.run_id === run.id && artifact.artifact_type === "evidence_packet")
    .sort(newestFirst)[0];
  if (!evidence || !validArtifactBytes(evidence) || !evidence.stage_id) return null;
  if (evidence.metadata_json?.kind !== "behavioral_demand_preflight_evidence") return null;
  const stage = stages.find((candidate) => candidate.id === evidence.stage_id && candidate.run_id === run.id);
  if (!stage || stage.stage_name !== "ActivitySim Bundle & Preflight" || stage.status !== "succeeded") return null;
  const kpi = kpis
    .filter((candidate) => candidate.run_id === run.id && candidate.kpi_name === "activitysim_runtime_mode")
    .sort(newestFirst)[0];
  const mode = kpi?.breakdown_json?.mode;
  return mode === "preflight_only" || mode === "executed" ? mode : null;
}
