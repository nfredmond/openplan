-- Rollback-only extension. Current eligibility is separate from immutable historical context.
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
