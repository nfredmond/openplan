-- Apply the fail-closed metadata comparisons to databases that received the
-- first v0.38 migration before its verification pass completed.
CREATE OR REPLACE FUNCTION public.validate_modeling_validation_assessment_custody()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_run public.model_runs%ROWTYPE;
  v_output public.model_run_artifacts%ROWTYPE;
  v_input public.model_run_artifacts%ROWTYPE;
  v_basis public.model_run_artifacts%ROWTYPE;
  v_assessment public.model_run_artifacts%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.model_runs WHERE id = NEW.model_run_id;
  SELECT * INTO v_output FROM public.model_run_artifacts WHERE id = NEW.model_output_artifact_id;
  SELECT * INTO v_input FROM public.model_run_artifacts WHERE id = NEW.validation_input_bundle_artifact_id;
  SELECT * INTO v_basis FROM public.model_run_artifacts WHERE id = NEW.comparison_basis_artifact_id;
  SELECT * INTO v_assessment FROM public.model_run_artifacts WHERE id = NEW.model_validation_assessment_artifact_id;

  IF v_run.id IS NULL OR v_run.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'validation assessment run and workspace do not match';
  END IF;
  IF v_output.id IS NULL OR v_input.id IS NULL OR v_basis.id IS NULL OR v_assessment.id IS NULL
     OR v_output.run_id <> NEW.model_run_id OR v_input.run_id <> NEW.model_run_id
     OR v_basis.run_id <> NEW.model_run_id OR v_assessment.run_id <> NEW.model_run_id THEN
    RAISE EXCEPTION 'every bound validation artifact must belong to the same run';
  END IF;
  IF v_output.content_hash IS NULL OR v_output.content_hash !~ '^[0-9a-f]{64}$'
     OR v_input.content_hash IS NULL OR v_input.content_hash !~ '^[0-9a-f]{64}$'
     OR v_basis.content_hash IS NULL OR v_basis.content_hash !~ '^[0-9a-f]{64}$'
     OR v_assessment.content_hash IS NULL OR v_assessment.content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'every bound validation artifact requires an exact SHA-256';
  END IF;
  IF v_input.artifact_type <> 'validation_input_bundle'
     OR v_basis.artifact_type <> 'model_comparison_basis'
     OR v_assessment.artifact_type <> 'model_validation_assessment' THEN
    RAISE EXCEPTION 'validation assessment artifact types do not match the custody contract';
  END IF;
  IF v_input.metadata_json->>'schema' IS DISTINCT FROM 'openplan.validation-input-bundle.v1'
     OR v_basis.metadata_json->>'schema' IS DISTINCT FROM 'openplan.model-comparison-basis.v1'
     OR v_assessment.metadata_json->>'schema' IS DISTINCT FROM 'openplan.model-validation-assessment.v1' THEN
    RAISE EXCEPTION 'validation assessment artifact schemas do not match the custody contract';
  END IF;
  IF v_basis.content_hash IS DISTINCT FROM NEW.comparison_basis_sha256
     OR v_input.metadata_json->>'comparison_basis_sha256' IS DISTINCT FROM NEW.comparison_basis_sha256
     OR v_assessment.metadata_json->>'comparison_basis_sha256' IS DISTINCT FROM NEW.comparison_basis_sha256 THEN
    RAISE EXCEPTION 'comparison basis hash does not match every bound artifact';
  END IF;
  IF (v_assessment.metadata_json->>'rules_version')::integer IS DISTINCT FROM NEW.validation_rules_version
     OR v_assessment.metadata_json->>'scientific_outcome' IS DISTINCT FROM NEW.scientific_outcome
     OR v_assessment.metadata_json->>'planning_use' IS DISTINCT FROM NEW.planning_use
     OR v_assessment.metadata_json->'partition' IS DISTINCT FROM NEW.partition_json
     OR v_assessment.metadata_json->'reasons' IS DISTINCT FROM NEW.reasons_json THEN
    RAISE EXCEPTION 'model validation assessment custody hash or outcome mismatch';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_validation_assessment_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_validation_assessment_custody() TO service_role;
