-- Context tasks change with the exact preceding response. Keep that original
-- task text separate from static frame references and pin the predecessor's
-- original capture and selection. Native seals and proposed task hashes do not
-- replace the worker's independent reconstruction of original context inputs.
CREATE TABLE public.engagement_synthesis_context_attempt_inputs (
 attempt_id uuid PRIMARY KEY REFERENCES public.engagement_synthesis_generation_attempts(id),
 task_text text NOT NULL CHECK(task_text IS JSON OBJECT AND octet_length(task_text)<=1048576),
 task_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(task_text,'sha256'),'hex')) STORED,
 task_bytes integer GENERATED ALWAYS AS (octet_length(task_text)) STORED,
 predecessor_attempt_id uuid REFERENCES public.engagement_synthesis_generation_attempts(id),
 predecessor_selection_id uuid REFERENCES public.engagement_synthesis_generation_selections(id),
 predecessor_capture_sha256 text CHECK(predecessor_capture_sha256 ~ '^[a-f0-9]{64}$'),
 previous_result_sha256 text CHECK(previous_result_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((predecessor_attempt_id IS NULL AND predecessor_selection_id IS NULL AND predecessor_capture_sha256 IS NULL AND previous_result_sha256 IS NULL)
  OR (predecessor_attempt_id IS NOT NULL AND predecessor_selection_id IS NOT NULL AND predecessor_capture_sha256 IS NOT NULL AND previous_result_sha256 IS NOT NULL))
);
ALTER TABLE public.engagement_synthesis_context_attempt_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_context_attempt_inputs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_context_attempt_inputs TO service_role;
CREATE TRIGGER synthesis_context_attempt_input_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_context_attempt_inputs
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.assert_synthesis_context_execution_current(p_request uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; intent jsonb;
 connection public.workspace_provider_api_connections; revision public.workspace_provider_api_revisions;
 credential public.workspace_provider_api_credentials;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request); intent:=request.intent_text::jsonb;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request)
 OR NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plans WHERE request_id=p_request AND (header_text::jsonb->>'frameCount')::bigint>0) THEN
  RAISE EXCEPTION 'A sealed nonempty synthesis plan is required' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO connection FROM workspace_provider_api_connections WHERE id=(intent->>'connectionId')::uuid AND workspace_id=request.workspace_id FOR SHARE NOWAIT;
 IF NOT FOUND OR connection.revoked_at IS NOT NULL OR connection.current_revision_id IS DISTINCT FROM request.configuration_revision_id THEN
  RAISE EXCEPTION 'Selected synthesis API connection changed' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO revision FROM workspace_provider_api_revisions WHERE id=request.configuration_revision_id AND connection_id=connection.id AND workspace_id=request.workspace_id FOR SHARE NOWAIT;
 IF NOT FOUND OR revision.configuration_hash IS DISTINCT FROM intent->>'configurationHash' OR NOT (revision.configuration->'modelIds' ? (intent->>'modelId')) THEN
  RAISE EXCEPTION 'Selected synthesis API revision differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO credential FROM workspace_provider_api_credentials WHERE revision_id=revision.id AND connection_id=connection.id AND workspace_id=request.workspace_id FOR SHARE NOWAIT;
 IF NOT FOUND OR (revision.configuration->>'authMode'='api_key' AND credential.credential_ciphertext IS NULL)
 OR (revision.configuration->>'authMode'='none' AND credential.credential_ciphertext IS NOT NULL) THEN
  RAISE EXCEPTION 'Selected synthesis API credential unavailable' USING ERRCODE='PT409';
 END IF;
 RETURN encode(extensions.digest(credential.credential_ciphertext,'sha256'),'hex');
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Synthesis execution is busy; retry the same command' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.assert_synthesis_context_execution_current(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Check every selected ancestor, not only the immediately preceding frame.
-- The caller holds this request's advisory fence throughout claim/dispatch.
CREATE FUNCTION public.assert_synthesis_context_predecessors_current(p_attempt uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_attempt public.engagement_synthesis_generation_attempts;
 prior_attempt public.engagement_synthesis_generation_attempts;
 input public.engagement_synthesis_context_attempt_inputs;
 selection public.engagement_synthesis_generation_selections;
 original public.engagement_synthesis_generation_outputs;
BEGIN
 SELECT * INTO current_attempt FROM engagement_synthesis_generation_attempts WHERE id=p_attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Context attempt unavailable' USING ERRCODE='42501'; END IF;
 -- Follow the original selected chain through frame zero.
 LOOP
  SELECT * INTO input FROM engagement_synthesis_context_attempt_inputs WHERE attempt_id=current_attempt.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retained context task required' USING ERRCODE='0A000'; END IF;
  IF current_attempt.task_index=0 THEN
   IF input.predecessor_attempt_id IS NOT NULL THEN RAISE EXCEPTION 'First context frame has a predecessor' USING ERRCODE='PT409'; END IF;
   RETURN;
  END IF;
  SELECT * INTO prior_attempt FROM engagement_synthesis_generation_attempts WHERE id=input.predecessor_attempt_id
   AND request_id=current_attempt.request_id AND task_index=current_attempt.task_index-1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Context predecessor frame differs' USING ERRCODE='PT409'; END IF;
  SELECT * INTO selection FROM engagement_synthesis_generation_selections s WHERE s.request_id=current_attempt.request_id AND s.task_index=prior_attempt.task_index
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections n WHERE n.previous_selection_id=s.id);
  SELECT * INTO original FROM engagement_synthesis_generation_outputs WHERE attempt_id=prior_attempt.id;
  IF selection.id IS DISTINCT FROM input.predecessor_selection_id OR selection.attempt_id IS DISTINCT FROM prior_attempt.id
   OR original.attempt_id IS NULL OR original.capture_sha256 IS DISTINCT FROM input.predecessor_capture_sha256 THEN
   RAISE EXCEPTION 'Context predecessor selection or original changed' USING ERRCODE='PT409';
  END IF;
  current_attempt:=prior_attempt;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.assert_synthesis_context_predecessors_current(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Initial grants cover unattempted frames. A retry names one exact prior
-- attempt and permits one successor; neither implies a vendor price ceiling.
CREATE FUNCTION public.authorize_engagement_synthesis_context(p_request uuid,p_authorization uuid,p_intent_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; saved public.engagement_synthesis_generation_authorizations;
 intent jsonb; plan public.engagement_synthesis_generation_plans; previous public.engagement_synthesis_generation_attempts;
 credential_hash text; expiry timestamptz; key text;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request);
 IF auth.uid() IS DISTINCT FROM request.actor_id THEN RAISE EXCEPTION 'Original synthesis requester required' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM engagement_synthesis_generation_authorizations WHERE id=p_authorization;
 IF FOUND THEN
  IF saved.request_id IS DISTINCT FROM p_request OR saved.intent_text IS DISTINCT FROM p_intent_text THEN
   RAISE EXCEPTION 'Synthesis authorization retry differs' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF p_authorization IS NULL OR p_intent_text IS NULL OR octet_length(p_intent_text)>4096 OR p_intent_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
   RAISE EXCEPTION 'Invalid synthesis authorization' USING ERRCODE='22023';
  END IF;
  intent:=p_intent_text::jsonb;
  IF NOT intent ?& ARRAY['schemaVersion','headerSha256','maxAttempts','maxOutputTokens','responseByteLimit','expiresAt','chargesAcknowledged','retryTaskIndex','retryOfAttemptId']
  OR (SELECT count(*) FROM jsonb_object_keys(intent))<>9 OR intent->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR intent->'chargesAcknowledged' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(intent->'headerSha256') IS DISTINCT FROM 'string' OR intent->>'headerSha256' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(intent->'expiresAt') IS DISTINCT FROM 'string'
  OR intent->>'expiresAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
   RAISE EXCEPTION 'Invalid synthesis authorization' USING ERRCODE='22023';
  END IF;
  FOREACH key IN ARRAY ARRAY['maxAttempts','maxOutputTokens','responseByteLimit'] LOOP
   IF jsonb_typeof(intent->key) IS DISTINCT FROM 'number' OR (intent->>key)::numeric NOT BETWEEN 1 AND 9007199254740991
   OR (intent->>key)::numeric<>trunc((intent->>key)::numeric) THEN RAISE EXCEPTION 'Invalid synthesis resource limit' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (intent->>'maxOutputTokens')::bigint>65536 OR (intent->>'responseByteLimit')::bigint NOT BETWEEN 4096 AND 4194304 THEN
   RAISE EXCEPTION 'Invalid synthesis transport limit' USING ERRCODE='22023';
  END IF;
  expiry:=(intent->>'expiresAt')::timestamptz;
  IF NOT isfinite(expiry) OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Synthesis authorization expired' USING ERRCODE='PT409'; END IF;
  credential_hash:=assert_synthesis_context_execution_current(p_request);
  SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
  IF intent->>'headerSha256' IS DISTINCT FROM plan.header_sha256 THEN RAISE EXCEPTION 'Synthesis authorization plan differs' USING ERRCODE='PT409'; END IF;
  IF intent->'retryTaskIndex'='null'::jsonb AND intent->'retryOfAttemptId'='null'::jsonb THEN
   IF (intent->>'maxAttempts')::bigint>(plan.header_text::jsonb->>'frameCount')::bigint THEN RAISE EXCEPTION 'Synthesis allowance exceeds initial inventory' USING ERRCODE='22023'; END IF;
  ELSE
   IF jsonb_typeof(intent->'retryTaskIndex') IS DISTINCT FROM 'number' OR (intent->>'retryTaskIndex')::numeric NOT BETWEEN 0 AND 9007199254740991
   OR (intent->>'retryTaskIndex')::numeric<>trunc((intent->>'retryTaskIndex')::numeric)
   OR jsonb_typeof(intent->'retryOfAttemptId') IS DISTINCT FROM 'string' OR (intent->>'maxAttempts')::bigint<>1 THEN
    RAISE EXCEPTION 'Invalid synthesis retry authorization' USING ERRCODE='22023';
   END IF;
   SELECT * INTO previous FROM engagement_synthesis_generation_attempts WHERE id=(intent->>'retryOfAttemptId')::uuid;
   IF NOT FOUND OR previous.request_id IS DISTINCT FROM p_request OR previous.task_index IS DISTINCT FROM (intent->>'retryTaskIndex')::bigint
   OR EXISTS(SELECT 1 FROM engagement_synthesis_generation_attempts WHERE previous_attempt_id=previous.id) THEN
    RAISE EXCEPTION 'Synthesis retry predecessor differs' USING ERRCODE='PT409';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_outputs WHERE attempt_id=previous.id)
   AND greatest(previous.claim_expires_at,coalesce((SELECT expires_at FROM engagement_synthesis_generation_dispatches WHERE attempt_id=previous.id),previous.claim_expires_at))>clock_timestamp() THEN
    RAISE EXCEPTION 'Prior synthesis attempt is still active' USING ERRCODE='PT409';
   END IF;
  END IF;
  INSERT INTO engagement_synthesis_generation_authorizations(id,request_id,intent_text,credential_sha256)
   VALUES(p_authorization,p_request,p_intent_text,credential_hash) RETURNING * INTO saved;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'id',saved.id,'requestId',saved.request_id,'intentText',saved.intent_text,'intentSha256',saved.intent_sha256);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid synthesis authorization' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.authorize_engagement_synthesis_context(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authorize_engagement_synthesis_context(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.claim_engagement_synthesis_context_attempt(p_authorization uuid,p_task_index bigint,p_attempt uuid,p_worker uuid,
 p_task_text text,p_predecessor_attempt uuid,p_predecessor_selection uuid,p_predecessor_capture_sha256 text,p_previous_result_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_row public.engagement_synthesis_generation_authorizations; attempt public.engagement_synthesis_generation_attempts;
 request public.engagement_synthesis_generation_requests; saved public.engagement_synthesis_context_attempt_inputs;
 intent jsonb; binding text; credential_hash text; expiry timestamptz; previous uuid; selection_id uuid; sequence bigint;
