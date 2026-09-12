-- Saved API attempts extend the existing private turn history. Configuration
-- edits interrupt active attempts; no retry silently selects a newer revision.
BEGIN;

ALTER TABLE public.workspace_provider_api_revisions ADD CONSTRAINT workspace_provider_api_revision_hash_identity
  UNIQUE(id,connection_id,workspace_id,configuration_hash);
ALTER TABLE public.assistant_provider_turns
  ADD COLUMN api_connection_id uuid,
  ADD COLUMN api_revision_id uuid,
  ADD COLUMN api_configuration_canonical text,
  ADD COLUMN api_configuration_hash text,
  ADD COLUMN api_charge_ack boolean,
  DROP CONSTRAINT assistant_provider_turns_provider_check,
  DROP CONSTRAINT assistant_provider_turns_auth_mode_check,
  DROP CONSTRAINT assistant_provider_turns_check,
  ADD CONSTRAINT assistant_provider_turns_provider_check CHECK(provider IN ('codex','claude','opencode','anthropic','api_connection')),
  ADD CONSTRAINT assistant_provider_turns_auth_mode_check CHECK(auth_mode IN
    ('chatgpt','apiKey','claude_subscription','opencode_api','workspace_api_key','deployment_api_key','connection_api_key','connection_no_key')),
  ADD CONSTRAINT assistant_provider_turns_check CHECK(
    (provider='codex' AND connection_id IS NOT NULL AND auth_mode IN ('chatgpt','apiKey')) OR
    (provider='claude' AND connection_id IS NOT NULL AND auth_mode='claude_subscription') OR
    (provider='opencode' AND connection_id IS NOT NULL AND auth_mode='opencode_api') OR
    (provider='anthropic' AND connection_id IS NULL AND auth_mode IN ('workspace_api_key','deployment_api_key')) OR
    (provider='api_connection' AND connection_id IS NULL AND auth_mode IN ('connection_api_key','connection_no_key'))),
  ADD CONSTRAINT assistant_api_revision_identity FOREIGN KEY(api_revision_id,api_connection_id,workspace_id,api_configuration_hash)
    REFERENCES public.workspace_provider_api_revisions(id,connection_id,workspace_id,configuration_hash),
  ADD CONSTRAINT assistant_api_snapshot CHECK(
    (provider<>'api_connection' AND api_connection_id IS NULL AND api_revision_id IS NULL AND api_configuration_canonical IS NULL
      AND api_configuration_hash IS NULL AND api_charge_ack IS NULL) OR
    ((provider='api_connection' AND api_connection_id IS NOT NULL AND api_revision_id IS NOT NULL
      AND api_configuration_canonical IS NOT NULL AND octet_length(api_configuration_canonical)<=32000
      AND api_configuration_hash IS NOT NULL AND api_configuration_hash ~ '^[a-f0-9]{64}$' AND api_charge_ack IS TRUE
      AND api_configuration_hash=encode(extensions.digest(convert_to(api_configuration_canonical,'UTF8'),'sha256'),'hex')
      AND public.valid_workspace_provider_api_configuration(api_configuration_canonical::jsonb)
      AND (api_configuration_canonical::jsonb->'modelIds') ? model_id
      AND auth_mode=CASE api_configuration_canonical::jsonb->>'authMode' WHEN 'api_key' THEN 'connection_api_key' ELSE 'connection_no_key' END) IS TRUE));
CREATE INDEX assistant_api_queue ON public.assistant_provider_turns(created_at,id)
  WHERE provider='api_connection' AND state IN ('queued','running');
CREATE INDEX assistant_api_active_connection ON public.assistant_provider_turns(api_connection_id,api_revision_id)
  WHERE provider='api_connection' AND state IN ('queued','running');

