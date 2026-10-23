import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  collectGuidedRunEvidence, guidedPopulationComparison, guidedPopulationSnapshotMetadata,
  guidedPopulationRerun, readGuidedStageCustody, snapshotHasExactGuidedEvidence, guidedEvidenceSharesExactNetwork,
  verifiedGuidedArtifact, verifiedGuidedPopulation, verifiedActivitySimPreflight,
  type GuidedRunJob, type GuidedRunRow, type ModelRunArtifactRow, type ModelRunStageRow,
  type GuidedRunEvidence, type ScenarioComparisonModelRunLinkRow,
} from "@/lib/models/guided-model-evidence";
import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { populationFixture, POPULATION_ATTEMPT_ID } from "@/test/fixtures/common-population-evidence";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const profile = '{"engine":"aequilibrae"}';
const settings = '{"capacity":"shared"}';
const state = { network_settings_digest: hash(settings), osm_snapshot: "supplied" };
const network = { assignment_profile: JSON.parse(profile), assignment_profile_payload_json: profile, assignment_profile_digest: hash(profile),
  network_settings: JSON.parse(settings), network_settings_payload_json: settings, network_settings_digest: hash(settings),
  network_state_record: state, network_state_digest: hash(sortedCompactJson(state)) };

function fixture() {
  const population = populationFixture();
  const change = { guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -5, basis: "Supplied scenario" } };
  const jobs: GuidedRunJob[] = [
    { method: "aequilibrae", scenario: "baseline", modelId: "aeq", scenarioEntryId: "base", assumptionsJson: {} },
    { method: "aequilibrae", scenario: "build", modelId: "aeq", scenarioEntryId: "build", assumptionsJson: change },
    { method: "activitysim", scenario: "baseline", modelId: "asim", scenarioEntryId: "base", assumptionsJson: {} },
    { method: "activitysim", scenario: "build", modelId: "asim", scenarioEntryId: "build", assumptionsJson: change },
  ];
  const runs: GuidedRunRow[] = jobs.map((job, index) => ({ id: index === 0 ? "run-aeq-base" : `run-${index}`,
    model_id: job.modelId, scenario_entry_id: job.scenarioEntryId, engine_key: job.method === "aequilibrae" ? "aequilibrae" : "behavioral_demand",
    status: "succeeded", attempt_managed: true, assumption_snapshot_json: job.assumptionsJson,
    input_snapshot_json: { commonPopulation: index === 0 ? population.generate : population.reuse } }));
  const artifacts: ModelRunArtifactRow[] = runs.map((run, index) => ({ id: `artifact-${index}`, run_id: run.id,
    stage_id: `stage-${index}`, attempt_id: POPULATION_ATTEMPT_ID,
    artifact_type: index < 2 ? "link_volumes" : "activitysim_link_volumes", file_url: `local:///supplied/${run.id}/links.csv`,
    file_size_bytes: 100, content_hash: "d".repeat(64), metadata_json: { ...network, ...population.metadata }, created_at: "2026-10-18" }));
  const stages: ModelRunStageRow[] = runs.map((run, index) => ({ id: `stage-${index}`, run_id: run.id, status: "succeeded",
    stage_name: index < 2 ? "Artifact Extraction" : "ActivitySim Network Assignment", attempt_managed: true, active_attempt_id: POPULATION_ATTEMPT_ID }));
  artifacts.push({ id: population.source.artifactId, run_id: runs[0].id, stage_id: population.source.stageId,
    attempt_id: population.source.attemptId, artifact_type: "common_population", file_url: "local:///supplied/common_population.json",
    file_size_bytes: population.source.sizeBytes, content_hash: population.source.sha256,
    metadata_json: population.sourceMetadata, created_at: "2026-10-18" });
  stages.push({ id: population.source.stageId, run_id: runs[0].id, stage_name: "AequilibraE Setup",
    status: "succeeded", attempt_managed: true, active_attempt_id: population.source.attemptId });
  return { population, jobs, runs, artifacts, stages, evidence: () => collectGuidedRunEvidence(jobs, runs, artifacts, stages) };
}

