export const GUIDED_MODEL_METHODS = ["aequilibrae", "activitysim"] as const;
export const GUIDED_SCENARIO_ROLES = ["baseline", "build"] as const;

export type GuidedModelMethod = (typeof GUIDED_MODEL_METHODS)[number];
export type GuidedScenarioRole = (typeof GUIDED_SCENARIO_ROLES)[number];

export type GuidedRunJob = {
  method: GuidedModelMethod;
  scenario: GuidedScenarioRole;
  modelId: string;
  scenarioEntryId: string;
};

export type GuidedRunRow = {
  id: string;
  model_id: string;
  scenario_entry_id: string | null;
  status: string;
  assumption_snapshot_json?: Record<string, unknown> | null;
};

export type ModelRunArtifactRow = {
  run_id: string;
  artifact_type: string;
  file_url: string | null;
  file_size_bytes: number | string | null;
  content_hash: string | null;
};

export type GuidedRunEvidence = GuidedRunJob & {
  runId: string;
  artifactType: "link_volumes" | "activitysim_link_volumes";
  artifactSha256: string;
};

export type ScenarioComparisonModelRunLinkRow = {
  comparison_snapshot_id: string;
  model_run_id: string;
  method: string;
  scenario_role: string;
  artifact_type: string;
  artifact_sha256: string;
};

const SHA256 = /^[0-9a-f]{64}$/;

export function guidedArtifactType(method: GuidedModelMethod): GuidedRunEvidence["artifactType"] {
  return method === "aequilibrae" ? "link_volumes" : "activitysim_link_volumes";
}

/**
 * A finished status is not output evidence. The worker must have registered a
 * non-empty method-specific artifact and the SHA-256 it computed from those
 * bytes. Snapshot links retain that digest so later rows cannot substitute for
 * the result a planner reviewed.
 */
export function verifiedGuidedArtifact(
  artifacts: readonly ModelRunArtifactRow[],
  runId: string,
  method: GuidedModelMethod,
): ModelRunArtifactRow | null {
  const expectedType = guidedArtifactType(method);
  return artifacts.find((artifact) => {
    const size = typeof artifact.file_size_bytes === "string"
      ? Number(artifact.file_size_bytes)
      : artifact.file_size_bytes;
    return artifact.run_id === runId &&
      artifact.artifact_type === expectedType &&
      typeof artifact.file_url === "string" &&
      artifact.file_url.trim().length > 0 &&
      typeof size === "number" &&
      Number.isSafeInteger(size) &&
      size > 0 &&
      typeof artifact.content_hash === "string" &&
      SHA256.test(artifact.content_hash);
  }) ?? null;
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
    if (row) latest.set(`${job.method}:${job.scenario}`, row);
  }
  return latest;
}

export function collectGuidedRunEvidence(
  jobs: readonly GuidedRunJob[],
  orderedNewestFirst: readonly GuidedRunRow[],
  artifacts: readonly ModelRunArtifactRow[],
): GuidedRunEvidence[] {
  const latest = latestGuidedRuns(jobs, orderedNewestFirst);
  const evidence: GuidedRunEvidence[] = [];
  for (const job of jobs) {
    const run = latest.get(`${job.method}:${job.scenario}`);
    if (!run || run.status !== "succeeded") continue;
    const artifact = verifiedGuidedArtifact(artifacts, run.id, job.method);
    if (!artifact?.content_hash) continue;
    evidence.push({
      ...job,
      runId: run.id,
      artifactType: guidedArtifactType(job.method),
      artifactSha256: artifact.content_hash,
    });
  }
  return evidence;
}

export function snapshotHasExactGuidedEvidence(
  snapshotId: string,
  links: readonly ScenarioComparisonModelRunLinkRow[],
  current: readonly GuidedRunEvidence[],
): boolean {
  if (current.length !== 4) return false;
  const snapshotLinks = links.filter((link) => link.comparison_snapshot_id === snapshotId);
  if (snapshotLinks.length !== 4) return false;
  return current.every((item) => snapshotLinks.some((link) =>
    link.model_run_id === item.runId &&
    link.method === item.method &&
    link.scenario_role === item.scenario &&
    link.artifact_type === item.artifactType &&
    link.artifact_sha256 === item.artifactSha256
  ));
}
