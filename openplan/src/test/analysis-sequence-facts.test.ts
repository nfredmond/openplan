import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { loadAnalysisSequenceFacts } from "@/components/models/analysis-sequence-facts";
import { resolveAnalysisSequence } from "@/components/models/analysis-sequence";

/** Project modeling facts must come from this project's exact output custody. */

type Row = Record<string, unknown>;
type TableData = { rows?: Row[]; single?: Row | null; error?: { message: string } | null };

/** Records the projection each table was read with, so it can be asserted. */
type Recorded = { selects: Record<string, string> };

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
        eq: () => chain,
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
    assumption_snapshot_json: scenario_entry_id === "entry-build"
      ? { guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -8, basis: "adopted project forecast" } }
      : null,
  }));
  const artifacts = runs.map((run) => ({
    run_id: run.id,
    artifact_type: run.model_id === "model-aeq" ? "link_volumes" : "activitysim_link_volumes",
    file_url: `storage://run-artifacts/${run.id}.csv`,
    file_size_bytes: 24,
    content_hash: HASH,
  }));
  return {
    workspaces: { single: HOME },
    network_packages: { rows: [] },
    network_package_versions: { rows: [] },
    scenario_sets: { rows: [{ id: "set-1", baseline_entry_id: "entry-base" }] },
    scenario_entries: { rows: [
      { id: "entry-base", scenario_set_id: "set-1", entry_type: "baseline" },
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
    model_run_artifacts: { rows: artifacts },
    modeling_claim_decisions: { rows: runs.map((run) => ({
      model_run_id: run.id,
      track: run.model_id === "model-aeq" ? "assignment" : "behavioral_demand",
      claim_status: "screening_grade",
    })) },
    scenario_comparison_snapshots: { rows: [{ id: "snapshot-1", scenario_set_id: "set-1", status: "ready" }] },
    scenario_comparison_model_run_links: { rows: runs.map((run) => ({
      comparison_snapshot_id: "snapshot-1",
      model_run_id: run.id,
      method: run.model_id === "model-aeq" ? "aequilibrae" : "activitysim",
      scenario_role: run.scenario_entry_id === "entry-base" ? "baseline" : "build",
      artifact_type: run.model_id === "model-aeq" ? "link_volumes" : "activitysim_link_volumes",
      artifact_sha256: HASH,
    })) },
  };
}

async function load(tables: Record<string, TableData>) {
  const recorded: Recorded = { selects: {} };
  const facts = await loadAnalysisSequenceFacts(fakeSupabase(tables, recorded), "ws-1");
  return { facts, recorded };
}

describe("what the analysis sequence counts as a checked run", () => {
  it("counts only claim decisions attached to the exact verified project outputs", async () => {
    const { facts } = await load(guidedTables());
    expect(facts.aequilibraeRunCount).toBe(2);
    expect(facts.activitySimRunCount).toBe(2);
    expect(facts.checkedRunCount).toBe(4);
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
  });

  it("does not accept an otherwise ready snapshot with no exact run links", async () => {
    const tables = guidedTables();
    tables.scenario_comparison_model_run_links = { rows: [] };
    const { facts } = await load(tables);
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

  it("does not count prototype or wrong-track decisions as a field check", async () => {
    const tables = guidedTables();
    tables.modeling_claim_decisions = { rows: [
      { model_run_id: "run-asim-base", track: "assignment", claim_status: "screening_grade" },
      { model_run_id: "run-aeq-base", track: "assignment", claim_status: "prototype_only" },
    ] };
    const { facts } = await load(tables);
    expect(facts.checkedRunCount).toBe(0);
  });

  it("projects the hashes, sizes, tracks, and snapshot binding fields it checks", async () => {
    const { recorded } = await load(guidedTables());
    expect(recorded.selects.model_run_artifacts).toContain("content_hash");
    expect(recorded.selects.model_run_artifacts).toContain("file_size_bytes");
    expect(recorded.selects.modeling_claim_decisions).toContain("claim_status");
    expect(recorded.selects.scenario_comparison_model_run_links).toContain("artifact_sha256");
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
    tables.network_package_versions = { rows: [] };
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
