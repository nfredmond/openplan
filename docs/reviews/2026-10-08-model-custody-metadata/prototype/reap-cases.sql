
SET LOCAL ROLE service_role;
DO $test$
DECLARE old_attempt uuid;
BEGIN
 IF public.reap_model_run_if_stale('57afae71-f16e-4152-b7f3-f32670040de9',now()-interval '1 second','too old snapshot') THEN RAISE EXCEPTION 'fresh progress reaped'; END IF;
 IF NOT public.reap_model_run_if_stale('57afae71-f16e-4152-b7f3-f32670040de9',clock_timestamp(),'synthetic revoked attempt') THEN RAISE EXCEPTION 'reap absent'; END IF;
 old_attempt := (public.claim_model_stage_attempt('63714167-0655-4890-ae46-39f36fe78e65','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-a')->>'attempt_id')::uuid;
 BEGIN
  UPDATE public.model_run_stages SET status='succeeded',log_tail='legacy after reap' WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920';
  RAISE EXCEPTION 'legacy write after reaping accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage requires an attempt command' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.model_run_stages SET attempt_managed=false WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920';
  RAISE EXCEPTION 'managed stage downgrade accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage requires an attempt command' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_model_stage_attempt('25c576dc-1f92-4cd0-922a-e7bc47d9fd7a',old_attempt,'succeeded','late after reap',NULL);
  RAISE EXCEPTION 'old attempt after reaping accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id='57afae71-f16e-4152-b7f3-f32670040de9' AND (NOT attempt_managed OR active_attempt_id IS NOT NULL OR status<>'failed')) THEN RAISE EXCEPTION 'reaped stages retain authority'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_stage_attempts WHERE stage_id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920' AND worker_id='worker-reassigned' AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'revocation not recorded'; END IF;
 IF EXISTS(SELECT 1 FROM public.model_stage_write_context) THEN RAISE EXCEPTION 'reaper context leaked'; END IF;
END;
$test$;