CREATE FUNCTION public.preserve_assistant_api_turn_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF (OLD.provider='api_connection' OR NEW.provider='api_connection') AND
    ROW(OLD.id,OLD.request_id,OLD.user_id,OLD.workspace_id,OLD.project_id,OLD.connection_id,OLD.provider,OLD.model_id,OLD.auth_mode,
      OLD.question,OLD.packet,OLD.packet_canonical,OLD.packet_hash,OLD.request_hash,OLD.created_at,
      OLD.api_connection_id,OLD.api_revision_id,OLD.api_configuration_canonical,OLD.api_configuration_hash,OLD.api_charge_ack)
    IS DISTINCT FROM
    ROW(NEW.id,NEW.request_id,NEW.user_id,NEW.workspace_id,NEW.project_id,NEW.connection_id,NEW.provider,NEW.model_id,NEW.auth_mode,
      NEW.question,NEW.packet,NEW.packet_canonical,NEW.packet_hash,NEW.request_hash,NEW.created_at,
      NEW.api_connection_id,NEW.api_revision_id,NEW.api_configuration_canonical,NEW.api_configuration_hash,NEW.api_charge_ack) THEN
    RAISE EXCEPTION 'Saved API attempt identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_assistant_api_turn_identity BEFORE UPDATE ON public.assistant_provider_turns
  FOR EACH ROW EXECUTE FUNCTION public.preserve_assistant_api_turn_identity();
REVOKE ALL ON FUNCTION public.preserve_assistant_api_turn_identity() FROM PUBLIC,anon,authenticated,service_role;

