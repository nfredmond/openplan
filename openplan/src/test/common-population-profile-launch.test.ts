import { afterEach, describe, expect, it, vi } from "vitest";
import * as sources from "@/lib/geographies/zone-attribute-source";
import { createPopulationSourceRegistry, type PopulationSourceRegistration } from "@/lib/geographies/population-source-registry";
import { prepareCommonPopulationLaunch, type CommonPopulationLaunchClient } from "@/lib/models/common-population-launch";
import type { ZoneAttributeStamp } from "@/lib/models/zone-attribute-payload";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const config = { guidedProjectComparison: "openplan.project_comparison.v1", method: "aequilibrae" };
const model = { id: id(1), workspace_id: id(2), project_id: id(3), scenario_set_id: id(4), config_json: config };
const baseline = { id: id(5), scenario_set_id: id(4), entry_type: "baseline", assumptions_json: {} };
const build = { id: id(6), scenario_set_id: id(4), entry_type: "alternative", assumptions_json: {
  guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -5, basis: "Supplied sensitivity" },
} };
const profile = { adapter: "us_census_acs5_pums", acs_summary_endpoint: "https://api.census.gov/data/2023/acs/acs5",
  pums_endpoint: "https://api.census.gov/data/2023/acs/acs5/pums", sample_years: [2019, 2023],
  income_dollar_year: 2023, puma_fields: { "2020": "PUMA" } };
const stamp: ZoneAttributeStamp = { version: "zone-attributes-v1", status: "supplied",
  storageRef: "storage://run-artifacts/model-runs/current/zone-attributes.json", sourceId: "us_census_acs5",
  sourceLabel: "Supplied fixture", vintage: "2023", keyOrigin: "none", demographics: { status: "supplied", geographies: 1, reason: null },
  equity: { status: "supplied", level: "tract", geographies: 1, reason: null }, geographyIndexTruncated: false, reason: null };
const generated = { schema: "openplan.common-population-request.v1", mode: "generate", custody: "managed_attempt",
  comparisonPolicy: "fixed_population_auto_trip_change", sourceProfile: profile };

function fixture() {
  const rows: Record<string, unknown> = {
    scenario_sets: [{ id: id(4), workspace_id: id(2), project_id: id(3), baseline_entry_id: id(5) }],
    scenario_entries: [baseline, build], models: [model],
    model_runs: [{ id: id(7), workspace_id: id(2), project_id: id(3), model_id: id(1), scenario_set_id: id(4), scenario_entry_id: id(5),
      engine_key: "aequilibrae", status: "succeeded", attempt_managed: true, corridor_geojson: geometry,
      input_snapshot_json: { commonPopulation: generated, zoneAttributes: stamp, zoneGeography: "tract" } }],
  };
  const selected: Record<string, string[]> = {};
  const client: CommonPopulationLaunchClient = { from(table) { return { select(columns) {
    (selected[table] ??= []).push(columns);
    const q: ReturnType<ReturnType<CommonPopulationLaunchClient["from"]>["select"]> = { eq: () => q, order: () => q, limit: () => q,
      then: <T = { data: unknown; error: null }, U = never>(
        yes?: ((value: { data: unknown; error: null }) => T | PromiseLike<T>) | null,
        no?: ((reason: unknown) => U | PromiseLike<U>) | null,
      ) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(yes, no),
    }; return q;
  } }; } };
  return { rows, selected, args: { client, model, scenarioEntry: baseline, engineKey: "aequilibrae", corridorGeojson: geometry,
    zoneGeography: "tract", zoneAttributes: structuredClone(stamp), custody: "managed_attempt" as const,
    readStageCustody: vi.fn(async () => ({ data: null, error: null })), readOutputs: vi.fn(async () => ({ data: null, error: null })) } };
}

function injectedAdapter(capabilities: PopulationSourceRegistration["capabilities"] = { new_guided_launch: "supported" }) {
  const descriptor: sources.ZoneAttributeSourceDescriptor = { id: "pure_test_source", vintage: "fixture-v1", retrievalUrl: "https://source.invalid/fixture",
    label: "Pure dispatch fixture", coverage: "Supplied fixture only", supportedLevels: ["tract"] };
  const testProfile = { adapter: "pure_test_population", revision: "fixture-v1" };
  const registry = createPopulationSourceRegistry([{ id: "pure_test", descriptor, profile: testProfile, capabilities }]);
  const population = vi.fn((purpose: Parameters<typeof registry.forDescriptor>[1]) => registry.forDescriptor(descriptor, purpose));
  const fetch = vi.fn<sources.ZoneAttributeSourceAdapter["fetch"]>();
  const adapter: sources.ZoneAttributeSourceAdapter = { descriptor, retainedPopulation: { profile: population }, fetch };
  vi.spyOn(sources, "resolveZoneAttributeSource").mockReturnValue(adapter);
  return { adapter, population, fetch, testProfile };
}

