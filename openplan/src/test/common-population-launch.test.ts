import { describe, expect, it, vi } from "vitest";
import { prepareCommonPopulationLaunch, type CommonPopulationLaunchClient } from "@/lib/models/common-population-launch";
import { US_CENSUS_ACS_DESCRIPTOR } from "@/lib/geographies/zone-attribute-source";
import { GUIDED_PROJECT_COMPARISON_VERSION } from "@/lib/models/project-comparison";
import type { ZoneAttributeStamp } from "@/lib/models/zone-attribute-payload";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const config = (method: string) => ({ guidedProjectComparison: GUIDED_PROJECT_COMPARISON_VERSION, method });
const model = { id: id(1), workspace_id: id(2), project_id: id(3), scenario_set_id: id(4), config_json: config("aequilibrae") };
const baseline = { id: id(5), scenario_set_id: id(4), entry_type: "baseline", assumptions_json: {} };
const build = { id: id(6), scenario_set_id: id(4), entry_type: "alternative", assumptions_json: {
  guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -10, basis: "Planner-supplied sensitivity input" },
} };
const profile = {
  adapter: "us_census_acs5_pums", acs_summary_endpoint: "https://api.census.gov/data/2023/acs/acs5",
  pums_endpoint: "https://api.census.gov/data/2023/acs/acs5/pums", sample_years: [2019, 2023],
  income_dollar_year: 2023, puma_fields: { "2020": "PUMA" },
};
const generated = { schema: "openplan.common-population-request.v1", mode: "generate", custody: "managed_attempt", comparisonPolicy: "fixed_population_auto_trip_change", sourceProfile: profile };
const stamp: ZoneAttributeStamp = {
  version: "zone-attributes-v1", status: "supplied", storageRef: "storage://run-artifacts/model-runs/current/zone-attributes.json",
  sourceId: "us_census_acs5", sourceLabel: "Synthetic supplied adapter fixture", vintage: "2023", keyOrigin: "workspace",
  demographics: { status: "supplied", geographies: 2, reason: null },
  equity: { status: "supplied", level: "tract", geographies: 2, reason: null }, reason: null, geographyIndexTruncated: false,
};
const run = {
  id: id(7), workspace_id: id(2), project_id: id(3), model_id: id(1), scenario_set_id: id(4), scenario_entry_id: id(5),
  engine_key: "aequilibrae", status: "succeeded", attempt_managed: true, corridor_geojson: geometry,
  input_snapshot_json: { commonPopulation: generated, zoneGeography: "tract", zoneAttributes: stamp },
};
const artifact = { id: id(8), run_id: id(7), stage_id: id(9), attempt_id: id(10), artifact_type: "common_population",
  file_url: "/owned/baseline/common-population.json", file_size_bytes: "1234", content_hash: "a".repeat(64) };
const stage = { id: id(9), run_id: id(7), stage_name: "AequilibraE Setup", status: "succeeded", attempt_managed: true, active_attempt_id: id(10) };

function fixture() {
  const tables: Record<string, unknown> = {
    scenario_sets: [{ id: id(4), workspace_id: id(2), project_id: id(3), baseline_entry_id: id(5) }],
    scenario_entries: [structuredClone(baseline), structuredClone(build)], models: [structuredClone(model)], model_runs: [structuredClone(run)],
    model_run_artifacts: [structuredClone(artifact)], model_run_stages: [structuredClone(stage)],
  };
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const errors: Record<string, { message: string } | null> = {};
  const client: CommonPopulationLaunchClient = {
    from(table) {
      return { select(columns) {
        calls.push({ table, method: "select", args: [columns] });
        const query = {
          eq(column: string, value: string) { calls.push({ table, method: "eq", args: [column, value] }); return query; },
          order(column: string, options: { ascending: boolean }) { calls.push({ table, method: "order", args: [column, options] }); return query; },
          limit(count: number) { calls.push({ table, method: "limit", args: [count] }); return query; },
          then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
            fulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
            rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) { return Promise.resolve({ data: tables[table], error: errors[table] ?? null }).then(fulfilled, rejected); },
        };
        return query;
      } };
    },
  };
  const readOutputs = vi.fn<(runId: string, workspaceId: string) => Promise<{ data: unknown; error: { message: string } | null }>>(
    async (_runId, _workspaceId) => ({ data: {
      run_id: id(7), run_status: "succeeded", outputs: [{ kind: "artifact", ownership_state: "current_completed", record: structuredClone(artifact) }],
    }, error: null }),
  );
  const readStageCustody = vi.fn(async (workspaceId: string, runId: string, stageId: string, artifactId: string): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: {
    schema: "openplan.common-population-stage-custody.v1", custody: "legacy_stage_snapshot", workspace_id: workspaceId,
    run_id: runId, stage_id: stageId, artifact_id: artifactId, eligible: true,
  } as Record<string, unknown>, error: null as { message: string } | null }));
  const args = { client, readOutputs, readStageCustody, custody: "managed_attempt" as const, model: structuredClone(model), scenarioEntry: structuredClone(build),
    engineKey: "aequilibrae", corridorGeojson: structuredClone(geometry), zoneGeography: "tract", zoneAttributes: structuredClone(stamp),
    sourceDescriptor: { ...US_CENSUS_ACS_DESCRIPTOR } };
  return { args, tables, calls, errors, readOutputs, readStageCustody };
}


