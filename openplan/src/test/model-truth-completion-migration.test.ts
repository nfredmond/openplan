import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827000001_model_truth_completion.sql"),
  "utf8",
);

describe("guided model truth completion migration", () => {
  it("binds links to the exact artifact, engine, succeeded stage, assumptions, and three recomputed digests", () => {
    for (const field of [
      "model_run_artifact_id",
      "assignment_profile_sha256",
      "network_settings_sha256",
      "network_state_sha256",
      "scenario_assumptions_json",
    ]) expect(sql).toContain(field);
    expect(sql).toContain("v_run.engine_key <> v_expected_engine");
    expect(sql).toContain("v_stage.status <> 'succeeded'");
    expect(sql).toContain("v_run.assumption_snapshot_json");
    expect(sql).toContain("extensions.digest");
    expect(sql).toContain("(newer.created_at, newer.id) > (v_artifact.created_at, v_artifact.id)");
    expect(sql).toContain("all four comparison outputs must share exact assignment and network identity");
    expect(sql).toContain("all four exact guided runs need track-matched validation decisions");
    expect(sql).toContain("decision.track = CASE link.method");
  });

  it("freezes bound snapshot semantics, indicator deltas, and artifacts while preserving parent cascades", () => {
    expect(sql).toContain("evidence-bound comparison snapshot semantics are immutable");
    expect(sql).toContain("evidence-bound comparison indicator deltas are immutable");
    expect(sql).toContain("a comparison-bound model artifact is immutable");
    expect(sql.match(/TG_OP = 'DELETE' AND pg_trigger_depth\(\) > 1/g)).toHaveLength(3);
  });

  it("checks the actual launched geometry and distinguishes absent coverage from outside coverage", () => {
    expect(sql).toContain("p_run_geometry jsonb");
    expect(sql).toContain("ST_Equals(v_stored_area, v_run_area)");
    expect(sql).toContain("'run_geometry_mismatch'");
    expect(sql).toContain("'tract_coverage_not_loaded'");
    expect(sql).toContain("'outside_loaded_tract_coverage'");
    expect(sql).toContain("'tract_coverage_unknown'");
    expect(sql).not.toContain("home_geography");
  });
});
