import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const VIEW_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "20260416000055_scenario_comparison_summary_view.sql"
);

describe("scenario_comparison_summary view — modeling caveat isolation", () => {
  const sql = readFileSync(VIEW_MIGRATION_PATH, "utf8");

  it("never references the model_run_kpis table", () => {
    expect(sql).not.toMatch(/model_run_kpis/i);
  });

  it("never references the behavioral_onramp KPI category", () => {
    expect(sql).not.toMatch(/behavioral_onramp/i);
  });

  it("aggregates only from the scenario comparison spine (positive control)", () => {
    expect(sql).toMatch(/scenario_comparison_indicator_deltas/);
    expect(sql).toMatch(/scenario_comparison_snapshots/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW scenario_comparison_summary/);
    expect(sql).toMatch(/security_invoker = true/);
  });
});
