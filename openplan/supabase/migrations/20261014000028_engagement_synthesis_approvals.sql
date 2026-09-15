-- Approval is internal staff review of exact retained bytes, never a draft status rewrite.
CREATE TABLE public.engagement_synthesis_approval_events (
 id uuid PRIMARY KEY,
 review_id uuid NOT NULL REFERENCES public.engagement_synthesis_reviews(id),
 revision_id uuid NOT NULL REFERENCES public.engagement_synthesis_review_revisions(id),
 event_no integer NOT NULL CHECK(event_no>0),
 predecessor_id uuid REFERENCES public.engagement_synthesis_approval_events(id),
 predecessor_sha256 text CHECK(predecessor_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('approve','withdraw')),
 intent_json jsonb NOT NULL CHECK(jsonb_typeof(intent_json)='object'),
 event_text text NOT NULL CHECK(event_text IS JSON OBJECT),
 event_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(event_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL,
 UNIQUE(review_id,event_no),
 UNIQUE(review_id,id,event_sha256),
 CONSTRAINT engagement_synthesis_approval_predecessor FOREIGN KEY(review_id,predecessor_id,predecessor_sha256)
  REFERENCES public.engagement_synthesis_approval_events(review_id,id,event_sha256),
 UNIQUE NULLS NOT DISTINCT(review_id,predecessor_id),
 CHECK((event_no=1 AND predecessor_id IS NULL AND predecessor_sha256 IS NULL AND operation='approve')
  OR (event_no>1 AND predecessor_id IS NOT NULL AND predecessor_sha256 IS NOT NULL)),
 CHECK(id IS DISTINCT FROM predecessor_id)
);
ALTER TABLE public.engagement_synthesis_approval_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_approval_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_approval_events TO service_role;
CREATE TRIGGER engagement_synthesis_approval_events_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_approval_events
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Private helper; only the checked reader and writer below may return these bytes.
CREATE FUNCTION public.engagement_synthesis_approval_packet(p_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('eventText',event_text,'eventSha256',event_sha256)
 FROM engagement_synthesis_approval_events WHERE id=p_event;
$$;
REVOKE ALL ON FUNCTION public.engagement_synthesis_approval_packet(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The route binds the actor. Membership and both heads are rechecked inside this transaction.
CREATE FUNCTION public.retain_engagement_synthesis_approval(p_campaign uuid,p_actor uuid,p_workspace uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; request uuid; review uuid; revision uuid; operation text; field text;
 root public.engagement_synthesis_reviews; target public.engagement_synthesis_review_revisions; current_revision uuid;
 saved public.engagement_synthesis_approval_events; previous public.engagement_synthesis_approval_events;
 recorded_at timestamptz; next_no integer; event_text text;
BEGIN
 IF p_actor IS NULL OR p_workspace IS NULL THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c WHERE c.id=p_campaign FOR SHARE NOWAIT;
 IF NOT FOUND OR workspace IS DISTINCT FROM p_workspace OR NOT EXISTS(SELECT 1 FROM workspace_members m
  WHERE m.workspace_id=workspace AND m.user_id=p_actor AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR NOT p_intent ?& ARRAY[
  'campaignId','workspaceId','reviewId','sourceId','sourceSha256','preparationSha256','revisionId','revisionSha256','revisionNo',
  'requestId','actorId','operation','reason','predecessorId','predecessorSha256']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN (
   'campaignId','workspaceId','reviewId','sourceId','sourceSha256','preparationSha256','revisionId','revisionSha256','revisionNo',
   'requestId','actorId','operation','reason','predecessorId','predecessorSha256')) THEN
  RAISE EXCEPTION 'Invalid synthesis approval intent' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['campaignId','workspaceId','reviewId','sourceId','revisionId','requestId','actorId'] LOOP
  IF jsonb_typeof(p_intent->field) IS DISTINCT FROM 'string' OR p_intent->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   RAISE EXCEPTION 'Invalid synthesis approval identifier' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['sourceSha256','preparationSha256','revisionSha256'] LOOP
  IF jsonb_typeof(p_intent->field) IS DISTINCT FROM 'string' OR p_intent->>field !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid synthesis approval checksum' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF p_intent->>'actorId' IS DISTINCT FROM p_actor::text OR p_intent->>'workspaceId' IS DISTINCT FROM workspace::text
  OR p_intent->>'campaignId' IS DISTINCT FROM p_campaign::text THEN
  RAISE EXCEPTION 'Synthesis approval actor or workspace differs' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_intent->'revisionNo') IS DISTINCT FROM 'number' OR p_intent->>'revisionNo' !~ '^[1-9][0-9]*$'
  OR (p_intent->>'revisionNo')::numeric>2147483647
  OR jsonb_typeof(p_intent->'reason') IS DISTINCT FROM 'string' OR length(p_intent->>'reason')>2000
  OR (p_intent->>'reason') !~ U&'[^[:space:]\FEFF]' OR jsonb_typeof(p_intent->'operation') IS DISTINCT FROM 'string'
  OR p_intent->>'operation' NOT IN ('approve','withdraw') THEN
  RAISE EXCEPTION 'Invalid synthesis approval operation or reason' USING ERRCODE='22023';
 END IF;
 request:=(p_intent->>'requestId')::uuid; review:=(p_intent->>'reviewId')::uuid;
 revision:=(p_intent->>'revisionId')::uuid; operation:=p_intent->>'operation';
 IF (p_intent->'predecessorId'='null'::jsonb) IS DISTINCT FROM (p_intent->'predecessorSha256'='null'::jsonb)
  OR (operation='withdraw' AND p_intent->'predecessorId'='null'::jsonb)
  OR (p_intent->'predecessorId'<>'null'::jsonb AND (
   jsonb_typeof(p_intent->'predecessorId') IS DISTINCT FROM 'string' OR p_intent->>'predecessorId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(p_intent->'predecessorSha256') IS DISTINCT FROM 'string' OR p_intent->>'predecessorSha256' !~ '^[a-f0-9]{64}$'
   OR p_intent->>'predecessorId'=request::text)) THEN
  RAISE EXCEPTION 'Invalid synthesis approval predecessor' USING ERRCODE='22023';
 END IF;
 -- Match correction's review lock. Request locks are independent because these are different event tables.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-approval-request:'||request::text,0))
  OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-review:'||review::text,0)) THEN
  RAISE EXCEPTION 'Review is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=review AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retained review is unavailable' USING ERRCODE='PT409'; END IF;
 SELECT * INTO saved FROM engagement_synthesis_approval_events WHERE id=request;
 IF FOUND THEN
  IF saved.review_id IS DISTINCT FROM review OR saved.actor_id IS DISTINCT FROM p_actor OR saved.intent_json IS DISTINCT FROM p_intent THEN
   RAISE EXCEPTION 'Synthesis approval retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN jsonb_build_object('event',public.engagement_synthesis_approval_packet(request),'replayed',true);
 END IF;
 IF root.source_id::text IS DISTINCT FROM p_intent->>'sourceId' OR root.source_sha256 IS DISTINCT FROM p_intent->>'sourceSha256'
  OR root.preparation_sha256 IS DISTINCT FROM p_intent->>'preparationSha256' THEN
  RAISE EXCEPTION 'Synthesis approval source differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO target FROM engagement_synthesis_review_revisions WHERE id=revision AND review_id=review;
 IF NOT FOUND OR target.content_sha256 IS DISTINCT FROM p_intent->>'revisionSha256' OR target.revision_no::text IS DISTINCT FROM p_intent->>'revisionNo' THEN
  RAISE EXCEPTION 'Synthesis approval revision differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO previous FROM engagement_synthesis_approval_events WHERE review_id=review ORDER BY event_no DESC LIMIT 1;
 IF previous.id::text IS DISTINCT FROM p_intent->>'predecessorId' OR previous.event_sha256 IS DISTINCT FROM p_intent->>'predecessorSha256' THEN
  RAISE EXCEPTION 'Synthesis approval history has changed' USING ERRCODE='PT409';
 END IF;
 IF operation='approve' THEN
  SELECT id INTO current_revision FROM engagement_synthesis_review_revisions WHERE review_id=review ORDER BY revision_no DESC LIMIT 1;
  IF current_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'Review has a newer revision' USING ERRCODE='PT409'; END IF;
  IF previous.operation='approve' AND previous.revision_id=revision THEN RAISE EXCEPTION 'This revision is already approved' USING ERRCODE='PT409'; END IF;
 ELSE
  IF previous.id IS NULL OR previous.operation<>'approve' OR previous.revision_id IS DISTINCT FROM revision THEN
   RAISE EXCEPTION 'Withdrawal must name the exact preceding approval' USING ERRCODE='PT409';
  END IF;
 END IF;
 next_no:=COALESCE(previous.event_no,0)+1; recorded_at:=clock_timestamp();
 event_text:=jsonb_build_object('schemaVersion',1,'purpose','internal_staff_synthesis','eventNo',next_no,'createdAt',recorded_at,'intent',p_intent)::text;
 INSERT INTO engagement_synthesis_approval_events(id,review_id,revision_id,event_no,predecessor_id,predecessor_sha256,actor_id,operation,intent_json,event_text,created_at)
  VALUES(request,review,revision,next_no,previous.id,previous.event_sha256,p_actor,operation,p_intent,event_text,recorded_at);
 RETURN jsonb_build_object('event',public.engagement_synthesis_approval_packet(request),'replayed',false);
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Review is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_synthesis_approval(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_approval(uuid,uuid,uuid,jsonb) TO service_role;

-- Missing events are null only after checking current staff access, including old exact-request recovery.
CREATE FUNCTION public.read_engagement_synthesis_approval(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; event uuid;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT e.id INTO event FROM engagement_synthesis_approval_events e JOIN engagement_synthesis_reviews r ON r.id=e.review_id
  WHERE e.id=p_request AND r.campaign_id=p_campaign AND r.workspace_id=workspace;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.engagement_synthesis_approval_packet(event);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_approval(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_approval(uuid,uuid) TO authenticated;

-- Complete approval metadata stays private. Content remains in the existing immutable revision reader.
CREATE FUNCTION public.read_engagement_synthesis_approval_history(p_campaign uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; root public.engagement_synthesis_reviews; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=p_review AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND THEN RETURN NULL; END IF;
 WITH events AS MATERIALIZED (SELECT id,event_no,event_text,event_sha256 FROM engagement_synthesis_approval_events WHERE review_id=p_review)
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'reviewId',root.id,'sourceId',root.source_id,
  'sourceSha256',root.source_sha256,'preparationSha256',root.preparation_sha256,
  'headId',(SELECT id FROM events ORDER BY event_no DESC LIMIT 1),'headSha256',(SELECT event_sha256 FROM events ORDER BY event_no DESC LIMIT 1),
  'eventCount',(SELECT count(*) FROM events),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventText',event_text,'eventSha256',event_sha256) ORDER BY event_no) FROM events),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_approval_history(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_approval_history(uuid,uuid) TO authenticated;
