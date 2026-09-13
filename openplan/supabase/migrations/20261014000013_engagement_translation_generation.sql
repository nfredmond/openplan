-- Private durable staff translation attempts and retained provider output.
-- Worker/public producer integration follows separately. No authenticated
-- command grant or automatic model invocation is added here.

-- BEGIN TRANSLATION_GENERATION_QUEUE
-- Unreleased staff translation queue candidate. Application-stack probes roll
-- back; concurrency uses a separate proof database. Completion delivery, public
-- producers and the worker join must be exercised before application activation.
CREATE TABLE public.engagement_translation_generation_requests (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL, workspace_id uuid NOT NULL, actor_id uuid NOT NULL,
 locale text NOT NULL, intent jsonb NOT NULL, credential jsonb NOT NULL,
 selected_key_ciphertext_hash text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(selected_key_ciphertext_hash IS NULL OR selected_key_ciphertext_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.engagement_translation_generation_fields (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES public.engagement_translation_generation_requests(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 25), address jsonb NOT NULL,
 packet_canonical text NOT NULL CHECK(octet_length(packet_canonical)<=200000),
 packet_hash text GENERATED ALWAYS AS (encode(extensions.digest(packet_canonical,'sha256'),'hex')) STORED,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','reserved','running','completed','incomplete','failed','interrupted','cancelled')),
 attempt_id uuid UNIQUE, reservation_id uuid UNIQUE, lease_expires_at timestamptz, reserved_at timestamptz,
 dispatch_authorized_at timestamptz, failure_code text, finished_at timestamptz,
 UNIQUE(request_id,ordinal),
 CHECK((state IN ('queued','failed','cancelled') AND attempt_id IS NULL AND reservation_id IS NULL AND reserved_at IS NULL AND lease_expires_at IS NULL)
   OR (state<>'queued' AND attempt_id IS NOT NULL AND reservation_id IS NOT NULL AND reserved_at IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((state IN ('queued','reserved','running') AND finished_at IS NULL AND failure_code IS NULL)
   OR (state NOT IN ('queued','reserved','running') AND finished_at IS NOT NULL))
);
CREATE INDEX translation_generation_queue ON public.engagement_translation_generation_fields(request_id,ordinal) WHERE state='queued';
ALTER TABLE public.engagement_translation_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_translation_generation_fields ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_translation_generation_requests,public.engagement_translation_generation_fields FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_translation_generation_requests,public.engagement_translation_generation_fields TO service_role;

CREATE FUNCTION public.preserve_translation_generation_request() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Generation requests are retained unchanged' USING ERRCODE='23514'; END $$;
CREATE TRIGGER translation_generation_request_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_generation_requests
 FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_request();
CREATE FUNCTION public.preserve_translation_generation_field() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Generation fields are retained' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.request_id,NEW.ordinal,NEW.address,NEW.packet_canonical) IS DISTINCT FROM
    ROW(OLD.id,OLD.request_id,OLD.ordinal,OLD.address,OLD.packet_canonical)
 OR (OLD.attempt_id IS NOT NULL AND ROW(NEW.attempt_id,NEW.reservation_id,NEW.reserved_at,NEW.lease_expires_at) IS DISTINCT FROM
    ROW(OLD.attempt_id,OLD.reservation_id,OLD.reserved_at,OLD.lease_expires_at))
 OR (OLD.dispatch_authorized_at IS NOT NULL AND NEW.dispatch_authorized_at IS DISTINCT FROM OLD.dispatch_authorized_at)
 OR (OLD.state<>'queued' AND NEW.state='queued')
 OR (OLD.state IN ('completed','incomplete','failed','interrupted','cancelled') AND NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'Generation identity or terminal outcome changed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER translation_generation_field_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_generation_fields
 FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_field();

-- Use the existing response/source lock order. Reads of saved private requests
-- must go through a staff-authorized route; no browser table grants are added.
CREATE FUNCTION public.lock_translation_generation_scope(p_campaign uuid,p_actor uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=p_actor AND m.role IN ('owner','admin','member')) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Translation sources are busy' USING ERRCODE='PT503';
 END IF;
 SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=workspace AND user_id=p_actor
  AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 RETURN workspace;
END $$;

CREATE FUNCTION public.assert_translation_generation_selection(p_workspace uuid,p_credential jsonb,p_selected_hash text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.workspace_integration_keys;
BEGIN
 SELECT * INTO selected FROM workspace_integration_keys WHERE workspace_id=p_workspace AND provider='anthropic' FOR SHARE NOWAIT;
 IF p_credential->>'source'='workspace' THEN
  IF NOT FOUND OR p_selected_hash IS NULL OR p_selected_hash IS DISTINCT FROM encode(extensions.digest(selected.key_ciphertext,'sha256'),'hex') THEN
   RAISE EXCEPTION 'Selected workspace key changed' USING ERRCODE='PT409';
  END IF;
 ELSIF p_credential->>'source'='env' THEN
  IF FOUND OR p_selected_hash IS NOT NULL THEN RAISE EXCEPTION 'Selected environment key no longer applies' USING ERRCODE='PT409'; END IF;
 ELSE RAISE EXCEPTION 'Invalid credential source' USING ERRCODE='22023'; END IF;
 -- Environment plaintext and encryption availability are checked by the worker
 -- before dispatch. PostgreSQL cannot attest a process environment.
END $$;

CREATE FUNCTION public.assert_translation_generation_source(p_campaign uuid,p_locale text,p_address jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actual jsonb; previous public.engagement_content_translations; expected jsonb;
BEGIN
 IF jsonb_typeof(p_address) IS DISTINCT FROM 'object' OR NOT p_address ?& ARRAY['entityType','entityId','field','expectedSource','expectedTranslation']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_address) k WHERE k NOT IN ('entityType','entityId','field','expectedSource','expectedTranslation')) THEN
  RAISE EXCEPTION 'Invalid source address' USING ERRCODE='22023';
 END IF;
 actual:=translation_source_snapshot(p_campaign,p_address->>'entityType',(p_address->>'entityId')::uuid,p_address->>'field');
 IF actual IS DISTINCT FROM p_address->'expectedSource' OR (actual->>'available')::boolean IS DISTINCT FROM true
 OR octet_length(actual->>'text')>32000 THEN RAISE EXCEPTION 'Generation source changed or unavailable' USING ERRCODE='PT409'; END IF;
 SELECT * INTO previous FROM engagement_content_translations WHERE campaign_id=p_campaign AND entity_type=p_address->>'entityType'
  AND entity_id=(p_address->>'entityId')::uuid AND field=p_address->>'field' AND locale=p_locale FOR SHARE NOWAIT;
 expected:=CASE WHEN FOUND THEN jsonb_build_object('id',previous.id,'revision',
  (SELECT max(h.revision) FROM engagement_translation_history h WHERE h.translation_id=previous.id)) ELSE 'null'::jsonb END;
 IF expected IS DISTINCT FROM p_address->'expectedTranslation' THEN RAISE EXCEPTION 'Generation translation version changed' USING ERRCODE='PT409'; END IF;
 RETURN actual;
END $$;

CREATE FUNCTION public.create_translation_generation_request(p_request uuid,p_actor uuid,p_campaign uuid,p_locale text,
 p_fields jsonb,p_credential jsonb,p_selected_hash text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; saved public.engagement_translation_generation_requests; intent jsonb; entry jsonb; actual jsonb; packet jsonb;
 old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_scope(p_campaign,p_actor);
 IF p_request IS NULL OR p_locale IS NULL OR p_locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR length(p_locale)>35
 OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) NOT BETWEEN 1 AND 25 OR octet_length(p_fields::text)>8388608 THEN
  RAISE EXCEPTION 'Invalid generation request' USING ERRCODE='22023';
 END IF;
 intent:=jsonb_build_object('requestId',p_request,'actorId',p_actor,'campaignId',p_campaign,'locale',p_locale,'fields',p_fields);
 SELECT * INTO saved FROM engagement_translation_generation_requests WHERE id=p_request;
 IF FOUND THEN
  IF saved.intent IS DISTINCT FROM intent THEN RAISE EXCEPTION 'Generation retry differs' USING ERRCODE='PT409'; END IF;
  PERFORM set_config('lock_timeout',old_timeout,true);
  RETURN jsonb_build_object('requestId',saved.id,'created',false);
 END IF;
 IF jsonb_typeof(p_credential) IS DISTINCT FROM 'object' OR p_credential->>'workspaceId' IS DISTINCT FROM workspace::text
 OR p_credential->>'requestId' IS DISTINCT FROM p_request::text OR p_credential->>'credentialId' IS NULL
 OR p_credential#>>'{configuration,provider}' IS DISTINCT FROM 'anthropic' OR p_credential#>>'{configuration,recipeVersion}' IS DISTINCT FROM '1'
 OR coalesce(length(p_credential#>>'{configuration,modelId}'),0) NOT BETWEEN 1 AND 160
 OR coalesce(p_credential->>'configurationHash','') !~ '^[a-f0-9]{64}$'
 OR coalesce(length(p_credential->>'credentialCiphertext'),0) NOT BETWEEN 1 AND 32000 THEN
  RAISE EXCEPTION 'Invalid captured credential' USING ERRCODE='22023';
 END IF;
 PERFORM (p_credential->>'credentialId')::uuid;
 PERFORM assert_translation_generation_selection(workspace,p_credential,p_selected_hash);
 IF (SELECT count(*) FROM jsonb_array_elements(p_fields))<>(SELECT count(DISTINCT (e#>>'{address,entityType}',e#>>'{address,entityId}',e#>>'{address,field}')) FROM jsonb_array_elements(p_fields) e)
 OR (SELECT count(*) FROM jsonb_array_elements(p_fields))<>(SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_fields) e) THEN
  RAISE EXCEPTION 'Duplicate generation field' USING ERRCODE='22023';
 END IF;
 INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,locale,intent,credential,selected_key_ciphertext_hash)
 VALUES(p_request,p_campaign,workspace,p_actor,p_locale,intent,p_credential,p_selected_hash);
 FOR entry IN SELECT value FROM jsonb_array_elements(p_fields) ORDER BY value#>>'{address,entityType}',value#>>'{address,entityId}',value#>>'{address,field}' LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['id','address','packetCanonical']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('id','address','packetCanonical'))
  OR jsonb_typeof(entry->'packetCanonical') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid generation field' USING ERRCODE='22023'; END IF;
  actual:=assert_translation_generation_source(p_campaign,p_locale,entry->'address');
  packet:=(entry->>'packetCanonical')::jsonb;
  IF packet IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'workspaceId',workspace,'campaignId',p_campaign,'fieldId',(entry->>'id')::uuid,
    'sourceText',actual->>'text','targetLanguage',p_locale) THEN RAISE EXCEPTION 'Generation packet differs from source' USING ERRCODE='22023'; END IF;
  INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical)
   VALUES((entry->>'id')::uuid,p_request,(SELECT ord FROM jsonb_array_elements(p_fields) WITH ORDINALITY a(v,ord) WHERE v=entry),entry->'address',entry->>'packetCanonical');
 END LOOP;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('requestId',p_request,'created',true);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation sources are busy; retry this request' USING ERRCODE='PT503';
END $$;

-- Claim a named candidate so a worker may validate its private credential before
-- reserving. Expired claims are terminal; another worker cannot reclaim them.
CREATE FUNCTION public.claim_translation_generation_field(p_field uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 active_reservations bigint; recent_dispatches bigint; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation field missing' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 PERFORM lock_translation_generation_scope(request.campaign_id,request.actor_id);
 PERFORM assert_translation_generation_selection(request.workspace_id,request.credential,request.selected_key_ciphertext_hash);
 PERFORM assert_translation_generation_source(request.campaign_id,request.locale,job.address);
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 IF job.state IN ('reserved','running') AND job.lease_expires_at<=clock_timestamp() THEN
  UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code='translation_attempt_expired',finished_at=clock_timestamp() WHERE id=job.id;
  PERFORM set_config('lock_timeout',old_timeout,true); RETURN NULL;
 END IF;
 IF job.state<>'queued' THEN PERFORM set_config('lock_timeout',old_timeout,true); RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('assistant_api_dispatch:'||request.workspace_id::text,0));
 SELECT count(*) INTO recent_dispatches FROM usage_events WHERE workspace_id=request.workspace_id
  AND bucket_key IN ('assistant_chat','grant_narrative_draft','engagement_synthesis','engagement_moderation','document_narrative_draft','rtp_document_extraction','engagement_content_translation')
  AND occurred_at>=clock_timestamp()-interval '300 seconds';
 SELECT count(*) INTO active_reservations FROM engagement_translation_generation_fields f JOIN engagement_translation_generation_requests r ON r.id=f.request_id
  WHERE r.workspace_id=request.workspace_id AND f.state='reserved' AND f.lease_expires_at>clock_timestamp();
 IF recent_dispatches+active_reservations>=20 THEN RAISE EXCEPTION 'Staff dispatch allowance reserved' USING ERRCODE='PT429'; END IF;
 UPDATE engagement_translation_generation_fields SET state='reserved',attempt_id=gen_random_uuid(),reservation_id=gen_random_uuid(),
  reserved_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds' WHERE id=job.id RETURNING * INTO job;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN to_jsonb(job);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation claim is busy' USING ERRCODE='PT503';
END $$;

CREATE FUNCTION public.authorize_translation_generation_dispatch(p_field uuid,p_attempt uuid,p_reservation uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 recent_dispatches bigint; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation field missing' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 PERFORM lock_translation_generation_scope(request.campaign_id,request.actor_id);
 PERFORM assert_translation_generation_selection(request.workspace_id,request.credential,request.selected_key_ciphertext_hash);
 PERFORM assert_translation_generation_source(request.campaign_id,request.locale,job.address);
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 IF p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt OR p_reservation IS NULL OR job.reservation_id IS DISTINCT FROM p_reservation THEN
  RAISE EXCEPTION 'Generation attempt differs' USING ERRCODE='42501';
 END IF;
 IF job.state IN ('reserved','running') AND job.lease_expires_at<=clock_timestamp() THEN
  UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code='translation_attempt_expired',finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 ELSIF job.state='reserved' THEN
  -- Recheck at dispatch as existing staff producers may have consumed capacity
  -- since this reservation was made. A replay of running never records again.
  PERFORM pg_advisory_xact_lock(hashtextextended('assistant_api_dispatch:'||request.workspace_id::text,0));
  SELECT count(*) INTO recent_dispatches FROM usage_events WHERE workspace_id=request.workspace_id
   AND bucket_key IN ('assistant_chat','grant_narrative_draft','engagement_synthesis','engagement_moderation','document_narrative_draft','rtp_document_extraction','engagement_content_translation')
   AND occurred_at>=clock_timestamp()-interval '300 seconds';
  IF recent_dispatches>=20 THEN RAISE EXCEPTION 'Staff dispatch allowance consumed' USING ERRCODE='PT429'; END IF;
  INSERT INTO usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,source_route,metadata_json)
   VALUES(request.workspace_id,job.id::text,'engagement_content_translation',1,'translation_dispatch:'||job.attempt_id::text,
    '/api/engagement/campaigns/translations/generation',jsonb_build_object('dispatchReservation',true,'attemptId',job.attempt_id,'reservationId',job.reservation_id));
  UPDATE engagement_translation_generation_fields SET state='running',dispatch_authorized_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 END IF;
 -- Acknowledgement is authorization, not proof the provider received a call.
 -- The worker journal decides whether it can invoke or must report uncertainty.
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('fieldId',job.id,'attemptId',job.attempt_id,'reservationId',job.reservation_id,'state',job.state,'leaseExpiresAt',job.lease_expires_at);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation dispatch is busy' USING ERRCODE='PT503';
END $$;

-- Worker-only minimal status and terminal failures can be retained after the
-- original actor/source/key becomes unavailable. They disclose no source words
-- or credential. Completed delivery is added separately before worker activation.
CREATE FUNCTION public.stop_translation_generation_field(p_field uuid,p_attempt uuid,p_state text,p_code text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields;
BEGIN
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 IF NOT FOUND OR job.attempt_id IS DISTINCT FROM p_attempt THEN RAISE EXCEPTION 'Generation attempt differs' USING ERRCODE='42501'; END IF;
 IF p_state IS NULL OR p_state NOT IN ('failed','interrupted','cancelled') OR p_code IS NULL OR p_code !~ '^[a-z_]{1,100}$'
 OR (p_attempt IS NULL AND p_state='interrupted') THEN RAISE EXCEPTION 'Invalid generation failure' USING ERRCODE='22023'; END IF;
 IF job.state IN ('queued','reserved','running') THEN
  UPDATE engagement_translation_generation_fields SET state=p_state,failure_code=p_code,finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 ELSIF job.state IS DISTINCT FROM p_state OR job.failure_code IS DISTINCT FROM p_code THEN
  RAISE EXCEPTION 'Retained generation outcome differs' USING ERRCODE='PT409';
 END IF;
 RETURN jsonb_build_object('fieldId',job.id,'attemptId',job.attempt_id,'state',job.state,'failureCode',job.failure_code);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'Generation status is busy' USING ERRCODE='PT503';
END $$;

CREATE FUNCTION public.read_translation_generation_status(p_field uuid,p_attempt uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 failure text; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND OR p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt THEN RAISE EXCEPTION 'Generation attempt differs' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 BEGIN
  PERFORM lock_translation_generation_scope(request.campaign_id,request.actor_id);
  PERFORM assert_translation_generation_selection(request.workspace_id,request.credential,request.selected_key_ciphertext_hash);
  PERFORM assert_translation_generation_source(request.campaign_id,request.locale,job.address);
 EXCEPTION WHEN insufficient_privilege THEN failure:='translation_access_lost';
 WHEN SQLSTATE 'PT409' THEN failure:='translation_source_or_key_changed';
 END;
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 IF job.state IN ('reserved','running') THEN
  IF failure IS NULL AND job.lease_expires_at<=clock_timestamp() THEN failure:='translation_attempt_expired'; END IF;
  IF failure IS NOT NULL THEN
   UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code=failure,finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  END IF;
 END IF;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('fieldId',job.id,'attemptId',job.attempt_id,'state',job.state,'failureCode',job.failure_code,'leaseExpiresAt',job.lease_expires_at);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation status is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.stop_translation_generation_field(uuid,uuid,text,text),public.read_translation_generation_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stop_translation_generation_field(uuid,uuid,text,text),public.read_translation_generation_status(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.preserve_translation_generation_request(),public.preserve_translation_generation_field(),
 public.lock_translation_generation_scope(uuid,uuid),public.assert_translation_generation_selection(uuid,jsonb,text),
 public.assert_translation_generation_source(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_translation_generation_request(uuid,uuid,uuid,text,jsonb,jsonb,text),
 public.claim_translation_generation_field(uuid),public.authorize_translation_generation_dispatch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_translation_generation_request(uuid,uuid,uuid,text,jsonb,jsonb,text),
 public.claim_translation_generation_field(uuid),public.authorize_translation_generation_dispatch(uuid,uuid,uuid) TO service_role;
-- END TRANSLATION_GENERATION_QUEUE

-- BEGIN TRANSLATION_GENERATION_OUTPUT
-- Retain completed and incomplete output separately from terminal job state.
-- Run after generation-queue-candidate.sql in an identified proof database.
ALTER TABLE public.engagement_translation_generation_fields ADD CONSTRAINT translation_generation_field_attempt_identity UNIQUE(id,attempt_id);
CREATE TABLE public.engagement_translation_generation_outputs (
 field_id uuid PRIMARY KEY, attempt_id uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('completed','incomplete')),
 output_json text NOT NULL, binding_canonical text NOT NULL, provider_metadata_json text NOT NULL,
 delivery_digest text GENERATED ALWAYS AS (encode(extensions.digest(status||chr(10)||output_json||chr(10)||binding_canonical||chr(10)||provider_metadata_json,'sha256'),'hex')) STORED,
 accepted_state text NOT NULL CHECK(accepted_state IN ('completed','incomplete','failed','interrupted','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(field_id,attempt_id) REFERENCES public.engagement_translation_generation_fields(id,attempt_id),
 CHECK(octet_length(output_json)+octet_length(binding_canonical)+octet_length(provider_metadata_json)<=200000)
);
ALTER TABLE public.engagement_translation_generation_outputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_translation_generation_outputs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_translation_generation_outputs TO service_role;
CREATE FUNCTION public.preserve_translation_generation_output() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Generated output is retained unchanged' USING ERRCODE='23514'; END $$;
CREATE TRIGGER translation_generation_output_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_generation_outputs
 FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_output();
REVOKE ALL ON FUNCTION public.preserve_translation_generation_output() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.retain_translation_generation_output(p_field uuid,p_attempt uuid,p_status text,
 p_output_json text,p_binding_canonical text,p_provider_metadata_json text,p_digest text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 saved public.engagement_translation_generation_outputs; binding jsonb; expected jsonb; packet jsonb; words text; key text;
 actual_digest text; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND OR p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt OR job.dispatch_authorized_at IS NULL THEN
  RAISE EXCEPTION 'No matching authorized generation attempt' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 IF p_status IS NULL OR p_status NOT IN ('completed','incomplete') OR p_output_json IS NULL OR p_binding_canonical IS NULL OR p_provider_metadata_json IS NULL
 OR octet_length(p_output_json)+octet_length(p_binding_canonical)+octet_length(p_provider_metadata_json)>200000
 OR position(chr(10) IN p_output_json||p_binding_canonical||p_provider_metadata_json)>0 THEN
  RAISE EXCEPTION 'Invalid retained generation encoding' USING ERRCODE='22023';
 END IF;
 actual_digest:=encode(extensions.digest(p_status||chr(10)||p_output_json||chr(10)||p_binding_canonical||chr(10)||p_provider_metadata_json,'sha256'),'hex');
 IF p_digest IS DISTINCT FROM actual_digest THEN RAISE EXCEPTION 'Generation delivery digest differs' USING ERRCODE='22023'; END IF;
 -- JSON (not JSONB) checks syntax without converting unsupported escapes into
 -- PostgreSQL text. Never extract values from the opaque provider metadata.
 IF json_typeof(p_output_json::json) IS DISTINCT FROM 'string' OR json_typeof(p_provider_metadata_json::json) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid retained generation shape' USING ERRCODE='22023';
 END IF;
 binding:=p_binding_canonical::jsonb; packet:=job.packet_canonical::jsonb;
 expected:=jsonb_build_object('schemaVersion',1,'provider','anthropic','workspaceId',request.workspace_id,'campaignId',request.campaign_id,
  'requestId',request.id,'attemptId',job.attempt_id,'fieldId',job.id,'reservationId',job.reservation_id,
  'credentialId',request.credential->>'credentialId','configurationHash',request.credential->>'configurationHash','packetHash',job.packet_hash,
  'leaseExpiresAt',binding->'leaseExpiresAt','model',request.credential#>>'{configuration,modelId}',
  'credentialSource',request.credential->>'source','recipeVersion',1,'targetLanguage',request.locale,
  'sourceHash',encode(extensions.digest(packet->>'sourceText','sha256'),'hex'));
 IF (binding-ARRAY['outputHash','finishReason','inputTokens','outputTokens']) IS DISTINCT FROM expected
 OR (binding->>'leaseExpiresAt')::timestamptz IS DISTINCT FROM job.lease_expires_at
 OR coalesce(binding->>'outputHash','') !~ '^[a-f0-9]{64}$'
 OR NOT binding ?& ARRAY['finishReason','inputTokens','outputTokens']
 OR (binding->'finishReason'<>'null'::jsonb AND binding->>'finishReason' NOT IN ('stop','length','content-filter','tool-calls','error','other','unknown')) THEN
  RAISE EXCEPTION 'Generation receipt differs from the claimed packet' USING ERRCODE='22023';
 END IF;
 FOREACH key IN ARRAY ARRAY['inputTokens','outputTokens'] LOOP
  IF jsonb_typeof(binding->key) NOT IN ('null','number') THEN RAISE EXCEPTION 'Invalid generation token count' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(binding->key)='number' AND ((binding->>key)::numeric<0 OR (binding->>key)::numeric>9007199254740991 OR trunc((binding->>key)::numeric)<>(binding->>key)::numeric) THEN
   RAISE EXCEPTION 'Invalid generation token count' USING ERRCODE='22023';
  END IF;
 END LOOP;
 BEGIN words:=p_output_json::jsonb#>>'{}';
 EXCEPTION WHEN data_exception THEN words:=NULL;
 END;
 IF words IS NOT NULL AND binding->>'outputHash' IS DISTINCT FROM encode(extensions.digest(words,'sha256'),'hex') THEN
  RAISE EXCEPTION 'Retained output hash differs' USING ERRCODE='22023';
 END IF;
 IF ((binding->>'finishReason'='stop' AND words IS NOT NULL AND length(words) BETWEEN 1 AND 8000
  AND translation_source_compatibility_hash(words)<>translation_source_compatibility_hash('')) IS TRUE) IS DISTINCT FROM (p_status='completed') THEN
  RAISE EXCEPTION 'Output completeness differs from delivery' USING ERRCODE='22023';
 END IF;
 -- Serialize on the common scope/job lock order. The worker-only status may
 -- mark an active job interrupted when source, authority, key or lease changed.
 -- Its output is still retained; late arrival never revives that terminal job.
 PERFORM read_translation_generation_status(job.id,job.attempt_id);
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 SELECT * INTO saved FROM engagement_translation_generation_outputs WHERE field_id=job.id;
 IF FOUND THEN
  IF saved.attempt_id IS DISTINCT FROM p_attempt OR saved.status IS DISTINCT FROM p_status OR saved.output_json IS DISTINCT FROM p_output_json
   OR saved.binding_canonical IS DISTINCT FROM p_binding_canonical OR saved.provider_metadata_json IS DISTINCT FROM p_provider_metadata_json OR saved.delivery_digest IS DISTINCT FROM p_digest THEN
   RAISE EXCEPTION 'Retained generation delivery differs from retry' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF job.state='running' THEN
   UPDATE engagement_translation_generation_fields SET state=p_status,finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  ELSIF job.state NOT IN ('failed','interrupted','cancelled') THEN RAISE EXCEPTION 'Generation state cannot receive output' USING ERRCODE='PT409'; END IF;
  INSERT INTO engagement_translation_generation_outputs(field_id,attempt_id,status,output_json,binding_canonical,provider_metadata_json,accepted_state)
  VALUES(job.id,job.attempt_id,p_status,p_output_json,p_binding_canonical,p_provider_metadata_json,job.state) RETURNING * INTO saved;
 END IF;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('fieldId',saved.field_id,'attemptId',saved.attempt_id,'status',saved.status,'state',saved.accepted_state,'digest',saved.delivery_digest);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid generation delivery value' USING ERRCODE='22023';
 WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation delivery is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_translation_generation_output(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_translation_generation_output(uuid,uuid,text,text,text,text,text) TO service_role;
-- END TRANSLATION_GENERATION_OUTPUT
