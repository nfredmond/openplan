import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260828000005_structural_demand_diagnosis_custody.sql"),
  "utf8",
);

describe("structural demand diagnosis custody migration", () => {
  it("keeps audit and diagnosis custody append-only and service-role-only", () => {
    expect(migration).toContain("structural demand diagnosis custody is append-only");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.modeling_structural_demand_diagnosis_custody");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.record_modeling_structural_demand_diagnosis\([\s\S]+FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_modeling_structural_demand_diagnosis\([\s\S]+TO service_role;/);
  });

  it("refuses cross-workspace, changed-hash, and wrong-schema records", () => {
    expect(migration).toContain("structural demand diagnosis run does not belong to workspace");
    expect(migration).toContain("structural demand artifact type, run, or hash does not match custody");
    expect(migration).toContain("structural demand metadata does not match exact custody");
    expect(migration).toContain("openplan.model-structural-input-audit.v1");
    expect(migration).toContain("openplan.model-validation-structural-diagnosis.v3");
  });

  it("creates both artifacts and custody in one security-definer transaction", () => {
    expect(migration).toContain("'model_structural_input_audit_v1'");
    expect(migration).toContain("'model_validation_structural_diagnosis_v3'");
    expect(migration).toContain("LANGUAGE plpgsql SECURITY DEFINER");
    expect(migration).toContain("UNIQUE (model_run_id, method)");
  });
});
