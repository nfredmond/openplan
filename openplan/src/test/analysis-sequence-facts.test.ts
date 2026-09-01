import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { loadAnalysisSequenceFacts } from "@/components/models/analysis-sequence-facts";
import { resolveAnalysisSequence } from "@/components/models/analysis-sequence";
import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { guidedRunJobKey, latestGuidedRuns, type GuidedRunJob } from "@/lib/models/guided-model-evidence";

/** Project modeling facts must come from this project's exact output custody. */

type Row = Record<string, unknown>;
type TableData = { rows?: Row[]; single?: Row | null; error?: { message: string } | null };

/** Records the projection each table was read with, so it can be asserted. */
type Recorded = { selects: Record<string, string>; eqs: Record<string, Array<[string, unknown]>> };

function fakeSupabase(tables: Record<string, TableData>, recorded: Recorded): SupabaseClient {
  const client = {
    from(table: string) {
      const data = tables[table] ?? { rows: [] };
      const result = { data: data.rows ?? [], error: data.error ?? null };
      const chain = {
        select(columns: string) {
          recorded.selects[table] = columns;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          (recorded.eqs[table] ??= []).push([column, value]);
          return chain;
        },
        in: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: data.single ?? null, error: data.error ?? null }),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return client as unknown as SupabaseClient;
}

const HOME = {
  home_geography_label: "Nevada County, California",
  home_geography_source: "tigerweb",
  home_geography_kind: "county",
  home_geography_ref: "06057",
};

const HASH = "a".repeat(64);

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const PROFILE_PAYLOAD = '{"engine":"aequilibrae"}';
const SETTINGS_PAYLOAD = '{"capacity":"shared"}';
const PROFILE_HASH = digest(PROFILE_PAYLOAD);
const SETTINGS_HASH = digest(SETTINGS_PAYLOAD);
const NETWORK_STATE = { network_settings_digest: SETTINGS_HASH, osm_snapshot: "shared" };
const STATE_HASH = digest(sortedCompactJson(NETWORK_STATE));

function artifactMetadata() {
  return {
    assignment_profile: JSON.parse(PROFILE_PAYLOAD),
    assignment_profile_payload_json: PROFILE_PAYLOAD,
    assignment_profile_digest: PROFILE_HASH,
    network_settings: JSON.parse(SETTINGS_PAYLOAD),
    network_settings_payload_json: SETTINGS_PAYLOAD,
    network_settings_digest: SETTINGS_HASH,
    network_state_record: NETWORK_STATE,
    network_state_digest: STATE_HASH,
  };
}

function withCountyRuns(rows: Row[]): Record<string, TableData> {
  return {
    workspaces: { single: HOME },
    network_packages: { rows: [{ id: "pkg-1" }] },
    network_package_versions: { rows: [{ id: "ver-1" }] },
    scenario_sets: { rows: [{ id: "set-1", baseline_entry_id: null }] },
    models: { rows: [{ id: "model-1" }] },
    model_runs: { rows: [{ id: "run-1" }] },
    county_runs: { rows },
  };
}

function guidedTables(): Record<string, TableData> {
  const guided = (method: string) => ({
    guidedProjectComparison: "openplan.project_comparison.v1",
    method,
    networkBasis: {
      kind: "worker_osm_snapshot",
      source: "OpenStreetMap",
      identity: "network_state_digest",
      comparisonRule: "exact_digest_match",
    },
  });
  const runs = [
    ["run-aeq-base", "model-aeq", "entry-base"],
    ["run-aeq-build", "model-aeq", "entry-build"],
    ["run-asim-base", "model-asim", "entry-base"],
    ["run-asim-build", "model-asim", "entry-build"],
  ].map(([id, model_id, scenario_entry_id]) => ({
    id,
    model_id,
    scenario_entry_id,
    status: "succeeded",
    engine_key: model_id === "model-aeq" ? "aequilibrae" : "behavioral_demand",
    assumption_snapshot_json: scenario_entry_id === "entry-build"
      ? { guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -8, basis: "adopted project forecast" } }
      : {},
  }));
  const artifacts = runs.map((run, index) => ({
    id: `artifact-${index}`,
    run_id: run.id,
    stage_id: `stage-${index}`,
    artifact_type: run.model_id === "model-aeq" ? "link_volumes" : "activitysim_link_volumes",
    file_url: `storage://run-artifacts/${run.id}.csv`,
    file_size_bytes: 24,
    content_hash: HASH,
    metadata_json: artifactMetadata(),
    created_at: `2026-08-27T00:00:0${index}Z`,
  }));
  return {
    workspaces: { single: HOME },
    network_packages: { rows: [] },
    network_package_versions: { rows: [] },
    scenario_sets: { rows: [{ id: "set-1", baseline_entry_id: "entry-base" }] },
    scenario_entries: { rows: [
      { id: "entry-base", scenario_set_id: "set-1", entry_type: "baseline", assumptions_json: {} },
      {
        id: "entry-build",
        scenario_set_id: "set-1",
        entry_type: "alternative",
        assumptions_json: {
          guidedProjectChange: {
            kind: "assigned_auto_trip_change_pct",
            autoTripChangePct: -8,
            basis: "adopted project forecast",
          },
        },
      },
    ] },
    models: { rows: [
      { id: "model-aeq", scenario_set_id: "set-1", model_family: "travel_demand", config_json: guided("aequilibrae") },
      { id: "model-asim", scenario_set_id: "set-1", model_family: "activity_based_model", config_json: guided("activitysim") },
    ] },
    model_runs: { rows: runs },
    model_run_stages: { rows: runs.map((run, index) => ({
      id: `stage-${index}`,
      run_id: run.id,
      stage_name: run.model_id === "model-aeq" ? "Artifact Extraction" : "ActivitySim Network Assignment",
      status: "succeeded",
    })) },
    model_run_artifacts: { rows: artifacts },
    modeling_claim_decisions: { rows: runs.map((run) => ({
      model_run_id: run.id,
      track: run.model_id === "model-aeq" ? "assignment" : "behavioral_demand",
      claim_status: "screening_grade",
    })) },
    scenario_comparison_snapshots: { rows: [{ id: "snapshot-1", scenario_set_id: "set-1", status: "ready" }] },
    scenario_comparison_model_run_links: { rows: runs.map((run, index) => ({
      comparison_snapshot_id: "snapshot-1",
      model_run_id: run.id,
      model_run_artifact_id: `artifact-${index}`,
      method: run.model_id === "model-aeq" ? "aequilibrae" : "activitysim",
      scenario_role: run.scenario_entry_id === "entry-base" ? "baseline" : "build",
      artifact_type: run.model_id === "model-aeq" ? "link_volumes" : "activitysim_link_volumes",
      artifact_sha256: HASH,
      assignment_profile_sha256: PROFILE_HASH,
      network_settings_sha256: SETTINGS_HASH,
      network_state_sha256: STATE_HASH,
      scenario_assumptions_json: run.assumption_snapshot_json,
    })) },
  };
}

