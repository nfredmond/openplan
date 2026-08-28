-- Append-only custody for a structural diagnosis tied to an existing
-- rules-v4 validation assessment and the same modeling run.

CREATE TABLE public.modeling_validation_structural_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  modeling_validation_assessment_id uuid NOT NULL
    REFERENCES public.modeling_validation_assessments(id) ON DELETE RESTRICT,
  diagnosis_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  assessment_sha256 text NOT NULL CHECK (assessment_sha256 ~ '^[0-9a-f]{64}$'),
  diagnosis_sha256 text NOT NULL CHECK (diagnosis_sha256 ~ '^[0-9a-f]{64}$'),
  scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modeling_validation_assessment_id),
  UNIQUE (diagnosis_artifact_id)
);

CREATE INDEX modeling_validation_structural_diagnoses_run_idx
  ON public.modeling_validation_structural_diagnoses(model_run_id, created_at DESC);
CREATE INDEX modeling_validation_structural_diagnoses_workspace_idx
  ON public.modeling_validation_structural_diagnoses(workspace_id, created_at DESC);

ALTER TABLE public.modeling_validation_structural_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY modeling_validation_structural_diagnoses_member_read
  ON public.modeling_validation_structural_diagnoses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = modeling_validation_structural_diagnoses.workspace_id
        AND member.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.model_runs run
      WHERE run.id = modeling_validation_structural_diagnoses.model_run_id
        AND run.workspace_id = modeling_validation_structural_diagnoses.workspace_id
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.modeling_validation_structural_diagnoses FROM anon, authenticated;
GRANT SELECT ON public.modeling_validation_structural_diagnoses TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_modeling_validation_structural_diagnosis_custody()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_run public.model_runs%ROWTYPE;
  v_assessment public.modeling_validation_assessments%ROWTYPE;
  v_assessment_artifact public.model_run_artifacts%ROWTYPE;
  v_diagnosis public.model_run_artifacts%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.model_runs WHERE id = NEW.model_run_id;
  SELECT * INTO v_assessment
    FROM public.modeling_validation_assessments
    WHERE id = NEW.modeling_validation_assessment_id;
  SELECT * INTO v_assessment_artifact
    FROM public.model_run_artifacts
    WHERE id = v_assessment.model_validation_assessment_artifact_id;
  SELECT * INTO v_diagnosis
    FROM public.model_run_artifacts
    WHERE id = NEW.diagnosis_artifact_id;

  IF v_run.id IS NULL OR v_run.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'structural diagnosis run and workspace do not match';
  END IF;
  IF v_assessment.id IS NULL
     OR v_assessment.workspace_id <> NEW.workspace_id
     OR v_assessment.model_run_id <> NEW.model_run_id THEN
    RAISE EXCEPTION 'structural diagnosis assessment must belong to the same workspace and run';
  END IF;
  IF v_assessment_artifact.id IS NULL
     OR v_assessment_artifact.run_id <> NEW.model_run_id
     OR v_assessment_artifact.artifact_type <> 'model_validation_assessment'
     OR v_assessment_artifact.content_hash IS DISTINCT FROM NEW.assessment_sha256 THEN
    RAISE EXCEPTION 'structural diagnosis assessment hash does not match immutable assessment custody';
  END IF;
  IF v_diagnosis.id IS NULL
     OR v_diagnosis.run_id <> NEW.model_run_id
     OR v_diagnosis.artifact_type <> 'model_validation_structural_diagnosis'
     OR v_diagnosis.content_hash IS DISTINCT FROM NEW.diagnosis_sha256 THEN
    RAISE EXCEPTION 'structural diagnosis artifact hash or run does not match custody';
  END IF;
  IF v_diagnosis.metadata_json->>'schema'
       IS DISTINCT FROM 'openplan.model-validation-structural-diagnosis.v1'
     OR v_diagnosis.metadata_json->>'assessment_sha256' IS DISTINCT FROM NEW.assessment_sha256
     OR v_diagnosis.metadata_json->>'diagnosis_sha256' IS DISTINCT FROM NEW.diagnosis_sha256
     OR v_diagnosis.metadata_json->>'modeling_validation_assessment_id'
       IS DISTINCT FROM NEW.modeling_validation_assessment_id::text
     OR v_diagnosis.metadata_json->>'scientific_outcome' IS DISTINCT FROM NEW.scientific_outcome THEN
    RAISE EXCEPTION 'structural diagnosis metadata does not match exact custody';
  END IF;
  IF v_assessment.scientific_outcome IS DISTINCT FROM NEW.scientific_outcome THEN
    RAISE EXCEPTION 'structural diagnosis cannot change the scientific assessment outcome';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_validation_structural_diagnosis_custody()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_validation_structural_diagnosis_custody()
  TO service_role;

