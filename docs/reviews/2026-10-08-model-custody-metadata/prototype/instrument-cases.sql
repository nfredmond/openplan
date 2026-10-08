SET LOCAL ROLE service_role;
DO $test$
DECLARE
 run uuid := gen_random_uuid(); stage uuid := gen_random_uuid(); attempt uuid;
 iteration integer := 0; method text; spec record; artifact jsonb; payload jsonb; result jsonb; request uuid;
BEGIN
 INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,engine_key,'queued','Synthetic dual instrument custody',created_by FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
 INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic dual instrument','queued',1);
 attempt := (public.claim_model_stage_attempt(gen_random_uuid(),stage,'instrument-fixture')->>'attempt_id')::uuid;
 FOREACH method IN ARRAY ARRAY['aequilibrae','activitysim','activitysim'] LOOP
  iteration := iteration+1;
  payload := jsonb_build_object('demand_method',method,'scientific_outcome','inconclusive');
  FOR spec IN SELECT * FROM (VALUES
   ('model_output','synthetic_output','synthetic.output'),
   ('input_bundle','validation_input_bundle_v2','openplan.validation-input-bundle.v2'),
   ('match_audit','pre_volume_match_audit_v2','openplan.pre-volume-observation-match-audit.v2'),
   ('comparison_basis','model_comparison_basis_v2','openplan.model-comparison-basis.v2'),
   ('assessment','model_validation_assessment_v2','openplan.model-validation-assessment.v2'),
   ('diagnosis','model_validation_structural_diagnosis_v2','openplan.model-validation-structural-diagnosis.v2')
  ) AS refs(prefix,artifact_type,schema_name) LOOP
   artifact := public.write_model_attempt_artifact(gen_random_uuid(),attempt,jsonb_build_object(
    'artifact_type',spec.artifact_type,'file_url','local://synthetic-'||method||'-'||spec.prefix,
    'file_size_bytes',0,'content_hash',repeat('a',64),'metadata_json',jsonb_build_object('schema',spec.schema_name,'demand_method',method)));
   payload := payload || jsonb_build_object(spec.prefix||'_artifact_id',artifact->>'id',spec.prefix||'_sha256',repeat('a',64));
  END LOOP;
  BEGIN
   PERFORM public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload||'{"scientific_outcome":"pass"}');
   RAISE EXCEPTION 'diagnostic instrument promoted';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'Invalid attempt instrument payload' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload||jsonb_build_object('demand_method',CASE WHEN method='aequilibrae' THEN 'activitysim' ELSE 'aequilibrae' END));
   RAISE EXCEPTION 'wrong instrument method accepted';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'Instrument demand method does not match output and assessment' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload||jsonb_build_object('model_output_sha256',repeat('b',64)));
   RAISE EXCEPTION 'wrong output hash accepted';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'Instrument artifact attempt, run, stage or hash mismatch' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload||jsonb_build_object('input_bundle_artifact_id',payload->>'model_output_artifact_id'));
   RAISE EXCEPTION 'swapped instrument artifact accepted';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'comparable observation artifact type, run, or hash does not match custody' THEN RAISE; END IF;
  END;
  IF iteration=3 THEN EXIT; END IF;
  request := gen_random_uuid();
  result := public.record_model_attempt_instrument(request,attempt,payload);
  IF result->>'demand_method' IS DISTINCT FROM method OR result->>'attempt_id' IS DISTINCT FROM attempt::text OR result->>'model_run_id' IS DISTINCT FROM run::text THEN RAISE EXCEPTION 'instrument identity changed'; END IF;
  IF public.record_model_attempt_instrument(request,attempt,payload) IS DISTINCT FROM result THEN RAISE EXCEPTION 'instrument retry changed'; END IF;
  BEGIN
   PERFORM public.record_model_attempt_instrument(request,attempt,payload||jsonb_build_object('model_output_sha256',repeat('b',64)));
   RAISE EXCEPTION 'changed instrument request accepted';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'Instrument request identity reused with different payload' THEN RAISE; END IF;
  END;
 END LOOP;
 PERFORM public.reap_model_run_if_stale(run,clock_timestamp(),'Synthetic instrument revoke');
 BEGIN
  PERFORM public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload);
  RAISE EXCEPTION 'revoked instrument write accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Instrument attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(DISTINCT demand_method) FROM model_attempt_instrument_custody) <> 2
 OR (SELECT count(DISTINCT model_run_id) FROM model_attempt_instrument_custody) <> 1
 OR (SELECT count(*) FROM model_attempt_instrument_receipts) <> 2 THEN RAISE EXCEPTION 'dual method custody not retained'; END IF;
 IF has_table_privilege('service_role','public.model_attempt_instrument_custody','INSERT') THEN RAISE EXCEPTION 'direct instrument insert access'; END IF;
END;
$test$;