BEGIN
 SELECT * INTO grant_row FROM engagement_synthesis_generation_authorizations WHERE id=p_authorization;
 IF NOT FOUND THEN RAISE EXCEPTION 'Context authorization unavailable' USING ERRCODE='42501'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||grant_row.request_id::text,0)) THEN
  RAISE EXCEPTION 'Context execution is busy; retry the same claim' USING ERRCODE='PT503';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=grant_row.request_id) THEN
  RAISE EXCEPTION 'A retained context request is required' USING ERRCODE='0A000';
 END IF;
 SELECT * INTO attempt FROM engagement_synthesis_generation_attempts WHERE id=p_attempt;
 IF FOUND THEN
  SELECT * INTO saved FROM engagement_synthesis_context_attempt_inputs WHERE attempt_id=p_attempt;
  IF attempt.authorization_id IS DISTINCT FROM p_authorization OR attempt.task_index IS DISTINCT FROM p_task_index OR attempt.worker_id IS DISTINCT FROM p_worker
   OR saved.attempt_id IS NULL OR saved.task_text IS DISTINCT FROM p_task_text
   OR saved.predecessor_attempt_id IS DISTINCT FROM p_predecessor_attempt OR saved.predecessor_selection_id IS DISTINCT FROM p_predecessor_selection
   OR saved.predecessor_capture_sha256 IS DISTINCT FROM p_predecessor_capture_sha256 OR saved.previous_result_sha256 IS DISTINCT FROM p_previous_result_sha256 THEN
   RAISE EXCEPTION 'Context claim retry differs' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF p_attempt IS NULL OR p_worker IS NULL OR p_task_index IS NULL OR p_task_index NOT BETWEEN 0 AND 9007199254740991
   OR p_task_text IS NULL OR p_task_text IS NOT JSON OBJECT THEN RAISE EXCEPTION 'Invalid context claim' USING ERRCODE='22023'; END IF;
  IF (p_task_index=0 AND (p_predecessor_attempt IS NOT NULL OR p_predecessor_selection IS NOT NULL OR p_predecessor_capture_sha256 IS NOT NULL OR p_previous_result_sha256 IS NOT NULL))
   OR (p_task_index>0 AND (p_predecessor_attempt IS NULL OR p_predecessor_selection IS NULL OR p_predecessor_capture_sha256 IS NULL OR p_previous_result_sha256 IS NULL
    OR p_predecessor_capture_sha256 !~ '^[a-f0-9]{64}$' OR p_previous_result_sha256 !~ '^[a-f0-9]{64}$')) THEN
   RAISE EXCEPTION 'Invalid context predecessor identity' USING ERRCODE='22023';
  END IF;
  credential_hash:=assert_synthesis_context_execution_current(grant_row.request_id);
  IF credential_hash IS DISTINCT FROM grant_row.credential_sha256 THEN RAISE EXCEPTION 'Context credential changed' USING ERRCODE='PT409'; END IF;
  intent:=grant_row.intent_text::jsonb; expiry:=(intent->>'expiresAt')::timestamptz;
  IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Context authorization expired' USING ERRCODE='PT409'; END IF;
  IF (SELECT count(*) FROM engagement_synthesis_generation_attempts WHERE authorization_id=p_authorization)>=(intent->>'maxAttempts')::bigint THEN
   RAISE EXCEPTION 'Context attempt allowance exhausted' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id=grant_row.request_id;
  IF octet_length(p_task_text)>(request.intent_text::jsonb->>'taskByteLimit')::integer THEN
   RAISE EXCEPTION 'Context task exceeds requested byte limit' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_context_frames WHERE request_id=request.id AND frame_index=p_task_index) THEN
   RAISE EXCEPTION 'Context frame is outside the sealed plan' USING ERRCODE='PT409';
  END IF;
  previous:=(intent->>'retryOfAttemptId')::uuid;
  IF previous IS NULL THEN
   IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_attempts WHERE request_id=grant_row.request_id AND task_index=p_task_index) THEN
    RAISE EXCEPTION 'Context frame needs an explicit retry authorization' USING ERRCODE='PT409';
   END IF;
  ELSIF p_task_index IS DISTINCT FROM (intent->>'retryTaskIndex')::bigint OR EXISTS(SELECT 1 FROM engagement_synthesis_generation_attempts WHERE previous_attempt_id=previous) THEN
   RAISE EXCEPTION 'Context retry task or predecessor differs' USING ERRCODE='PT409';
  END IF;
  binding:=jsonb_build_object('jobId',request.id,'planSha256',(SELECT header_text::jsonb->>'continuationHeaderSha256' FROM engagement_synthesis_generation_plans WHERE request_id=request.id),
   'configurationRevisionId',request.configuration_revision_id,'configurationHash',request.intent_text::jsonb->>'configurationHash',
   'provider','api_connection','modelId',request.intent_text::jsonb->>'modelId','taskSha256',encode(extensions.digest(p_task_text,'sha256'),'hex'),'attemptId',p_attempt)::text;
  INSERT INTO engagement_synthesis_generation_attempts(id,authorization_id,request_id,task_index,previous_attempt_id,worker_id,claim_expires_at,binding_text)
   VALUES(p_attempt,p_authorization,request.id,p_task_index,previous,p_worker,least(expiry,clock_timestamp()+interval '5 minutes'),binding) RETURNING * INTO attempt;
  INSERT INTO engagement_synthesis_context_attempt_inputs(attempt_id,task_text,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256)
   VALUES(p_attempt,p_task_text,p_predecessor_attempt,p_predecessor_selection,p_predecessor_capture_sha256,p_previous_result_sha256);
  PERFORM assert_synthesis_context_predecessors_current(p_attempt);
  IF previous IS NULL AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections WHERE request_id=request.id AND task_index=p_task_index) THEN
   selection_id:=gen_random_uuid();
   SELECT coalesce(max(sequence_no),0)+1 INTO sequence FROM engagement_synthesis_generation_selections WHERE request_id=request.id;
   INSERT INTO engagement_synthesis_generation_selections(id,request_id,task_index,attempt_id,previous_selection_id,sequence_no,actor_id,origin,receipt_text)
   VALUES(selection_id,request.id,p_task_index,p_attempt,NULL,sequence,request.actor_id,'authorization',
    jsonb_build_object('schemaVersion',1,'id',selection_id,'requestId',request.id,'taskIndex',p_task_index,'attemptId',p_attempt,
     'previousSelectionId',NULL,'sequence',sequence,'actorId',request.actor_id,'origin','authorization','authorizationId',p_authorization,
     'reason','Initial context attempt selected by retained resource authorization','selectedAt',clock_timestamp())::text);
  END IF;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'attemptId',attempt.id,'authorizationId',attempt.authorization_id,'taskIndex',attempt.task_index,
  'workerId',attempt.worker_id,'claimExpiresAt',attempt.claim_expires_at,'bindingText',attempt.binding_text);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid context claim' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.claim_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,text,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.dispatch_engagement_synthesis_context_attempt(p_attempt uuid,p_worker uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.engagement_synthesis_generation_attempts; grant_row public.engagement_synthesis_generation_authorizations;
 dispatch public.engagement_synthesis_generation_dispatches; intent jsonb; expiry timestamptz; credential_hash text; allowed boolean:=false; timeout_seconds integer;
