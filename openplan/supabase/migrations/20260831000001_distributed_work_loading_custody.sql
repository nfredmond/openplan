-- Service-role-only append-only custody for one distributed work-loading input,
-- its assignment-blind audit, and its post-output development comparison.

CREATE TABLE public.modeling_distributed_work_loading_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  loading_input_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  pre_output_audit_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  development_comparison_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  loading_input_sha256 text NOT NULL CHECK (loading_input_sha256 ~ '^[0-9a-f]{64}$'),
  pre_output_audit_sha256 text NOT NULL CHECK (pre_output_audit_sha256 ~ '^[0-9a-f]{64}$'),
  development_comparison_sha256 text NOT NULL CHECK (development_comparison_sha256 ~ '^[0-9a-f]{64}$'),
  source_custody_sha256 text NOT NULL CHECK (source_custody_sha256 ~ '^[0-9a-f]{64}$'),
  network_custody_sha256 text NOT NULL CHECK (network_custody_sha256 ~ '^[0-9a-f]{64}$'),
  method text NOT NULL CHECK (method IN ('aequilibrae', 'activitysim')),
  scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive'),
  defaults_changed boolean NOT NULL CHECK (defaults_changed = false),
  holdout_accessed boolean NOT NULL CHECK (holdout_accessed = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_run_id, method)
);

ALTER TABLE public.modeling_distributed_work_loading_custody ENABLE ROW LEVEL SECURITY;

CREATE POLICY modeling_distributed_work_loading_member_read
  ON public.modeling_distributed_work_loading_custody FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = modeling_distributed_work_loading_custody.workspace_id
        AND member.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.model_runs run
      WHERE run.id = modeling_distributed_work_loading_custody.model_run_id
        AND run.workspace_id = modeling_distributed_work_loading_custody.workspace_id
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.modeling_distributed_work_loading_custody FROM anon, authenticated;
GRANT SELECT ON public.modeling_distributed_work_loading_custody TO authenticated;

CREATE OR REPLACE FUNCTION public.refuse_modeling_distributed_work_loading_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'distributed work loading custody is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_modeling_distributed_work_loading_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_modeling_distributed_work_loading_mutation() TO service_role;

CREATE TRIGGER refuse_modeling_distributed_work_loading_mutation
BEFORE UPDATE OR DELETE ON public.modeling_distributed_work_loading_custody
FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_distributed_work_loading_mutation();

CREATE OR REPLACE FUNCTION public.validate_modeling_distributed_work_loading_custody()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  v_input public.model_run_artifacts%ROWTYPE;
  v_audit public.model_run_artifacts%ROWTYPE;
  v_comparison public.model_run_artifacts%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = NEW.model_run_id AND run.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'distributed work loading run does not belong to workspace';
  END IF;
  SELECT * INTO v_input FROM public.model_run_artifacts WHERE id = NEW.loading_input_artifact_id;
  SELECT * INTO v_audit FROM public.model_run_artifacts WHERE id = NEW.pre_output_audit_artifact_id;
  SELECT * INTO v_comparison FROM public.model_run_artifacts WHERE id = NEW.development_comparison_artifact_id;
  IF v_input.id IS NULL OR v_audit.id IS NULL OR v_comparison.id IS NULL
     OR v_input.run_id <> NEW.model_run_id OR v_audit.run_id <> NEW.model_run_id OR v_comparison.run_id <> NEW.model_run_id
     OR v_input.artifact_type <> 'distributed_work_loading_input_v1'
     OR v_audit.artifact_type <> 'pre_output_audit_v1'
     OR v_comparison.artifact_type <> 'development_comparison_v1'
     OR v_input.content_hash IS DISTINCT FROM NEW.loading_input_sha256
     OR v_audit.content_hash IS DISTINCT FROM NEW.pre_output_audit_sha256
     OR v_comparison.content_hash IS DISTINCT FROM NEW.development_comparison_sha256 THEN
    RAISE EXCEPTION 'distributed work loading artifact type, run, or hash does not match custody';
  END IF;
  IF v_input.metadata_json->>'schema' IS DISTINCT FROM 'openplan.distributed-work-loading-input.v1'
     OR v_audit.metadata_json->>'schema' IS DISTINCT FROM 'openplan.pre-output-audit.v1'
     OR v_comparison.metadata_json->>'schema' IS DISTINCT FROM 'openplan.development-comparison.v1'
     OR v_input.metadata_json->>'method' IS DISTINCT FROM NEW.method
     OR v_audit.metadata_json->>'method' IS DISTINCT FROM NEW.method
     OR v_comparison.metadata_json->>'method' IS DISTINCT FROM NEW.method
     OR v_audit.metadata_json->>'assignment_output_bytes_read' IS DISTINCT FROM 'false'
     OR v_comparison.metadata_json->>'scientific_outcome' IS DISTINCT FROM NEW.scientific_outcome
     OR v_comparison.metadata_json->>'defaults_changed' IS DISTINCT FROM 'false'
     OR v_comparison.metadata_json->>'holdout_accessed' IS DISTINCT FROM 'false'
     OR v_comparison.metadata_json->'bindings'->>'pre_output_audit_sha256' IS DISTINCT FROM NEW.pre_output_audit_sha256
     OR v_audit.metadata_json->'bindings'->'source_od'->>'sha256' IS DISTINCT FROM NEW.source_custody_sha256
     OR v_audit.metadata_json->'bindings'->'candidate_network'->>'sha256' IS DISTINCT FROM NEW.network_custody_sha256 THEN
    RAISE EXCEPTION 'distributed work loading metadata does not match exact custody';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_distributed_work_loading_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_distributed_work_loading_custody() TO service_role;