/** Four exact links keep policy refusal distinct from missing-output refusal. */
function exactSnapshotLinks(evidence: readonly GuidedRunEvidence[]): ScenarioComparisonModelRunLinkRow[] {
  return evidence.map((item) => ({
    comparison_snapshot_id: "historical-ready",
    model_run_id: item.runId, model_run_artifact_id: item.artifactId,
    method: item.method, scenario_role: item.scenario, artifact_type: item.artifactType,
    artifact_sha256: item.artifactSha256, assignment_profile_sha256: item.assignmentProfileSha256,
    network_settings_sha256: item.networkSettingsSha256, network_state_sha256: item.networkStateSha256,
    scenario_assumptions_json: item.scenarioAssumptionsJson,
  }));
}

function restoredFixture() {
  const f = fixture();
  const baseline = '10101010-1010-4010-8010-101010101010';
  const population = populationFixture(baseline, 'legacy_stage_snapshot');
  const lineage = { schema: 'openplan.population-replacement.v1',
    checkpoint_id: '20202020-2020-4020-8020-202020202020', checkpoint_sha256: 'd'.repeat(64),
    source_run_id: '30303030-3030-4030-8030-303030303030', source_stage_id: '40404040-4040-4040-8040-404040404040',
    source_attempt_id: null, population_digest: population.digest, package_sha256: 'e'.repeat(64) };
  f.runs.forEach((run, index) => { const oldId = run.id;
    if (index === 0) { run.id = baseline;
      f.stages.filter((item) => item.run_id === oldId).forEach((item) => { item.run_id = baseline; });
      f.artifacts.filter((item) => item.run_id === oldId).forEach((item) => { item.run_id = baseline; }); }
    run.attempt_managed = false;
    run.input_snapshot_json = { commonPopulation: index === 0 ? { ...population.generate, mode: 'restore_checkpoint',
      checkpoint: { id: lineage.checkpoint_id, sha256: lineage.checkpoint_sha256 }, source: null } : population.reuse };
  });
  f.stages.forEach((stage) => { stage.attempt_managed = false; stage.active_attempt_id = null; });
  f.artifacts.forEach((artifact) => { artifact.attempt_id = null;
    artifact.metadata_json = artifact.artifact_type === 'common_population'
      ? { ...population.sourceMetadata, replacement: lineage } : { ...network, ...population.metadata }; });
  const eligible = new Set(f.artifacts.map((item) => item.id));
  return { ...f, population, lineage, eligible,
    evidence: () => collectGuidedRunEvidence(f.jobs, f.runs, f.artifacts, f.stages, eligible) };
}

function changedMetadata(update: (basis: Record<string, unknown>) => void) {
  const result = populationFixture().metadata;
  const basis: Record<string, unknown> = structuredClone(result.population_basis);
  update(basis);
  const payload = sortedCompactJson(basis);
  return { population_custody: "managed_attempt", population_basis: basis, population_basis_payload_json: payload, population_basis_digest: hash(payload) };
}

