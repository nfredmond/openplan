import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260718000088_sketch_abm_engine.sql"),
  "utf8",
);

describe("sketch_abm engine migration", () => {
  it("swaps model_runs_engine_key_check behind an existence guard", () => {
    expect(migrationSql).toMatch(/IF EXISTS \(\s*SELECT 1 FROM pg_constraint/i);
    expect(migrationSql).toMatch(/conname = 'model_runs_engine_key_check'/i);
    expect(migrationSql).toMatch(/DROP CONSTRAINT model_runs_engine_key_check/i);
    expect(migrationSql).toMatch(/ADD CONSTRAINT model_runs_engine_key_check/i);
  });

  it("permits every engine key including sketch_abm (five values)", () => {
    const engineKeyCheck = migrationSql.match(
      /ADD CONSTRAINT model_runs_engine_key_check\s+CHECK \(engine_key IN \(([^)]+)\)\)/i,
    );
    expect(engineKeyCheck).not.toBeNull();
    const allowed = engineKeyCheck![1].split(",").map((value) => value.trim().replace(/'/g, ""));
    expect(allowed).toEqual([
      "deterministic_corridor_v1",
      "aequilibrae",
      "activitysim",
      "behavioral_demand",
      "sketch_abm",
    ]);
  });

  it("swaps model_run_kpis_kpi_category_check behind an existence guard", () => {
    expect(migrationSql).toMatch(/conname = 'model_run_kpis_kpi_category_check'/i);
    expect(migrationSql).toMatch(/DROP CONSTRAINT model_run_kpis_kpi_category_check/i);
    expect(migrationSql).toMatch(/ADD CONSTRAINT model_run_kpis_kpi_category_check/i);
  });

  it("permits every KPI category including sketch_abm", () => {
    const categoryCheck = migrationSql.match(
      /ADD CONSTRAINT model_run_kpis_kpi_category_check\s+CHECK \(kpi_category IN \(([^)]+)\)\)/i,
    );
    expect(categoryCheck).not.toBeNull();
    const allowed = categoryCheck![1].split(",").map((value) => value.trim().replace(/'/g, ""));
    expect(allowed).toEqual([
      "accessibility",
      "assignment",
      "safety",
      "equity",
      "general",
      "behavioral_onramp",
      "sketch_abm",
    ]);
  });

  it("leaves model_run_kpis_source_shape untouched — sketch_abm KPIs are run-scoped", () => {
    expect(migrationSql).not.toMatch(/DROP CONSTRAINT (IF EXISTS )?model_run_kpis_source_shape/i);
    expect(migrationSql).not.toMatch(/ADD CONSTRAINT model_run_kpis_source_shape/i);
  });
});
