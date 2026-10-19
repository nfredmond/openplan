import { createHash } from "node:crypto";
import { z } from "zod";
import { validStageCustodyAttestation, type ReadStageCustody, type CommonPopulationCustody } from "@/lib/models/common-population-launch";

import {
  jsonValuesEqual,
  sortedCompactJson,
} from "@/lib/models/demand-agreement-artifact";

export const GUIDED_MODEL_METHODS = ["aequilibrae", "activitysim"] as const;
export const GUIDED_SCENARIO_ROLES = ["baseline", "build"] as const;
export const GUIDED_FIXED_POPULATION_POLICY = "fixed_population_auto_trip_change";

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
  attempt_managed?: boolean;
  assumption_snapshot_json?: Record<string, unknown> | null;
  input_snapshot_json?: Record<string, unknown> | null;
};

export type ModelRunArtifactRow = {
  id: string;
  run_id: string;
  stage_id: string | null;
  attempt_id?: string | null;
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
  attempt_managed?: boolean;
  active_attempt_id?: string | null;
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
  population: GuidedPopulationEvidence;
  populationRequest: unknown;
  producerManaged: boolean;
  producerStageSnapshot: boolean;
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const descriptor = z.object({ path: z.string(), sha256: z.string().regex(SHA256), bytes: safeCount }).strict();
const sourceProfile = z.object({
  adapter: z.literal("us_census_acs5_pums"),
  acs_summary_endpoint: z.string(),
  pums_endpoint: z.string(),
  sample_years: z.tuple([z.number().int(), z.number().int()]),
  income_dollar_year: z.number().int(),
  puma_fields: z.record(z.string(), z.string()),
}).strict().refine((profile) => {
  const year = profile.income_dollar_year;
  return [2022, 2023].includes(year) &&
    profile.acs_summary_endpoint === `https://api.census.gov/data/${year}/acs/acs5` &&
    profile.pums_endpoint === `${profile.acs_summary_endpoint}/pums` &&
    jsonValuesEqual(profile.sample_years, [year - 4, year]) &&
    jsonValuesEqual(profile.puma_fields, year === 2023 ? { "2020": "PUMA" } : { "2020": "PUMA20", "2010": "PUMA10" });
});
const identitySchema = z.object({
  schema: z.literal("openplan.common-population-identity.v1"),
  manifest: descriptor.refine((file) => file.path === "common_population.json" && file.bytes > 0),
  source_profile: sourceProfile,
  universe: z.literal("household_residents"),
  exclusions: z.object({ group_quarters: z.literal("excluded_unassessed"), full_population_coverage: z.literal("unassessed") }).strict(),
  selected_zone_map: descriptor.refine((file) => file.path === "selected_zones.json" && file.bytes > 0),
  realized_zone_counts: z.array(z.object({ zone_id: safeCount.refine((id) => id > 0), households: safeCount, persons: safeCount, workers: safeCount }).strict())
    .min(1).refine((counts) => counts.every((row, index) => row.workers <= row.persons && row.households <= row.persons &&
      (index === 0 || counts[index - 1].zone_id < row.zone_id))),
  source_manifest: descriptor.refine((file) => file.path === "source_manifest.json" && file.bytes > 0),
}).strict();

export type GuidedPopulationIdentity = z.infer<typeof identitySchema>;
export type GuidedPopulationEvidence =
  | { state: "unassessed" | "invalid" }
  | { state: "verified"; custody: CommonPopulationCustody; basis: GuidedPopulationIdentity; payloadJson: string; digest: string };
const originSchema = z.object({
  modelRunId: z.string().min(1), artifactId: z.string().regex(UUID), stageId: z.string().regex(UUID),
  attemptId: z.string().regex(UUID).nullable(), sha256: z.string().regex(SHA256), sizeBytes: safeCount.refine((size) => size > 0),
}).strict();
export type GuidedPopulationOrigin = z.infer<typeof originSchema>;
export type GuidedPopulationComparison =
  | { state: "not_required" | "pending" }
  | { state: "unassessed" | "invalid" | "mismatch"; repairState: "needs_shared_population_rerun" | "population_basis_invalid" | "population_basis_mismatch" }
  | { state: "ready"; custody: CommonPopulationCustody; basis: GuidedPopulationIdentity; digest: string; source: GuidedPopulationOrigin };

function originMatchesCustody(origin: GuidedPopulationOrigin, custody: CommonPopulationCustody): boolean {
  return custody === "legacy_stage_snapshot" ? origin.attemptId === null : typeof origin.attemptId === "string" && UUID.test(origin.attemptId);
}

function verifiedPopulationProducer(item: GuidedRunEvidence): boolean {
  return item.population.state === "verified" && (item.population.custody === "managed_attempt"
    ? item.producerManaged : item.producerStageSnapshot);
}

/** Ask the scoped native reader about exact completed files, preserving its custody tier. */
export async function readGuidedStageCustody(args: {
  workspaceId: string; runs: readonly GuidedRunRow[]; artifacts: readonly ModelRunArtifactRow[];
  stages: readonly ModelRunStageRow[]; readStageCustody: ReadStageCustody;
}): Promise<ReadonlySet<string>> {
  const eligible = new Set<string>();
  for (const artifact of args.artifacts) {
    if (!["common_population", "link_volumes", "activitysim_link_volumes"].includes(artifact.artifact_type)) continue;
    const run = args.runs.find((candidate) => candidate.id === artifact.run_id);
    const stage = args.stages.find((candidate) => candidate.id === artifact.stage_id && candidate.run_id === artifact.run_id);
    const request = run?.input_snapshot_json?.commonPopulation;
    if (!run || run.status !== "succeeded" || run.attempt_managed !== false || !stage || stage.status !== "succeeded" ||
        stage.attempt_managed !== false || stage.active_attempt_id !== null || artifact.attempt_id !== null ||
        !request || typeof request !== "object" || (request as Record<string, unknown>).custody !== "legacy_stage_snapshot" ||
        (artifact.artifact_type === "common_population" ? artifact.metadata_json?.custody : artifact.metadata_json?.population_custody) !== "legacy_stage_snapshot") continue;
    try {
      const result = await args.readStageCustody(args.workspaceId, run.id, stage.id, artifact.id);
      if (!result.error && validStageCustodyAttestation(result.data, args.workspaceId, run.id, stage.id, artifact.id)) eligible.add(artifact.id);
    } catch { /* Unconfirmed custody stays ineligible for comparison. */ }
  }
  return eligible;
}

/** Exact Python sorted compact ASCII JSON for this validated integer/string record. */
export function populationIdentityPayload(value: GuidedPopulationIdentity): string {
  return sortedCompactJson(value).replace(/[\u0080-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Verify consumed-population metadata without changing legacy artifact eligibility. */
export function verifiedGuidedPopulation(metadata: Record<string, unknown> | null | undefined, sourceCompanion = false): GuidedPopulationEvidence {
  const keys = ["population_basis", "population_basis_payload_json", "population_basis_digest"];
  if (!metadata || keys.every((key) => metadata[key] === undefined)) return { state: "unassessed" };
  if (sourceCompanion && (Object.keys(metadata).sort().join(",") !==
      ["schema", "custody", "population_basis", "population_basis_payload_json", "population_basis_digest", "origin", "scientific_acceptance"].sort().join(",") ||
      metadata.schema !== "openplan.common-population.v1" || metadata.scientific_acceptance !== "unassessed")) return { state: "invalid" };
  const custody = z.enum(["legacy_stage_snapshot", "managed_attempt"]).safeParse(sourceCompanion ? metadata.custody : metadata.population_custody);
  if (!custody.success) return { state: "invalid" };
  const basis = identitySchema.safeParse(metadata.population_basis);
  const payload = metadata.population_basis_payload_json;
  const digest = metadata.population_basis_digest;
  if (!basis.success || typeof payload !== "string" || typeof digest !== "string" || !SHA256.test(digest)) return { state: "invalid" };
  try {
    if (payload !== populationIdentityPayload(basis.data) || !jsonValuesEqual(JSON.parse(payload), metadata.population_basis) ||
        sha256(payload) !== digest) return { state: "invalid" };
  } catch { return { state: "invalid" }; }
  return { state: "verified", custody: custody.data, basis: basis.data, payloadJson: payload, digest };
}

/** This rule belongs to the current guided auto-trip adjustment, not all scenarios. */
export function requiresFixedGuidedPopulation(jobs: readonly GuidedRunJob[]): boolean {
  return jobs.some((job) => job.scenario === "build" &&
    typeof job.assumptionsJson.guidedProjectChange === "object" && job.assumptionsJson.guidedProjectChange !== null &&
    (job.assumptionsJson.guidedProjectChange as Record<string, unknown>).kind === "assigned_auto_trip_change_pct");
}

/** Check the four actual output bases and their frozen baseline origin references. */
export function guidedPopulationComparison(jobs: readonly GuidedRunJob[], current: readonly GuidedRunEvidence[]): GuidedPopulationComparison {
  if (!requiresFixedGuidedPopulation(jobs)) return { state: "not_required" };
  if (current.some((item) => item.population.state === "invalid" || (item.population.state === "verified" && !verifiedPopulationProducer(item)))) {
    return { state: "invalid", repairState: "population_basis_invalid" };
  }
  if (current.some((item) => item.population.state === "unassessed")) return { state: "unassessed", repairState: "needs_shared_population_rerun" };
  if (current.length !== 4 || new Set(current.map((item) => `${item.method}:${item.scenario}`)).size !== 4) return { state: "pending" };
  const baseline = current.find((item) => item.method === "aequilibrae" && item.scenario === "baseline");
  if (!baseline || baseline.population.state !== "verified") return { state: "invalid", repairState: "population_basis_invalid" };
  const first = baseline.population;
  if (current.some((item) => item.population.state !== "verified" || item.population.digest !== first.digest || item.population.custody !== first.custody ||
      !jsonValuesEqual(item.population.basis, first.basis))) return { state: "mismatch", repairState: "population_basis_mismatch" };
  const generated = z.object({ custody: z.literal(first.custody), schema: z.literal("openplan.common-population-request.v1"), mode: z.literal("generate"),
    comparisonPolicy: z.literal(GUIDED_FIXED_POPULATION_POLICY), sourceProfile }).strict().safeParse(baseline.populationRequest);
  if (!generated.success || !jsonValuesEqual(generated.data.sourceProfile, first.basis.source_profile)) {
    return { state: "invalid", repairState: "population_basis_invalid" };
  }
  let origin: GuidedPopulationOrigin | null = null;
  for (const item of current.filter((candidate) => candidate !== baseline)) {
    const reused = z.object({ custody: z.literal(first.custody), schema: z.literal("openplan.common-population-request.v1"), mode: z.literal("reuse"),
      comparisonPolicy: z.literal(GUIDED_FIXED_POPULATION_POLICY), source: originSchema }).strict().safeParse(item.populationRequest);
    if (!reused.success || !originMatchesCustody(reused.data.source, first.custody) || reused.data.source.modelRunId !== baseline.runId ||
        reused.data.source.sha256 !== first.basis.manifest.sha256 || reused.data.source.sizeBytes !== first.basis.manifest.bytes ||
        (origin !== null && !jsonValuesEqual(origin, reused.data.source))) return { state: "mismatch", repairState: "population_basis_mismatch" };
    origin = reused.data.source;
  }
  return origin ? { state: "ready", custody: first.custody, basis: first.basis, digest: first.digest, source: origin }
    : { state: "invalid", repairState: "population_basis_invalid" };
}

export function guidedPopulationSnapshotMetadata(comparison: Extract<GuidedPopulationComparison, { state: "ready" }>) {
  return { schema: "openplan.common-population-comparison.v1", custody: comparison.custody, comparisonPolicy: GUIDED_FIXED_POPULATION_POLICY,
    sourceRunId: comparison.source.modelRunId, source: comparison.source, manifest: comparison.basis.manifest,
    populationBasis: comparison.basis, populationBasisDigest: comparison.digest };
}

export type GuidedPopulationSummary = {
  sourceRunId: string; households: number; persons: number; universe: "household_residents";
  manifestSha256: string; sourceVintage: string;
};

/** Find the first incompatible job against the latest baseline, without launching it. */
export function guidedPopulationRerun(
  jobs: readonly GuidedRunJob[], current: readonly GuidedRunEvidence[],
  artifacts: readonly ModelRunArtifactRow[], stages: readonly ModelRunStageRow[],
  eligibleStageArtifacts: ReadonlySet<string> = new Set(),
): { nextRun: GuidedRunJob | null; summary: GuidedPopulationSummary | null; repairState?: string } {
  if (!requiresFixedGuidedPopulation(jobs)) return { nextRun: null, summary: null };
  const baselineJob = jobs.find((job) => job.method === "aequilibrae" && job.scenario === "baseline");
  const baseline = current.find((item) => item.method === "aequilibrae" && item.scenario === "baseline");
  if (!baselineJob || !baseline) return { nextRun: baselineJob ?? null, summary: null };
  if (!verifiedPopulationProducer(baseline) || baseline.population.state !== "verified") {
    return { nextRun: baselineJob, summary: null, repairState: baseline.population.state === "unassessed" ? "needs_shared_population_rerun" : "population_basis_invalid" };
  }
  const population = baseline.population;
  const generated = z.object({ custody: z.literal(population.custody), schema: z.literal("openplan.common-population-request.v1"), mode: z.literal("generate"),
    comparisonPolicy: z.literal(GUIDED_FIXED_POPULATION_POLICY), sourceProfile }).strict().safeParse(baseline.populationRequest);
  const sourceArtifact = artifacts.filter((item) => item.run_id === baseline.runId && item.artifact_type === "common_population").sort(newestFirst)[0];
  const sourcePopulation = verifiedGuidedPopulation(sourceArtifact?.metadata_json, true);
  const sourceStage = sourceArtifact ? stages.find((stage) => stage.id === sourceArtifact.stage_id && stage.run_id === baseline.runId) : null;
  if (!generated.success || !jsonValuesEqual(generated.data.sourceProfile, population.basis.source_profile) ||
      !sourceArtifact || !validArtifactBytes(sourceArtifact) || sourceArtifact.content_hash !== population.basis.manifest.sha256 ||
      sourceArtifact.metadata_json?.schema !== "openplan.common-population.v1" ||
      sourceArtifact.metadata_json?.custody !== population.custody ||
      sourceArtifact.metadata_json?.origin !== null || sourceArtifact.metadata_json?.scientific_acceptance !== "unassessed" ||
      sourcePopulation.state !== "verified" || sourcePopulation.digest !== population.digest || !jsonValuesEqual(sourcePopulation.basis, population.basis) ||
      Number(sourceArtifact.file_size_bytes) !== population.basis.manifest.bytes || !sourceStage || sourceStage.stage_name !== "AequilibraE Setup" ||
      sourceStage.status !== "succeeded" || (population.custody === "managed_attempt"
        ? sourceStage.attempt_managed !== true || !sourceArtifact.attempt_id || sourceStage.active_attempt_id !== sourceArtifact.attempt_id
        : sourceStage.attempt_managed !== false || sourceStage.active_attempt_id !== null || sourceArtifact.attempt_id !== null || !eligibleStageArtifacts.has(sourceArtifact.id))) {
    return { nextRun: baselineJob, summary: null, repairState: "needs_shared_population_rerun" };
  }
  const source = originSchema.safeParse({ modelRunId: baseline.runId, artifactId: sourceArtifact.id,
    stageId: sourceArtifact.stage_id, attemptId: sourceArtifact.attempt_id,
    sha256: sourceArtifact.content_hash, sizeBytes: population.basis.manifest.bytes });
  if (!source.success || !originMatchesCustody(source.data, population.custody)) return { nextRun: baselineJob, summary: null, repairState: "population_basis_invalid" };
  const households = population.basis.realized_zone_counts.reduce((sum, row) => sum + row.households, 0);
  const persons = population.basis.realized_zone_counts.reduce((sum, row) => sum + row.persons, 0);
  if (!Number.isSafeInteger(households) || !Number.isSafeInteger(persons)) return { nextRun: baselineJob, summary: null, repairState: "population_basis_invalid" };
  const summary: GuidedPopulationSummary = { sourceRunId: baseline.runId, households, persons, universe: "household_residents",
    manifestSha256: population.basis.manifest.sha256, sourceVintage: String(population.basis.source_profile.income_dollar_year) };
  for (const job of jobs.filter((candidate) => candidate !== baselineJob)) {
    const item = current.find((candidate) => guidedRunJobKey(candidate) === guidedRunJobKey(job));
    if (!item) return { nextRun: job, summary };
    const request = z.object({ custody: z.literal(population.custody), schema: z.literal("openplan.common-population-request.v1"), mode: z.literal("reuse"),
      comparisonPolicy: z.literal(GUIDED_FIXED_POPULATION_POLICY), source: originSchema }).strict().safeParse(item.populationRequest);
    if (!verifiedPopulationProducer(item) || item.population.state !== "verified") return { nextRun: job, summary,
      repairState: item.population.state === "unassessed" ? "needs_shared_population_rerun" : "population_basis_invalid" };
    if (item.population.digest !== population.digest || item.population.custody !== population.custody || !jsonValuesEqual(item.population.basis, population.basis) ||
        !request.success || !jsonValuesEqual(request.data.source, source.data)) return { nextRun: job, summary, repairState: "population_basis_mismatch" };
  }
  return { nextRun: null, summary };
}

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
  population: GuidedPopulationEvidence;
  producerManaged: boolean;
}) | null {
  const expectedType = guidedArtifactType(method);
  const latest = artifacts
    .filter((artifact) => artifact.run_id === runId && artifact.artifact_type === expectedType)
    .sort(newestFirst)[0];
  if (!latest || !validArtifactBytes(latest) || !latest.stage_id) return null;
  const stage = stages.find((candidate) => candidate.id === latest.stage_id && candidate.run_id === runId);
  if (!stage || stage.status !== "succeeded" || stage.stage_name !== guidedArtifactStageName(method)) return null;
  const digests = artifactDigests(latest);
  return digests ? { ...latest, ...digests, population: verifiedGuidedPopulation(latest.metadata_json),
    producerManaged: stage.attempt_managed === true && typeof latest.attempt_id === "string" &&
      UUID.test(latest.attempt_id) && stage.active_attempt_id === latest.attempt_id } : null;
}

/** Select the newest row for each exact method and scenario pair. */
export function latestGuidedRuns(
  jobs: readonly GuidedRunJob[],
  orderedNewestFirst: readonly GuidedRunRow[],
): Map<string, GuidedRunRow> {
  const latest = new Map<string, GuidedRunRow>();
  for (const job of jobs) {
    const row = orderedNewestFirst.find(
      (run) =>
        run.model_id === job.modelId &&
        run.scenario_entry_id === job.scenarioEntryId &&
        run.engine_key === guidedEngineKey(job.method),
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
  eligibleStageArtifacts: ReadonlySet<string> = new Set(),
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
    const producer = stages.find((stage) => stage.id === artifact.stage_id && stage.run_id === run.id);
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
      population: artifact.population,
      populationRequest: run.input_snapshot_json?.commonPopulation,
      producerManaged: artifact.producerManaged && run.attempt_managed === true,
      producerStageSnapshot: run.attempt_managed === false && artifact.attempt_id === null &&
        producer?.attempt_managed === false && producer.active_attempt_id === null && eligibleStageArtifacts.has(artifact.id),
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
  metadata?: Record<string, unknown> | null,
): boolean {
  if (!guidedEvidenceSharesExactNetwork(current)) return false;
  const population = guidedPopulationComparison(current, current);
  if (population.state !== "not_required" && (population.state !== "ready" ||
      !jsonValuesEqual(metadata?.commonPopulation, guidedPopulationSnapshotMetadata(population)))) return false;
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
