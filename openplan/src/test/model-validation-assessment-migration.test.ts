import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260828000001_model_validation_assessment_custody.sql"),
  "utf8",
);

describe("rules-v4 model validation custody migration", () => {
  it("binds one run and the exact four artifacts under append-only custody", () => {
    expect(migration).toContain("CREATE TABLE public.modeling_validation_assessments");
    expect(migration).toContain("model_output_artifact_id uuid NOT NULL");
    expect(migration).toContain("validation_input_bundle_artifact_id uuid NOT NULL");
    expect(migration).toContain("comparison_basis_artifact_id uuid NOT NULL");
    expect(migration).toContain("model_validation_assessment_artifact_id uuid NOT NULL");
    expect(migration).toContain("comparison_basis_sha256 text NOT NULL");
    expect(migration).toContain("validation_rules_version integer NOT NULL CHECK (validation_rules_version = 4)");
    expect(migration).toContain("scientific_outcome text NOT NULL CHECK (scientific_outcome IN ('pass', 'fail', 'inconclusive'))");
    expect(migration).toContain("CREATE TRIGGER refuse_modeling_validation_assessment_mutation");
    expect(migration).toContain("CREATE TRIGGER refuse_bound_model_validation_artifact_mutation");
  });

  it("allows member reads but makes the transactional recorder service-only", () => {
    expect(migration).toContain("ALTER TABLE public.modeling_validation_assessments ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY modeling_validation_assessments_member_read");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.modeling_validation_assessments FROM anon, authenticated");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.record_modeling_validation_assessment\([\s\S]+FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_modeling_validation_assessment\([\s\S]+TO service_role;/);
  });

  it("checks common ownership, content hashes, and artifact schemas before recording", () => {
    expect(migration).toContain("v_output.run_id <> NEW.model_run_id");
    expect(migration).toContain("v_basis.content_hash IS DISTINCT FROM NEW.comparison_basis_sha256");
    expect(migration).toContain("openplan.validation-input-bundle.v1");
    expect(migration).toContain("openplan.model-comparison-basis.v1");
    expect(migration).toContain("openplan.model-validation-assessment.v1");
    expect(migration).toContain("model validation assessment custody hash or outcome mismatch");
    expect(migration).toContain("IS DISTINCT FROM NEW.partition_json");
    expect(migration).toContain("IS DISTINCT FROM NEW.reasons_json");
  });
});