async function load(tables: Record<string, TableData>, projectId?: string) {
  const recorded: Recorded = { selects: {}, eqs: {} };
  const facts = await loadAnalysisSequenceFacts(fakeSupabase(tables, recorded), "ws-1", projectId);
  return { facts, recorded };
}

describe("what the analysis sequence counts as a checked run", () => {
  it("keeps exact run selection separate across multiple scenario sets", () => {
    const first: GuidedRunJob = { method: "aequilibrae", scenario: "baseline", modelId: "model-1", scenarioEntryId: "entry-1", assumptionsJson: {} };
    const second: GuidedRunJob = { method: "aequilibrae", scenario: "baseline", modelId: "model-2", scenarioEntryId: "entry-2", assumptionsJson: {} };
    const latest = latestGuidedRuns([first, second], [
      { id: "run-1", model_id: "model-1", scenario_entry_id: "entry-1", engine_key: "aequilibrae", status: "succeeded" },
      { id: "run-2", model_id: "model-2", scenario_entry_id: "entry-2", engine_key: "aequilibrae", status: "succeeded" },
    ]);
    expect(latest.get(guidedRunJobKey(first))?.id).toBe("run-1");
    expect(latest.get(guidedRunJobKey(second))?.id).toBe("run-2");
  });

  it("does not let a newer Corridor Analysis run hide the guided assignment", () => {
    const job: GuidedRunJob = {
      method: "aequilibrae",
      scenario: "baseline",
      modelId: "model-aeq",
      scenarioEntryId: "entry-base",
      assumptionsJson: {},
    };
    const latest = latestGuidedRuns([job], [
      {
        id: "newer-corridor-run",
        model_id: "model-aeq",
        scenario_entry_id: "entry-base",
        engine_key: "deterministic_corridor_v1",
        status: "succeeded",
      },
      {
        id: "guided-assignment",
        model_id: "model-aeq",
        scenario_entry_id: "entry-base",
        engine_key: "aequilibrae",
        status: "succeeded",
      },
    ]);

    expect(latest.get(guidedRunJobKey(job))?.id).toBe("guided-assignment");
  });

  it("counts only claim decisions attached to the exact verified project outputs", async () => {
    const { facts } = await load(guidedTables());
    expect(facts.aequilibraeRunCount).toBe(2);
    expect(facts.activitySimRunCount).toBe(2);
    expect(facts.checkedRunCount).toBe(4);
    expect(facts.nonPrototypeCheckedRunCount).toBe(4);
    expect(facts.guidedComparisonCheckedCount).toBe(1);
    expect(facts.comparisonPacketCount).toBe(1);
  });

  it("does not let a workspace-wide county result satisfy a project step", async () => {
    const { facts } = await load(withCountyRuns([{ stage: "validated-screening", status_label: "bounded screening-ready" }]));
    expect(facts.checkedRunCount).toBe(0);
  });

  it("does not count succeeded statuses without method artifacts", async () => {
    const tables = guidedTables();
    tables.model_run_artifacts = { rows: [] };
    const { facts } = await load(tables);
    expect(facts.aequilibraeRunCount).toBe(0);
    expect(facts.activitySimRunCount).toBe(0);
  });

  it("rejects a malformed artifact hash and an unbound ready snapshot", async () => {
    const tables = guidedTables();
    const artifacts = tables.model_run_artifacts.rows ?? [];
    artifacts[0] = { ...artifacts[0], content_hash: "tampered" };
    const { facts } = await load(tables);
    expect(facts.aequilibraeRunCount).toBe(1);
    expect(facts.comparisonPacketCount).toBe(0);
    expect(facts.savedComparisonPacketCount).toBe(1);
  });

  it("does not accept an otherwise ready snapshot with no exact run links", async () => {
    const tables = guidedTables();
    tables.scenario_comparison_model_run_links = { rows: [] };
    const { facts } = await load(tables);
    expect(facts.comparisonPacketCount).toBe(0);
    expect(facts.savedComparisonPacketCount).toBe(1);
  });

  it("keeps validation incomplete until all four exact outputs have track-matched decisions", async () => {
    const tables = guidedTables();
    tables.modeling_claim_decisions.rows = tables.modeling_claim_decisions.rows?.slice(0, 3);
    const { facts } = await load(tables);
    expect(facts.checkedRunCount).toBe(3);
    expect(facts.guidedComparisonCheckedCount).toBe(0);
    expect(resolveAnalysisSequence(facts).find((step) => step.id === "check")?.state).not.toBe("done");
  });

  it("records all four decisions even when one remains prototype-only", async () => {
    const tables = guidedTables();
    const decisions = tables.modeling_claim_decisions.rows ?? [];
    decisions[3] = { ...decisions[3], claim_status: "prototype_only" };
    const { facts } = await load(tables);
    expect(facts.checkedRunCount).toBe(4);
    expect(facts.nonPrototypeCheckedRunCount).toBe(3);
    expect(facts.guidedComparisonCheckedCount).toBe(1);
  });

  it("rejects four individually valid artifacts when one names a different network state", async () => {
    const tables = guidedTables();
    const artifacts = tables.model_run_artifacts.rows ?? [];
    const changedState = { network_settings_digest: SETTINGS_HASH, osm_snapshot: "different" };
    artifacts[3] = {
      ...artifacts[3],
      metadata_json: {
        ...artifactMetadata(),
        network_state_record: changedState,
        network_state_digest: digest(sortedCompactJson(changedState)),
      },
    };
    const { facts } = await load(tables);
    expect(facts.activitySimRunCount).toBe(2);
    expect(facts.guidedComparisonCheckedCount).toBe(0);
    expect(facts.comparisonPacketCount).toBe(0);
  });

  it("fails closed on a corrupt newest retry instead of falling back to an older artifact", async () => {
    const tables = guidedTables();
    tables.model_run_artifacts.rows?.push({
      ...(tables.model_run_artifacts.rows[0] ?? {}),
      id: "artifact-newest-corrupt",
      content_hash: "corrupt",
      created_at: "2026-08-28T00:00:00Z",
    });
    const { facts } = await load(tables);
    expect(facts.aequilibraeRunCount).toBe(1);
    expect(facts.comparisonPacketCount).toBe(0);
  });

  it("requires exact baseline assumptions as well as the guided build assumption", async () => {
    const tables = guidedTables();
    const baseline = tables.scenario_entries.rows?.[0];
    if (baseline) baseline.assumptions_json = { horizonYear: 2050 };
    const { facts } = await load(tables);
    expect(facts.aequilibraeRunCount).toBe(1);
    expect(facts.activitySimRunCount).toBe(1);
    expect(facts.comparisonPacketCount).toBe(0);
  });

  it("treats a snapshot as stale after the build assumption changes", async () => {
    const tables = guidedTables();
    const entries = tables.scenario_entries.rows ?? [];
    entries[1] = {
      ...entries[1],
      assumptions_json: {
        guidedProjectChange: {
          kind: "assigned_auto_trip_change_pct",
          autoTripChangePct: -12,
          basis: "revised adopted project forecast",
        },
      },
    };
    const { facts } = await load(tables);
    expect(facts.comparisonPacketCount).toBe(0);
  });

  it("records prototype decisions separately from non-prototype passes and rejects wrong tracks", async () => {
    const tables = guidedTables();
    tables.modeling_claim_decisions = { rows: [
      { model_run_id: "run-asim-base", track: "assignment", claim_status: "screening_grade" },
      { model_run_id: "run-aeq-base", track: "assignment", claim_status: "prototype_only" },
    ] };
    const { facts } = await load(tables);
    expect(facts.checkedRunCount).toBe(1);
    expect(facts.nonPrototypeCheckedRunCount).toBe(0);
    expect(facts.guidedComparisonCheckedCount).toBe(0);
  });

  it("projects the hashes, sizes, tracks, and snapshot binding fields it checks", async () => {
    const { recorded } = await load(guidedTables());
    expect(recorded.selects.model_run_artifacts).toContain("content_hash");
    expect(recorded.selects.model_run_artifacts).toContain("file_size_bytes");
    expect(recorded.selects.model_run_artifacts).toContain("metadata_json");
    expect(recorded.selects.model_run_stages).toContain("stage_name");
    expect(recorded.selects.modeling_claim_decisions).toContain("claim_status");
    expect(recorded.selects.scenario_comparison_model_run_links).toContain("artifact_sha256");
  });

  it("pins scenario sets, models, and project geography to the launched project", async () => {
    const tables = guidedTables();
    tables.projects = { single: { place_source: "drawn", place_geometry_geojson: { type: "Polygon", coordinates: [] } } };
    const { recorded } = await load(tables, "project-1");
    expect(recorded.eqs.projects).toEqual(expect.arrayContaining([["id", "project-1"], ["workspace_id", "ws-1"]]));
    expect(recorded.eqs.scenario_sets).toContainEqual(["project_id", "project-1"]);
    expect(recorded.eqs.models).toContainEqual(["project_id", "project-1"]);
  });
});

