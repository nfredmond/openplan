import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826000003_model_truth_correction.sql"),
  "utf8",
);
const cascadeCorrection = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826000007_scenario_model_link_cascade_delete.sql"),
  "utf8",
);

describe("guided model output custody migration", () => {
  it("keeps exact links immutable without blocking parent cleanup", () => {
    expect(cascadeCorrection).toContain("TG_OP = 'DELETE' AND pg_trigger_depth() > 1");
    expect(cascadeCorrection).toContain("scenario comparison model-run links are append-only");
  });
  it("binds each ready snapshot role to one exact run artifact hash", () => {
    expect(sql).toContain("scenario_comparison_model_run_links_role_unique");
    expect(sql).toContain("UNIQUE (comparison_snapshot_id, method, scenario_role)");
    expect(sql).toContain("artifact.content_hash = NEW.artifact_sha256");
    expect(sql).toContain("artifact.file_size_bytes > 0");
    expect(sql).toContain("v_run.status <> 'succeeded'");
  });

  it("checks project, workspace, scenario set, method, and scenario entry at insert time", () => {
    expect(sql).toContain("NEW.workspace_id <> v_set.workspace_id");
    expect(sql).toContain("v_model.project_id IS DISTINCT FROM v_set.project_id");
    expect(sql).toContain("v_model.scenario_set_id IS DISTINCT FROM v_set.id");
    expect(sql).toContain("v_run.scenario_entry_id IS DISTINCT FROM v_expected_entry");
    expect(sql).toContain("v_model.config_json ->> 'method' <> NEW.method");
  });

  it("makes custody links append-only and denies anonymous access", () => {
    expect(sql).toContain("RAISE EXCEPTION 'scenario comparison model-run links are append-only'");
    expect(sql).toContain("REVOKE ALL ON public.scenario_comparison_model_run_links FROM anon");
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|UPDATE|DELETE)[^;]*TO authenticated/i);
  });

  it("uses only the stored project geometry and fails closed on unreadable or empty tract coverage", () => {
    expect(sql).toContain("FROM public.projects");
    expect(sql).toContain("place_geometry_geojson");
    expect(sql).toContain("'missing_geometry'");
    expect(sql).toContain("'invalid_geometry'");
    expect(sql).toContain("'no_tracts'");
    expect(sql).toContain("FROM public.census_tracts tract");
    expect(sql).not.toContain("home_geography");
  });
});
