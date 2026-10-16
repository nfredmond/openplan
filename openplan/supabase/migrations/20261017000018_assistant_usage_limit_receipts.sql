-- Add a narrow failure report to the existing immutable terminal-result contract.
-- No state enum, business action, caller authority or historical result changes.
CREATE FUNCTION public.valid_assistant_native_limit_receipt(receipt jsonb,job public.assistant_provider_turns)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE signal jsonb:=receipt->'signal'; reset_value jsonb:=signal->'resetAtUnixSeconds';
BEGIN
  IF job.provider<>'codex' OR job.auth_mode NOT IN ('chatgpt','apiKey') OR job.connection_id IS NULL
    OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR jsonb_typeof(signal) IS DISTINCT FROM 'object'
    OR signal->>'code' IS NULL OR signal->>'code' NOT IN ('usageLimitExceeded','rateLimitExceeded','sessionBudgetExceeded')
    OR jsonb_typeof(receipt->'nativeThreadId') IS DISTINCT FROM 'string' OR (receipt->>'nativeThreadId') !~ '^[A-Za-z0-9_-]{1,160}$'
    OR jsonb_typeof(receipt->'nativeTurnId') IS DISTINCT FROM 'string' OR (receipt->>'nativeTurnId') !~ '^[A-Za-z0-9_-]{1,160}$'
    OR reset_value IS NULL THEN RETURN false; END IF;
  IF reset_value<>'null'::jsonb THEN
    IF jsonb_typeof(reset_value) IS DISTINCT FROM 'number' OR reset_value::text !~ '^(0|[1-9][0-9]{0,11})$' THEN RETURN false; END IF;
    IF (reset_value::text)::bigint>253402300799 OR signal->>'code'<>'usageLimitExceeded' THEN RETURN false; END IF;
  END IF;
  RETURN receipt=jsonb_build_object('schemaVersion',2,'outcome','limited','provider','codex',
    'model',job.model_id,'authMode',job.auth_mode,'userId',job.user_id,'requestId',job.request_id,
    'workspaceId',job.workspace_id,'projectId',job.project_id,'connectionId',job.connection_id,
    'turnId',job.id,'attemptId',job.attempt_id,'packetHash',job.packet_hash,
    'nativeThreadId',receipt->>'nativeThreadId','nativeTurnId',receipt->>'nativeTurnId',
    'signal',jsonb_build_object('code',signal->>'code','resetAtUnixSeconds',reset_value,
      'resetSource',CASE WHEN reset_value='null'::jsonb THEN NULL ELSE 'account_rate_limits' END));
