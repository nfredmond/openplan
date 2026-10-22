-- PREPARED ONLY. Root may run after review against its isolated synthetic stack.
-- Apply migration 20261017000018 there first. Supply session settings privately:
-- openplan.usage_limit_probe_synthetic=yes, openplan.usage_limit_probe_turn_id,
-- openplan.usage_limit_probe_token_hash. The seeded Codex attempt must be running.
-- This transaction rolls back every attempted write. It does not invoke a provider.
BEGIN;
DO $$
DECLARE job public.assistant_provider_turns; receipt jsonb; changed jsonb; saved jsonb; replay jsonb; key text;
BEGIN
  IF current_setting('openplan.usage_limit_probe_synthetic',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Explicit isolated synthetic probe setup required';
  END IF;
  SELECT * INTO STRICT job FROM public.assistant_provider_turns
    WHERE id=current_setting('openplan.usage_limit_probe_turn_id')::uuid FOR UPDATE;
  IF job.state<>'running' OR job.provider<>'codex' OR job.connection_id IS NULL OR job.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'An unexpired synthetic running Codex attempt is required';
  END IF;
  receipt:=jsonb_build_object('schemaVersion',2,'outcome','limited','provider','codex','model',job.model_id,'authMode',job.auth_mode,
    'userId',job.user_id,'requestId',job.request_id,'workspaceId',job.workspace_id,'projectId',job.project_id,'connectionId',job.connection_id,
    'turnId',job.id,'attemptId',job.attempt_id,'packetHash',job.packet_hash,'nativeThreadId','synthetic-thread','nativeTurnId','synthetic-turn',
    'signal',jsonb_build_object('code','usageLimitExceeded','resetAtUnixSeconds',1800000000,'resetSource','account_rate_limits'));
  IF NOT public.valid_assistant_native_limit_receipt(receipt,job) THEN RAISE EXCEPTION 'Valid report refused'; END IF;
  IF NOT public.valid_assistant_native_limit_receipt(jsonb_set(receipt,'{signal}',
    '{"code":"usageLimitExceeded","resetAtUnixSeconds":null,"resetSource":null}'),job) THEN RAISE EXCEPTION 'Unknown reset refused'; END IF;
  FOREACH key IN ARRAY ARRAY['userId','requestId','workspaceId','projectId','connectionId','turnId','attemptId','packetHash','model','authMode'] LOOP
    changed:=jsonb_set(receipt,ARRAY[key],to_jsonb('mismatched'::text));
    IF public.valid_assistant_native_limit_receipt(changed,job) THEN RAISE EXCEPTION 'Custody field accepted: %',key; END IF;
    BEGIN
      PERFORM public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
        current_setting('openplan.usage_limit_probe_token_hash'),NULL,changed,'native_usage_limit');
      RAISE EXCEPTION 'Altered report reached a terminal write';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  FOREACH changed IN ARRAY ARRAY[
    receipt||'{"message":"private"}'::jsonb,
    jsonb_set(receipt,'{signal,resetAtUnixSeconds}','-1'),
    jsonb_set(receipt,'{signal,resetAtUnixSeconds}','1.5'),
    jsonb_set(receipt,'{signal,resetAtUnixSeconds}','253402300800'),
    jsonb_set(receipt,'{signal,code}','"sessionBudgetExceeded"'),
    jsonb_set(receipt,'{signal,resetSource}','null')
  ] LOOP
    IF public.valid_assistant_native_limit_receipt(changed,job) THEN RAISE EXCEPTION 'Invalid report shape accepted'; END IF;
  END LOOP;
  BEGIN
    PERFORM public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
      current_setting('openplan.usage_limit_probe_token_hash'),NULL,receipt,'native_other_failure');
    RAISE EXCEPTION 'Arbitrary failure receipt accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- A cancellation persists inside this subtransaction until its deliberate rollback.
  BEGIN
    PERFORM public.cancel_assistant_provider_turn(job.id,job.user_id);
    BEGIN
      PERFORM public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
        current_setting('openplan.usage_limit_probe_token_hash'),NULL,receipt,'native_usage_limit');
      RAISE EXCEPTION 'Cancelled attempt accepted a receipt';
    EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Rollback synthetic cancellation';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
  saved:=public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
    current_setting('openplan.usage_limit_probe_token_hash'),NULL,receipt,'native_usage_limit');
  IF saved->>'state'<>'failed' OR saved->'result' IS DISTINCT FROM 'null'::jsonb OR saved->'provider_receipt' IS DISTINCT FROM receipt THEN
    RAISE EXCEPTION 'Limited failure was not retained exactly';
  END IF;
  replay:=public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
    current_setting('openplan.usage_limit_probe_token_hash'),NULL,receipt,'native_usage_limit');
  IF replay IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Exact replay changed the saved result'; END IF;
  BEGIN
    PERFORM public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
      current_setting('openplan.usage_limit_probe_token_hash'),NULL,jsonb_set(receipt,'{signal,resetAtUnixSeconds}','1800000600'),'native_usage_limit');
    RAISE EXCEPTION 'Changed terminal report overwrote the original';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
ROLLBACK;
