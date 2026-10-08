SET LOCAL ROLE service_role;
DO $test$
DECLARE
 run uuid := gen_random_uuid(); stage uuid := gen_random_uuid(); later uuid := gen_random_uuid();
 workspace uuid := 'de125ce5-820f-4a6c-af47-3983311b5897'; attempt uuid; result jsonb;
BEGIN
 INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,engine_key,'queued','Synthetic output reader',created_by
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
 INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic producer','queued',1),(later,run,'Synthetic later stage','queued',2);
 result := public.read_model_attempt_outputs(run,workspace);
 IF result->'outputs' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'empty output read fabricated records'; END IF;
 BEGIN
  PERFORM public.read_model_attempt_outputs(run,gen_random_uuid());
  RAISE EXCEPTION 'cross workspace output read accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model output read scope mismatch' THEN RAISE; END IF;
 END;
 INSERT INTO model_run_kpis(run_id,kpi_name,kpi_label,value) VALUES(run,'legacy','Legacy',NULL);
 attempt := (public.claim_model_stage_attempt(gen_random_uuid(),stage,'reader-fixture')->>'attempt_id')::uuid;
 PERFORM public.write_model_attempt_kpi(gen_random_uuid(),attempt,'{"kpi_name":"current","kpi_label":"Current","value":null}');
 PERFORM public.write_model_attempt_artifact(gen_random_uuid(),attempt,jsonb_build_object('artifact_type','synthetic','file_url','local://synthetic','file_size_bytes',0,'content_hash',repeat('a',64)));
 result := public.read_model_attempt_outputs(run,workspace);
 IF (SELECT count(*) FROM jsonb_array_elements(result->'outputs') x WHERE x->>'ownership_state'='legacy_unknown' AND x->'record'->'attempt_id'='null'::jsonb) <> 1 THEN RAISE EXCEPTION 'legacy provenance fabricated'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(result->'outputs') x WHERE x->>'ownership_state'='current_in_progress') <> 2 THEN RAISE EXCEPTION 'current progress outputs lost'; END IF;
 PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'succeeded','Synthetic complete',NULL);
 result := public.read_model_attempt_outputs(run,workspace);
 IF (SELECT count(*) FROM jsonb_array_elements(result->'outputs') x WHERE x->>'ownership_state'='current_completed') <> 2 THEN RAISE EXCEPTION 'completed outputs lost'; END IF;
 PERFORM public.reap_model_run_if_stale(run,clock_timestamp(),'Synthetic reader revoke');
 result := public.read_model_attempt_outputs(run,workspace);
 IF jsonb_array_length(result->'outputs') <> 3 OR (SELECT count(*) FROM jsonb_array_elements(result->'outputs') x WHERE x->>'ownership_state'='retained_inactive') <> 2 THEN RAISE EXCEPTION 'revoked output presented as current'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(result->'outputs') x WHERE x->>'kind'='kpi' AND x->'record'->'value'='null'::jsonb) <> 2 THEN RAISE EXCEPTION 'output null values changed'; END IF;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF has_function_privilege('authenticated','public.read_model_attempt_outputs(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.read_model_attempt_outputs(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public output read access'; END IF;
END;
$test$;
-- Simulate a malformed historical binding through explicit administrator fixture
-- control. This bypass exists only inside the outer rollback transaction.
ALTER TABLE public.model_run_artifacts DISABLE TRIGGER guard_model_attempt_artifact;
UPDATE public.model_run_artifacts a SET stage_id=s.id
FROM public.model_runs r,public.model_run_stages s
WHERE a.run_id=r.id AND r.run_title='Synthetic output reader' AND s.run_id=r.id AND s.sort_order=2;
ALTER TABLE public.model_run_artifacts ENABLE TRIGGER guard_model_attempt_artifact;
SET LOCAL ROLE service_role;
DO $test$
DECLARE result jsonb;
BEGIN
 SELECT public.read_model_attempt_outputs(id,workspace_id) INTO result FROM model_runs WHERE run_title='Synthetic output reader';
 IF (SELECT count(*) FROM jsonb_array_elements(result->'outputs') x WHERE x->>'ownership_state'='invalid_binding') <> 1 THEN RAISE EXCEPTION 'mismatched artifact binding accepted'; END IF;
END;
$test$;
RESET ROLE;