END $$;
REVOKE ALL ON FUNCTION public.valid_assistant_native_limit_receipt(jsonb,public.assistant_provider_turns) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valid_assistant_native_limit_receipt(jsonb,public.assistant_provider_turns) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_assistant_provider_turn(p_turn_id uuid,p_attempt_id uuid,p_user_id uuid,p_connection_id uuid,p_token_hash text,
  p_result jsonb,p_provider_receipt jsonb,p_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns; payload jsonb;
BEGIN
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id;
  IF job.provider='api_connection' THEN
    IF p_connection_id IS NOT NULL OR p_token_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Ambiguous API caller' USING ERRCODE='42501';
    END IF;
    job:=public.lock_assistant_api_turn(p_turn_id,p_user_id);
  ELSE
    IF p_connection_id IS NOT NULL THEN
      IF p_user_id IS NOT NULL THEN RAISE EXCEPTION 'Ambiguous provider caller' USING ERRCODE='42501'; END IF;
      connection:=public.lock_assistant_provider_connection(p_connection_id,p_token_hash);
    END IF;
    SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR job.attempt_id IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RAISE EXCEPTION 'Provider attempt does not match' USING ERRCODE='42501';
  END IF;
  IF p_connection_id IS NOT NULL THEN
    IF job.connection_id IS DISTINCT FROM connection.id OR job.user_id IS DISTINCT FROM connection.user_id
      OR job.workspace_id IS DISTINCT FROM connection.workspace_id OR job.project_id IS DISTINCT FROM connection.project_id THEN
      RAISE EXCEPTION 'Provider attempt does not match' USING ERRCODE='42501';
    END IF;
  ELSE
    IF p_user_id IS NULL OR job.user_id IS DISTINCT FROM p_user_id OR job.provider NOT IN ('anthropic','api_connection') THEN
      RAISE EXCEPTION 'Provider attempt does not match' USING ERRCODE='42501';
    END IF;
    IF job.provider<>'api_connection' THEN PERFORM public.assert_assistant_provider_scope(job.user_id,job.workspace_id,job.project_id); END IF;
  END IF;
  IF job.provider='api_connection' AND job.state IN ('cancelled','interrupted') THEN RETURN to_jsonb(job)-'request_hash'; END IF;
  IF job.state IN ('succeeded','failed') THEN
    IF job.result IS DISTINCT FROM p_result OR job.provider_receipt IS DISTINCT FROM p_provider_receipt OR job.failure_code IS DISTINCT FROM p_failure_code THEN
      RAISE EXCEPTION 'The retained provider result differs from this retry' USING ERRCODE='PT409';
    END IF;
    RETURN to_jsonb(job)-'request_hash';
  END IF;
  IF job.state<>'running' THEN RAISE EXCEPTION 'Provider attempt is no longer running' USING ERRCODE='PT409'; END IF;
  IF job.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='provider_attempt_expired' WHERE id=job.id RETURNING * INTO job;
    RETURN to_jsonb(job)-'request_hash';
  END IF;
  IF p_failure_code IS NOT NULL THEN
    IF p_failure_code !~ '^[a-z_]{1,120}$' OR p_result IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid provider failure' USING ERRCODE='22023';
    END IF;
    IF p_provider_receipt IS NOT NULL AND (p_failure_code<>'native_usage_limit' OR p_connection_id IS NULL
      OR NOT public.valid_assistant_native_limit_receipt(p_provider_receipt,job)) THEN
      RAISE EXCEPTION 'Invalid native usage limit receipt' USING ERRCODE='22023';
    END IF;
    UPDATE public.assistant_provider_turns SET state='failed',failure_code=p_failure_code,provider_receipt=p_provider_receipt,
      finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
    RETURN to_jsonb(job)-'request_hash';
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR jsonb_typeof(p_result->'answer') IS DISTINCT FROM 'string'
    OR length(trim(p_result->>'answer')) NOT BETWEEN 1 AND 12000 OR octet_length(p_result::text)>80000
    OR jsonb_typeof(p_result->'citations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'citations')<>1
    OR p_result->'citations'->0 IS DISTINCT FROM job.packet->'source'
    OR NOT (p_result ? 'proposal') OR (p_result->'proposal'<>'null'::jsonb AND jsonb_typeof(p_result->'proposal')<>'object') THEN
    RAISE EXCEPTION 'Invalid provider result' USING ERRCODE='22023';
  END IF;
  IF p_result->'proposal'<>'null'::jsonb THEN
    payload:=p_result->'proposal'->'payload';
    IF p_result->'proposal'->>'status' IS DISTINCT FROM 'proposed' OR p_result->'proposal'->>'kind' IS DISTINCT FROM 'create_project_record'
      OR payload->>'kind' IS DISTINCT FROM 'create_project_record' OR payload->>'recordType' IS DISTINCT FROM 'submittal'
      OR payload->>'projectId' IS DISTINCT FROM job.project_id::text OR coalesce(payload->>'status','draft')<>'draft'
      OR jsonb_typeof(payload->'title') IS DISTINCT FROM 'string' OR length(trim(payload->>'title')) NOT BETWEEN 1 AND 160
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) key WHERE key NOT IN ('kind','projectId','recordType','title','submittalType','status','notes')) THEN
      RAISE EXCEPTION 'Provider proposal is outside this project task' USING ERRCODE='22023';
    END IF;
  END IF;
  IF jsonb_typeof(p_provider_receipt) IS DISTINCT FROM 'object' OR p_provider_receipt->>'schemaVersion' IS DISTINCT FROM '1'
    OR p_provider_receipt->>'provider' IS DISTINCT FROM job.provider OR p_provider_receipt->>'model' IS DISTINCT FROM job.model_id
    OR p_provider_receipt->>'authMode' IS DISTINCT FROM job.auth_mode OR octet_length(p_provider_receipt::text)>8000 THEN
    RAISE EXCEPTION 'Provider receipt identity differs from this request' USING ERRCODE='22023';
  END IF;
  IF job.provider='api_connection' AND (
    p_provider_receipt->>'turnId' IS DISTINCT FROM job.id::text OR p_provider_receipt->>'attemptId' IS DISTINCT FROM job.attempt_id::text OR
    p_provider_receipt->>'connectionId' IS DISTINCT FROM job.api_connection_id::text OR p_provider_receipt->>'revisionId' IS DISTINCT FROM job.api_revision_id::text OR
    p_provider_receipt->>'configurationHash' IS DISTINCT FROM job.api_configuration_hash OR p_provider_receipt->>'packetHash' IS DISTINCT FROM job.packet_hash OR
    p_provider_receipt->>'endpoint' IS DISTINCT FROM job.api_configuration_canonical::jsonb->>'endpoint' OR
    p_provider_receipt->>'protocol' IS DISTINCT FROM job.api_configuration_canonical::jsonb->>'protocol') THEN
    RAISE EXCEPTION 'API receipt differs from the saved attempt' USING ERRCODE='22023';
  END IF;
  UPDATE public.assistant_provider_turns SET state='succeeded',result=p_result,provider_receipt=p_provider_receipt,finished_at=clock_timestamp()
    WHERE id=job.id RETURNING * INTO job;
  RETURN to_jsonb(job)-'request_hash';
END $$;
REVOKE ALL ON FUNCTION public.finish_assistant_provider_turn(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_assistant_provider_turn(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) TO service_role;