describe("consumed population identity", () => {
  it("accepts all four exact consumed bases and reconstructs the explicit policy reference", () => {
    const f = fixture();
    const comparison = guidedPopulationComparison(f.jobs, f.evidence());
    expect(comparison.state).toBe("ready");
    if (comparison.state !== "ready") throw new Error("Expected verified supplied comparison");
    expect(guidedPopulationSnapshotMetadata(comparison)).toEqual(f.population.snapshot);
  });

  it("reads the exact fixed-population snapshot and tolerates unrelated metadata", () => {
    const f = fixture();
    const evidence = f.evidence();
    const links = exactSnapshotLinks(evidence);
    expect(evidence).toHaveLength(4);
    expect(guidedEvidenceSharesExactNetwork(evidence)).toBe(true);
    expect(snapshotHasExactGuidedEvidence("historical-ready", links, evidence,
      { commonPopulation: f.population.snapshot, note: "Harmless historical note" })).toBe(true);
    expect(snapshotHasExactGuidedEvidence("historical-ready", links, evidence, {})).toBe(false);
    expect(snapshotHasExactGuidedEvidence("historical-ready", links, evidence,
      { commonPopulation: { ...f.population.snapshot, populationBasisDigest: "0".repeat(64) } })).toBe(false);
  });

  it.each([
    {}, { guidedProjectChange: null }, { guidedProjectChange: "malformed" },
    { guidedProjectChange: [] }, { guidedProjectChange: {} },
    { guidedProjectChange: { kind: "future_population_change" } },
  ] as Record<string, unknown>[])("withholds guided current-read acceptance for matching unsupported assumptions %j", (assumptions) => {
    for (const retainPopulation of [true, false]) {
      const f = fixture();
      f.jobs.forEach((job, index) => {
        if (job.scenario === "build") {
          job.assumptionsJson = assumptions;
          f.runs[index].assumption_snapshot_json = assumptions;
        }
      });
      if (!retainPopulation) f.artifacts.forEach((artifact) => { artifact.metadata_json = network; });
      const evidence = f.evidence();
      const links = exactSnapshotLinks(evidence);
      expect(evidence).toHaveLength(4);
      expect(guidedEvidenceSharesExactNetwork(evidence)).toBe(true);
      expect(links).toHaveLength(4);
      expect(new Set(links.map((link) => `${link.method}:${link.scenario_role}`)).size).toBe(4);
      expect(guidedPopulationComparison(f.jobs, evidence)).toEqual({ state: "not_required" });
      expect(evidence.every((item) => item.population.state === (retainPopulation ? "verified" : "unassessed"))).toBe(true);
      for (const claim of [undefined, null, "malformed", { schema: "openplan.future-population.v1" }, f.population.snapshot]) {
        const metadata = claim === undefined ? {} : { commonPopulation: claim };
        const before = structuredClone({ evidence, links, metadata });
        expect(snapshotHasExactGuidedEvidence("historical-ready", links, evidence, metadata)).toBe(false);
        expect({ evidence, links, metadata }).toEqual(before);
      }
    }
  });

  it("keeps the generic low-level population classification without guided readiness", () => {
    const genericJob: GuidedRunJob = { method: "aequilibrae", scenario: "build", modelId: "generic",
      scenarioEntryId: "generic-build", assumptionsJson: { horizonYear: 2050 } };
    expect(guidedPopulationComparison([genericJob], [])).toEqual({ state: "not_required" });
  });

  it("keeps absent legacy population unassessed while preserving standalone artifact eligibility", () => {
    const f = fixture();
    f.artifacts[0].metadata_json = network;
    expect(verifiedGuidedArtifact(f.artifacts, f.stages, f.runs[0].id, "aequilibrae")?.population).toEqual({ state: "unassessed" });
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "unassessed", repairState: "needs_shared_population_rerun" });
    f.jobs.forEach((job) => { job.assumptionsJson = { populationChange: "Intentional future scenario" }; });
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toEqual({ state: "not_required" });
  });

  it.each([
    ["number coercion", (basis: Record<string, unknown>) => { (basis.manifest as Record<string, unknown>).bytes = "1234"; }],
    ["unknown universe", (basis: Record<string, unknown>) => { basis.universe = "all_people"; }],
    ["unknown profile", (basis: Record<string, unknown>) => { (basis.source_profile as Record<string, unknown>).income_dollar_year = 2024; }],
    ["negative people", (basis: Record<string, unknown>) => { (basis.realized_zone_counts as Array<Record<string, unknown>>)[0].persons = -1; }],
    ["extra identity field", (basis: Record<string, unknown>) => { basis.claimed_accuracy = true; }],
    ["boolean count", (basis: Record<string, unknown>) => { (basis.realized_zone_counts as Array<Record<string, unknown>>)[0].households = true; }],
  ] as Array<[string, (basis: Record<string, unknown>) => void]>)("rejects strictly typed identity fault %s even with a newly computed digest", (_name, update) => {
    expect(verifiedGuidedPopulation(changedMetadata(update))).toEqual({ state: "invalid" });
  });

  it("rejects corrupt digest, noncanonical payload and object/string disagreement", () => {
    const valid = populationFixture().metadata;
    expect(verifiedGuidedPopulation({ ...valid, population_basis_digest: "0".repeat(64) })).toEqual({ state: "invalid" });
    const spaced = valid.population_basis_payload_json + " ";
    expect(verifiedGuidedPopulation({ ...valid, population_basis_payload_json: spaced, population_basis_digest: hash(spaced) })).toEqual({ state: "invalid" });
    const changed = structuredClone(valid.population_basis);
    changed.realized_zone_counts[0].persons = 3;
    expect(verifiedGuidedPopulation({ ...valid, population_basis: changed })).toEqual({ state: "invalid" });
    const duplicate = valid.population_basis_payload_json.replace('{', '{"schema":"openplan.common-population-identity.v1",');
    expect(verifiedGuidedPopulation({ ...valid, population_basis_payload_json: duplicate, population_basis_digest: hash(duplicate) })).toEqual({ state: "invalid" });
  });

  it("reports a real basis mismatch separately from missing outputs", () => {
    const f = fixture();
    f.artifacts[3].metadata_json = { ...network, ...changedMetadata((basis) => {
      (basis.realized_zone_counts as Array<Record<string, unknown>>)[0].persons = 3;
    }) };
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "mismatch", repairState: "population_basis_mismatch" });
    expect(f.evidence()).toHaveLength(4);
  });

  it("requires current managed producing attempts and the same baseline reference", () => {
    const f = fixture();
    f.stages[3].active_attempt_id = "78787878-7878-4787-8787-787878787878";
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "invalid", repairState: "population_basis_invalid" });
    f.stages[3].active_attempt_id = POPULATION_ATTEMPT_ID;
    f.runs[3].input_snapshot_json = { commonPopulation: { ...f.population.reuse,
      source: { ...f.population.source, modelRunId: "another-baseline" } } };
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "mismatch", repairState: "population_basis_mismatch" });
  });

  it("allows unrelated artifact metadata and object key order to vary", () => {
    const f = fixture();
    f.artifacts[2].metadata_json = { unrelated_note: "Harmless supplied metadata", ...f.artifacts[2].metadata_json };
    f.artifacts[3].metadata_json = Object.fromEntries(Object.entries(f.artifacts[3].metadata_json ?? {}).reverse());
    expect(guidedPopulationComparison(f.jobs, f.evidence()).state).toBe("ready");
  });

  it("preserves a valid baseline and sends only the first incompatible later job to review", () => {
    const f = fixture();
    f.runs[1].input_snapshot_json = { commonPopulation: { ...f.population.reuse,
      source: { ...f.population.source, modelRunId: "older-baseline" } } };
    const repair = guidedPopulationRerun(f.jobs, f.evidence(), f.artifacts, f.stages);
    expect(repair.nextRun).toEqual(f.jobs[1]);
    expect(repair.repairState).toBe("population_basis_mismatch");
    expect(repair.summary).toMatchObject({ sourceRunId: "run-aeq-base", households: 1, persons: 2, universe: "household_residents" });
    f.runs[1].input_snapshot_json = { commonPopulation: f.population.reuse };
    f.artifacts[2].metadata_json = network;
    expect(guidedPopulationRerun(f.jobs, f.evidence(), f.artifacts, f.stages).nextRun).toEqual(f.jobs[2]);
  });

  it("reviews a new baseline only when the latest baseline basis or retained source artifact is unusable", () => {
    const f = fixture();
    f.artifacts[0].metadata_json = network;
    expect(guidedPopulationRerun(f.jobs, f.evidence(), f.artifacts, f.stages)).toMatchObject({
      nextRun: f.jobs[0], summary: null, repairState: "needs_shared_population_rerun" });
    f.artifacts[0].metadata_json = { ...network, ...f.population.metadata };
    f.artifacts.pop();
    expect(guidedPopulationRerun(f.jobs, f.evidence(), f.artifacts, f.stages).nextRun).toEqual(f.jobs[0]);
  });
  it("requires explicit stage attestations on all four actual outputs and the retained source", () => {
    const f = fixture();
    const population = populationFixture(f.runs[0].id, "legacy_stage_snapshot");
    f.runs.forEach((run, index) => { run.attempt_managed = false;
      run.input_snapshot_json = { commonPopulation: index === 0 ? population.generate : population.reuse }; });
    f.stages.forEach((stage) => { stage.attempt_managed = false; stage.active_attempt_id = null; });
    f.artifacts.forEach((artifact) => { artifact.attempt_id = null;
      artifact.metadata_json = artifact.artifact_type === "common_population" ? population.sourceMetadata : { ...network, ...population.metadata }; });
    const eligible = new Set(f.artifacts.map((artifact) => artifact.id));
    const evidence = () => collectGuidedRunEvidence(f.jobs, f.runs, f.artifacts, f.stages, eligible);
    const comparison = guidedPopulationComparison(f.jobs, evidence());
    expect(comparison.state).toBe("ready");
    if (comparison.state === "ready") expect(guidedPopulationSnapshotMetadata(comparison)).toEqual(population.snapshot);
    expect(guidedPopulationRerun(f.jobs, evidence(), f.artifacts, f.stages, eligible)).toMatchObject({ nextRun: null });
    eligible.delete(f.artifacts[1].id);
    expect(guidedPopulationComparison(f.jobs, evidence())).toMatchObject({ state: "invalid", repairState: "population_basis_invalid" });
    expect(guidedPopulationRerun(f.jobs, evidence(), f.artifacts, f.stages, eligible).nextRun).toEqual(f.jobs[1]);
    eligible.add(f.artifacts[1].id); eligible.delete(population.source.artifactId);
    expect(guidedPopulationRerun(f.jobs, evidence(), f.artifacts, f.stages, eligible).nextRun).toEqual(f.jobs[0]);
  });

  it('uses a completed restored baseline in all four real guided evidence readers', () => {
    const f = restoredFixture();
    const evidence = f.evidence();
    const comparison = guidedPopulationComparison(f.jobs, evidence);
    expect(evidence).toHaveLength(4); expect(comparison.state).toBe('ready');
    if (comparison.state === 'ready') expect(guidedPopulationSnapshotMetadata(comparison)).toEqual(f.population.snapshot);
    expect(guidedPopulationRerun(f.jobs, evidence, f.artifacts, f.stages, f.eligible)).toMatchObject({ nextRun: null });
  });

  it.each(['checkpoint_id', 'checkpoint_sha256', 'population_digest'])('refuses a restored source with mismatched %s lineage', (field) => {
    const f = restoredFixture();
    const source = f.artifacts.find((item) => item.artifact_type === 'common_population')!;
    source.metadata_json = { ...source.metadata_json, replacement: { ...f.lineage,
      [field]: field === 'checkpoint_id' ? '99999999-9999-4999-8999-999999999999' : 'f'.repeat(64) } };
    expect(guidedPopulationRerun(f.jobs, f.evidence(), f.artifacts, f.stages, f.eligible).nextRun).toEqual(f.jobs[0]);
  });

  it.each([undefined, "unknown", "legacy_stage_snapshot"])("refuses absent or wrong consumed output custody %s", (custody) => {
    const f = fixture();
    f.artifacts[1].metadata_json = { ...network, ...f.population.metadata, population_custody: custody };
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "invalid" });
  });

  it("refuses a stage null attempt in managed requests and mixed request custody without losing the usable baseline", () => {
    const f = fixture();
    f.runs[1].input_snapshot_json = { commonPopulation: { ...f.population.reuse, source: { ...f.population.source, attemptId: null } } };
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "mismatch" });
    expect(guidedPopulationRerun(f.jobs, f.evidence(), f.artifacts, f.stages).nextRun).toEqual(f.jobs[1]);
    f.runs[1].input_snapshot_json = { commonPopulation: { ...f.population.reuse, custody: "legacy_stage_snapshot" } };
    expect(guidedPopulationComparison(f.jobs, f.evidence())).toMatchObject({ state: "mismatch" });
  });

  it("attests only exact succeeded false/null output scope through the scoped reader", async () => {
    const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
    const population = populationFixture(id(2), "legacy_stage_snapshot");
    const run: GuidedRunRow = { id: id(2), model_id: id(3), scenario_entry_id: id(4), engine_key: "aequilibrae",
      status: "succeeded", attempt_managed: false, input_snapshot_json: { commonPopulation: population.generate } };
    const stage: ModelRunStageRow = { id: id(5), run_id: run.id, stage_name: "Artifact Extraction", status: "succeeded",
      attempt_managed: false, active_attempt_id: null };
    const artifact: ModelRunArtifactRow = { id: id(6), run_id: run.id, stage_id: stage.id, attempt_id: null,
      artifact_type: "link_volumes", file_url: "local:///supplied/links.csv", file_size_bytes: 10, content_hash: "a".repeat(64),
      metadata_json: population.metadata, created_at: "2026-10-18" };
    const attestation = { schema: "openplan.common-population-stage-custody.v1", custody: "legacy_stage_snapshot",
      workspace_id: id(1), run_id: run.id, stage_id: stage.id, artifact_id: artifact.id, eligible: true };
    const readStageCustody = vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: attestation, error: null }));
    const args = { workspaceId: id(1), runs: [run], stages: [stage], artifacts: [artifact], readStageCustody };
    expect(await readGuidedStageCustody(args)).toEqual(new Set([artifact.id]));
    expect(readStageCustody).toHaveBeenCalledExactlyOnceWith(id(1), run.id, stage.id, artifact.id);
    readStageCustody.mockResolvedValue({ data: { ...attestation, workspace_id: id(99) }, error: null });
    expect(await readGuidedStageCustody(args)).toEqual(new Set());
    readStageCustody.mockClear(); stage.active_attempt_id = POPULATION_ATTEMPT_ID;
    expect(await readGuidedStageCustody(args)).toEqual(new Set()); expect(readStageCustody).not.toHaveBeenCalled();
  });

});


