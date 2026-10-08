SET LOCAL ROLE service_role;
DO $test$
DECLARE run_row public.model_runs%ROWTYPE; result jsonb; old_attempt uuid; new_attempt uuid;
BEGIN
 SELECT * INTO run_row FROM model_runs WHERE id='7c2f1f61-997e-4421-b46b-0083d7b1a762';
 BEGIN
  PERFORM public.relaunch_model_run_attempts('20edb693-8e2a-4a85-8616-d3e7dc65e24c',run_row.id,gen_random_uuid(),run_row.updated_at,'{}');
  RAISE EXCEPTION 'cross workspace relaunch accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model relaunch scope mismatch' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.relaunch_model_run_attempts('20edb693-8e2a-4a85-8616-d3e7dc65e24c',run_row.id,run_row.workspace_id,run_row.updated_at-interval '1 second','{}');
  RAISE EXCEPTION 'stale relaunch accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model relaunch state changed' THEN RAISE; END IF;
 END;
 result := public.relaunch_model_run_attempts('20edb693-8e2a-4a85-8616-d3e7dc65e24c',run_row.id,run_row.workspace_id,run_row.updated_at,'{"synthetic":"refreshed"}');
 IF result->>'status' <> 'queued' THEN RAISE EXCEPTION 'relaunch not queued'; END IF;
 IF public.relaunch_model_run_attempts('20edb693-8e2a-4a85-8616-d3e7dc65e24c',run_row.id,run_row.workspace_id,run_row.updated_at,'{"synthetic":"refreshed"}') IS DISTINCT FROM result THEN RAISE EXCEPTION 'relaunch retry changed'; END IF;
 BEGIN
  PERFORM public.relaunch_model_run_attempts('20edb693-8e2a-4a85-8616-d3e7dc65e24c',run_row.id,run_row.workspace_id,run_row.updated_at,'{}');
  RAISE EXCEPTION 'changed relaunch accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model relaunch request identity reused with different payload' THEN RAISE; END IF;
 END;
 old_attempt := (public.claim_model_stage_attempt('e59bdba1-af07-4e48-b52e-cb8cadb399e6','de38fc42-f6d5-4e4d-9201-2304435a3c07','failure-worker')->>'attempt_id')::uuid;
 new_attempt := (public.claim_model_stage_attempt('c6f068d2-ecdf-47f0-bcc8-df5c96af671a','605f193d-141f-4486-910d-6b74d263bb09','relaunch-worker')->>'attempt_id')::uuid;
 IF new_attempt IS NULL THEN RAISE EXCEPTION 'relaunched run not claimable'; END IF;
 PERFORM public.write_model_stage_attempt('2e5aa994-42e6-4a7c-b531-ef373916109e',new_attempt,'succeeded','recomputed predecessor',NULL);
 new_attempt := (public.claim_model_stage_attempt('69939dbb-9441-4da8-b5f7-1a8e5e88f7b3','de38fc42-f6d5-4e4d-9201-2304435a3c07','relaunch-worker')->>'attempt_id')::uuid;
 IF new_attempt IS NULL OR new_attempt=old_attempt THEN RAISE EXCEPTION 'relaunch did not replace same-stage ownership'; END IF;
 BEGIN
  PERFORM public.write_model_stage_attempt('a6e65bb9-8554-485d-a891-4c209a6c4331',old_attempt,'succeeded','late prior execution',NULL);
  RAISE EXCEPTION 'old execution survived relaunch';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM model_run_relaunch_receipts WHERE prior_run->>'status'='failed' AND jsonb_array_length(prior_stages)=3 AND prior_run->>'error_message'='Synthetic stage error') THEN RAISE EXCEPTION 'prior relaunch state lost'; END IF;
 IF (SELECT failure_count FROM model_runs WHERE id='7c2f1f61-997e-4421-b46b-0083d7b1a762') <> 1 THEN RAISE EXCEPTION 'relaunch retry duplicated history'; END IF;
 IF (SELECT input_snapshot_json FROM model_runs WHERE id='7c2f1f61-997e-4421-b46b-0083d7b1a762') <> '{"synthetic":"refreshed"}'::jsonb THEN RAISE EXCEPTION 'refreshed inputs absent'; END IF;
 IF EXISTS(SELECT 1 FROM model_run_write_context) OR EXISTS(SELECT 1 FROM model_stage_write_context) THEN RAISE EXCEPTION 'relaunch context leaked'; END IF;
END;
$test$;

INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '8ab0c7d2-c17d-48c9-99da-5f0fb84151f8',workspace_id,model_id,engine_key,'failed','Synthetic retained outputs',created_by
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('2e8a1b30-b8aa-473b-8827-caa4c09b933d','8ab0c7d2-c17d-48c9-99da-5f0fb84151f8','Synthetic output stage','failed',1);
INSERT INTO model_run_kpis(run_id,kpi_name,kpi_label,value) VALUES
 ('8ab0c7d2-c17d-48c9-99da-5f0fb84151f8','synthetic_unassessed','Synthetic unassessed',NULL);
SET LOCAL ROLE service_role;
DO $test$
DECLARE run_row public.model_runs%ROWTYPE;
BEGIN
 SELECT * INTO run_row FROM model_runs WHERE id='8ab0c7d2-c17d-48c9-99da-5f0fb84151f8';
 BEGIN
  PERFORM public.relaunch_model_run_attempts('49fe14ee-5aa4-4daa-8a50-aa0b4e1d796b',run_row.id,run_row.workspace_id,run_row.updated_at,'{}');
  RAISE EXCEPTION 'output-bearing relaunch accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model relaunch requires attempt-aware output retention' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM model_run_kpis WHERE run_id='8ab0c7d2-c17d-48c9-99da-5f0fb84151f8' AND value IS NULL) <> 1 THEN RAISE EXCEPTION 'refused relaunch lost output'; END IF;
 IF (SELECT status FROM model_runs WHERE id='8ab0c7d2-c17d-48c9-99da-5f0fb84151f8') <> 'failed' THEN RAISE EXCEPTION 'refused relaunch changed run'; END IF;
END;
$test$;