describe("a failed read is not an empty agency", () => {
  it("names the step it could not read instead of reporting nothing done", async () => {
    const tables = guidedTables();
    tables.modeling_claim_decisions = { rows: [], error: { message: "permission denied" } };
    const { facts } = await load(tables);

    expect(facts.unreadable).toContain("check");
    const step = resolveAnalysisSequence(facts).find((entry) => entry.id === "check");
    expect(step?.state).toBe("unknown");
    expect(step?.standing).toContain("could not be read");
  });

  it("does the same for every other read behind the sequence", async () => {
    for (const [table, step] of [
      ["workspaces", "area"],
      ["network_package_versions", "network"],
      ["scenario_sets", "comparison"],
      ["models", "model"],
      ["model_runs", "run"],
    ] as const) {
      const tables = withCountyRuns([]);
      tables[table] = { ...tables[table], error: { message: "boom" } };
      const { facts } = await load(tables);
      expect(facts.unreadable, `${table} should mark ${step}`).toContain(step);
    }
  });
});

describe("counting the work that has actually been done", () => {
  it("counts networks by version, not by an empty package", async () => {
    // A package with no version in it is a name, and nothing can be run against
    // a name. Counting packages would tell a planner step two was finished.
    const tables = withCountyRuns([]);
    tables.network_package_versions = { rows: [] };
    const { facts } = await load(tables);
    expect(facts.networkCount).toBe(0);
    expect(resolveAnalysisSequence(facts).find((step) => step.id === "network")?.state).toBe("next");
  });

  it("accepts the explicit managed worker basis without pretending a snapshot is loaded", async () => {
    const tables = withCountyRuns([]);
    tables.network_package_versions = { rows: [] };
    tables.models = {
      rows: [
        {
          id: "model-aeq",
          scenario_set_id: "set-1",
          model_family: "travel_demand",
          config_json: {
            guidedProjectComparison: "openplan.project_comparison.v1",
            method: "aequilibrae",
            networkBasis: {
              kind: "worker_osm_snapshot",
              source: "OpenStreetMap",
              identity: "network_state_digest",
              comparisonRule: "exact_digest_match",
            },
          },
        },
        {
          id: "model-asim",
          scenario_set_id: "set-1",
          model_family: "activity_based_model",
          config_json: {
            guidedProjectComparison: "openplan.project_comparison.v1",
            method: "activitysim",
            networkBasis: {
              kind: "worker_osm_snapshot",
              source: "OpenStreetMap",
              identity: "network_state_digest",
              comparisonRule: "exact_digest_match",
            },
          },
        },
      ],
    };

    const { facts, recorded } = await load(tables);
    const network = resolveAnalysisSequence(facts).find((step) => step.id === "network");
    expect(recorded.selects.models).toContain("config_json");
    expect(facts.networkCount).toBe(0);
    expect(facts.managedNetworkBasisCount).toBe(1);
    expect(network?.state).toBe("done");
    expect(network?.standing).toContain("exact snapshot and digest remain unavailable until launch succeeds");
  });

  it("does not accept a managed basis when either method lacks the exact comparison rule", async () => {
    const tables = withCountyRuns([]);
    tables.network_package_versions = { rows: [{ id: "generic-version-that-must-not-rescue-guided" }] };
    tables.models = {
      rows: [
        {
          id: "model-aeq",
          model_family: "travel_demand",
          config_json: {
            guidedProjectComparison: "openplan.project_comparison.v1",
            method: "aequilibrae",
            networkBasis: {
              kind: "worker_osm_snapshot",
              source: "OpenStreetMap",
              identity: "network_state_digest",
              comparisonRule: "exact_digest_match",
            },
          },
        },
        {
          id: "model-asim",
          model_family: "activity_based_model",
          config_json: {
            guidedProjectComparison: "openplan.project_comparison.v1",
            method: "activitysim",
            networkBasis: {
              kind: "worker_osm_snapshot",
              source: "OpenStreetMap",
              identity: "network_state_digest",
              comparisonRule: "trust_latest",
            },
          },
        },
      ],
    };

    const { facts } = await load(tables);
    expect(facts.managedNetworkBasisCount).toBe(0);
    expect(facts.guidedProjectComparison).toBe(true);
    expect(facts.aequilibraeRunCount).toBe(0);
    expect(facts.activitySimRunCount).toBe(0);
    expect(resolveAnalysisSequence(facts).find((step) => step.id === "network")?.state).toBe("next");
  });

  it("calls a drawn boundary with no name an area all the same", async () => {
    const tables = withCountyRuns([]);
    tables.workspaces = {
      // A boundary the planner drew or uploaded: it has a source and a shape,
      // and no name — `parseWorkspaceHomeGeography` requires the source.
      single: {
        home_geography_source: "upload",
        home_geometry_geojson: { type: "Polygon", coordinates: [] },
        home_geography_label: null,
      },
    };
    const { facts } = await load(tables);
    expect(facts.areaLabel).toBe("the boundary on file");
    expect(resolveAnalysisSequence(facts).find((step) => step.id === "area")?.state).toBe("done");
  });

  it("requires separate AequilibraE and ActivitySim records, not merely two models", async () => {
    const oneMethod = withCountyRuns([]);
    oneMethod.models = {
      rows: [
        { id: "model-1", model_family: "travel_demand" },
        { id: "model-2", model_family: "travel_demand" },
      ],
    };
    const oneMethodFacts = (await load(oneMethod)).facts;
    expect(oneMethodFacts.aequilibraeModelCount).toBe(2);
    expect(oneMethodFacts.activitySimModelCount).toBe(0);
    expect(resolveAnalysisSequence(oneMethodFacts).find((step) => step.id === "model")?.state).not.toBe("done");

    const bothMethods = withCountyRuns([]);
    bothMethods.models = {
      rows: [
        { id: "model-1", model_family: "travel_demand" },
        { id: "model-2", model_family: "activity_based_model" },
      ],
    };
    const bothMethodFacts = (await load(bothMethods)).facts;
    expect(resolveAnalysisSequence(bothMethodFacts).find((step) => step.id === "model")?.state).toBe("done");
  });
});
