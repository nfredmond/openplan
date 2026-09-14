-- Uninstalled candidate: anonymous public translation uses the existing worker
-- packet, attempt, reservation and immutable output custody. No human actor is
-- invented. Apply only inside a rollback transaction in the named proof DB.
ALTER TABLE public.engagement_translation_generation_requests ADD COLUMN authority_kind text NOT NULL DEFAULT 'staff';
ALTER TABLE public.engagement_translation_generation_requests ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.engagement_translation_generation_requests ADD CONSTRAINT translation_generation_authority CHECK
 ((authority_kind='staff' AND actor_id IS NOT NULL) OR (authority_kind='public' AND actor_id IS NULL));
CREATE TABLE public.engagement_public_translation_requests (
 request_id uuid PRIMARY KEY REFERENCES public.engagement_translation_generation_requests(id),
 previous_request_id uuid UNIQUE REFERENCES public.engagement_public_translation_requests(request_id),
 campaign_id uuid NOT NULL, item_id uuid NOT NULL, locale text NOT NULL,
 share_token_hash text NOT NULL CHECK(share_token_hash ~ '^[a-f0-9]{64}$'),
 source_snapshot jsonb NOT NULL,
 source_fingerprint text GENERATED ALWAYS AS (encode(extensions.digest(source_snapshot::text,'sha256'),'hex')) STORED
);
CREATE UNIQUE INDEX public_translation_root ON public.engagement_public_translation_requests(campaign_id,item_id,locale,share_token_hash,source_fingerprint) WHERE previous_request_id IS NULL;
ALTER TABLE public.engagement_public_translation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_public_translation_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_public_translation_requests TO service_role;
CREATE TRIGGER public_translation_request_immutable BEFORE UPDATE OR DELETE ON public.engagement_public_translation_requests
 FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_request();

