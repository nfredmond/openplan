-- Service-role-only, append-only custody for the rules-v5 comparable
-- observation instrument. The five artifacts succeed in one transaction or
-- the run remains visibly scientifically unchecked.

CREATE TABLE public.modeling_validation_instrument_v2_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  input_bundle_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  match_audit_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  comparison_basis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  assessment_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  diagnosis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  input_bundle_sha256 text NOT NULL CHECK (input_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  match_audit_sha256 text NOT NULL CHECK (match_audit_sha256 ~ '^[0-9a-f]{64}$'),
  comparison_basis_sha256 text NOT NULL CHECK (comparison_basis_sha256 ~ '^[0-9a-f]{64}$'),
  assessment_sha256 text NOT NULL CHECK (assessment_sha256 ~ '^[0-9a-f]{64}$'),
  diagnosis_sha256 text NOT NULL CHECK (diagnosis_sha256 ~ '^[0-9a-f]{64}$'),
  scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_run_id)
);

ALTER TABLE public.modeling_validation_instrument_v2_custody ENABLE ROW LEVEL SECURITY;

CREATE POLICY modeling_validation_instrument_v2_member_read
  ON public.modeling_validation_instrument_v2_custody FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = modeling_validation_instrument_v2_custody.workspace_id
        AND member.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.model_runs run
      WHERE run.id = modeling_validation_instrument_v2_custody.model_run_id
        AND run.workspace_id = modeling_validation_instrument_v2_custody.workspace_id
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.modeling_validation_instrument_v2_custody FROM anon, authenticated;
GRANT SELECT ON public.modeling_validation_instrument_v2_custody TO authenticated;

CREATE OR REPLACE FUNCTION public.refuse_modeling_validation_instrument_v2_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'comparable observation custody is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_modeling_validation_instrument_v2_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_modeling_validation_instrument_v2_mutation() TO service_role;

CREATE TRIGGER refuse_modeling_validation_instrument_v2_mutation
BEFORE UPDATE OR DELETE ON public.modeling_validation_instrument_v2_custody
FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_validation_instrument_v2_mutation();

CREATE OR REPLACE FUNCTION public.validate_modeling_validation_instrument_v2_custody()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  v_artifact public.model_run_artifacts%ROWTYPE;
  v_pair record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = NEW.model_run_id AND run.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'comparable observation run does not belong to workspace';
  END IF;
  FOR v_pair IN SELECT * FROM (VALUES
    (NEW.input_bundle_artifact_id, NEW.input_bundle_sha256, 'validation_input_bundle_v2'),
    (NEW.match_audit_artifact_id, NEW.match_audit_sha256, 'pre_volume_match_audit_v2'),
    (NEW.comparison_basis_artifact_id, NEW.comparison_basis_sha256, 'model_comparison_basis_v2'),
    (NEW.assessment_artifact_id, NEW.assessment_sha256, 'model_validation_assessment_v2'),
    (NEW.diagnosis_artifact_id, NEW.diagnosis_sha256, 'model_validation_structural_diagnosis_v2')
  ) AS expected(artifact_id, artifact_sha256, artifact_type)
  LOOP
    SELECT * INTO v_artifact FROM public.model_run_artifacts WHERE id = v_pair.artifact_id;
    IF v_artifact.id IS NULL
       OR v_artifact.run_id <> NEW.model_run_id
       OR v_artifact.artifact_type <> v_pair.artifact_type
       OR v_artifact.content_hash IS DISTINCT FROM v_pair.artifact_sha256 THEN
      RAISE EXCEPTION 'comparable observation artifact type, run, or hash does not match custody';
    END IF;
  END LOOP;
  IF (SELECT metadata_json->>'schema' FROM public.model_run_artifacts WHERE id = NEW.input_bundle_artifact_id)
       IS DISTINCT FROM 'openplan.validation-input-bundle.v2'
     OR (SELECT metadata_json->>'schema' FROM public.model_run_artifacts WHERE id = NEW.match_audit_artifact_id)
       IS DISTINCT FROM 'openplan.pre-volume-observation-match-audit.v2'
     OR (SELECT metadata_json->>'schema' FROM public.model_run_artifacts WHERE id = NEW.comparison_basis_artifact_id)
       IS DISTINCT FROM 'openplan.model-comparison-basis.v2'
     OR (SELECT metadata_json->>'schema' FROM public.model_run_artifacts WHERE id = NEW.assessment_artifact_id)
       IS DISTINCT FROM 'openplan.model-validation-assessment.v2'
     OR (SELECT metadata_json->>'schema' FROM public.model_run_artifacts WHERE id = NEW.diagnosis_artifact_id)
       IS DISTINCT FROM 'openplan.model-validation-structural-diagnosis.v2' THEN
    RAISE EXCEPTION 'comparable observation schema metadata does not match custody';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_validation_instrument_v2_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_validation_instrument_v2_custody() TO service_role;