BEGIN
 SELECT * INTO attempt FROM engagement_synthesis_generation_attempts WHERE id=p_attempt;
 IF NOT FOUND OR attempt.worker_id IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'Synthesis worker claim required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_context_attempt_inputs WHERE attempt_id=p_attempt) THEN RAISE EXCEPTION 'Retained context task required' USING ERRCODE='0A000'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||attempt.request_id::text,0)) THEN
  RAISE EXCEPTION 'Synthesis execution is busy; retry the same dispatch' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO dispatch FROM engagement_synthesis_generation_dispatches WHERE attempt_id=p_attempt;
 IF NOT FOUND THEN
  credential_hash:=assert_synthesis_context_execution_current(attempt.request_id);
  PERFORM assert_synthesis_context_predecessors_current(p_attempt);
  SELECT * INTO grant_row FROM engagement_synthesis_generation_authorizations WHERE id=attempt.authorization_id;
  IF credential_hash IS DISTINCT FROM grant_row.credential_sha256 THEN RAISE EXCEPTION 'Synthesis credential changed' USING ERRCODE='PT409'; END IF;
  intent:=grant_row.intent_text::jsonb; expiry:=(intent->>'expiresAt')::timestamptz;
  IF attempt.claim_expires_at<=clock_timestamp() OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Synthesis execution authorization expired' USING ERRCODE='PT409'; END IF;
  SELECT (r.configuration->>'timeoutSeconds')::integer INTO timeout_seconds FROM workspace_provider_api_revisions r JOIN engagement_synthesis_generation_requests q ON q.configuration_revision_id=r.id WHERE q.id=attempt.request_id;
  expiry:=least(expiry,clock_timestamp()+make_interval(secs=>timeout_seconds));
  INSERT INTO engagement_synthesis_generation_dispatches(attempt_id,expires_at,receipt_text) VALUES(p_attempt,expiry,
   jsonb_build_object('schemaVersion',1,'attemptId',p_attempt,'workerId',p_worker,'authorizationId',attempt.authorization_id,
    'binding',attempt.binding_text::jsonb,'maxOutputTokens',intent->'maxOutputTokens','responseByteLimit',intent->'responseByteLimit',
    'expiresAt',expiry,'authorizedAt',clock_timestamp())::text) RETURNING * INTO dispatch;
  allowed:=true;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'authorizedNow',allowed,'receiptText',dispatch.receipt_text,'receiptSha256',dispatch.receipt_sha256);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_engagement_synthesis_context_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_engagement_synthesis_context_attempt(uuid,uuid) TO service_role;

