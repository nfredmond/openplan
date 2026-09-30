-- Private request custody only. No provider dispatch or generation claim is enabled.
-- Sources and API revisions are retained by reference; browser requests carry no source text or secrets.
CREATE TABLE public.engagement_synthesis_generation_requests (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL,
 source_id uuid NOT NULL REFERENCES public.engagement_synthesis_sources(id),
 configuration_revision_id uuid NOT NULL REFERENCES public.workspace_provider_api_revisions(id),
 intent_text text NOT NULL CHECK(intent_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(intent_text)<=4096),
 intent_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(intent_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.engagement_synthesis_generation_cancellations (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL,
 receipt_text text NOT NULL CHECK(receipt_text IS JSON OBJECT WITH UNIQUE KEYS),
 receipt_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(receipt_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX synthesis_generation_requests_campaign ON public.engagement_synthesis_generation_requests(campaign_id,created_at,id);
CREATE INDEX synthesis_generation_cancellations_campaign ON public.engagement_synthesis_generation_cancellations(campaign_id,created_at,id);
ALTER TABLE public.engagement_synthesis_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_synthesis_generation_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_generation_requests,public.engagement_synthesis_generation_cancellations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_generation_requests,public.engagement_synthesis_generation_cancellations TO service_role;
CREATE TRIGGER synthesis_generation_request_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_generation_requests
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
CREATE TRIGGER synthesis_generation_cancellation_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_generation_cancellations
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Share locks fence membership/campaign changes. One request lock serializes
-- creation and cancellation, including a cancellation that arrives first.
CREATE FUNCTION public.lock_synthesis_generation_request_scope(p_campaign uuid,p_request uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid;
BEGIN
 SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;
 IF auth.uid() IS NULL OR workspace IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members m
  WHERE m.workspace_id=workspace AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=p_campaign AND workspace_id=workspace FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request identity required' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||p_request::text,0)) THEN
  RAISE EXCEPTION 'Synthesis request is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 RETURN workspace;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Synthesis request is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_generation_request_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_generation_request(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; saved public.engagement_synthesis_generation_requests;
 cancelled public.engagement_synthesis_generation_cancellations;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace;
 SELECT * INTO cancelled FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request AND campaign_id=p_campaign AND workspace_id=workspace;
 IF saved.id IS NULL AND cancelled.id IS NULL THEN RAISE EXCEPTION 'Synthesis request not accessible' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'campaignId',p_campaign,'workspaceId',workspace,
  'request',CASE WHEN saved.id IS NULL THEN NULL ELSE jsonb_build_object('id',saved.id,'actorId',saved.actor_id,
   'intentText',saved.intent_text,'intentSha256',saved.intent_sha256,'createdAt',saved.created_at) END,
  'cancellation',CASE WHEN cancelled.id IS NULL THEN NULL ELSE jsonb_build_object('id',cancelled.id,
   'receiptText',cancelled.receipt_text,'receiptSha256',cancelled.receipt_sha256,'createdAt',cancelled.created_at) END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_generation_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_generation_request(uuid,uuid) TO authenticated;

CREATE FUNCTION public.create_engagement_synthesis_generation_request(p_campaign uuid,p_request uuid,p_intent_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; intent jsonb; source public.engagement_synthesis_sources;
 connection public.workspace_provider_api_connections; revision public.workspace_provider_api_revisions;
 saved public.engagement_synthesis_generation_requests; cancelled public.engagement_synthesis_generation_cancellations;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF FOUND THEN
  IF saved.campaign_id IS DISTINCT FROM p_campaign OR saved.workspace_id IS DISTINCT FROM workspace OR saved.actor_id IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Synthesis request not accessible' USING ERRCODE='42501';
  END IF;
  IF saved.intent_text IS DISTINCT FROM p_intent_text THEN RAISE EXCEPTION 'Synthesis request retry differs' USING ERRCODE='PT409'; END IF;
  -- Lost acknowledgements return the original even after cancellation, revision change or key loss.
  RETURN read_engagement_synthesis_generation_request(p_campaign,p_request)||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO cancelled FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request;
 IF cancelled.id IS NOT NULL THEN
  IF cancelled.campaign_id IS DISTINCT FROM p_campaign OR cancelled.workspace_id IS DISTINCT FROM workspace OR cancelled.actor_id IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Synthesis request not accessible' USING ERRCODE='42501';
  END IF;
  RAISE EXCEPTION 'Synthesis request was cancelled; retain its receipt' USING ERRCODE='PT409';
 END IF;
 IF p_intent_text IS NULL OR octet_length(p_intent_text)>4096 OR p_intent_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid synthesis request intent' USING ERRCODE='22023';
 END IF;
 intent:=p_intent_text::jsonb;
 IF NOT intent ?& ARRAY['schemaVersion','sourceId','sourceSha256','connectionId','configurationRevisionId','configurationHash','modelId','taskByteLimit']
 OR (SELECT count(*) FROM jsonb_object_keys(intent))<>8 OR intent->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(intent) e WHERE e.key IN ('sourceId','sourceSha256','connectionId','configurationRevisionId','configurationHash','modelId') AND jsonb_typeof(e.value)<>'string')
 OR intent->>'sourceSha256' !~ '^[a-f0-9]{64}$' OR intent->>'configurationHash' !~ '^[a-f0-9]{64}$'
 OR length(intent->>'modelId') NOT BETWEEN 1 AND 160 OR intent->>'modelId' ~ '[[:space:][:cntrl:]]'
 OR jsonb_typeof(intent->'taskByteLimit') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Invalid synthesis request intent' USING ERRCODE='22023';
 END IF;
 IF (intent->>'taskByteLimit')::numeric NOT BETWEEN 4096 AND 1048576
 OR (intent->>'taskByteLimit')::numeric<>trunc((intent->>'taskByteLimit')::numeric) THEN
  RAISE EXCEPTION 'Invalid synthesis task byte limit' USING ERRCODE='22023';
 END IF;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=(intent->>'sourceId')::uuid;
 IF NOT FOUND OR source.campaign_id IS DISTINCT FROM p_campaign OR source.workspace_id IS DISTINCT FROM workspace
 OR source.snapshot_sha256 IS DISTINCT FROM intent->>'sourceSha256' THEN
  RAISE EXCEPTION 'Retained synthesis source differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO connection FROM workspace_provider_api_connections WHERE id=(intent->>'connectionId')::uuid AND workspace_id=workspace FOR SHARE NOWAIT;
 IF NOT FOUND OR connection.revoked_at IS NOT NULL OR connection.current_revision_id IS DISTINCT FROM (intent->>'configurationRevisionId')::uuid THEN
  RAISE EXCEPTION 'Selected API connection is unavailable or changed' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO revision FROM workspace_provider_api_revisions WHERE id=connection.current_revision_id AND connection_id=connection.id AND workspace_id=workspace;
 IF NOT FOUND OR revision.configuration_hash IS DISTINCT FROM intent->>'configurationHash'
 OR NOT (revision.configuration->'modelIds' ? (intent->>'modelId')) THEN
  RAISE EXCEPTION 'Selected API revision or model differs' USING ERRCODE='PT409';
 END IF;
 INSERT INTO engagement_synthesis_generation_requests(id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text)
 VALUES(p_request,p_campaign,workspace,auth.uid(),source.id,revision.id,p_intent_text);
 RETURN read_engagement_synthesis_generation_request(p_campaign,p_request)||jsonb_build_object('replayed',false);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid synthesis request intent' USING ERRCODE='22023';
 WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Synthesis request is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.create_engagement_synthesis_generation_request(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_engagement_synthesis_generation_request(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.cancel_engagement_synthesis_generation_request(p_campaign uuid,p_request uuid,p_cancellation uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; saved public.engagement_synthesis_generation_requests;
 cancelled public.engagement_synthesis_generation_cancellations; receipt text;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 IF p_cancellation IS NULL OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 4000 OR p_reason !~ '[^[:space:]]' THEN
  RAISE EXCEPTION 'Cancellation identity and reason required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO cancelled FROM engagement_synthesis_generation_cancellations WHERE id=p_cancellation OR request_id=p_request;
 IF FOUND THEN
  IF cancelled.campaign_id IS DISTINCT FROM p_campaign OR cancelled.workspace_id IS DISTINCT FROM workspace OR cancelled.actor_id IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Only the original requester can cancel this request' USING ERRCODE='42501';
  END IF;
  IF cancelled.id IS DISTINCT FROM p_cancellation OR cancelled.request_id IS DISTINCT FROM p_request OR cancelled.receipt_text::jsonb->>'reason' IS DISTINCT FROM p_reason THEN
   RAISE EXCEPTION 'Synthesis cancellation retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN read_engagement_synthesis_generation_request(p_campaign,p_request)||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF FOUND AND (saved.campaign_id IS DISTINCT FROM p_campaign OR saved.workspace_id IS DISTINCT FROM workspace OR saved.actor_id IS DISTINCT FROM auth.uid()) THEN
  RAISE EXCEPTION 'Only the original requester can cancel this request' USING ERRCODE='42501';
 END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'id',p_cancellation,'requestId',p_request,'campaignId',p_campaign,'workspaceId',workspace,
  'actorId',auth.uid(),'reason',p_reason,'requestExisted',saved.id IS NOT NULL,'cancelledAt',clock_timestamp())::text;
 INSERT INTO engagement_synthesis_generation_cancellations(id,request_id,campaign_id,workspace_id,actor_id,receipt_text)
 VALUES(p_cancellation,p_request,p_campaign,workspace,auth.uid(),receipt);
 RETURN read_engagement_synthesis_generation_request(p_campaign,p_request)||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.cancel_engagement_synthesis_generation_request(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_engagement_synthesis_generation_request(uuid,uuid,uuid,text) TO authenticated;