CREATE TRIGGER validate_modeling_distributed_work_loading_custody
BEFORE INSERT ON public.modeling_distributed_work_loading_custody
FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_distributed_work_loading_custody();

CREATE OR REPLACE FUNCTION public.refuse_bound_distributed_work_loading_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.modeling_distributed_work_loading_custody custody
    WHERE OLD.id IN (custody.loading_input_artifact_id, custody.pre_output_audit_artifact_id, custody.development_comparison_artifact_id)
  ) THEN
    RAISE EXCEPTION 'artifact is bound to immutable distributed work loading custody';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_bound_distributed_work_loading_artifact_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_bound_distributed_work_loading_artifact_mutation() TO service_role;

CREATE TRIGGER refuse_bound_distributed_work_loading_artifact_mutation
BEFORE UPDATE OR DELETE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_distributed_work_loading_artifact_mutation();

CREATE OR REPLACE FUNCTION public.record_modeling_distributed_work_loading(
  p_workspace_id uuid, p_model_run_id uuid, p_stage_id uuid,
  p_loading_input_file_url text, p_loading_input_size bigint, p_loading_input_sha256 text, p_loading_input_metadata jsonb,
  p_pre_output_audit_file_url text, p_pre_output_audit_size bigint, p_pre_output_audit_sha256 text, p_pre_output_audit_metadata jsonb,
  p_development_comparison_file_url text, p_development_comparison_size bigint, p_development_comparison_sha256 text, p_development_comparison_metadata jsonb,
  p_source_custody_sha256 text, p_network_custody_sha256 text,
  p_method text, p_scientific_outcome text, p_defaults_changed boolean, p_holdout_accessed boolean
)
RETURNS public.modeling_distributed_work_loading_custody
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  v_input_id uuid;
  v_audit_id uuid;
  v_comparison_id uuid;
  v_row public.modeling_distributed_work_loading_custody%ROWTYPE;
BEGIN
  IF p_stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.model_run_stages stage WHERE stage.id = p_stage_id AND stage.run_id = p_model_run_id
  ) THEN
    RAISE EXCEPTION 'distributed work loading stage does not belong to run';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run WHERE run.id = p_model_run_id AND run.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'distributed work loading run does not belong to workspace';
  END IF;
  INSERT INTO public.model_run_artifacts (run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json)
  VALUES (p_model_run_id, p_stage_id, 'distributed_work_loading_input_v1', p_loading_input_file_url, p_loading_input_size, p_loading_input_sha256, p_loading_input_metadata)
  RETURNING id INTO v_input_id;
  INSERT INTO public.model_run_artifacts (run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json)
  VALUES (p_model_run_id, p_stage_id, 'pre_output_audit_v1', p_pre_output_audit_file_url, p_pre_output_audit_size, p_pre_output_audit_sha256, p_pre_output_audit_metadata)
  RETURNING id INTO v_audit_id;
  INSERT INTO public.model_run_artifacts (run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json)
  VALUES (p_model_run_id, p_stage_id, 'development_comparison_v1', p_development_comparison_file_url, p_development_comparison_size, p_development_comparison_sha256, p_development_comparison_metadata)
  RETURNING id INTO v_comparison_id;
  INSERT INTO public.modeling_distributed_work_loading_custody (
    workspace_id, model_run_id, loading_input_artifact_id, pre_output_audit_artifact_id, development_comparison_artifact_id,
    loading_input_sha256, pre_output_audit_sha256, development_comparison_sha256, source_custody_sha256, network_custody_sha256,
    method, scientific_outcome, defaults_changed, holdout_accessed
  ) VALUES (
    p_workspace_id, p_model_run_id, v_input_id, v_audit_id, v_comparison_id,
    p_loading_input_sha256, p_pre_output_audit_sha256, p_development_comparison_sha256, p_source_custody_sha256, p_network_custody_sha256,
    p_method, p_scientific_outcome, p_defaults_changed, p_holdout_accessed
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_modeling_distributed_work_loading(
  uuid, uuid, uuid, text, bigint, text, jsonb, text, bigint, text, jsonb, text, bigint, text, jsonb,
  text, text, text, text, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_modeling_distributed_work_loading(
  uuid, uuid, uuid, text, bigint, text, jsonb, text, bigint, text, jsonb, text, bigint, text, jsonb,
  text, text, text, text, boolean, boolean
) TO service_role;

COMMENT ON TABLE public.modeling_distributed_work_loading_custody IS
  'Append-only exact custody for distributed work-loading input, assignment-blind audit, and post-output development comparison. Writes are service-role only.';