-- The existing output-retention command preserves late original captures.
-- This status read only checks current execution and never renews dispatch.

CREATE FUNCTION public.read_engagement_synthesis_context_execution_status(p_attempt uuid,p_worker uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.engagement_synthesis_generation_attempts; grant_row public.engagement_synthesis_generation_authorizations;
 dispatch public.engagement_synthesis_generation_dispatches; output_hash text; credential_hash text;
BEGIN
 SELECT * INTO attempt FROM engagement_synthesis_generation_attempts WHERE id=p_attempt;
 IF NOT FOUND OR attempt.worker_id IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'Synthesis worker claim required' USING ERRCODE='42501'; END IF;
 credential_hash:=assert_synthesis_context_execution_current(attempt.request_id);
 PERFORM assert_synthesis_context_predecessors_current(p_attempt);
 SELECT * INTO grant_row FROM engagement_synthesis_generation_authorizations WHERE id=attempt.authorization_id;
 IF credential_hash IS DISTINCT FROM grant_row.credential_sha256 THEN RAISE EXCEPTION 'Synthesis credential changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO dispatch FROM engagement_synthesis_generation_dispatches WHERE attempt_id=p_attempt;
 SELECT capture_sha256 INTO output_hash FROM engagement_synthesis_generation_outputs WHERE attempt_id=p_attempt;
 RETURN jsonb_build_object('schemaVersion',1,'attemptId',p_attempt,'workerId',p_worker,'dispatchSha256',dispatch.receipt_sha256,
  'outputSha256',output_hash,'expiresAt',dispatch.expires_at,'canContinue',dispatch.attempt_id IS NOT NULL AND output_hash IS NULL
   AND dispatch.expires_at>clock_timestamp() AND (grant_row.intent_text::jsonb->>'expiresAt')::timestamptz>clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_context_execution_status(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_context_execution_status(uuid,uuid) TO service_role;

CREATE FUNCTION public.select_engagement_synthesis_context_attempt(p_request uuid,p_task_index bigint,p_selection uuid,p_expected_previous uuid,p_attempt uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; saved public.engagement_synthesis_generation_selections;
 head public.engagement_synthesis_generation_selections; sequence bigint;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request);
 IF auth.uid() IS DISTINCT FROM request.actor_id THEN RAISE EXCEPTION 'Original synthesis requester required' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM engagement_synthesis_generation_selections WHERE id=p_selection;
 IF FOUND THEN
  IF saved.request_id IS DISTINCT FROM p_request OR saved.task_index IS DISTINCT FROM p_task_index OR saved.actor_id IS DISTINCT FROM auth.uid()
  OR saved.origin IS DISTINCT FROM 'staff' OR saved.previous_selection_id IS DISTINCT FROM p_expected_previous
  OR saved.attempt_id IS DISTINCT FROM p_attempt OR saved.receipt_text::jsonb->>'reason' IS DISTINCT FROM p_reason THEN
   RAISE EXCEPTION 'Synthesis selection retry differs' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF p_selection IS NULL OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 4000 OR p_reason !~ '[^[:space:]]' THEN
   RAISE EXCEPTION 'Selection identity and reason required' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request AND task_index=p_task_index) THEN
   RAISE EXCEPTION 'Synthesis selection task differs' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO head FROM engagement_synthesis_generation_selections s WHERE s.request_id=p_request AND s.task_index=p_task_index
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections n WHERE n.previous_selection_id=s.id);
  IF head.id IS DISTINCT FROM p_expected_previous THEN RAISE EXCEPTION 'Synthesis selection changed; reload before choosing' USING ERRCODE='PT409'; END IF;
  IF p_attempt IS NOT NULL AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_attempts a
   JOIN engagement_synthesis_generation_outputs o ON o.attempt_id=a.id WHERE a.id=p_attempt AND a.request_id=p_request AND a.task_index=p_task_index) THEN
   RAISE EXCEPTION 'Synthesis selection needs a retained output from this task' USING ERRCODE='PT409';
  END IF;
  SELECT coalesce(max(sequence_no),0)+1 INTO sequence FROM engagement_synthesis_generation_selections WHERE request_id=p_request;
  INSERT INTO engagement_synthesis_generation_selections(id,request_id,task_index,attempt_id,previous_selection_id,sequence_no,actor_id,origin,receipt_text)
  VALUES(p_selection,p_request,p_task_index,p_attempt,p_expected_previous,sequence,request.actor_id,'staff',
   jsonb_build_object('schemaVersion',1,'id',p_selection,'requestId',p_request,'taskIndex',p_task_index,'attemptId',p_attempt,
    'previousSelectionId',p_expected_previous,'sequence',sequence,'actorId',request.actor_id,'origin','staff','authorizationId',NULL,
    'reason',p_reason,'selectedAt',clock_timestamp())::text) RETURNING * INTO saved;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'receiptText',saved.receipt_text,'receiptSha256',saved.receipt_sha256);
