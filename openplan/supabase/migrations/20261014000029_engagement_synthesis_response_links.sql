-- Retain approved synthesis links, protect public dependencies, and preserve private navigation.
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

CREATE FUNCTION public.engagement_synthesis_item_meaning(p_item jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT p_item-ARRAY['metadata_json','request_id','request_sha256','created_by','submitted_by',
  'updated_at','votes_count','moderation_notes','review_reason','review_expected_updated_at'];
$$;
REVOKE ALL ON FUNCTION public.engagement_synthesis_item_meaning(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.engagement_synthesis_response_public_allowed(p_campaign uuid,p_response uuid,p_record jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE link engagement_synthesis_response_events; revision engagement_synthesis_review_revisions;
 approval engagement_synthesis_approval_events; item engagement_items; parent engagement_items;
 answer engagement_survey_answers; session engagement_survey_response_sessions;
 context jsonb; snapshot jsonb; retained jsonb; retained_parent jsonb; retained_session jsonb; selected jsonb;
 member record; seen boolean:=false; workspace uuid;
BEGIN
 IF p_record->>'id' IS DISTINCT FROM p_response::text OR p_record->>'campaign_id' IS DISTINCT FROM p_campaign::text THEN RETURN false; END IF;
 SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_response_events WHERE campaign_id=p_campaign AND response_id=p_response) THEN RETURN true; END IF;
 FOR link IN SELECT DISTINCT ON(review_id,group_id) * FROM engagement_synthesis_response_events
  WHERE campaign_id=p_campaign AND response_id=p_response ORDER BY review_id,group_id,event_no DESC
 LOOP
  IF link.operation='withdraw' THEN CONTINUE; END IF;
  seen:=true;
  IF link.workspace_id IS DISTINCT FROM workspace THEN RETURN false; END IF;
  context:=link.context_text::jsonb; snapshot:=(context#>>'{source,snapshotText}')::jsonb;
  -- Status, timestamps and display order change during publication without changing reviewed wording.
  IF ((context#>>'{responseHistory,recordText}')::jsonb-ARRAY['status','published_at','updated_at','sort_order'])
   IS DISTINCT FROM (p_record-ARRAY['status','published_at','updated_at','sort_order']) THEN RETURN false; END IF;
  SELECT * INTO revision FROM engagement_synthesis_review_revisions WHERE review_id=link.review_id ORDER BY revision_no DESC LIMIT 1;
  SELECT * INTO approval FROM engagement_synthesis_approval_events WHERE review_id=link.review_id ORDER BY event_no DESC LIMIT 1;
  IF revision.id::text IS DISTINCT FROM context#>>'{revision,id}' OR approval.operation IS DISTINCT FROM 'approve'
   OR approval.revision_id IS DISTINCT FROM revision.id OR approval.event_text IS DISTINCT FROM context#>>'{approval,eventText}'
   OR approval.event_sha256 IS DISTINCT FROM context#>>'{approval,eventSha256}' THEN RETURN false; END IF;
  SELECT g INTO selected FROM jsonb_array_elements(revision.content_text::jsonb->'groups') g WHERE g->>'id'=link.group_id;
  IF selected IS NULL OR jsonb_array_length(selected->'sourceIds')=0 THEN RETURN false; END IF;
  -- Cross-check the normalized index against the complete retained group before trusting it.
  IF (SELECT COALESCE(jsonb_agg(source_kind||':'||source_id::text ORDER BY source_kind||':'||source_id::text),'[]'::jsonb)
    FROM engagement_synthesis_response_members WHERE event_id=link.id)
   IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(selected->'sourceIds')) THEN RETURN false; END IF;
  FOR member IN SELECT source_kind,source_id FROM engagement_synthesis_response_members WHERE event_id=link.id LOOP
   IF member.source_kind='item' THEN
    SELECT * INTO item FROM engagement_items WHERE id=member.source_id AND campaign_id=p_campaign;
    IF NOT FOUND OR NOT public.engagement_item_public_copy_allowed(item.status,item.metadata_json) THEN RETURN false; END IF;
    SELECT v INTO retained FROM jsonb_array_elements(snapshot->'items') v WHERE v->>'id'=member.source_id::text;
    IF retained IS NULL OR public.engagement_synthesis_item_meaning(retained) IS DISTINCT FROM public.engagement_synthesis_item_meaning(to_jsonb(item)) THEN RETURN false; END IF;
    IF item.parent_item_id IS NOT NULL THEN
     SELECT * INTO parent FROM engagement_items WHERE id=item.parent_item_id AND campaign_id=p_campaign AND parent_item_id IS NULL;
     SELECT v INTO retained_parent FROM jsonb_array_elements(snapshot->'items') v WHERE v->>'id'=item.parent_item_id::text;
     IF parent.id IS NULL OR NOT public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)
      OR retained_parent IS NULL OR public.engagement_synthesis_item_meaning(retained_parent) IS DISTINCT FROM public.engagement_synthesis_item_meaning(to_jsonb(parent)) THEN RETURN false; END IF;
    END IF;
   ELSE
    SELECT * INTO answer FROM engagement_survey_answers WHERE id=member.source_id AND campaign_id=p_campaign;
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT v INTO retained FROM jsonb_array_elements(snapshot->'answers') v WHERE v->>'id'=member.source_id::text;
    IF retained IS NULL OR retained IS DISTINCT FROM to_jsonb(answer) THEN RETURN false; END IF;
    SELECT * INTO session FROM engagement_survey_response_sessions WHERE id=answer.session_id AND campaign_id=p_campaign;
    IF NOT FOUND OR NOT public.engagement_item_public_copy_allowed(session.status,session.metadata_json) THEN RETURN false; END IF;
    SELECT v INTO retained_session FROM jsonb_array_elements(snapshot->'sessions') v WHERE v->>'id'=session.id::text;
    IF retained_session IS NULL OR (retained_session-ARRAY['updated_at','moderation_notes']) IS DISTINCT FROM
     (to_jsonb(session)-ARRAY['metadata_json','respondent_fingerprint','created_by','submitted_by','request_id','request_sha256','updated_at','moderation_notes']) THEN RETURN false; END IF;
   END IF;
  END LOOP;
 END LOOP;
 -- A withdrawn final link does not silently restore public eligibility for the same response.
 RETURN seen;
END $$;
REVOKE ALL ON FUNCTION public.engagement_synthesis_response_public_allowed(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Expose only eligibility for an existing response already readable by this caller.
-- The private evaluator remains unavailable for guesses about historical record text.
CREATE FUNCTION public.read_engagement_synthesis_response_public_eligibility(p_campaign uuid,p_response uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE response engagement_closeloop_entries;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND NOT EXISTS(
  SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Response read access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO response FROM engagement_closeloop_entries WHERE id=p_response AND campaign_id=p_campaign;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN public.engagement_synthesis_response_public_allowed(p_campaign,p_response,to_jsonb(response));
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_response_public_eligibility(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_response_public_eligibility(uuid,uuid) TO authenticated,service_role;

-- Keep legacy publication rules and add the complete retained synthesis dependency check.
CREATE OR REPLACE FUNCTION public.guard_engagement_response_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- A fixed snapshot can miss source changes or new links committed before the campaign lock.
 -- Require a fresh snapshot even when no synthesis link is visible in this transaction.
 IF NEW.status='published' AND current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Response publication requires read committed isolation' USING ERRCODE='25001';
 END IF;
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM unnest(NEW.source_item_ids) source_id WHERE NOT EXISTS(
  SELECT 1 FROM engagement_items i WHERE i.id=source_id AND i.campaign_id=NEW.campaign_id AND public.engagement_item_public_copy_allowed(i.status,i.metadata_json)
   AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM engagement_items p WHERE p.id=i.parent_item_id AND p.campaign_id=NEW.campaign_id
    AND public.engagement_item_public_copy_allowed(p.status,p.metadata_json) AND p.parent_item_id IS NULL))
 )) THEN RAISE EXCEPTION 'Review and publish linked contributions before publishing the staff response'; END IF;
 IF NEW.status='published' AND NOT public.engagement_synthesis_response_public_allowed(NEW.campaign_id,NEW.id,to_jsonb(NEW)) THEN
  RAISE EXCEPTION 'Review current synthesis links and their public source copies before publishing this response' USING ERRCODE='PT409';
 END IF;
 RETURN NEW;
END $$;

-- Preserve invoker RLS and the existing explicit projection. No private context enters the snapshot.
CREATE OR REPLACE FUNCTION public.read_engagement_response_snapshot(p_campaign uuid,p_published_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('campaignId',p_campaign,'publishedOnly',p_published_only,'count',count(*),
  'entries',COALESCE(jsonb_agg(to_jsonb(entry) ORDER BY entry.sort_order,entry.created_at,entry.id),'[]'::jsonb))
 FROM (
  SELECT id,campaign_id,category_id,theme_title,you_said,we_did,status,ai_assisted,source_item_ids,sort_order,published_at,created_at,updated_at
  FROM engagement_closeloop_entries
  WHERE campaign_id=p_campaign AND (NOT p_published_only OR (status='published'
   AND public.read_engagement_synthesis_response_public_eligibility(p_campaign,id)
   AND NOT EXISTS(SELECT 1 FROM unnest(source_item_ids) source_id WHERE NOT EXISTS(
    SELECT 1 FROM engagement_items i WHERE i.id=source_id AND i.campaign_id=p_campaign AND public.engagement_item_public_copy_allowed(i.status,i.metadata_json)
     AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM engagement_items p WHERE p.id=i.parent_item_id AND p.campaign_id=p_campaign
      AND p.parent_item_id IS NULL AND public.engagement_item_public_copy_allowed(p.status,p.metadata_json)))
   ))))
 ) entry;
$$;

-- Candidate-only patch against the installed report definition; promotion must retain this exact seam check.
DO $reports$ DECLARE body text; seam text:='AND e.status=''published''';
 session_seam text:='(p_scope=''internal'' OR s.status=''approved'')'; selection text:=$selection$
 AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_response_events link JOIN engagement_synthesis_response_members member ON member.event_id=link.id
  WHERE link.campaign_id=p_campaign AND link.response_id=e.id AND link.operation<>'withdraw'
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_response_events newer WHERE newer.campaign_id=link.campaign_id
    AND newer.response_id=link.response_id AND newer.review_id=link.review_id AND newer.group_id=link.group_id AND newer.event_no>link.event_no)
   AND ((member.source_kind='item' AND NOT EXISTS(SELECT 1 FROM selected_items item WHERE item.id=member.source_id))
    OR (member.source_kind='answer' AND NOT EXISTS(SELECT 1 FROM answers answer WHERE answer.id=member.source_id))))
 $selection$; BEGIN
 body:=pg_get_functiondef('public.queue_engagement_report(uuid,uuid,text,jsonb)'::regprocedure);
 IF (length(body)-length(replace(body,seam,'')))/length(seam)<>1 THEN RAISE EXCEPTION 'Report response eligibility seam differs'; END IF;
 IF (length(body)-length(replace(body,session_seam,'')))/length(session_seam)<>1 THEN RAISE EXCEPTION 'Report survey privacy seam differs'; END IF;
 body:=replace(body,session_seam,'(p_scope=''internal'' OR public.engagement_item_public_copy_allowed(s.status,s.metadata_json))');
 EXECUTE replace(body,seam,seam||' AND (p_scope=''internal'' OR public.engagement_synthesis_response_public_allowed(p_campaign,e.id,to_jsonb(e)))'||selection);
END $reports$;

CREATE FUNCTION public.withdraw_ineligible_synthesis_responses(p_campaign uuid,p_actor uuid,p_kind text,p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE previous engagement_closeloop_entries; saved engagement_closeloop_entries;
 request uuid; workspace uuid; previous_context text;
BEGIN
 -- A fixed snapshot could miss a publication committed before the shared campaign lock.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Synthesis withdrawals require read committed isolation' USING ERRCODE='25001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_response_events WHERE campaign_id=p_campaign) THEN RETURN; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Response publication is busy; retry the source change' USING ERRCODE='PT503';
 END IF;
 SELECT workspace_id INTO STRICT workspace FROM engagement_campaigns WHERE id=p_campaign;
 FOR previous IN SELECT e.* FROM engagement_closeloop_entries e WHERE e.campaign_id=p_campaign AND e.status='published'
  AND NOT public.engagement_synthesis_response_public_allowed(p_campaign,e.id,to_jsonb(e)) ORDER BY e.id FOR UPDATE
 LOOP
  request:=gen_random_uuid();
  INSERT INTO engagement_response_write_receipts(campaign_id,request_id,workspace_id,response_id,actor_id,operation,payload_json,before_record)
  VALUES(p_campaign,request,workspace,previous.id,p_actor,'source_withdrawal',jsonb_build_object(
   'reason','Automatically withdrawn after reviewed synthesis evidence changed',
   'causeKind',p_kind,'causeBefore',p_before,'causeAfter',p_after),to_jsonb(previous));
  previous_context:=current_setting('openplan.response_request',true);
  PERFORM set_config('openplan.response_request',request::text,true);
  UPDATE engagement_closeloop_entries SET status='draft',published_at=NULL WHERE id=previous.id RETURNING * INTO saved;
  PERFORM set_config('openplan.response_request',COALESCE(previous_context,''),true);
  UPDATE engagement_response_write_receipts SET result_json=jsonb_build_object('entry',to_jsonb(saved),'entryId',saved.id,
   'requestId',request,'removed',false,'replayed',false,'becamePublished',false)
   WHERE campaign_id=p_campaign AND request_id=request;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Trigger callers own the changed row already; the nonblocking campaign lock avoids inversion.
CREATE FUNCTION public.reconcile_synthesis_source_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE campaign uuid; actor uuid; before_record jsonb; after_record jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN before_record:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_record:=to_jsonb(NEW); END IF;
 IF before_record IS NOT DISTINCT FROM after_record THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME IN ('engagement_synthesis_review_revisions','engagement_synthesis_approval_events') THEN
  SELECT campaign_id INTO STRICT campaign FROM engagement_synthesis_reviews WHERE id=NEW.review_id;
  actor:=NEW.actor_id;
 ELSE
  campaign:=COALESCE(after_record,before_record)->>'campaign_id'; actor:=auth.uid();
 END IF;
 PERFORM public.withdraw_ineligible_synthesis_responses(campaign,actor,TG_TABLE_NAME,before_record,after_record);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_synthesis_source_publication() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER synthesis_item_publication AFTER UPDATE OR DELETE ON public.engagement_items
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_answer_publication AFTER UPDATE OR DELETE ON public.engagement_survey_answers
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_session_publication AFTER UPDATE OR DELETE ON public.engagement_survey_response_sessions
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_revision_publication AFTER INSERT ON public.engagement_synthesis_review_revisions
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_approval_publication AFTER INSERT ON public.engagement_synthesis_approval_events
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();

-- Reconcile only after the event's complete dependency index is present, never during event insertion.
DO $writer$ DECLARE body text; seam text:=$seam$ RETURN jsonb_build_object('event',public.engagement_synthesis_response_packet(request),'replayed',false);$seam$; BEGIN
 body:=pg_get_functiondef('public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 IF (length(body)-length(replace(body,seam,'')))/length(seam)<>1 THEN RAISE EXCEPTION 'Response link reconciliation seam differs'; END IF;
 EXECUTE replace(body,seam,$call$ PERFORM public.withdraw_ineligible_synthesis_responses(p_campaign,p_actor,'synthesis_response_link',
  CASE WHEN previous.id IS NULL THEN NULL ELSE jsonb_build_object('id',previous.id,'eventSha256',previous.event_sha256) END,
  jsonb_build_object('id',request,'eventSha256',encode(extensions.digest(event_text,'sha256'),'hex')));
$call$||seam);
END $writer$;

-- A service-origin review has an explicit retained actor even when there is no end-user JWT.
-- Only an unfinished private receipt for this exact response can supply history metadata.
DO $history$ DECLARE body text; seam text:='AND r.actor_id IS NOT DISTINCT FROM auth.uid() AND r.result_json IS NULL;';
 actor_seam text:=', auth.uid(),'; BEGIN
 body:=pg_get_functiondef('public.retain_engagement_response_history()'::regprocedure);
 IF (length(body)-length(replace(body,seam,'')))/length(seam)<>1
  OR (length(body)-length(replace(body,actor_seam,'')))/length(actor_seam)<>3 THEN RAISE EXCEPTION 'Response history actor seam differs'; END IF;
 body:=replace(body,seam,'AND (r.actor_id IS NOT DISTINCT FROM auth.uid() OR r.operation = ''source_withdrawal'') AND r.result_json IS NULL;');
 EXECUTE replace(body,actor_seam,', CASE WHEN write_receipt.request_id IS NOT NULL THEN write_receipt.actor_id ELSE auth.uid() END,');
END $history$;

-- Private navigation metadata. Read the verified event history before describing or changing a link.
CREATE FUNCTION public.list_engagement_synthesis_response_links(p_campaign uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_reviews r WHERE r.id=p_review AND r.campaign_id=p_campaign AND r.workspace_id=workspace) THEN RETURN NULL; END IF;
 WITH addresses AS MATERIALIZED (
  SELECT DISTINCT e.response_id,e.group_id FROM engagement_synthesis_response_events e
  WHERE e.campaign_id=p_campaign AND e.workspace_id=workspace AND e.review_id=p_review
 )
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'reviewId',p_review,
  'entryCount',(SELECT count(*) FROM addresses),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('responseId',response_id,'groupId',group_id)
   ORDER BY response_id,group_id COLLATE "C") FROM addresses),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_engagement_synthesis_response_links(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_engagement_synthesis_response_links(uuid,uuid) TO authenticated;
