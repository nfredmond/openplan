-- Service-role-only append-only custody for the pre-output structural input
-- audit and its post-output v3 diagnosis. Both artifacts bind in one transaction.

CREATE TABLE public.modeling_structural_demand_diagnosis_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  input_audit_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  diagnosis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  input_audit_sha256 text NOT NULL CHECK (input_audit_sha256 ~ '^[0-9a-f]{64}$'),
  diagnosis_sha256 text NOT NULL CHECK (diagnosis_sha256 ~ '^[0-9a-f]{64}$'),
  method text NOT NULL CHECK (method IN ('aequilibrae', 'activitysim')),
  scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_run_id, method)
);

ALTER TABLE public.modeling_structural_demand_diagnosis_custody ENABLE ROW LEVEL SECURITY;

CREATE POLICY modeling_structural_demand_diagnosis_member_read
  ON public.modeling_structural_demand_diagnosis_custody FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = modeling_structural_demand_diagnosis_custody.workspace_id
        AND member.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.model_runs run
      WHERE run.id = modeling_structural_demand_diagnosis_custody.model_run_id
        AND run.workspace_id = modeling_structural_demand_diagnosis_custody.workspace_id
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.modeling_structural_demand_diagnosis_custody FROM anon, authenticated;
GRANT SELECT ON public.modeling_structural_demand_diagnosis_custody TO authenticated;

CREATE OR REPLACE FUNCTION public.refuse_modeling_structural_demand_diagnosis_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'structural demand diagnosis custody is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_modeling_structural_demand_diagnosis_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_modeling_structural_demand_diagnosis_mutation() TO service_role;

CREATE TRIGGER refuse_modeling_structural_demand_diagnosis_mutation
BEFORE UPDATE OR DELETE ON public.modeling_structural_demand_diagnosis_custody
FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_structural_demand_diagnosis_mutation();

CREATE OR REPLACE FUNCTION public.validate_modeling_structural_demand_diagnosis_custody()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  v_audit public.model_run_artifacts%ROWTYPE;
  v_diagnosis public.model_run_artifacts%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = NEW.model_run_id AND run.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'structural demand diagnosis run does not belong to workspace';
  END IF;
  SELECT * INTO v_audit FROM public.model_run_artifacts WHERE id = NEW.input_audit_artifact_id;
  SELECT * INTO v_diagnosis FROM public.model_run_artifacts WHERE id = NEW.diagnosis_artifact_id;
  IF v_audit.id IS NULL OR v_diagnosis.id IS NULL
     OR v_audit.run_id <> NEW.model_run_id OR v_diagnosis.run_id <> NEW.model_run_id
     OR v_audit.artifact_type <> 'model_structural_input_audit_v1'
     OR v_diagnosis.artifact_type <> 'model_validation_structural_diagnosis_v3'
     OR v_audit.content_hash IS DISTINCT FROM NEW.input_audit_sha256
     OR v_diagnosis.content_hash IS DISTINCT FROM NEW.diagnosis_sha256 THEN
    RAISE EXCEPTION 'structural demand artifact type, run, or hash does not match custody';
  END IF;
  IF v_audit.metadata_json->>'schema' IS DISTINCT FROM 'openplan.model-structural-input-audit.v1'
     OR v_diagnosis.metadata_json->>'schema' IS DISTINCT FROM 'openplan.model-validation-structural-diagnosis.v3'
     OR v_audit.metadata_json->>'method' IS DISTINCT FROM NEW.method
     OR v_diagnosis.metadata_json->>'method' IS DISTINCT FROM NEW.method
     OR v_diagnosis.metadata_json->>'input_audit_sha256' IS DISTINCT FROM NEW.input_audit_sha256
     OR v_diagnosis.metadata_json->>'scientific_outcome' IS DISTINCT FROM NEW.scientific_outcome THEN
    RAISE EXCEPTION 'structural demand metadata does not match exact custody';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_structural_demand_diagnosis_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_structural_demand_diagnosis_custody() TO service_role;

CREATE TRIGGER validate_modeling_structural_demand_diagnosis_custody
BEFORE INSERT ON public.modeling_structural_demand_diagnosis_custody
FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_structural_demand_diagnosis_custody();

CREATE OR REPLACE FUNCTION public.refuse_bound_structural_demand_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.modeling_structural_demand_diagnosis_custody custody
    WHERE OLD.id IN (custody.input_audit_artifact_id, custody.diagnosis_artifact_id)
  ) THEN
    RAISE EXCEPTION 'artifact is bound to immutable structural demand custody';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_bound_structural_demand_artifact_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_bound_structural_demand_artifact_mutation() TO service_role;

CREATE TRIGGER refuse_bound_structural_demand_artifact_mutation
BEFORE UPDATE OR DELETE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_structural_demand_artifact_mutation();

CREATE OR REPLACE FUNCTION public.record_modeling_structural_demand_diagnosis(
  p_workspace_id uuid, p_model_run_id uuid, p_stage_id uuid,
  p_input_audit_file_url text, p_input_audit_size bigint, p_input_audit_sha256 text, p_input_audit_metadata jsonb,
  p_diagnosis_file_url text, p_diagnosis_size bigint, p_diagnosis_sha256 text, p_diagnosis_metadata jsonb,
  p_method text, p_scientific_outcome text
)
RETURNS public.modeling_structural_demand_diagnosis_custody
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  v_audit_id uuid;
  v_diagnosis_id uuid;
  v_row public.modeling_structural_demand_diagnosis_custody%ROWTYPE;
BEGIN
  IF p_stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.model_run_stages stage
    WHERE stage.id = p_stage_id AND stage.run_id = p_model_run_id
  ) THEN
    RAISE EXCEPTION 'structural demand stage does not belong to run';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = p_model_run_id AND run.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'structural demand run does not belong to workspace';
  END IF;
  INSERT INTO public.model_run_artifacts (
    run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json
  ) VALUES (
    p_model_run_id, p_stage_id, 'model_structural_input_audit_v1',
    p_input_audit_file_url, p_input_audit_size, p_input_audit_sha256, p_input_audit_metadata
  ) RETURNING id INTO v_audit_id;
  INSERT INTO public.model_run_artifacts (
    run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json
  ) VALUES (
    p_model_run_id, p_stage_id, 'model_validation_structural_diagnosis_v3',
    p_diagnosis_file_url, p_diagnosis_size, p_diagnosis_sha256, p_diagnosis_metadata
  ) RETURNING id INTO v_diagnosis_id;
  INSERT INTO public.modeling_structural_demand_diagnosis_custody (
    workspace_id, model_run_id, input_audit_artifact_id, diagnosis_artifact_id,
    input_audit_sha256, diagnosis_sha256, method, scientific_outcome
  ) VALUES (
    p_workspace_id, p_model_run_id, v_audit_id, v_diagnosis_id,
    p_input_audit_sha256, p_diagnosis_sha256, p_method, p_scientific_outcome
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_modeling_structural_demand_diagnosis(
  uuid, uuid, uuid, text, bigint, text, jsonb, text, bigint, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_modeling_structural_demand_diagnosis(
  uuid, uuid, uuid, text, bigint, text, jsonb, text, bigint, text, jsonb, text, text
) TO service_role;

COMMENT ON TABLE public.modeling_structural_demand_diagnosis_custody IS
  'Append-only exact custody for one pre-output structural input audit and its separate post-output v3 diagnosis. Writes are service-role only.';