-- Management RPCs already hold manager membership and the connection row.
-- Their exact save retries return before UPDATE; an unchanged revoke is a no-op.
CREATE FUNCTION public.interrupt_changed_assistant_api_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.current_revision_id IS DISTINCT FROM NEW.current_revision_id OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='api_connection_changed'
      WHERE api_connection_id=NEW.id AND provider='api_connection' AND state IN ('queued','running')
        AND (NEW.revoked_at IS NOT NULL OR api_revision_id IS DISTINCT FROM NEW.current_revision_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER interrupt_changed_assistant_api_connection AFTER UPDATE ON public.workspace_provider_api_connections
  FOR EACH ROW EXECUTE FUNCTION public.interrupt_changed_assistant_api_connection();
REVOKE ALL ON FUNCTION public.interrupt_changed_assistant_api_connection() FROM PUBLIC,anon,authenticated,service_role;

-- Read identity without a lock, then lock membership -> project -> connection
-- -> turn. History remains readable after an edit/revoke, subject to user scope.
CREATE FUNCTION public.lock_assistant_api_turn(p_turn_id uuid,p_user_id uuid)
RETURNS public.assistant_provider_turns LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE identity public.assistant_provider_turns; job public.assistant_provider_turns; connection public.workspace_provider_api_connections;
BEGIN
  SELECT * INTO identity FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id AND provider='api_connection';
  IF NOT FOUND THEN RAISE EXCEPTION 'API attempt denied' USING ERRCODE='42501'; END IF;
  PERFORM public.assert_assistant_provider_scope(identity.user_id,identity.workspace_id,identity.project_id);
  SELECT * INTO connection FROM public.workspace_provider_api_connections WHERE id=identity.api_connection_id AND workspace_id=identity.workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'API connection denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=identity.id AND user_id=p_user_id AND provider='api_connection' FOR UPDATE;
  IF NOT FOUND OR job.api_connection_id IS DISTINCT FROM connection.id OR job.workspace_id IS DISTINCT FROM connection.workspace_id THEN
    RAISE EXCEPTION 'API attempt denied' USING ERRCODE='42501';
  END IF;
  IF job.state IN ('queued','running') AND (connection.revoked_at IS NOT NULL OR connection.current_revision_id IS DISTINCT FROM job.api_revision_id) THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='api_connection_changed'
      WHERE id=job.id RETURNING * INTO job;
  ELSIF job.state='running' AND job.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='api_attempt_expired'
      WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN job;
END $$;
REVOKE ALL ON FUNCTION public.lock_assistant_api_turn(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_assistant_api_turn(p_request_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_connection_id uuid,p_revision_id uuid,p_configuration_hash text,p_model_id text,p_auth_mode text,p_charge_ack boolean,p_question text,p_packet_canonical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.workspace_provider_api_connections; revision public.workspace_provider_api_revisions;
  job public.assistant_provider_turns; request_digest text; created boolean;
BEGIN
  PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);
  IF p_charge_ack IS DISTINCT FROM true THEN RAISE EXCEPTION 'API dispatch acknowledgement required' USING ERRCODE='22023'; END IF;
  SELECT * INTO connection FROM public.workspace_provider_api_connections WHERE id=p_connection_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'API connection denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO revision FROM public.workspace_provider_api_revisions
    WHERE id=p_revision_id AND connection_id=connection.id AND workspace_id=p_workspace_id;
  IF NOT FOUND OR revision.configuration_hash IS DISTINCT FROM p_configuration_hash OR p_model_id IS NULL OR
    NOT ((revision.configuration->'modelIds') ? p_model_id) OR p_auth_mode IS DISTINCT FROM
      (CASE revision.configuration->>'authMode' WHEN 'api_key' THEN 'connection_api_key' ELSE 'connection_no_key' END) THEN
    RAISE EXCEPTION 'API selection differs from the saved revision' USING ERRCODE='22023';
  END IF;
  request_digest:=encode(extensions.digest(convert_to(jsonb_build_object('userId',p_user_id,'workspaceId',p_workspace_id,'projectId',p_project_id,
    'provider','api_connection','connectionId',p_connection_id,'revisionId',p_revision_id,'configurationHash',p_configuration_hash,
    'modelId',p_model_id,'authMode',p_auth_mode,'chargeAck',p_charge_ack,'question',p_question)::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO job FROM public.assistant_provider_turns WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF job.request_hash IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'API retry differs' USING ERRCODE='PT409'; END IF;
    RETURN jsonb_build_object('created',false,'turn',to_jsonb(job)-'request_hash');
  END IF;
  IF connection.revoked_at IS NOT NULL OR connection.current_revision_id IS DISTINCT FROM revision.id THEN
    RAISE EXCEPTION 'API connection changed before dispatch' USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.assistant_provider_turns(request_id,user_id,workspace_id,project_id,connection_id,provider,model_id,auth_mode,question,
    packet,packet_canonical,packet_hash,request_hash,api_connection_id,api_revision_id,api_configuration_canonical,api_configuration_hash,api_charge_ack)
    VALUES(p_request_id,p_user_id,p_workspace_id,p_project_id,NULL,'api_connection',p_model_id,p_auth_mode,p_question,
      p_packet_canonical::jsonb,p_packet_canonical,encode(extensions.digest(convert_to(p_packet_canonical,'UTF8'),'sha256'),'hex'),request_digest,
      connection.id,revision.id,revision.configuration_canonical,revision.configuration_hash,true)
    ON CONFLICT(user_id,request_id) DO NOTHING RETURNING * INTO job;
  created:=FOUND;
  IF NOT created THEN
    SELECT * INTO job FROM public.assistant_provider_turns WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
    IF job.request_hash IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'API retry differs' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN jsonb_build_object('created',created,'turn',to_jsonb(job)-'request_hash');
END $$;
REVOKE ALL ON FUNCTION public.create_assistant_api_turn(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_assistant_api_turn(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,text,text) TO service_role;

-- A candidate is deliberately not locked until its scope and connection are.
-- Concurrent claimants recheck state after that lock order; an attempt is never
-- requeued. The existing ledger records conservative reservations, not charges.
CREATE FUNCTION public.claim_assistant_api_turn()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate public.assistant_provider_turns; job public.assistant_provider_turns; recent_count bigint;
BEGIN
  SELECT * INTO candidate FROM public.assistant_provider_turns WHERE provider='api_connection'
    AND (state='queued' OR (state='running' AND lease_expires_at<=clock_timestamp())) ORDER BY created_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  BEGIN
    job:=public.lock_assistant_api_turn(candidate.id,candidate.user_id);
  EXCEPTION WHEN insufficient_privilege THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='api_access_lost'
      WHERE id=candidate.id AND provider='api_connection' AND state IN ('queued','running');
    RETURN NULL;
  END;
  IF job.state<>'queued' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('assistant_api_dispatch:'||job.workspace_id::text,0));
  SELECT count(*) INTO recent_count FROM public.usage_events WHERE workspace_id=job.workspace_id
    AND bucket_key IN ('assistant_chat','grant_narrative_draft','engagement_synthesis','engagement_moderation','document_narrative_draft','rtp_document_extraction')
    AND occurred_at>=clock_timestamp()-interval '300 seconds';
  IF recent_count>=20 THEN
    UPDATE public.assistant_provider_turns SET state='failed',finished_at=clock_timestamp(),failure_code='api_rate_limited' WHERE id=job.id;
    RETURN NULL;
  END IF;
  UPDATE public.assistant_provider_turns SET state='running',attempt_id=gen_random_uuid(),started_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>(job.api_configuration_canonical::jsonb->>'timeoutSeconds')::int+60)
    WHERE id=job.id RETURNING * INTO job;
  INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,source_route,metadata_json)
    VALUES(job.workspace_id,job.id::text,'assistant_chat',1,'assistant_api_dispatch:'||job.id::text,
      '/api/assistant/providers/turns',jsonb_build_object('provider','api_connection','dispatchReservation',true));
  RETURN to_jsonb(job)-'request_hash';
END $$;
REVOKE ALL ON FUNCTION public.claim_assistant_api_turn() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assistant_api_turn() TO service_role;

-- Only the service worker can obtain this minimal status after losing scope.
-- It can retire its private journal without disclosing a retained answer.
CREATE FUNCTION public.read_assistant_api_turn_status(p_turn_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE identity public.assistant_provider_turns; job public.assistant_provider_turns;
BEGIN
  SELECT * INTO identity FROM public.assistant_provider_turns WHERE id=p_turn_id AND provider='api_connection';
  IF NOT FOUND OR p_attempt_id IS NULL OR identity.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RAISE EXCEPTION 'API attempt denied' USING ERRCODE='42501';
  END IF;
  BEGIN
    job:=public.lock_assistant_api_turn(identity.id,identity.user_id);
  EXCEPTION WHEN insufficient_privilege THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='api_access_lost'
      WHERE id=identity.id AND state IN ('queued','running');
    RETURN jsonb_build_object('id',identity.id,'state','access_lost','attemptId',p_attempt_id,'leaseExpiresAt',NULL);
  END;
  RETURN jsonb_build_object('id',job.id,'state',job.state,'attemptId',job.attempt_id,'leaseExpiresAt',job.lease_expires_at);
END $$;
REVOKE ALL ON FUNCTION public.read_assistant_api_turn_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_assistant_api_turn_status(uuid,uuid) TO service_role;

-- Common finish and browser recovery functions follow below.

CREATE OR REPLACE FUNCTION public.finish_assistant_provider_turn(p_turn_id uuid,p_attempt_id uuid,p_user_id uuid,p_connection_id uuid,p_token_hash text,
  p_result jsonb,p_provider_receipt jsonb,p_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
    IF p_failure_code !~ '^[a-z_]{1,120}$' OR p_result IS NOT NULL OR p_provider_receipt IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid provider failure' USING ERRCODE='22023';
    END IF;
    UPDATE public.assistant_provider_turns SET state='failed',failure_code=p_failure_code,finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
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


CREATE OR REPLACE FUNCTION public.cancel_assistant_provider_turn(p_turn_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.assistant_provider_turns;
BEGIN
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
  IF job.provider='api_connection' THEN
    job:=public.lock_assistant_api_turn(p_turn_id,p_user_id);
  ELSE
    SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
    PERFORM public.assert_assistant_provider_scope(job.user_id,job.workspace_id,job.project_id);
  END IF;
  UPDATE public.assistant_provider_turns SET state='cancelled',finished_at=clock_timestamp(),failure_code='cancelled_by_user'
    WHERE id=job.id AND state IN ('queued','running');
END $$;
REVOKE ALL ON FUNCTION public.cancel_assistant_provider_turn(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_assistant_provider_turn(uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.read_assistant_provider_turn_for_user(p_turn_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.assistant_provider_turns;
BEGIN
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
  IF job.provider='api_connection' THEN
    job:=public.lock_assistant_api_turn(p_turn_id,p_user_id);
  ELSE
    SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
    PERFORM public.assert_assistant_provider_scope(job.user_id,job.workspace_id,job.project_id);
  END IF;
  IF job.state='running' AND job.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='provider_attempt_expired' WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN to_jsonb(job)-'request_hash';
END $$;
REVOKE ALL ON FUNCTION public.read_assistant_provider_turn_for_user(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_assistant_provider_turn_for_user(uuid,uuid) TO service_role;


COMMIT;