it("chooses current attempt evidence before recency while retaining the original rows", () => {
  const f = fixture();
  const original = structuredClone(f.artifacts[0]);
  const stale = { ...original, id: "retained-old-output", attempt_id: "99999999-9999-4999-8999-999999999999", created_at: "2099-01-01" };
  f.artifacts.push(stale);
  expect(verifiedGuidedArtifact(f.artifacts, f.stages, f.runs[0].id, "aequilibrae")?.id).toBe(original.id);
  expect(f.artifacts).toContainEqual(stale);
  f.artifacts.splice(0, 1);
  expect(verifiedGuidedArtifact(f.artifacts, f.stages, f.runs[0].id, "aequilibrae")?.producerManaged).toBe(false);
});
it("binds managed ActivitySim runtime evidence and its KPI to the same active preflight attempt", () => {
  const f = fixture(), run = f.runs[2], stage = { ...f.stages[2], stage_name: "ActivitySim Bundle & Preflight" };
  const evidence = { ...f.artifacts[2], artifact_type: "evidence_packet", metadata_json: { kind: "behavioral_demand_preflight_evidence" } };
  const current = { id: "runtime-current", run_id: run.id, attempt_id: POPULATION_ATTEMPT_ID, kpi_name: "activitysim_runtime_mode", breakdown_json: { mode: "executed" }, created_at: "2026-10-18" };
  const stale = { ...current, id: "runtime-retained", attempt_id: "99999999-9999-4999-8999-999999999999", breakdown_json: { mode: "preflight_only" }, created_at: "2099-01-01" };
  expect(verifiedActivitySimPreflight({ run, stages: [stage], artifacts: [evidence], kpis: [stale, current] })).toBe("executed");
  expect(verifiedActivitySimPreflight({ run, stages: [stage], artifacts: [evidence], kpis: [stale] })).toBeNull();
  expect(verifiedActivitySimPreflight({ run, stages: [stage], artifacts: [{ ...evidence, attempt_id: stale.attempt_id }], kpis: [current] })).toBeNull();
});
