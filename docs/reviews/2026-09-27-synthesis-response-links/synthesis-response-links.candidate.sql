-- Rollback-only candidate. Do not install until source-change and public-read joins are complete.
-- These are private relationships, never authority to publish their source material.
CREATE TABLE public.engagement_synthesis_response_events (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 review_id uuid NOT NULL REFERENCES public.engagement_synthesis_reviews(id),
 response_id uuid NOT NULL,
 group_id text NOT NULL,
 event_no integer NOT NULL CHECK(event_no>0),
 predecessor_id uuid,
 predecessor_sha256 text,
 actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('link','refresh','withdraw')),
 intent_json jsonb NOT NULL CHECK(jsonb_typeof(intent_json)='object'),
 context_text text NOT NULL CHECK(context_text IS JSON OBJECT),
 context_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(context_text,'sha256'),'hex')) STORED,
 event_text text NOT NULL CHECK(event_text IS JSON OBJECT),
 event_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(event_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL,
 UNIQUE(campaign_id,workspace_id,review_id,response_id,group_id,event_no),
 UNIQUE(campaign_id,workspace_id,review_id,response_id,group_id,id,event_sha256),
 UNIQUE NULLS NOT DISTINCT(campaign_id,workspace_id,review_id,response_id,group_id,predecessor_id),
 CONSTRAINT synthesis_response_predecessor FOREIGN KEY(campaign_id,workspace_id,review_id,response_id,group_id,predecessor_id,predecessor_sha256)
  REFERENCES public.engagement_synthesis_response_events(campaign_id,workspace_id,review_id,response_id,group_id,id,event_sha256),
 CHECK((event_no=1 AND predecessor_id IS NULL AND predecessor_sha256 IS NULL AND operation='link')
  OR (event_no>1 AND predecessor_id IS NOT NULL AND predecessor_sha256 IS NOT NULL AND operation IN ('refresh','withdraw'))),
 CHECK(id IS DISTINCT FROM predecessor_id),
 CHECK(event_text::jsonb#>>'{context,contextText}'=context_text),
 CHECK(event_text::jsonb#>>'{context,contextSha256}'=encode(extensions.digest(context_text,'sha256'),'hex'))
);
-- Dependencies use retained source identities, not foreign keys to deletable live contributions.
CREATE TABLE public.engagement_synthesis_response_members (
 event_id uuid NOT NULL REFERENCES public.engagement_synthesis_response_events(id),
 source_kind text NOT NULL CHECK(source_kind IN ('item','answer')),
 source_id uuid NOT NULL,
 PRIMARY KEY(event_id,source_kind,source_id)
);
CREATE INDEX synthesis_response_members_source ON public.engagement_synthesis_response_members(source_kind,source_id,event_id);
ALTER TABLE public.engagement_synthesis_response_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_synthesis_response_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_response_events,public.engagement_synthesis_response_members FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_response_events,public.engagement_synthesis_response_members TO service_role;
CREATE TRIGGER synthesis_response_events_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_response_events
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
CREATE TRIGGER synthesis_response_members_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_response_members
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.engagement_synthesis_response_packet(p_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('eventText',event_text,'eventSha256',event_sha256)
 FROM engagement_synthesis_response_events WHERE id=p_event;
$$;
REVOKE ALL ON FUNCTION public.engagement_synthesis_response_packet(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The writer holds the review and response locks before obtaining this current context.
-- JSON equality permits transport formatting; every retained text field remains byte-exact.
CREATE FUNCTION public.engagement_synthesis_response_current(p_campaign uuid,p_workspace uuid,p_review uuid,p_response uuid,p_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE root engagement_synthesis_reviews; source engagement_synthesis_sources;
 revision engagement_synthesis_review_revisions; approval engagement_synthesis_approval_events;
 history engagement_response_history; response engagement_closeloop_entries;
BEGIN
 SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=p_review AND campaign_id=p_campaign AND workspace_id=p_workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved review is unavailable' USING ERRCODE='PT409'; END IF;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=root.source_id AND campaign_id=p_campaign AND workspace_id=p_workspace;
 SELECT * INTO revision FROM engagement_synthesis_review_revisions WHERE review_id=root.id ORDER BY revision_no DESC LIMIT 1;
 SELECT * INTO approval FROM engagement_synthesis_approval_events WHERE review_id=root.id ORDER BY event_no DESC LIMIT 1;
 IF source.id IS NULL OR source.snapshot_sha256 IS DISTINCT FROM root.source_sha256 OR revision.id IS NULL
  OR approval.id IS NULL OR approval.operation<>'approve' OR approval.revision_id IS DISTINCT FROM revision.id THEN
  RAISE EXCEPTION 'Approve the current retained review before linking' USING ERRCODE='PT409';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(revision.content_text::jsonb->'groups') g WHERE g->>'id'=p_group)<>1 THEN
  RAISE EXCEPTION 'Saved review group is unavailable' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO response FROM engagement_closeloop_entries WHERE id=p_response AND campaign_id=p_campaign FOR SHARE NOWAIT;
 SELECT * INTO history FROM engagement_response_history WHERE response_id=p_response AND campaign_id=p_campaign ORDER BY revision DESC LIMIT 1;
 IF response.id IS NULL OR history.id IS NULL OR history.event='removed' OR history.record_json IS DISTINCT FROM to_jsonb(response) THEN
  RAISE EXCEPTION 'Current response history differs' USING ERRCODE='PT409';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'visibility','private','purpose','reviewed_synthesis_response',
  'campaignId',p_campaign,'workspaceId',p_workspace,'reviewId',p_review,'responseId',p_response,
  'sourceId',root.source_id,'sourceSha256',root.source_sha256,
  'source',jsonb_build_object('requestId',source.id,'campaignId',source.campaign_id,'workspaceId',source.workspace_id,
   'snapshotText',source.snapshot_text,'snapshotSha256',source.snapshot_sha256,'createdAt',source.created_at),
  'preparationText',root.preparation_text,'preparationSha256',root.preparation_sha256,
  'revision',jsonb_build_object('id',revision.id,'number',revision.revision_no,'contentText',revision.content_text,'contentSha256',revision.content_sha256),
  'approval',public.engagement_synthesis_approval_packet(approval.id),'groupId',p_group,
  'responseHistory',jsonb_build_object('id',history.id,'campaign_id',history.campaign_id,'response_id',history.response_id,
   'revision',history.revision,'actor_id',history.actor_id,'recorded_at',history.recorded_at,'event',history.event,
   'recordText',history.record_json::text,'record_sha256',history.record_sha256,'write_request_id',history.write_request_id,
   'change_reason',history.change_reason,'change_origin',history.change_origin));
END $$;
REVOKE ALL ON FUNCTION public.engagement_synthesis_response_current(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.retain_engagement_synthesis_response_link(p_campaign uuid,p_actor uuid,p_workspace uuid,p_intent jsonb,p_context_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; request uuid; review uuid; response uuid; selected_group text; operation text; field text;
 previous engagement_synthesis_response_events; saved engagement_synthesis_response_events;
 current_context jsonb; context_text text; context_sha text; event_text text; recorded_at timestamptz;
BEGIN
 IF p_actor IS NULL OR p_workspace IS NULL THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c WHERE c.id=p_campaign FOR SHARE NOWAIT;
 IF NOT FOUND OR workspace IS DISTINCT FROM p_workspace OR NOT EXISTS(SELECT 1 FROM workspace_members m
  WHERE m.workspace_id=workspace AND m.user_id=p_actor AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR NOT p_intent ?& ARRAY[
  'campaignId','workspaceId','reviewId','responseId','groupId','requestId','actorId','operation','reason','predecessorId','predecessorSha256','expectedContextSha256']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN (
   'campaignId','workspaceId','reviewId','responseId','groupId','requestId','actorId','operation','reason','predecessorId','predecessorSha256','expectedContextSha256')) THEN
  RAISE EXCEPTION 'Invalid synthesis response intent' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['campaignId','workspaceId','reviewId','responseId','requestId','actorId'] LOOP
  IF jsonb_typeof(p_intent->field) IS DISTINCT FROM 'string' OR p_intent->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   RAISE EXCEPTION 'Invalid synthesis response identifier' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF p_intent->>'actorId' IS DISTINCT FROM p_actor::text OR p_intent->>'workspaceId' IS DISTINCT FROM workspace::text
  OR p_intent->>'campaignId' IS DISTINCT FROM p_campaign::text THEN
  RAISE EXCEPTION 'Synthesis response actor or workspace differs' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_intent->'groupId') IS DISTINCT FROM 'string' OR p_intent->>'groupId' !~ '^[a-zA-Z0-9_-]{1,100}$'
  OR jsonb_typeof(p_intent->'operation') IS DISTINCT FROM 'string' OR p_intent->>'operation' NOT IN ('link','refresh','withdraw')
  OR jsonb_typeof(p_intent->'reason') IS DISTINCT FROM 'string' OR length(p_intent->>'reason')>2000
  OR (p_intent->>'reason') !~ U&'[^[:space:]\FEFF]' THEN
  RAISE EXCEPTION 'Invalid synthesis response operation or reason' USING ERRCODE='22023';
 END IF;
 request:=(p_intent->>'requestId')::uuid; review:=(p_intent->>'reviewId')::uuid; response:=(p_intent->>'responseId')::uuid;
 selected_group:=p_intent->>'groupId'; operation:=p_intent->>'operation';
 IF (operation='link') IS DISTINCT FROM (p_intent->'predecessorId'='null'::jsonb)
  OR (p_intent->'predecessorId'='null'::jsonb) IS DISTINCT FROM (p_intent->'predecessorSha256'='null'::jsonb)
  OR (p_intent->'predecessorId'<>'null'::jsonb AND (
   jsonb_typeof(p_intent->'predecessorId') IS DISTINCT FROM 'string' OR p_intent->>'predecessorId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(p_intent->'predecessorSha256') IS DISTINCT FROM 'string' OR p_intent->>'predecessorSha256' !~ '^[a-f0-9]{64}$'
   OR p_intent->>'predecessorId'=request::text))
  OR (operation='withdraw' AND (p_intent->'expectedContextSha256'<>'null'::jsonb OR p_context_text IS NOT NULL))
  OR (operation<>'withdraw' AND (jsonb_typeof(p_intent->'expectedContextSha256') IS DISTINCT FROM 'string'
   OR p_intent->>'expectedContextSha256' !~ '^[a-f0-9]{64}$' OR (p_context_text IS JSON OBJECT) IS NOT TRUE)) THEN
  RAISE EXCEPTION 'Invalid synthesis response predecessor or context' USING ERRCODE='22023';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-response-request:'||request::text,0)) THEN
  RAISE EXCEPTION 'Synthesis response save is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO saved FROM engagement_synthesis_response_events WHERE id=request;
 IF FOUND THEN
  IF saved.intent_json IS DISTINCT FROM p_intent OR saved.actor_id IS DISTINCT FROM p_actor
   OR (operation<>'withdraw' AND saved.context_text IS DISTINCT FROM p_context_text) THEN
   RAISE EXCEPTION 'Synthesis response retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN jsonb_build_object('event',public.engagement_synthesis_response_packet(request),'replayed',true);
 END IF;
 -- Nonblocking shared locks avoid cycles with source writes that already own row locks.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-review:'||review::text,0))
  OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Synthesis response save is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO previous FROM engagement_synthesis_response_events WHERE campaign_id=p_campaign AND workspace_id=workspace
  AND review_id=review AND response_id=response AND group_id=selected_group ORDER BY event_no DESC LIMIT 1;
 IF previous.id::text IS DISTINCT FROM p_intent->>'predecessorId' OR previous.event_sha256 IS DISTINCT FROM p_intent->>'predecessorSha256' THEN
  RAISE EXCEPTION 'Synthesis response history changed' USING ERRCODE='PT409';
 END IF;
 IF operation='withdraw' THEN
  IF previous.id IS NULL OR previous.operation='withdraw' THEN RAISE EXCEPTION 'No active synthesis response link' USING ERRCODE='PT409'; END IF;
  context_text:=previous.context_text;
 ELSE
  current_context:=public.engagement_synthesis_response_current(p_campaign,workspace,review,response,selected_group);
  IF p_context_text::jsonb IS DISTINCT FROM current_context
   OR encode(extensions.digest(p_context_text,'sha256'),'hex') IS DISTINCT FROM p_intent->>'expectedContextSha256' THEN
   RAISE EXCEPTION 'Synthesis response context changed' USING ERRCODE='PT409';
  END IF;
  context_text:=p_context_text;
  IF previous.operation<>'withdraw' AND previous.context_text::jsonb=context_text::jsonb THEN
   RAISE EXCEPTION 'Synthesis response refresh changes nothing' USING ERRCODE='22023';
  END IF;
 END IF;
 context_sha:=encode(extensions.digest(context_text,'sha256'),'hex'); recorded_at:=clock_timestamp();
 event_text:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_response_link','eventNo',COALESCE(previous.event_no,0)+1,
  'createdAt',recorded_at,'intent',p_intent,'context',jsonb_build_object('contextText',context_text,'contextSha256',context_sha))::text;
 INSERT INTO engagement_synthesis_response_events(id,campaign_id,workspace_id,review_id,response_id,group_id,event_no,predecessor_id,predecessor_sha256,
  actor_id,operation,intent_json,context_text,event_text,created_at)
 VALUES(request,p_campaign,workspace,review,response,selected_group,COALESCE(previous.event_no,0)+1,previous.id,previous.event_sha256,
  p_actor,operation,p_intent,context_text,event_text,recorded_at);
 INSERT INTO engagement_synthesis_response_members(event_id,source_kind,source_id)
 SELECT request,split_part(member,':',1),split_part(member,':',2)::uuid
 FROM jsonb_array_elements((context_text::jsonb#>>'{revision,contentText}')::jsonb->'groups') g
 CROSS JOIN LATERAL jsonb_array_elements_text(g->'sourceIds') member WHERE g->>'id'=selected_group;
 RETURN jsonb_build_object('event',public.engagement_synthesis_response_packet(request),'replayed',false);
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Synthesis response save is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text) TO service_role;

CREATE FUNCTION public.read_engagement_synthesis_response_link(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; event uuid;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT id INTO event FROM engagement_synthesis_response_events WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.engagement_synthesis_response_packet(event);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_response_link(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_response_link(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_engagement_synthesis_response_links(p_campaign uuid,p_review uuid,p_response uuid,p_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 WITH events AS MATERIALIZED (SELECT id,event_no,event_text,event_sha256 FROM engagement_synthesis_response_events
  WHERE campaign_id=p_campaign AND workspace_id=workspace AND review_id=p_review AND response_id=p_response AND group_id=p_group)
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'reviewId',p_review,'responseId',p_response,'groupId',p_group,
  'headId',(SELECT id FROM events ORDER BY event_no DESC LIMIT 1),'headSha256',(SELECT event_sha256 FROM events ORDER BY event_no DESC LIMIT 1),
  'eventCount',(SELECT count(*) FROM events),'entries',COALESCE((SELECT jsonb_agg(public.engagement_synthesis_response_packet(id) ORDER BY event_no) FROM events),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text) TO authenticated;