CREATE TRIGGER validate_modeling_validation_instrument_v2_custody
BEFORE INSERT ON public.modeling_validation_instrument_v2_custody
FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_validation_instrument_v2_custody();

CREATE OR REPLACE FUNCTION public.refuse_bound_model_validation_instrument_v2_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.modeling_validation_instrument_v2_custody custody
    WHERE OLD.id IN (
      custody.input_bundle_artifact_id, custody.match_audit_artifact_id,
      custody.comparison_basis_artifact_id, custody.assessment_artifact_id,
      custody.diagnosis_artifact_id
    )
  ) THEN
    RAISE EXCEPTION 'artifact is bound to immutable comparable observation custody';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_bound_model_validation_instrument_v2_artifact_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_bound_model_validation_instrument_v2_artifact_mutation() TO service_role;

CREATE TRIGGER refuse_bound_model_validation_instrument_v2_artifact_mutation
BEFORE UPDATE OR DELETE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_model_validation_instrument_v2_artifact_mutation();

CREATE OR REPLACE FUNCTION public.record_modeling_validation_instrument_v2(
  p_workspace_id uuid, p_model_run_id uuid,
  p_input_bundle_artifact_id uuid, p_input_bundle_sha256 text,
  p_match_audit_artifact_id uuid, p_match_audit_sha256 text,
  p_comparison_basis_artifact_id uuid, p_comparison_basis_sha256 text,
  p_assessment_artifact_id uuid, p_assessment_sha256 text,
  p_diagnosis_artifact_id uuid, p_diagnosis_sha256 text,
  p_scientific_outcome text
)
RETURNS public.modeling_validation_instrument_v2_custody
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $$
DECLARE v_row public.modeling_validation_instrument_v2_custody%ROWTYPE;
BEGIN
  INSERT INTO public.modeling_validation_instrument_v2_custody (
    workspace_id, model_run_id,
    input_bundle_artifact_id, input_bundle_sha256,
    match_audit_artifact_id, match_audit_sha256,
    comparison_basis_artifact_id, comparison_basis_sha256,
    assessment_artifact_id, assessment_sha256,
    diagnosis_artifact_id, diagnosis_sha256, scientific_outcome
  ) VALUES (
    p_workspace_id, p_model_run_id,
    p_input_bundle_artifact_id, p_input_bundle_sha256,
    p_match_audit_artifact_id, p_match_audit_sha256,
    p_comparison_basis_artifact_id, p_comparison_basis_sha256,
    p_assessment_artifact_id, p_assessment_sha256,
    p_diagnosis_artifact_id, p_diagnosis_sha256, p_scientific_outcome
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_modeling_validation_instrument_v2(
  uuid, uuid, uuid, text, uuid, text, uuid, text, uuid, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_modeling_validation_instrument_v2(
  uuid, uuid, uuid, text, uuid, text, uuid, text, uuid, text, uuid, text, text
) TO service_role;

COMMENT ON TABLE public.modeling_validation_instrument_v2_custody IS
  'Append-only v2 observation, match, basis, assessment, and diagnosis custody. Writes are service-role only.';
