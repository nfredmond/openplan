import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = [
  "20260831000001_distributed_work_loading_custody.sql",
  "20260831000002_distributed_work_loading_custody_guards.sql",
].map((file) => readFileSync(path.join(process.cwd(), "supabase/migrations", file), "utf8")).join("\n");

describe("distributed work loading custody migration", () => {
  it("keeps all three artifacts append-only and service-role-only", () => {
    expect(migration).toContain("distributed work loading custody is append-only");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.modeling_distributed_work_loading_custody");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.record_modeling_distributed_work_loading\([\s\S]+FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_modeling_distributed_work_loading\([\s\S]+TO service_role;/);
  });

  it("refuses cross-workspace, changed-hash, and wrong-schema records", () => {
    expect(migration).toContain("distributed work loading run does not belong to workspace");
    expect(migration).toContain("distributed work loading artifact type, run, or hash does not match custody");
    expect(migration).toContain("distributed work loading metadata does not match exact custody");
    expect(migration).toContain("openplan.distributed-work-loading-input.v1");
    expect(migration).toContain("openplan.pre-output-audit.v1");
    expect(migration).toContain("openplan.development-comparison.v1");
    expect(migration).toContain("unchanged_not_supported_by_lodes");
    expect(migration).toContain("no_county_stratum_worsened");
    expect(migration).toContain("demand accounting does not conserve exact demand");
  });

  it("creates the three artifacts and custody in one security-definer transaction", () => {
    expect(migration).toContain("'distributed_work_loading_input_v1'");
    expect(migration).toContain("'pre_output_audit_v1'");
    expect(migration).toContain("'development_comparison_v1'");
    expect(migration).toContain("LANGUAGE plpgsql SECURITY DEFINER");
    expect(migration).toContain("UNIQUE (model_run_id, method)");
  });
});