function stageFixture() {
  const f = fixture();
  const stageGenerate = { ...generated, custody: "legacy_stage_snapshot" };
  f.tables.model_runs = [{ ...run, attempt_managed: false, input_snapshot_json: { ...run.input_snapshot_json, commonPopulation: stageGenerate } }];
  f.tables.model_run_artifacts = [{ ...artifact, attempt_id: null }];
  f.tables.model_run_stages = [{ ...stage, attempt_managed: false, active_attempt_id: null }];
  return { ...f, args: { ...f.args, custody: "legacy_stage_snapshot" as const }, stageGenerate };
}

describe("server-selected common-population launch", () => {
  it.each(["managed_attempt", "legacy_stage_snapshot"] as const)("retains the fresh guided baseline before any build assumption with %s custody", async (custody) => {
    const f = fixture();
    f.tables.scenario_entries = [baseline, { ...build, assumptions_json: {} }];
    expect(await prepareCommonPopulationLaunch({ ...f.args, custody, scenarioEntry: baseline }))
      .toEqual({ state: "ready", request: { ...generated, custody } });
    expect(f.calls).toContainEqual({ table: "scenario_entries", method: "select", args: ["id, scenario_set_id, entry_type, assumptions_json"] });
    expect(f.calls.map((call) => call.table)).not.toContain("model_runs");
    expect(f.readOutputs).not.toHaveBeenCalled();
    expect(f.readStageCustody).not.toHaveBeenCalled();
  });

  it("still refuses an invalid current build change on reuse", async () => {
    const f = fixture();
    const invalidBuild = { ...build, assumptions_json: { guidedProjectChange: {
      kind: "assigned_auto_trip_change_pct", autoTripChangePct: -91, basis: "Planner sensitivity input",
    } } };
    f.tables.scenario_entries = [baseline, invalidBuild];
    expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: invalidBuild }))
      .toMatchObject({ state: "repair", repairState: "common_population_comparison_scope_invalid" });
    expect(f.calls.map((call) => call.table)).not.toContain("model_runs");
  });

  it.each(["missing baseline", "wrong baseline type", "duplicate build", "wrong entry scope"])("keeps %s invalid before a fresh guided baseline", async (fault) => {
    const f = fixture();
    const emptyBuild = { ...build, assumptions_json: {} };
    f.tables.scenario_entries = fault === "missing baseline" ? [emptyBuild]
      : fault === "wrong baseline type" ? [{ ...baseline, entry_type: "alternative" }, emptyBuild]
      : fault === "duplicate build" ? [baseline, emptyBuild, { ...emptyBuild, id: id(80) }]
      : [baseline, emptyBuild];
    expect(await prepareCommonPopulationLaunch({ ...f.args,
      scenarioEntry: fault === "wrong entry scope" ? { ...baseline, scenario_set_id: id(80) } : baseline,
    })).toMatchObject({ state: "repair", repairState: "common_population_comparison_scope_invalid" });
  });

  it("generates only the first guided AequilibraE baseline from the actual supplied adapter profile", async () => {
    const f = fixture();
    expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: baseline })).toEqual({ state: "ready", request: generated });
    expect(f.calls.map((call) => call.table)).not.toContain("model_runs");
    expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it.each(["aequilibrae-build", "activitysim-baseline", "activitysim-build"])("reuses the exact designated baseline for %s", async (job) => {
    const f = fixture();
    const activitysim = job.startsWith("activitysim");
    const result = await prepareCommonPopulationLaunch({ ...f.args,
      model: activitysim ? { ...model, id: id(11), config_json: config("activitysim") } : model,
      engineKey: activitysim ? "behavioral_demand" : "aequilibrae",
      scenarioEntry: job.endsWith("baseline") ? baseline : build,
    });
    expect(result).toEqual({ state: "ready", request: {
      schema: generated.schema, custody: "managed_attempt", mode: "reuse", comparisonPolicy: generated.comparisonPolicy,
      source: { modelRunId: id(7), artifactId: id(8), stageId: id(9), attemptId: id(10), sha256: "a".repeat(64), sizeBytes: 1234 },
    } });
    expect(f.readOutputs).toHaveBeenCalledExactlyOnceWith(id(7), id(2));
    const projections: Record<string, string> = {
      scenario_sets: "id, workspace_id, project_id, baseline_entry_id",
      scenario_entries: "id, scenario_set_id, entry_type, assumptions_json",
      models: "id, workspace_id, project_id, scenario_set_id, config_json",
      model_runs: "id, workspace_id, project_id, model_id, scenario_set_id, scenario_entry_id, engine_key, status, attempt_managed, corridor_geojson, input_snapshot_json",
      model_run_artifacts: "id, run_id, stage_id, attempt_id, artifact_type, file_url, file_size_bytes, content_hash",
      model_run_stages: "id, run_id, stage_name, status, attempt_managed, active_attempt_id",
    };
    for (const [table, projection] of Object.entries(projections)) {
      expect(f.calls).toContainEqual({ table, method: "select", args: [projection] });
    }
    for (const [column, value] of [["workspace_id", id(2)], ["project_id", id(3)], ["model_id", id(1)],
      ["scenario_set_id", id(4)], ["scenario_entry_id", id(5)], ["engine_key", "aequilibrae"]]) {
      expect(f.calls).toContainEqual({ table: "model_runs", method: "eq", args: [column, value] });
    }
    expect(f.calls.filter((call) => call.table === "model_runs" && call.method === "order")).toEqual([
      { table: "model_runs", method: "order", args: ["created_at", { ascending: false }] },
      { table: "model_runs", method: "order", args: ["id", { ascending: false }] },
    ]);
    expect(f.calls).not.toContainEqual({ table: "model_runs", method: "eq", args: ["status", "succeeded"] });
  });

  it("preserves standalone and future population-changing contracts", async () => {
    const f = fixture();
    expect(await prepareCommonPopulationLaunch({ ...f.args, model: { ...model, config_json: {} } })).toEqual({ state: "not_applicable" });
    expect(f.calls).toEqual([]);
    const future = { ...build, assumptions_json: { guidedProjectChange: { kind: "future_population_change" } } };
    f.tables.scenario_entries = [baseline, future];
    expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: future })).toEqual({ state: "not_applicable" });
    expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", { status: "unavailable" }, "common_population_source_unavailable"],
    ["truncated", { geographyIndexTruncated: true }, "common_population_source_unavailable"],
    ["wrong supplied vintage", { vintage: "2022" }, "common_population_source_mismatch"],
    ["wrong supplied adapter", { sourceId: "another_adapter" }, "common_population_source_mismatch"],
  ] as const)("refuses %s inputs before baseline generation", async (_label, overrides, repairState) => {
    const f = fixture();
    expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: baseline, zoneAttributes: { ...stamp, ...overrides } }))
      .toMatchObject({ state: "repair", repairState });
    expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it.each(["id", "vintage", "retrievalUrl"])("refuses an unsupported registered source %s", async (field) => {
    const f = fixture();
    expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: baseline,
      sourceDescriptor: { ...US_CENSUS_ACS_DESCRIPTOR, [field]: "unsupported" } })).toMatchObject({
      state: "repair", repairState: "common_population_source_unsupported",
    });
  });

  it.each([
    ["workspace_id", id(20)], ["project_id", id(20)], ["model_id", id(20)], ["scenario_set_id", id(20)],
    ["scenario_entry_id", id(20)], ["status", "running"], ["attempt_managed", false],
  ])("refuses baseline run %s mismatch without reading outputs", async (field, value) => {
    const f = fixture();
    f.tables.model_runs = [{ ...run, [field]: value }];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_baseline_required" });
    expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it.each([
    { commonPopulation: undefined, zoneGeography: "tract" },
    { commonPopulation: generated, zoneGeography: "block_group" },
    { commonPopulation: { ...generated, sourceProfile: { ...profile, income_dollar_year: 2022 } }, zoneGeography: "tract" },
  ])("refuses a historical or mismatched input basis", async (input_snapshot_json) => {
    const f = fixture();
    f.tables.model_runs = [{ ...run, input_snapshot_json: { ...run.input_snapshot_json, ...input_snapshot_json } }];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_baseline_mismatch" });
  });

  it.each([
    [{ ...model, workspace_id: id(20) }], [{ ...model, project_id: id(20) }], [{ ...model, scenario_set_id: id(20) }],
    [{ ...model, id: id(20) }], [model, { ...model, id: id(20) }],
  ])("refuses an ambiguous or cross-scope source model %j", async (...models) => {
    const f = fixture();
    f.tables.models = models;
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_baseline_model_invalid" });
    expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it.each([
    { project_id: id(20) }, { workspace_id: id(20) }, { baseline_entry_id: id(20) },
  ])("refuses a mismatched comparison scope %j", async (overrides) => {
    const f = fixture();
    f.tables.scenario_sets = [{ id: id(4), workspace_id: id(2), project_id: id(3), baseline_entry_id: id(5), ...overrides }];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_comparison_scope_invalid" });
  });

  it("requires exact geometry while ignoring object key order and unrelated source rows", async () => {
    const f = fixture();
    f.tables.models = [{ ...model, id: id(25), config_json: null }, model];
    expect(await prepareCommonPopulationLaunch({ ...f.args, corridorGeojson: { coordinates: geometry.coordinates, type: "Polygon" } }))
      .toMatchObject({ state: "ready" });
    expect(await prepareCommonPopulationLaunch({ ...f.args, corridorGeojson: { ...geometry, coordinates: [] } }))
      .toMatchObject({ state: "repair", repairState: "common_population_baseline_mismatch" });
  });

  it.each([
    { attempt_id: null }, { stage_id: id(20) }, { content_hash: "bad" }, { file_size_bytes: 0 },
    { file_size_bytes: "9007199254740992" }, { file_size_bytes: "1e3" }, { run_id: id(20) },
  ])("refuses incomplete or mismatched population artifact %j", async (overrides) => {
    const f = fixture();
    const changed = { ...artifact, ...overrides };
    f.tables.model_run_artifacts = [changed];
    f.readOutputs.mockResolvedValue({ data: { run_id: id(7), run_status: "succeeded", outputs: [
      { kind: "artifact", ownership_state: "current_completed", record: changed },
    ] }, error: null });
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair" });
  });

  it.each(["model_run_artifacts", "model_run_stages"])("refuses duplicate %s rows", async (table) => {
    const f = fixture();
    const row = table === "model_run_artifacts" ? artifact : stage;
    f.tables[table] = [row, row];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair" });
  });

  it.each([{ stage_name: "Artifact Extraction" }, { status: "running" }, { attempt_managed: false }, { active_attempt_id: id(20) }])
    ("refuses an inactive or wrong setup stage %j", async (overrides) => {
      const f = fixture();
      f.tables.model_run_stages = [{ ...stage, ...overrides }];
      expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_attempt_invalid" });
      expect(f.readOutputs).not.toHaveBeenCalled();
    });

  it.each(["retained_inactive", "invalid_binding", "legacy_unknown", "current_in_progress"])("refuses %s ownership", async (ownership_state) => {
    const f = fixture();
    f.readOutputs.mockResolvedValue({ data: { run_id: id(7), run_status: "succeeded", outputs: [
      { kind: "artifact", ownership_state, record: artifact },
    ] }, error: null });
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_attempt_invalid" });
  });

  it("requires the RPC's exact retained record, not just a completed label", async () => {
    const f = fixture();
    f.readOutputs.mockResolvedValue({ data: { run_id: id(7), run_status: "succeeded", outputs: [
      { kind: "artifact", ownership_state: "current_completed", record: { ...artifact, content_hash: "b".repeat(64) } },
    ] }, error: null });
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_attempt_invalid" });
  });

  it.each(["scenario_sets", "scenario_entries", "models", "model_runs", "model_run_artifacts", "model_run_stages"])
    ("names the repair state when %s cannot be read", async (table) => {
      const f = fixture();
      f.errors[table] = { message: "Synthetic read refusal" };
      expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_source_read_failed", status: 503 });
    });

  it("names a failed or rejected attempt-reader call", async () => {
    const f = fixture();
    f.readOutputs.mockRejectedValue(new Error("Synthetic transport refusal"));
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_source_read_failed", status: 503 });
  });
  it("defaults normal baseline generation to explicit stage custody without claiming future execution", async () => {
    const f = stageFixture();
    const { custody: _custody, ...args } = f.args;
    expect(await prepareCommonPopulationLaunch({ ...args, scenarioEntry: baseline })).toEqual({ state: "ready", request: f.stageGenerate });
    expect(f.readStageCustody).not.toHaveBeenCalled(); expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it("reuses only a fresh stage attestation and preserves actual null attempt identity", async () => {
    const f = stageFixture();
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "ready", request: { custody: "legacy_stage_snapshot",
      mode: "reuse", source: { modelRunId: run.id, artifactId: artifact.id, stageId: stage.id, attemptId: null } } });
    expect(f.readStageCustody).toHaveBeenCalledExactlyOnceWith(model.workspace_id, run.id, stage.id, artifact.id);
    expect(f.readOutputs).not.toHaveBeenCalled();
    expect(f.calls.some((call) => ["model_run_execution_enrollments", "model_stage_execution_starts", "model_stage_attempts"].includes(call.table))).toBe(false);
  });

  it.each(["workspace_id", "run_id", "stage_id", "artifact_id", "custody", "schema", "eligible", "extra"])("refuses a changed attestation %s", async (field) => {
    const f = stageFixture();
    const data: Record<string, unknown> = { schema: "openplan.common-population-stage-custody.v1", custody: "legacy_stage_snapshot",
      workspace_id: model.workspace_id, run_id: run.id, stage_id: stage.id, artifact_id: artifact.id, eligible: true };
    data[field] = field === "eligible" ? false : id(99);
    f.readStageCustody.mockResolvedValue({ data, error: null });
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_custody_invalid" });
    expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it.each([undefined, "unknown", "managed_attempt"])("refuses omitted or mixed source request custody %s", async (custody) => {
    const f = stageFixture();
    f.tables.model_runs = [{ ...run, attempt_managed: false, input_snapshot_json: {
      ...run.input_snapshot_json, commonPopulation: { ...generated, custody },
    } }];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_baseline_mismatch" });
    expect(f.readStageCustody).not.toHaveBeenCalled();
  });

  it.each(["managed_run", "managed_stage", "artifact_attempt", "active_attempt"])("refuses mixed stage flags %s before attesting", async (change) => {
    const f = stageFixture();
    if (change === "managed_run") f.tables.model_runs = [{ ...run, input_snapshot_json: { ...run.input_snapshot_json, commonPopulation: f.stageGenerate } }];
    if (change === "managed_stage") f.tables.model_run_stages = [{ ...stage, active_attempt_id: null }];
    if (change === "artifact_attempt") f.tables.model_run_artifacts = [artifact];
    if (change === "active_attempt") f.tables.model_run_stages = [{ ...stage, attempt_managed: false }];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair" });
    expect(f.readStageCustody).not.toHaveBeenCalled(); expect(f.readOutputs).not.toHaveBeenCalled();
  });

  it("does not downgrade managed refusal to the stage reader", async () => {
    const f = fixture();
    f.readOutputs.mockResolvedValue({ data: { run_id: run.id, run_status: "succeeded", outputs: [
      { kind: "artifact", ownership_state: "legacy_unknown", record: artifact },
    ] }, error: null });
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", repairState: "common_population_attempt_invalid" });
    expect(f.readStageCustody).not.toHaveBeenCalled();
  });

  it("keeps harmless unrelated scoped models eligible but refuses an unconfirmed stage read", async () => {
    const f = stageFixture();
    f.tables.models = [{ ...model, id: id(90), config_json: null }, model];
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "ready" });
    f.readStageCustody.mockResolvedValue({ data: null, error: { message: "Supplied native refusal" } });
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ state: "repair", status: 503 });
  });

});
