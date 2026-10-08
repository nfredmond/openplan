
SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid; first_result jsonb;
BEGIN
 attempt := (public.claim_model_stage_attempt('63714167-0655-4890-ae46-39f36fe78e65','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-a')->>'attempt_id')::uuid;
 first_result := public.write_model_stage_attempt('201cb97d-7036-4f4d-b1cd-1a07c5feb9a7',attempt,'running','progress',NULL);
 IF public.write_model_stage_attempt('201cb97d-7036-4f4d-b1cd-1a07c5feb9a7',attempt,'running','progress',NULL) IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'progress retry changed'; END IF;
 BEGIN
  PERFORM public.write_model_stage_attempt('201cb97d-7036-4f4d-b1cd-1a07c5feb9a7',attempt,'running','different',NULL);
  RAISE EXCEPTION 'changed write accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage write request identity reused with different payload' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.model_run_stages SET log_tail='legacy bypass' WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920';
  RAISE EXCEPTION 'legacy write accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage requires an attempt command' THEN RAISE; END IF;
 END;
 first_result := public.write_model_stage_attempt('9b64f1cf-5c33-4805-adb3-6adeef3a6c85',attempt,'succeeded','finished',NULL);
 IF first_result->>'status' <> 'succeeded' OR first_result->>'completed_at' IS NULL THEN RAISE EXCEPTION 'terminal write absent'; END IF;
 IF public.write_model_stage_attempt('9b64f1cf-5c33-4805-adb3-6adeef3a6c85',attempt,'succeeded','finished',NULL) IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'terminal retry changed'; END IF;
 BEGIN
  PERFORM public.write_model_stage_attempt('a0b22cc7-e00d-4bd5-9104-4dc1c677bb18',attempt,'running','late',NULL);
  RAISE EXCEPTION 'late write accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.model_stage_write_context) <> 0 THEN RAISE EXCEPTION 'write authority leaked'; END IF;
 IF (SELECT count(*) FROM public.model_stage_write_receipts) <> 2 THEN RAISE EXCEPTION 'write receipt count wrong'; END IF;
 IF (SELECT log_tail FROM public.model_run_stages WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920') <> 'finished' THEN RAISE EXCEPTION 'late log overwrote result'; END IF;
 IF has_table_privilege('service_role','public.model_stage_write_context','INSERT') OR has_table_privilege('authenticated','public.model_stage_write_context','INSERT') THEN RAISE EXCEPTION 'direct context access'; END IF;
 IF has_function_privilege('authenticated','public.write_model_stage_attempt(uuid,uuid,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'public write command'; END IF;
END;
$test$;

-- Controlled reassignment fixture, not a production relaunch implementation.
DO $fixture$
DECLARE next_attempt uuid;
BEGIN
 INSERT INTO public.model_stage_attempts(stage_id,run_id,worker_id)
 SELECT id,run_id,'worker-reassigned' FROM public.model_run_stages WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920' RETURNING id INTO next_attempt;
 INSERT INTO public.model_stage_write_context VALUES(txid_current(),'9898f32b-23e4-4f0f-9a39-36ff4f1b2920',next_attempt);
 UPDATE public.model_run_stages SET active_attempt_id=next_attempt,status='running',log_tail='new owner' WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920';
 DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current() AND stage_id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920';
END;
$fixture$;
SET LOCAL ROLE service_role;
DO $test$
DECLARE old_attempt uuid;
BEGIN
 old_attempt := (public.claim_model_stage_attempt('63714167-0655-4890-ae46-39f36fe78e65','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-a')->>'attempt_id')::uuid;
 BEGIN
  PERFORM public.write_model_stage_attempt('607ed782-ee89-4e94-b9bf-1d9f039532de',old_attempt,'running','stale overwrite',NULL);
  RAISE EXCEPTION 'old attempt overwrote new owner';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