afterEach(() => vi.restoreAllMocks());
describe("actual shared launch calls the selected adapter's population capability", () => {
  it("preserves the exact current construction and launch-before-build behavior", async () => {
    const f = fixture();
    f.rows.scenario_entries = [baseline, { ...build, assumptions_json: {} }];
    expect(await prepareCommonPopulationLaunch(f.args)).toEqual({ state: "ready", request: generated });
    expect(f.selected.model_runs).toBeUndefined();
  });
  it("dispatches an injected non-Census pure adapter in the actual launch, without production enrollment", async () => {
    const f = fixture(); const test = injectedAdapter();
    f.args.zoneAttributes.sourceId = test.adapter.descriptor.id;
    f.args.zoneAttributes.vintage = test.adapter.descriptor.vintage;
    expect(await prepareCommonPopulationLaunch(f.args)).toEqual({ state: "ready", request: { ...generated, sourceProfile: test.testProfile } });
    expect(test.population).toHaveBeenCalledExactlyOnceWith("new_guided_launch");
    expect(test.fetch).not.toHaveBeenCalled();
    expect(sources.ZONE_ATTRIBUTE_SOURCES).toHaveLength(1);
    expect(sources.ZONE_ATTRIBUTE_SOURCES[0].descriptor.id).toBe("us_census_acs5");
  });
  it.each(["unassessed", "unsupported", "unavailable"] as const)("keeps %s distinct before provider or producer work", async (status) => {
    const f = fixture(); const test = injectedAdapter(status === "unassessed" ? {} : { new_guided_launch: status });
    const result = await prepareCommonPopulationLaunch(f.args);
    expect(result).toMatchObject({ state: "repair", repairState: `common_population_source_${status}` });
    expect(test.fetch).not.toHaveBeenCalled(); expect(f.args.readOutputs).not.toHaveBeenCalled();
    expect(f.selected.model_runs).toBeUndefined();
  });
  it("refuses an adapter with no capability and caller descriptor self-enrollment", async () => {
    const f = fixture(); const test = injectedAdapter(); delete test.adapter.retainedPopulation;
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ repairState: "common_population_source_unassessed" });
    vi.restoreAllMocks();
    expect(await prepareCommonPopulationLaunch({ ...f.args, sourceDescriptor: test.adapter.descriptor }))
      .toMatchObject({ repairState: "common_population_source_unsupported" });
  });
  it.each(["id", "vintage", "retrievalUrl"] as const)("binds the actual descriptor %s", async (field) => {
    const f = fixture();
    expect(await prepareCommonPopulationLaunch({ ...f.args, sourceDescriptor: { ...sources.US_CENSUS_ACS_DESCRIPTOR, [field]: "unknown" } }))
      .toMatchObject({ repairState: "common_population_source_unsupported" });
  });
  it.each(["sourceId", "vintage"] as const)("retains exact supplied stamp %s", async (field) => {
    const f = fixture(); f.args.zoneAttributes[field] = "different";
    expect(await prepareCommonPopulationLaunch(f.args)).toMatchObject({ repairState: "common_population_source_mismatch" });
  });
  it.each(["generate", "restore_checkpoint"])("requires production retained membership for a matching injected %s profile", async (mode) => {
    const f = fixture(); const test = injectedAdapter();
    const testStamp = { ...stamp, sourceId: test.adapter.descriptor.id, vintage: test.adapter.descriptor.vintage };
    f.args.zoneAttributes = testStamp;
    f.rows.model_runs = [{ id: id(7), workspace_id: id(2), project_id: id(3), model_id: id(1), scenario_set_id: id(4), scenario_entry_id: id(5),
      engine_key: "aequilibrae", status: "succeeded", attempt_managed: mode === "generate", corridor_geojson: geometry,
      input_snapshot_json: { zoneAttributes: testStamp, zoneGeography: "tract", commonPopulation: { ...generated, mode,
        custody: mode === "generate" ? "managed_attempt" : "legacy_stage_snapshot", sourceProfile: test.testProfile,
        ...(mode === "restore_checkpoint" ? { checkpoint: { id: id(20), sha256: "a".repeat(64) }, source: null } : {}) } } }];
    // With record-only parsing this reaches the absent-artifact branch instead.
    expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: build,
      custody: mode === "generate" ? "managed_attempt" : "legacy_stage_snapshot" }))
      .toMatchObject({ repairState: "common_population_baseline_mismatch" });
    expect(f.selected.model_run_artifacts).toBeUndefined();
    expect(test.fetch).not.toHaveBeenCalled();
  });
  it.each(["generate", "restore_checkpoint"])("refuses nonsemantic %s profiles before artifact reads", async (mode) => {
    for (const sourceProfile of [{ ...profile, extra: true }, { ...profile, puma_fields: { "2020": "PUMA20" } },
      { ...profile, sample_years: [2018, 2023] }, { ...profile, income_dollar_year: 2022 }, { adapter: "unknown" }]) {
      const f = fixture();
      f.rows.model_runs = [{ id: id(7), workspace_id: id(2), project_id: id(3), model_id: id(1), scenario_set_id: id(4), scenario_entry_id: id(5),
        engine_key: "aequilibrae", status: "succeeded", attempt_managed: mode === "generate", corridor_geojson: geometry,
        input_snapshot_json: { zoneAttributes: stamp, zoneGeography: "tract", commonPopulation: { ...generated, mode,
          custody: mode === "generate" ? "managed_attempt" : "legacy_stage_snapshot", sourceProfile,
          ...(mode === "restore_checkpoint" ? { checkpoint: { id: id(20), sha256: "a".repeat(64) }, source: null } : {}) } } }];
      expect(await prepareCommonPopulationLaunch({ ...f.args, scenarioEntry: build,
        custody: mode === "generate" ? "managed_attempt" : "legacy_stage_snapshot" }))
        .toMatchObject({ repairState: "common_population_baseline_mismatch" });
      expect(f.selected.models).toEqual(["id, workspace_id, project_id, scenario_set_id, config_json"]);
      expect(f.selected.model_runs).toEqual(["id, workspace_id, project_id, model_id, scenario_set_id, scenario_entry_id, engine_key, status, attempt_managed, corridor_geojson, input_snapshot_json"]);
      expect(f.selected.model_run_artifacts).toBeUndefined();
    }
  });
});
