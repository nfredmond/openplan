import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { loadAnalysisSequenceFacts } from "@/components/models/analysis-sequence-facts";
import { resolveAnalysisSequence } from "@/components/models/analysis-sequence";

/**
 * THE SCREENING GATE, WHERE THE SEQUENCE READS IT.
 *
 * Step six of the analysis sequence tells a planner whether anything in their
 * agency has been measured against counts collected in the field, and step
 * seven's standing line softens from "treat every number as provisional" once
 * it has. The whole value of that sentence rests on the count being the SAME
 * verdict `/models/[id]` applies before it will let a number leave the agency:
 *
 *   - reaching the `validated-screening` stage says the checking RAN, not that
 *     it passed;
 *   - a gate string nothing in the repository emits is not evidence
 *     (`COUNTY_RUN_PASSING_GATE_STATUSES` is an allowlist, flipped from a
 *     denylist in 2026-08-08 precisely because a denylist fails open);
 *   - and a run whose zones are too coarse for a road-by-road comparison did
 *     not establish anything, whatever gate its validator recorded offline.
 *
 * Each of those is one `&&` away from silently becoming "yes, you're validated".
 * This file makes each one fail.
 *
 * WHAT IT CANNOT SEE. A fake client cannot catch a missing `.select()` column,
 * so the projection string is asserted directly — `run_summary_json` is read for
 * exactly one field, and a page that stops projecting it would hand every
 * coarse-zoned run a pass with nothing to notice.
 *
 * MUTATION-VERIFIED 2026-08-13.
 */

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

/** A county run that HAS cleared the gate: right stage, allowlisted status, fine zones. */
const PASSING = {
  stage: "validated-screening",
  status_label: "bounded screening-ready",
  run_summary_json: { intrazonal_trip_share: 0.05 },
};

function withCountyRuns(rows: Row[]): Record<string, TableData> {
  return {
    workspaces: { single: HOME },
    network_packages: { rows: [{ id: "pkg-1" }] },
    network_package_versions: { rows: [{ id: "ver-1" }] },
    scenario_sets: { rows: [{ id: "set-1" }] },
    models: { rows: [{ id: "model-1" }] },
    model_runs: { rows: [{ id: "run-1" }] },
    county_runs: { rows },
  };
}

async function load(tables: Record<string, TableData>) {
  const recorded: Recorded = { selects: {} };
  const facts = await loadAnalysisSequenceFacts(fakeSupabase(tables, recorded), "ws-1");
  return { facts, recorded };
}

describe("what the analysis sequence counts as a checked run", () => {
  it("counts a run that reached the stage, cleared the gate, and has usable zones", async () => {
    const { facts } = await load(withCountyRuns([PASSING]));
    expect(facts.checkedRunCount).toBe(1);
  });

  it("does not count a run that only reached the stage", async () => {
    // Reaching validated-screening says the checking RAN. A run whose own gate
    // recorded prototype-grade would then be a failed check strengthening a
    // claim.
    const { facts } = await load(
      withCountyRuns([{ ...PASSING, status_label: "internal prototype only" }])
    );
    expect(facts.checkedRunCount).toBe(0);
  });

  it("does not count a gate string nothing in the product emits", async () => {
    const { facts } = await load(
      withCountyRuns([{ ...PASSING, status_label: "validated screening slice" }])
    );
    expect(facts.checkedRunCount).toBe(0);
  });

  it("does not count a run whose zones are too coarse for a road-by-road check", async () => {
    // Same numbers, same gate, one difference: most of its travel begins and
    // ends inside a single zone, so comparing it to road counts established
    // nothing.
    const { facts } = await load(
      withCountyRuns([{ ...PASSING, run_summary_json: { intrazonal_trip_share: 0.62 } }])
    );
    expect(facts.checkedRunCount).toBe(0);
  });

  it("does not count a run that has not finished the checking stage", async () => {
    const { facts } = await load(withCountyRuns([{ ...PASSING, stage: "validation-scaffolded" }]));
    expect(facts.checkedRunCount).toBe(0);
  });

  it("reads the one field the zone qualification depends on", async () => {
    // A mocked client cannot catch a missing column. If this projection ever
    // drops run_summary_json, every coarse-zoned run silently passes.
    const { recorded } = await load(withCountyRuns([PASSING]));
    expect(recorded.selects.county_runs).toContain("run_summary_json");
    expect(recorded.selects.county_runs).toContain("stage");
    expect(recorded.selects.county_runs).toContain("status_label");
  });
});

describe("a failed read is not an empty agency", () => {
  it("names the step it could not read instead of reporting nothing done", async () => {
    const tables = withCountyRuns([PASSING]);
    tables.county_runs = { rows: [], error: { message: "permission denied" } };
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
      const tables = withCountyRuns([PASSING]);
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
    const tables = withCountyRuns([PASSING]);
    tables.network_package_versions = { rows: [] };
    const { facts } = await load(tables);
    expect(facts.networkCount).toBe(0);
    expect(resolveAnalysisSequence(facts).find((step) => step.id === "network")?.state).toBe("next");
  });

  it("accepts the explicit managed worker basis without pretending a snapshot is loaded", async () => {
    const tables = withCountyRuns([PASSING]);
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
    const tables = withCountyRuns([PASSING]);
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
    const tables = withCountyRuns([PASSING]);
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
    const oneMethod = withCountyRuns([PASSING]);
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

    const bothMethods = withCountyRuns([PASSING]);
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