-- Capture exactly the currently public original under the response/source locks.
-- Approval of a reply never substitutes for approval of its top-level parent.
CREATE FUNCTION public.lock_public_translation_source(p_campaign uuid,p_share_hash text,p_item uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE campaign public.engagement_campaigns; item public.engagement_items;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Public translation source is busy' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO campaign FROM engagement_campaigns WHERE id=p_campaign AND status='active'
  AND encode(extensions.digest(share_token,'sha256'),'hex')=p_share_hash FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM engagement_items WHERE id=p_item AND campaign_id=campaign.id AND status='approved' FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501'; END IF;
 IF item.parent_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM engagement_items WHERE id=item.parent_item_id
  AND campaign_id=campaign.id AND status='approved' AND parent_item_id IS NULL FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('workspaceId',campaign.workspace_id,'campaignId',campaign.id,'itemId',item.id,'title',item.title,'body',item.body);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Public translation source is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_public_translation_source(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_public_translation_source(p_share_token text,p_item uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE campaign uuid;
BEGIN
 SELECT id INTO campaign FROM engagement_campaigns WHERE share_token=p_share_token AND status='active';
 IF campaign IS NULL THEN RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501'; END IF;
 RETURN lock_public_translation_source(campaign,encode(extensions.digest(p_share_token,'sha256'),'hex'),p_item);
END $$;
REVOKE ALL ON FUNCTION public.read_public_translation_source(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_translation_source(text,uuid) TO service_role;

CREATE FUNCTION public.create_public_translation_attempt(p_request uuid,p_field uuid,p_share_token text,p_item uuid,p_locale text,
 p_snapshot jsonb,p_packet_canonical text,p_credential jsonb,p_selected_hash text,p_previous uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actual jsonb; token_hash text; old_request uuid; workspace uuid; campaign uuid; source_text text; packet jsonb; previous public.engagement_public_translation_requests; previous_state text;
BEGIN
 actual:=read_public_translation_source(p_share_token,p_item);
 IF actual IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'Public translation source changed' USING ERRCODE='PT409'; END IF;
 campaign:=(actual->>'campaignId')::uuid; workspace:=(actual->>'workspaceId')::uuid;
 token_hash:=encode(extensions.digest(p_share_token,'sha256'),'hex');
 IF p_request IS NULL OR p_field IS NULL OR p_locale IS NULL OR p_locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR length(p_locale)>35 THEN
  RAISE EXCEPTION 'Invalid public translation identity' USING ERRCODE='22023';
 END IF;
 IF p_previous IS NOT NULL THEN
  SELECT * INTO previous FROM engagement_public_translation_requests WHERE request_id=p_previous AND campaign_id=campaign AND item_id=p_item
   AND locale=p_locale AND share_token_hash=token_hash AND source_snapshot=actual;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public retry does not match this original' USING ERRCODE='42501'; END IF;
  SELECT state INTO STRICT previous_state FROM engagement_translation_generation_fields WHERE request_id=previous.request_id AND ordinal=1;
  IF previous_state NOT IN ('failed','interrupted','incomplete','cancelled') THEN
   RAISE EXCEPTION 'Public translation has not failed; recover its existing request' USING ERRCODE='PT409';
  END IF;
 END IF;
 SELECT request_id INTO old_request FROM engagement_public_translation_requests WHERE campaign_id=campaign AND item_id=p_item
  AND locale=p_locale AND share_token_hash=token_hash AND source_snapshot=actual AND previous_request_id IS NOT DISTINCT FROM p_previous;
 IF FOUND THEN RETURN jsonb_build_object('requestId',old_request,'created',false); END IF;
 IF EXISTS(SELECT 1 FROM engagement_translation_generation_requests WHERE id=p_request) THEN
  RAISE EXCEPTION 'Public translation request identity differs' USING ERRCODE='PT409';
 END IF;
 source_text:=CASE WHEN coalesce(actual->>'title','')<>'' THEN (actual->>'title')||chr(10)||chr(10)||(actual->>'body') ELSE actual->>'body' END;
 IF source_text IS NULL OR octet_length(source_text)>32000 OR translation_source_compatibility_hash(source_text)=translation_source_compatibility_hash('') THEN
  RAISE EXCEPTION 'Public translation source is not translatable' USING ERRCODE='22023';
 END IF;
 IF p_packet_canonical IS NULL OR octet_length(p_packet_canonical)>200000 THEN RAISE EXCEPTION 'Invalid public translation packet' USING ERRCODE='22023'; END IF;
 packet:=p_packet_canonical::jsonb;
 IF packet IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'workspaceId',workspace,'campaignId',campaign,'fieldId',p_field,'sourceText',source_text,'targetLanguage',p_locale) THEN
  RAISE EXCEPTION 'Public translation packet differs from source' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_credential) IS DISTINCT FROM 'object' OR p_credential->>'workspaceId' IS DISTINCT FROM workspace::text
 OR p_credential->>'requestId' IS DISTINCT FROM p_request::text OR p_credential->>'credentialId' IS NULL
 OR p_credential#>>'{configuration,provider}' IS DISTINCT FROM 'anthropic' OR p_credential#>>'{configuration,recipeVersion}' IS DISTINCT FROM '1'
 OR coalesce(length(p_credential#>>'{configuration,modelId}'),0) NOT BETWEEN 1 AND 160
 OR coalesce(p_credential->>'configurationHash','') !~ '^[a-f0-9]{64}$'
 OR coalesce(length(p_credential->>'credentialCiphertext'),0) NOT BETWEEN 1 AND 32000 THEN
  RAISE EXCEPTION 'Invalid captured public credential' USING ERRCODE='22023';
 END IF;
 PERFORM (p_credential->>'credentialId')::uuid;
 PERFORM assert_translation_generation_selection(workspace,p_credential,p_selected_hash);
 INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,authority_kind,locale,intent,credential,selected_key_ciphertext_hash)
 VALUES(p_request,campaign,workspace,NULL,'public',p_locale,jsonb_build_object('requestId',p_request,'source',actual,'locale',p_locale,'previousRequestId',p_previous),p_credential,p_selected_hash);
 INSERT INTO engagement_public_translation_requests(request_id,campaign_id,item_id,locale,share_token_hash,source_snapshot,previous_request_id)
 VALUES(p_request,campaign,p_item,p_locale,token_hash,actual,p_previous);
 INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical)
 VALUES(p_field,p_request,1,jsonb_build_object('entityType','public_item','entityId',p_item),p_packet_canonical);
 RETURN jsonb_build_object('requestId',p_request,'created',true);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Public translation creation is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.create_public_translation_attempt(uuid,uuid,text,uuid,text,jsonb,text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_public_translation_request(p_request uuid,p_field uuid,p_share_token text,p_item uuid,p_locale text,
 p_snapshot jsonb,p_packet_canonical text,p_credential jsonb,p_selected_hash text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT create_public_translation_attempt(p_request,p_field,p_share_token,p_item,p_locale,p_snapshot,p_packet_canonical,p_credential,p_selected_hash,NULL);
$$;
REVOKE ALL ON FUNCTION public.create_public_translation_request(uuid,uuid,text,uuid,text,jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_translation_request(uuid,uuid,text,uuid,text,jsonb,text,jsonb,text) TO service_role;

-- Only an explicit retry of a named terminal attempt may create its successor.
-- A repeated retry returns that same successor, even if later attempts exist.
CREATE FUNCTION public.retry_public_translation_request(p_request uuid,p_field uuid,p_share_token text,p_item uuid,p_locale text,
 p_snapshot jsonb,p_packet_canonical text,p_credential jsonb,p_selected_hash text,p_previous uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_previous IS NULL THEN RAISE EXCEPTION 'Public retry requires its original request' USING ERRCODE='22023'; END IF;
 RETURN create_public_translation_attempt(p_request,p_field,p_share_token,p_item,p_locale,p_snapshot,p_packet_canonical,p_credential,p_selected_hash,p_previous);
END $$;
REVOKE ALL ON FUNCTION public.retry_public_translation_request(uuid,uuid,text,uuid,text,jsonb,text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_public_translation_request(uuid,uuid,text,uuid,text,jsonb,text,jsonb,text,uuid) TO service_role;

-- Shared worker entry: public requests assert the retained anonymous authority;
-- staff requests keep the existing membership and publication-version checks.
CREATE FUNCTION public.assert_translation_generation_authority(p_request uuid,p_field uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request public.engagement_translation_generation_requests; job public.engagement_translation_generation_fields;
 public_request public.engagement_public_translation_requests; actual jsonb;
BEGIN
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=p_request;
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field AND request_id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation field differs' USING ERRCODE='42501'; END IF;
 IF request.authority_kind='staff' THEN
  PERFORM lock_translation_generation_scope(request.campaign_id,request.actor_id);
  PERFORM assert_translation_generation_source(request.campaign_id,request.locale,job.address);
 ELSE
  SELECT * INTO public_request FROM engagement_public_translation_requests WHERE request_id=request.id;
  IF NOT FOUND OR public_request.campaign_id<>request.campaign_id OR public_request.locale<>request.locale THEN
   RAISE EXCEPTION 'Public generation authority missing' USING ERRCODE='42501';
  END IF;
  actual:=lock_public_translation_source(public_request.campaign_id,public_request.share_token_hash,public_request.item_id);
  IF actual IS DISTINCT FROM public_request.source_snapshot OR actual->>'workspaceId' IS DISTINCT FROM request.workspace_id::text THEN
   RAISE EXCEPTION 'Public generation source changed' USING ERRCODE='PT409';
  END IF;
 END IF;
 PERFORM assert_translation_generation_selection(request.workspace_id,request.credential,request.selected_key_ciphertext_hash);
END $$;
REVOKE ALL ON FUNCTION public.assert_translation_generation_authority(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.claim_translation_generation_field(p_field uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 active_reservations bigint; recent_dispatches bigint; bucket_keys text[]; allowance integer; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation field missing' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 bucket_keys:=CASE WHEN request.authority_kind='public' THEN ARRAY['engagement_public_translation'] ELSE ARRAY['assistant_chat','grant_narrative_draft','engagement_synthesis','engagement_moderation','document_narrative_draft','rtp_document_extraction','engagement_content_translation'] END;
 allowance:=CASE WHEN request.authority_kind='public' THEN 30 ELSE 20 END;
 PERFORM assert_translation_generation_authority(request.id,job.id);
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 IF job.state IN ('reserved','running') AND job.lease_expires_at<=clock_timestamp() THEN
  UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code='translation_attempt_expired',finished_at=clock_timestamp() WHERE id=job.id;
  PERFORM set_config('lock_timeout',old_timeout,true); RETURN NULL;
 END IF;
 IF job.state<>'queued' THEN PERFORM set_config('lock_timeout',old_timeout,true); RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(CASE WHEN request.authority_kind='public' THEN 'public_translation_dispatch:' ELSE 'assistant_api_dispatch:' END||request.workspace_id::text,0));
 SELECT count(*) INTO recent_dispatches FROM usage_events WHERE workspace_id=request.workspace_id
  AND bucket_key=ANY(bucket_keys)
  AND occurred_at>=clock_timestamp()-interval '300 seconds';
 SELECT count(*) INTO active_reservations FROM engagement_translation_generation_fields f JOIN engagement_translation_generation_requests r ON r.id=f.request_id
  WHERE r.workspace_id=request.workspace_id AND r.authority_kind=request.authority_kind AND f.state='reserved' AND f.lease_expires_at>clock_timestamp();
 IF recent_dispatches+active_reservations>=allowance THEN RAISE EXCEPTION 'Translation dispatch allowance reserved' USING ERRCODE='PT429'; END IF;
 UPDATE engagement_translation_generation_fields SET state='reserved',attempt_id=gen_random_uuid(),reservation_id=gen_random_uuid(),
  reserved_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds' WHERE id=job.id RETURNING * INTO job;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN to_jsonb(job);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation claim is busy' USING ERRCODE='PT503';
END $$;

CREATE OR REPLACE FUNCTION public.authorize_translation_generation_dispatch(p_field uuid,p_attempt uuid,p_reservation uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 recent_dispatches bigint; bucket_keys text[]; allowance integer; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation field missing' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 bucket_keys:=CASE WHEN request.authority_kind='public' THEN ARRAY['engagement_public_translation'] ELSE ARRAY['assistant_chat','grant_narrative_draft','engagement_synthesis','engagement_moderation','document_narrative_draft','rtp_document_extraction','engagement_content_translation'] END;
 allowance:=CASE WHEN request.authority_kind='public' THEN 30 ELSE 20 END;
 PERFORM assert_translation_generation_authority(request.id,job.id);
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 IF p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt OR p_reservation IS NULL OR job.reservation_id IS DISTINCT FROM p_reservation THEN
  RAISE EXCEPTION 'Generation attempt differs' USING ERRCODE='42501';
 END IF;
 IF job.state IN ('reserved','running') AND job.lease_expires_at<=clock_timestamp() THEN
  UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code='translation_attempt_expired',finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 ELSIF job.state='reserved' THEN
  -- Recheck at dispatch as existing staff producers may have consumed capacity
  -- since this reservation was made. A replay of running never records again.
  PERFORM pg_advisory_xact_lock(hashtextextended(CASE WHEN request.authority_kind='public' THEN 'public_translation_dispatch:' ELSE 'assistant_api_dispatch:' END||request.workspace_id::text,0));
  SELECT count(*) INTO recent_dispatches FROM usage_events WHERE workspace_id=request.workspace_id
   AND bucket_key=ANY(bucket_keys)
   AND occurred_at>=clock_timestamp()-interval '300 seconds';
  IF recent_dispatches>=allowance THEN RAISE EXCEPTION 'Translation dispatch allowance consumed' USING ERRCODE='PT429'; END IF;
  INSERT INTO usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,source_route,metadata_json)
   VALUES(request.workspace_id,job.id::text,CASE WHEN request.authority_kind='public' THEN 'engagement_public_translation' ELSE 'engagement_content_translation' END,1,'translation_dispatch:'||job.attempt_id::text,
    CASE WHEN request.authority_kind='public' THEN '/api/engage/[shareToken]/items/[itemId]/translate' ELSE '/api/engagement/campaigns/translations/generation' END,jsonb_build_object('dispatchReservation',true,'attemptId',job.attempt_id,'reservationId',job.reservation_id));
  UPDATE engagement_translation_generation_fields SET state='running',dispatch_authorized_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 END IF;
 -- Acknowledgement is authorization, not proof the provider received a call.
 -- The worker journal decides whether it can invoke or must report uncertainty.
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('fieldId',job.id,'attemptId',job.attempt_id,'reservationId',job.reservation_id,'state',job.state,'leaseExpiresAt',job.lease_expires_at);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation dispatch is busy' USING ERRCODE='PT503';
END $$;

CREATE OR REPLACE FUNCTION public.read_translation_generation_status(p_field uuid,p_attempt uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 failure text; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND OR p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt THEN RAISE EXCEPTION 'Generation attempt differs' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 BEGIN
  PERFORM assert_translation_generation_authority(request.id,job.id);
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

CREATE OR REPLACE FUNCTION public.read_translation_generation_request(p_campaign uuid,p_request uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request public.engagement_translation_generation_requests; fields jsonb; workspace uuid;
 old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_read_scope(p_campaign,auth.uid());
 SELECT * INTO request FROM engagement_translation_generation_requests WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace AND authority_kind='staff';
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation request is not available' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'address',f.address,'packetCanonical',f.packet_canonical,'packetHash',f.packet_hash,
   'state',f.state,'attemptId',f.attempt_id,'reservationId',f.reservation_id,'leaseExpiresAt',f.lease_expires_at,'failureCode',f.failure_code,
   'output',CASE WHEN o.field_id IS NULL THEN NULL ELSE jsonb_build_object('status',o.status,'outputJson',o.output_json,
    'bindingCanonical',o.binding_canonical,'providerMetadataJson',o.provider_metadata_json,'digest',o.delivery_digest,'acceptedState',o.accepted_state) END)
   ORDER BY f.ordinal),'[]'::jsonb) INTO fields
 FROM engagement_translation_generation_fields f LEFT JOIN engagement_translation_generation_outputs o ON o.field_id=f.id AND o.attempt_id=f.attempt_id
 WHERE f.request_id=request.id;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('schema',1,'requestId',request.id,'campaignId',request.campaign_id,'workspaceId',request.workspace_id,
  'actorId',request.actor_id,'locale',request.locale,'createdAt',request.created_at,
  'credential',jsonb_build_object('id',request.credential->>'credentialId','configurationHash',request.credential->>'configurationHash',
    'model',request.credential#>>'{configuration,modelId}','source',request.credential->>'source'),
  'fields',fields,'count',jsonb_array_length(request.intent->'fields'));
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Generation request is busy; retry the read' USING ERRCODE='PT503';
END $$;

CREATE OR REPLACE FUNCTION public.list_translation_generation_requests(p_campaign uuid,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_read_scope(p_campaign,auth.uid());
 IF (p_before_created_at IS NULL) IS DISTINCT FROM (p_before_id IS NULL) THEN
  RAISE EXCEPTION 'Both pagination cursor values are required' USING ERRCODE='22023';
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT r.* FROM engagement_translation_generation_requests r
  WHERE r.campaign_id=p_campaign AND r.workspace_id=workspace AND r.authority_kind='staff'
   AND (p_before_created_at IS NULL OR (r.created_at,r.id)<(p_before_created_at,p_before_id))
  ORDER BY r.created_at DESC,r.id DESC LIMIT 21
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT 20
 ), rows AS (
  SELECT r.id,r.created_at,jsonb_build_object('id',r.id,'actorId',r.actor_id,'locale',r.locale,
   'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'fieldCount',jsonb_array_length(r.intent->'fields'),'counts',
   (SELECT jsonb_build_object('queued',count(*) FILTER(WHERE f.state='queued'),'reserved',count(*) FILTER(WHERE f.state='reserved'),
    'running',count(*) FILTER(WHERE f.state='running'),'completed',count(*) FILTER(WHERE f.state='completed'),
    'incomplete',count(*) FILTER(WHERE f.state='incomplete'),'failed',count(*) FILTER(WHERE f.state='failed'),
    'interrupted',count(*) FILTER(WHERE f.state='interrupted'),'cancelled',count(*) FILTER(WHERE f.state='cancelled'))
    FROM engagement_translation_generation_fields f WHERE f.request_id=r.id)) AS value
  FROM page r
 )
 SELECT jsonb_build_object('schema',1,'campaignId',p_campaign,'workspaceId',workspace,
  'requests',coalesce((SELECT jsonb_agg(value ORDER BY created_at DESC,id DESC) FROM rows),'[]'::jsonb),
  'next',CASE WHEN (SELECT count(*) FROM candidates)>20 THEN
   (SELECT jsonb_build_object('createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',id)
    FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END) INTO result;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN result;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Generation request list is busy; retry the read' USING ERRCODE='PT503';
END $$;

-- The public HTTP route may return only this DTO. Stored credentials, packet,
-- provider metadata and staff requests never enter it. Recheck current public
-- authority even for completed output; removing a comment withdraws its copy.
CREATE FUNCTION public.read_public_translation_request(p_request uuid,p_share_token text,p_item uuid,p_snapshot jsonb DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source jsonb; saved public.engagement_public_translation_requests; job public.engagement_translation_generation_fields;
 output public.engagement_translation_generation_outputs;
BEGIN
 source:=read_public_translation_source(p_share_token,p_item);
 IF p_snapshot IS NOT NULL AND source IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'Displayed public original changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO saved FROM engagement_public_translation_requests WHERE request_id=p_request AND item_id=p_item
  AND campaign_id=(source->>'campaignId')::uuid AND share_token_hash=encode(extensions.digest(p_share_token,'sha256'),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501'; END IF;
 IF saved.source_snapshot IS DISTINCT FROM source THEN RAISE EXCEPTION 'Public translation source changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE request_id=saved.request_id AND ordinal=1;
 IF job.state IN ('reserved','running') THEN
  PERFORM read_translation_generation_status(job.id,job.attempt_id);
  SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=job.id;
 END IF;
 SELECT * INTO output FROM engagement_translation_generation_outputs WHERE field_id=job.id AND attempt_id=job.attempt_id;
 IF job.state='completed' AND (NOT FOUND OR output.status<>'completed' OR output.accepted_state<>'completed') THEN
  RAISE EXCEPTION 'Public translation output is not retained' USING ERRCODE='PT503';
 END IF;
 RETURN jsonb_build_object('requestId',saved.request_id,'language',saved.locale,'state',job.state,
  'translated',CASE WHEN job.state='completed' THEN output.output_json::jsonb ELSE 'null'::jsonb END);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Public translation read is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.read_public_translation_request(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_translation_request(uuid,text,uuid,jsonb) TO service_role;

-- Discover a retained current request before selecting/sealing another key.
-- For an explicit retry, return only its exact successor. Ordinary discovery
-- follows the leaf of the immutable chain, not a prior failed root.
CREATE FUNCTION public.find_public_translation_request(p_share_token text,p_item uuid,p_locale text,p_previous uuid DEFAULT NULL,p_snapshot jsonb DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source jsonb; request uuid; previous public.engagement_public_translation_requests;
BEGIN
 source:=read_public_translation_source(p_share_token,p_item);
 IF p_snapshot IS NOT NULL AND source IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'Displayed public original changed' USING ERRCODE='PT409'; END IF;
 IF p_previous IS NOT NULL THEN
  SELECT * INTO previous FROM engagement_public_translation_requests WHERE request_id=p_previous AND item_id=p_item
   AND campaign_id=(source->>'campaignId')::uuid AND locale=p_locale AND source_snapshot=source
   AND share_token_hash=encode(extensions.digest(p_share_token,'sha256'),'hex');
  IF NOT FOUND THEN RAISE EXCEPTION 'Public retry does not match this original' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT r.request_id INTO request FROM engagement_public_translation_requests r WHERE r.item_id=p_item AND r.locale=p_locale
  AND r.campaign_id=(source->>'campaignId')::uuid AND r.source_snapshot=source
  AND r.share_token_hash=encode(extensions.digest(p_share_token,'sha256'),'hex')
  AND CASE WHEN p_previous IS NULL THEN NOT EXISTS(SELECT 1 FROM engagement_public_translation_requests next WHERE next.previous_request_id=r.request_id)
   ELSE r.previous_request_id=p_previous END;
 IF request IS NULL THEN RETURN NULL; END IF;
 RETURN read_public_translation_request(request,p_share_token,p_item,source);
END $$;
REVOKE ALL ON FUNCTION public.find_public_translation_request(text,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_public_translation_request(text,uuid,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.read_public_translation_cache(p_share_token text,p_item uuid,p_locale text,p_snapshot jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source jsonb; cached jsonb; source_hash text;
BEGIN
 source:=read_public_translation_source(p_share_token,p_item);
 IF p_snapshot IS NULL OR source IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'Displayed public original changed' USING ERRCODE='PT409'; END IF;
 source_hash:=encode(extensions.digest('['||coalesce(to_json(source->>'title')::text,'null')||','||to_json(source->>'body')::text||']','sha256'),'hex');
 SELECT metadata_json#>ARRAY['ai_translations',p_locale] INTO cached FROM engagement_items WHERE id=p_item;
 IF cached->>'sourceHash' IS DISTINCT FROM source_hash OR jsonb_typeof(cached->'text') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
 RETURN cached->'text';
END $$;
REVOKE ALL ON FUNCTION public.read_public_translation_cache(text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_translation_cache(text,uuid,text,jsonb) TO service_role;
