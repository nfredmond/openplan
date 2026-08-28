import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260828000004_comparable_observation_v2_custody.sql"),
  "utf8",
);

describe("rules-v5 comparable observation custody", () => {
  it("is workspace-scoped, service-role-only, and immutable", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("member.workspace_id = modeling_validation_instrument_v2_custody.workspace_id");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.modeling_validation_instrument_v2_custody");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.model_run_artifacts");
  });

  it("binds all five exact artifacts in one transaction and refuses mismatches", () => {
    for (const field of [
      "input_bundle_sha256",
      "match_audit_sha256",
      "comparison_basis_sha256",
      "assessment_sha256",
      "diagnosis_sha256",
    ]) expect(migration).toContain(field);
    expect(migration).toContain("artifact type, run, or hash does not match custody");
    expect(migration).toContain("comparable observation schema metadata does not match custody");
    expect(migration).toContain("scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive')");
  });
});
