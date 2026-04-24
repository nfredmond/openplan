import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260424000070_reports_modeling_county_run_link.sql", "utf8");
const grantMigration = readFileSync("supabase/migrations/20260424000071_reports_modeling_county_run_link_grants.sql", "utf8");

describe("report modeling county-run link migration", () => {
  it("adds a nullable reports link to county runs with an index", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS modeling_county_run_id UUID");
    expect(migration).toContain("REFERENCES public.county_runs(id) ON DELETE SET NULL");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS reports_modeling_county_run_idx");
  });

  it("guards the linked county run to the report workspace", () => {
    expect(migration).toContain("report_modeling_county_run_matches_workspace");
    expect(migration).toContain("SET search_path = public, pg_catalog");
    expect(migration).toContain("reports_modeling_county_run_workspace_match");
    expect(migration).toContain("cr.workspace_id = p_workspace_id");
  });

  it("keeps the workspace guard function off anon execute grants", () => {
    expect(grantMigration).toContain(
      "REVOKE ALL ON FUNCTION public.report_modeling_county_run_matches_workspace(UUID, UUID) FROM PUBLIC, anon"
    );
    expect(grantMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.report_modeling_county_run_matches_workspace(UUID, UUID) TO authenticated, service_role"
    );
  });
});
