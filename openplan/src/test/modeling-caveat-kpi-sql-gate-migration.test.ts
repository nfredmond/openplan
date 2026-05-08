import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260508000079_modeling_caveat_kpi_sql_gate.sql"),
  "utf8"
);

describe("modeling caveat KPI SQL gate migration", () => {
  it("excludes behavioral-onramp rows from direct authenticated model_run_kpis SELECT", () => {
    expect(migrationSql).toMatch(/DROP POLICY IF EXISTS "model_run_kpis_select"/);
    expect(migrationSql).toMatch(/CREATE POLICY "model_run_kpis_select" ON public\.model_run_kpis/);
    expect(migrationSql).toMatch(/FOR SELECT USING \(\s*kpi_category <> 'behavioral_onramp'/);
    expect(migrationSql).toMatch(/JOIN public\.workspace_members wm/);
    expect(migrationSql).toMatch(/wm\.user_id = auth\.uid\(\)/);
  });

  it("adds the behavioral-onramp source-shape constraint", () => {
    expect(migrationSql).toMatch(/ADD CONSTRAINT model_run_kpis_source_shape/);
    expect(migrationSql).toMatch(/kpi_category = 'behavioral_onramp'\s+AND county_run_id IS NOT NULL\s+AND run_id IS NULL/);
    expect(migrationSql).toMatch(/kpi_category <> 'behavioral_onramp'\s+AND run_id IS NOT NULL\s+AND county_run_id IS NULL/);
  });

  it("creates a narrow RPC with membership, consent, and a pinned search_path", () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION public\.load_behavioral_onramp_kpis_for_workspace/);
    expect(migrationSql).toMatch(/RETURNS TABLE \(\s*kpi_name text,\s+kpi_label text,\s+kpi_category text,/);
    expect(migrationSql).toMatch(/SECURITY DEFINER/);
    expect(migrationSql).toMatch(/SET search_path = public, pg_catalog/);
    expect(migrationSql).toMatch(/FROM public\.workspace_members wm\s+WHERE wm\.workspace_id = p_workspace_id\s+AND wm\.user_id = auth\.uid\(\)/);
    expect(migrationSql).toMatch(/p_accept_screening_grade IS TRUE/);
    expect(migrationSql).toMatch(/v_allowed_non_screening_stages constant text\[\] := ARRAY\[\]::text\[\]/);
  });

  it("grants RPC execution only to authenticated callers and service role", () => {
    expect(migrationSql).toMatch(/REVOKE ALL ON FUNCTION public\.load_behavioral_onramp_kpis_for_workspace\(uuid, boolean\)\s+FROM PUBLIC, anon, authenticated/);
    expect(migrationSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.load_behavioral_onramp_kpis_for_workspace\(uuid, boolean\)\s+TO authenticated, service_role/);
  });
});
