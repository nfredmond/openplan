
INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '7c2f1f61-997e-4421-b46b-0083d7b1a762',workspace_id,model_id,engine_key,'queued','Synthetic failure',created_by
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('605f193d-141f-4486-910d-6b74d263bb09','7c2f1f61-997e-4421-b46b-0083d7b1a762','Prior completed stage','succeeded',0),
 ('de38fc42-f6d5-4e4d-9201-2304435a3c07','7c2f1f61-997e-4421-b46b-0083d7b1a762','Failing stage','queued',1),
 ('34d833ec-9a76-4c89-999a-276c1433f318','7c2f1f61-997e-4421-b46b-0083d7b1a762','Dependent stage','queued',2);
CREATE FUNCTION public.prototype_reject_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='7c2f1f61-997e-4421-b46b-0083d7b1a762' AND NEW.status='failed' THEN
  RAISE EXCEPTION 'synthetic parent failure refusal';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER prototype_reject_failure BEFORE UPDATE ON model_runs
 FOR EACH ROW EXECUTE FUNCTION public.prototype_reject_failure();
SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid;
BEGIN
 attempt := (public.claim_model_stage_attempt('e59bdba1-af07-4e48-b52e-cb8cadb399e6','de38fc42-f6d5-4e4d-9201-2304435a3c07','failure-worker')->>'attempt_id')::uuid;
 BEGIN
  PERFORM public.write_model_stage_attempt('fce0737f-cb6c-49fa-81a4-7eb047a301bf',attempt,'failed','failed log','Synthetic stage error');
  RAISE EXCEPTION 'parent failure omitted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'synthetic parent failure refusal' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT status FROM model_run_stages WHERE id='de38fc42-f6d5-4e4d-9201-2304435a3c07') <> 'running' THEN RAISE EXCEPTION 'failure stage escaped rollback'; END IF;
 IF EXISTS(SELECT 1 FROM model_stage_attempts WHERE run_id='7c2f1f61-997e-4421-b46b-0083d7b1a762' AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'revocation escaped rollback'; END IF;
 IF EXISTS(SELECT 1 FROM model_stage_write_receipts WHERE request_id='fce0737f-cb6c-49fa-81a4-7eb047a301bf') THEN RAISE EXCEPTION 'failure receipt escaped rollback'; END IF;
END;
$test$;
DROP TRIGGER prototype_reject_failure ON model_runs;
DROP FUNCTION public.prototype_reject_failure();
SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid; result jsonb;
BEGIN
 attempt := (public.claim_model_stage_attempt('e59bdba1-af07-4e48-b52e-cb8cadb399e6','de38fc42-f6d5-4e4d-9201-2304435a3c07','failure-worker')->>'attempt_id')::uuid;
 result := public.write_model_stage_attempt('fce0737f-cb6c-49fa-81a4-7eb047a301bf',attempt,'failed','failed log','Synthetic stage error');
 IF result->>'run_status' <> 'failed' OR result->>'run_completed_at' IS NULL THEN RAISE EXCEPTION 'run failure absent'; END IF;
 IF public.write_model_stage_attempt('fce0737f-cb6c-49fa-81a4-7eb047a301bf',attempt,'failed','failed log','Synthetic stage error') IS DISTINCT FROM result THEN RAISE EXCEPTION 'failure retry changed'; END IF;
 BEGIN
  PERFORM public.write_model_stage_attempt('f8b6c771-660b-412b-b486-67589d05e260',attempt,'succeeded','late',NULL);
  RAISE EXCEPTION 'failed attempt revived';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT status FROM model_runs WHERE id='7c2f1f61-997e-4421-b46b-0083d7b1a762') <> 'failed' THEN RAISE EXCEPTION 'persisted run failure absent'; END IF;
 IF EXISTS(SELECT 1 FROM model_run_stages WHERE run_id='7c2f1f61-997e-4421-b46b-0083d7b1a762' AND (status <> CASE WHEN id='605f193d-141f-4486-910d-6b74d263bb09' THEN 'succeeded' ELSE 'failed' END OR active_attempt_id IS NOT NULL OR NOT attempt_managed)) THEN RAISE EXCEPTION 'failure left stages open'; END IF;
 IF EXISTS(SELECT 1 FROM model_stage_attempts WHERE run_id='7c2f1f61-997e-4421-b46b-0083d7b1a762' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'failure left authority active'; END IF;
 IF (SELECT error_message FROM model_run_stages WHERE id='de38fc42-f6d5-4e4d-9201-2304435a3c07') <> 'Synthetic stage error' THEN RAISE EXCEPTION 'original failure lost'; END IF;
 IF EXISTS(SELECT 1 FROM model_run_write_context) OR EXISTS(SELECT 1 FROM model_stage_write_context) THEN RAISE EXCEPTION 'failure context leaked'; END IF;
END;
$test$;
