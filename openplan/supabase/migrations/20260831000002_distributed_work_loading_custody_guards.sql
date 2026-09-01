-- Fail closed when artifact metadata weakens a distributed-work-loading gate.
-- The first custody migration binds identities and hashes; this correction also
-- checks conservation and every scientific boundary before a row can exist.

CREATE OR REPLACE FUNCTION public.validate_modeling_distributed_work_loading_custody()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  v_input public.model_run_artifacts%ROWTYPE;
  v_audit public.model_run_artifacts%ROWTYPE;
  v_comparison public.model_run_artifacts%ROWTYPE;
  v_original numeric;
  v_candidate numeric;
  v_work numeric;
  v_loaded numeric;
  v_retained numeric;
  v_retained_rows numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = NEW.model_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.engine_key = NEW.method
  ) THEN
    RAISE EXCEPTION 'distributed work loading run does not belong to workspace or method';
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
     OR v_input.metadata_json->>'method_aggregation' IS DISTINCT FROM 'separate'
     OR v_input.metadata_json->>'non_work_treatment' IS DISTINCT FROM 'unchanged_not_supported_by_lodes'
     OR v_input.metadata_json->'arbitrary_point_cap' IS DISTINCT FROM 'null'::jsonb
     OR v_input.metadata_json->'arbitrary_gateway_cap' IS DISTINCT FROM 'null'::jsonb
     OR v_audit.metadata_json->>'frozen_before_assignment_output' IS DISTINCT FROM 'true'
     OR v_audit.metadata_json->>'assignment_output_bytes_read' IS DISTINCT FROM 'false'
     OR v_audit.metadata_json->>'holdout_accessed' IS DISTINCT FROM 'false'
     OR v_audit.metadata_json->>'methods_averaged' IS DISTINCT FROM 'false'
     OR v_audit.metadata_json->>'defaults_changed' IS DISTINCT FROM 'false'
     OR v_audit.metadata_json->>'candidate_promoted' IS DISTINCT FROM 'false'
     OR v_comparison.metadata_json->>'scientific_outcome' IS DISTINCT FROM NEW.scientific_outcome
     OR v_comparison.metadata_json->>'method_aggregation' IS DISTINCT FROM 'separate'
     OR v_comparison.metadata_json->>'defaults_changed' IS DISTINCT FROM 'false'
     OR v_comparison.metadata_json->>'holdout_accessed' IS DISTINCT FROM 'false'
     OR v_comparison.metadata_json->'bindings'->>'pre_output_audit_sha256' IS DISTINCT FROM NEW.pre_output_audit_sha256
     OR v_audit.metadata_json->'bindings'->'source_od'->>'sha256' IS DISTINCT FROM NEW.source_custody_sha256
     OR v_audit.metadata_json->'bindings'->'candidate_network'->>'sha256' IS DISTINCT FROM NEW.network_custody_sha256
     OR jsonb_typeof(v_input.metadata_json->'retained_work_demand') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_input.metadata_json->'source_states') IS DISTINCT FROM 'object'
     OR NOT (v_input.metadata_json->'source_states' ?& ARRAY[
       'covered', 'explicit_zero', 'suppressed', 'unavailable_source',
       'unmapped', 'unroutable', 'inconclusive_missing_pair'
     ])
     OR v_comparison.metadata_json->'county_stratum'->>'worsened' IS NULL
     OR (
       v_comparison.metadata_json->'development_gate'->>'advanced' = 'true'
       AND NOT (
         v_comparison.metadata_json->'development_gate'->>'demand_conserved' = 'true'
         AND v_comparison.metadata_json->'development_gate'->>'observed_link_reach_improved' = 'true'
         AND v_comparison.metadata_json->'development_gate'->>'no_county_stratum_worsened' = 'true'
         AND v_comparison.metadata_json->'development_gate'->>'no_road_class_worsened' = 'true'
         AND v_comparison.metadata_json->'development_gate'->>'same_source_network_custody' = 'true'
       )
     ) THEN
    RAISE EXCEPTION 'distributed work loading metadata does not match exact custody';
  END IF;

  BEGIN
    v_original := (v_input.metadata_json #>> '{demand_accounting,original_total}')::numeric;
    v_candidate := (v_input.metadata_json #>> '{demand_accounting,candidate_total}')::numeric;
    v_work := (v_input.metadata_json #>> '{demand_accounting,original_work_total}')::numeric;
    v_loaded := (v_input.metadata_json #>> '{demand_accounting,work_loaded_at_access_points}')::numeric;
    v_retained := (v_input.metadata_json #>> '{demand_accounting,work_retained_at_original_centroids}')::numeric;
    SELECT COALESCE(sum((item->>'demand')::numeric), 0)
      INTO v_retained_rows
      FROM jsonb_array_elements(v_input.metadata_json->'retained_work_demand') AS item;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'distributed work loading demand accounting is not numeric';
  END;
  IF v_original IS NULL OR v_candidate IS NULL OR v_work IS NULL OR v_loaded IS NULL OR v_retained IS NULL
     OR v_original < 0 OR v_candidate < 0 OR v_work < 0 OR v_loaded < 0 OR v_retained < 0
     OR abs(v_candidate - v_original) > greatest(0.000001, v_original * 0.0000000001)
     OR abs(v_loaded + v_retained - v_work) > greatest(0.000001, v_work * 0.0000000001)
     OR abs(v_retained_rows - v_retained) > greatest(0.000001, v_retained * 0.0000000001) THEN
    RAISE EXCEPTION 'distributed work loading demand accounting does not conserve exact demand';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_distributed_work_loading_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_distributed_work_loading_custody() TO service_role;
