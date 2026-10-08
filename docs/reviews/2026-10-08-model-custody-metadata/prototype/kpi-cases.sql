SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid; result jsonb; payload jsonb := '{"kpi_name":"synthetic_null","kpi_label":"Synthetic null","value":null}';
BEGIN
 attempt := (public.claim_model_stage_attempt('69939dbb-9441-4da8-b5f7-1a8e5e88f7b3','de38fc42-f6d5-4e4d-9201-2304435a3c07','relaunch-worker')->>'attempt_id')::uuid;
 BEGIN
  PERFORM public.write_model_attempt_kpi('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload-'value');
  RAISE EXCEPTION 'missing KPI value accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Invalid attempt KPI payload' THEN RAISE; END IF;
 END;
 result := public.write_model_attempt_kpi('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload);
 IF result->'value' IS DISTINCT FROM 'null'::jsonb OR result->>'attempt_id' <> attempt::text THEN RAISE EXCEPTION 'KPI null or attempt lost'; END IF;
 IF public.write_model_attempt_kpi('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload) IS DISTINCT FROM result THEN RAISE EXCEPTION 'KPI retry changed'; END IF;
 BEGIN
  PERFORM public.write_model_attempt_kpi('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload||'{"value":0}');
  RAISE EXCEPTION 'changed KPI accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model KPI request identity reused with different payload' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO model_run_kpis(run_id,kpi_name,kpi_label,value) VALUES('7c2f1f61-997e-4421-b46b-0083d7b1a762','legacy','Legacy',0);
  RAISE EXCEPTION 'legacy KPI accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model KPI requires an attempt command' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE model_run_kpis SET value=0 WHERE id=(result->>'id')::uuid;
  RAISE EXCEPTION 'retained KPI overwritten';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Attempt KPI records are immutable' THEN RAISE; END IF;
 END;
 PERFORM public.reap_model_run_if_stale('7c2f1f61-997e-4421-b46b-0083d7b1a762',clock_timestamp(),'Synthetic KPI revoke');
 BEGIN
  PERFORM public.write_model_attempt_kpi('00e1131a-a3b5-42fc-9c77-cb0b3428a641',attempt,payload);
  RAISE EXCEPTION 'revoked KPI accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model KPI attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM model_run_kpis WHERE run_id='7c2f1f61-997e-4421-b46b-0083d7b1a762' AND attempt_id IS NOT NULL AND value IS NULL) <> 1 THEN RAISE EXCEPTION 'retained KPI count wrong'; END IF;
 IF EXISTS(SELECT 1 FROM model_kpi_write_context) THEN RAISE EXCEPTION 'KPI context leaked'; END IF;
 IF has_table_privilege('service_role','public.model_kpi_write_context','INSERT') THEN RAISE EXCEPTION 'direct KPI context access'; END IF;
END;
$test$;
