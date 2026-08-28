import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260828000003_model_validation_structural_diagnosis_custody.sql",
  ),
  "utf8",
);

describe("model validation structural diagnosis custody migration", () => {
  it("binds one diagnosis to the same workspace, run, and existing assessment", () => {
    expect(migration).toContain("CREATE TABLE public.modeling_validation_structural_diagnoses");
    expect(migration).toContain("modeling_validation_assessment_id uuid NOT NULL");
    expect(migration).toContain("diagnosis_artifact_id uuid NOT NULL");
    expect(migration).toContain("assessment_sha256 text NOT NULL");
    expect(migration).toContain("diagnosis_sha256 text NOT NULL");
    expect(migration).toContain("v_assessment.workspace_id <> NEW.workspace_id");
    expect(migration).toContain("v_assessment.model_run_id <> NEW.model_run_id");
    expect(migration).toContain("structural diagnosis assessment hash does not match immutable assessment custody");
    expect(migration).toContain("structural diagnosis artifact hash or run does not match custody");
    expect(migration).toContain("structural diagnosis cannot change the scientific assessment outcome");
  });

  it("is member-readable, service-created, and immutable", () => {
    expect(migration).toContain(
      "ALTER TABLE public.modeling_validation_structural_diagnoses ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "CREATE POLICY modeling_validation_structural_diagnoses_member_read",
    );
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.modeling_validation_structural_diagnoses FROM anon, authenticated",
    );
    expect(migration).toContain(
      "CREATE TRIGGER refuse_modeling_validation_structural_diagnosis_mutation",
    );
    expect(migration).toContain("OLD.id = diagnosis.diagnosis_artifact_id");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_modeling_validation_structural_diagnosis\([\s\S]+FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_modeling_validation_structural_diagnosis\([\s\S]+TO service_role;/,
    );
  });

  it("requires the exact v1 artifact schema, hashes, assessment id, and inconclusive result", () => {
    expect(migration).toContain("openplan.model-validation-structural-diagnosis.v1");
    expect(migration).toContain(
      "v_diagnosis.metadata_json->>'assessment_sha256' IS DISTINCT FROM NEW.assessment_sha256",
    );
    expect(migration).toContain(
      "v_diagnosis.metadata_json->>'diagnosis_sha256' IS DISTINCT FROM NEW.diagnosis_sha256",
    );
    expect(migration).toContain(
      "v_diagnosis.metadata_json->>'modeling_validation_assessment_id'",
    );
    expect(migration).toContain(
      "scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive')",
    );
  });
});