CREATE TRIGGER validate_modeling_validation_structural_diagnosis_custody
BEFORE INSERT ON public.modeling_validation_structural_diagnoses
FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_validation_structural_diagnosis_custody();

CREATE OR REPLACE FUNCTION public.refuse_modeling_validation_structural_diagnosis_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'model validation structural diagnosis custody is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_modeling_validation_structural_diagnosis_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_modeling_validation_structural_diagnosis_mutation()
  TO service_role;

CREATE TRIGGER refuse_modeling_validation_structural_diagnosis_mutation
BEFORE UPDATE OR DELETE ON public.modeling_validation_structural_diagnoses
FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_validation_structural_diagnosis_mutation();

-- Extend the existing artifact guard. A diagnosis and the assessment it cites
-- remain immutable after custody succeeds.
CREATE OR REPLACE FUNCTION public.refuse_bound_model_validation_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.modeling_validation_assessments custody
    WHERE OLD.id IN (
      custody.model_output_artifact_id,
      custody.validation_input_bundle_artifact_id,
      custody.comparison_basis_artifact_id,
      custody.model_validation_assessment_artifact_id
    )
  ) OR EXISTS (
    SELECT 1 FROM public.modeling_validation_structural_diagnoses diagnosis
    WHERE OLD.id = diagnosis.diagnosis_artifact_id
  ) THEN
    RAISE EXCEPTION 'artifact is bound to immutable model validation custody';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_bound_model_validation_artifact_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_bound_model_validation_artifact_mutation()
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_modeling_validation_structural_diagnosis(
  p_workspace_id uuid,
  p_model_run_id uuid,
  p_stage_id uuid,
  p_modeling_validation_assessment_id uuid,
  p_assessment_sha256 text,
  p_diagnosis_file_url text,
  p_diagnosis_size bigint,
  p_diagnosis_sha256 text,
  p_diagnosis_metadata jsonb,
  p_scientific_outcome text
)
RETURNS public.modeling_validation_structural_diagnoses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_diagnosis_id uuid;
  v_row public.modeling_validation_structural_diagnoses%ROWTYPE;
BEGIN
  IF p_stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.model_run_stages stage
    WHERE stage.id = p_stage_id AND stage.run_id = p_model_run_id
  ) THEN
    RAISE EXCEPTION 'structural diagnosis stage does not belong to the run';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = p_model_run_id AND run.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'structural diagnosis run does not belong to the workspace';
  END IF;

  INSERT INTO public.model_run_artifacts (
    run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json
  ) VALUES (
    p_model_run_id, p_stage_id, 'model_validation_structural_diagnosis',
    p_diagnosis_file_url, p_diagnosis_size, p_diagnosis_sha256, p_diagnosis_metadata
  ) RETURNING id INTO v_diagnosis_id;

  INSERT INTO public.modeling_validation_structural_diagnoses (
    workspace_id, model_run_id, modeling_validation_assessment_id,
    diagnosis_artifact_id, assessment_sha256, diagnosis_sha256, scientific_outcome
  ) VALUES (
    p_workspace_id, p_model_run_id, p_modeling_validation_assessment_id,
    v_diagnosis_id, p_assessment_sha256, p_diagnosis_sha256, p_scientific_outcome
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_modeling_validation_structural_diagnosis(
  uuid, uuid, uuid, uuid, text, text, bigint, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_modeling_validation_structural_diagnosis(
  uuid, uuid, uuid, uuid, text, text, bigint, text, jsonb, text
) TO service_role;

COMMENT ON TABLE public.modeling_validation_structural_diagnoses IS
  'Append-only custody binding one inconclusive structural diagnosis to an existing exact model validation assessment and the same run.';