END $$;
REVOKE ALL ON FUNCTION public.select_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.select_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,uuid,text) TO authenticated;

-- A retained sequence fixes pagination even when later selections are appended.
-- This command returns identities and checksums, never a page of response bodies.

CREATE FUNCTION public.read_engagement_synthesis_context_selections(p_request uuid,p_through_sequence bigint DEFAULT NULL,p_after_task_index bigint DEFAULT -1,p_limit integer DEFAULT 128)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sequence bigint; through_sequence bigint; entries jsonb;
BEGIN
 PERFORM lock_synthesis_context_plan_scope(p_request);
 SELECT coalesce(max(sequence_no),0) INTO sequence FROM engagement_synthesis_generation_selections WHERE request_id=p_request;
 through_sequence:=coalesce(p_through_sequence,sequence);
 IF through_sequence NOT BETWEEN 0 AND sequence OR p_after_task_index IS NULL OR p_after_task_index NOT BETWEEN -1 AND 9007199254740991 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'Invalid synthesis selection cursor' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(row.value ORDER BY row.task_index),'[]'::jsonb) INTO entries FROM (
  SELECT s.task_index,jsonb_build_object('receiptText',s.receipt_text,'receiptSha256',s.receipt_sha256) AS value
  FROM engagement_synthesis_generation_selections s WHERE s.request_id=p_request AND s.task_index>p_after_task_index AND s.sequence_no<=through_sequence
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections n WHERE n.previous_selection_id=s.id AND n.sequence_no<=through_sequence)
  ORDER BY s.task_index LIMIT p_limit+1
 ) row;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'throughSequence',through_sequence,'afterTaskIndex',p_after_task_index,
  'hasMore',jsonb_array_length(entries)>p_limit,'entries',CASE WHEN jsonb_array_length(entries)>p_limit THEN entries-p_limit ELSE entries END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_context_selections(uuid,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_context_selections(uuid,bigint,bigint,integer) TO service_role;

-- The child request fixes its parent's selection sequence. A service worker
-- reads that immutable snapshot under the child's current requester scope,
-- without impersonating a staff JWT or renewing the parent's execution.
CREATE FUNCTION public.read_engagement_synthesis_context_parent_selections(p_request uuid,p_after_task_index bigint DEFAULT -1,p_limit integer DEFAULT 128)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; parent public.engagement_synthesis_generation_requests;
 context public.engagement_synthesis_context_requests; through_sequence bigint; entries jsonb;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request);
 SELECT * INTO context FROM engagement_synthesis_context_requests WHERE request_id=p_request;
 SELECT * INTO parent FROM engagement_synthesis_generation_requests WHERE id=context.parent_request_id;
 IF parent.id IS NULL OR parent.campaign_id IS DISTINCT FROM request.campaign_id OR parent.workspace_id IS DISTINCT FROM request.workspace_id
  OR parent.source_id IS DISTINCT FROM request.source_id THEN RAISE EXCEPTION 'Context parent scope differs' USING ERRCODE='42501'; END IF;
 through_sequence:=(context.context_text::jsonb->>'selectionSequence')::bigint;
 IF p_after_task_index IS NULL OR p_after_task_index NOT BETWEEN -1 AND 9007199254740991 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'Invalid context parent selection cursor' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(row.value ORDER BY row.task_index),'[]'::jsonb) INTO entries FROM (
  SELECT s.task_index,jsonb_build_object('receiptText',s.receipt_text,'receiptSha256',s.receipt_sha256) AS value
  FROM engagement_synthesis_generation_selections s WHERE s.request_id=parent.id AND s.task_index>p_after_task_index AND s.sequence_no<=through_sequence
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections n WHERE n.previous_selection_id=s.id AND n.sequence_no<=through_sequence)
  ORDER BY s.task_index LIMIT p_limit+1
 ) row;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',parent.id,'throughSequence',through_sequence,'afterTaskIndex',p_after_task_index,
  'hasMore',jsonb_array_length(entries)>p_limit,'entries',CASE WHEN jsonb_array_length(entries)>p_limit THEN entries-p_limit ELSE entries END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_context_parent_selections(uuid,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_context_parent_selections(uuid,bigint,integer) TO service_role;
