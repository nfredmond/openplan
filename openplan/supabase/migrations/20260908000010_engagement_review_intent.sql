-- These inputs are consumed by the trigger and never stored on a contribution.
ALTER TABLE public.engagement_items ADD COLUMN review_expected_updated_at timestamptz, ADD COLUMN review_reason text;
CREATE FUNCTION public.require_engagement_review_intent() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.title,NEW.body,NEW.submitted_by,NEW.status,NEW.photo_path,NEW.geometry,NEW.latitude,NEW.longitude,NEW.category_id,NEW.source_type)
 IS DISTINCT FROM ROW(OLD.title,OLD.body,OLD.submitted_by,OLD.status,OLD.photo_path,OLD.geometry,OLD.latitude,OLD.longitude,OLD.category_id,OLD.source_type) THEN
  IF NEW.review_expected_updated_at IS DISTINCT FROM OLD.updated_at THEN
   RAISE EXCEPTION 'Contribution changed or review version missing' USING ERRCODE='40001';
  END IF;
  IF NULLIF(btrim(NEW.review_reason),'') IS NULL THEN
   RAISE EXCEPTION 'A fresh human review reason is required';
  END IF;
  NEW.moderation_notes=NEW.review_reason;
 END IF;
 NEW.review_expected_updated_at=NULL;
 NEW.review_reason=NULL;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_engagement_review_intent() FROM PUBLIC;
CREATE TRIGGER zy_engagement_review_intent BEFORE UPDATE ON public.engagement_items FOR EACH ROW EXECUTE FUNCTION public.require_engagement_review_intent();
CREATE TRIGGER zy_engagement_review_intent_insert BEFORE INSERT ON public.engagement_items FOR EACH ROW EXECUTE FUNCTION public.require_engagement_review_intent();
ALTER TABLE public.engagement_items ADD CONSTRAINT engagement_review_intent_consumed CHECK (review_expected_updated_at IS NULL AND review_reason IS NULL);

CREATE OR REPLACE FUNCTION public.queue_engagement_report(p_campaign uuid,p_request uuid,p_scope text,p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE c record; r uuid; j engagement_report_jobs; snap text; cats uuid[]; state_filter text; after_date timestamptz; before_date timestamptz;
BEGIN
 SELECT * INTO c FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Engagement write access required'; END IF;
 IF p_scope NOT IN ('public','internal') THEN RAISE EXCEPTION 'Choose public or internal scope'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('categoryIds','status','from','to')) THEN RAISE EXCEPTION 'Unknown export filter'; END IF;
 SELECT * INTO j FROM engagement_report_jobs WHERE campaign_id=p_campaign AND request_id=p_request;
 IF FOUND THEN
  IF j.scope<>p_scope OR j.filters_json<>p_filters THEN RAISE EXCEPTION 'Request identifier belongs to different export filters'; END IF;
  RETURN jsonb_build_object('jobId',j.id,'reportId',j.report_id,'snapshotSha256',j.snapshot_sha256);
 END IF;
 SELECT array_agg(value::uuid) INTO cats FROM jsonb_array_elements_text(COALESCE(p_filters->'categoryIds','[]'::jsonb));
 state_filter=NULLIF(p_filters->>'status',''); after_date=(p_filters->>'from')::timestamptz; before_date=(p_filters->>'to')::timestamptz;
 IF state_filter IS NOT NULL AND state_filter NOT IN ('pending','approved','rejected','flagged') THEN RAISE EXCEPTION 'Unknown review state'; END IF;
 IF p_scope='public' AND state_filter IS NOT NULL AND state_filter<>'approved' THEN RAISE EXCEPTION 'Public reports contain only published contributions'; END IF;
 IF after_date IS NOT NULL AND before_date IS NOT NULL AND before_date<=after_date THEN RAISE EXCEPTION 'End must follow start'; END IF;
 -- One SQL statement observes one database snapshot for contributions, definitions,
 -- surveys, answers and reviewed follow-through. No offset scan of changing records.
 WITH selected_items AS (
  SELECT i.* FROM engagement_items i WHERE i.campaign_id=p_campaign
   AND (p_scope='internal' OR (i.status='approved' AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM engagement_items parent WHERE parent.id=i.parent_item_id AND parent.campaign_id=p_campaign AND parent.status='approved' AND parent.parent_item_id IS NULL))))
   AND (state_filter IS NULL OR i.status=state_filter) AND (cats IS NULL OR i.category_id=ANY(cats))
   AND (after_date IS NULL OR i.created_at>=after_date) AND (before_date IS NULL OR i.created_at<before_date)
 ), sessions AS (
  SELECT s.* FROM engagement_survey_response_sessions s WHERE s.campaign_id=p_campaign
   AND (p_scope='internal' OR s.status='approved') AND (state_filter IS NULL OR s.status=state_filter)
   AND (after_date IS NULL OR s.created_at>=after_date) AND (before_date IS NULL OR s.created_at<before_date)
 ), answers AS (
  SELECT a.* FROM engagement_survey_answers a JOIN sessions s ON s.id=a.session_id
  WHERE cats IS NULL OR EXISTS(SELECT 1 FROM engagement_configuration_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition_json->'questions') q WHERE v.id=s.configuration_version_id AND q->>'id'=a.question_id::text AND (q->>'category_id')::uuid=ANY(cats))
 )
 SELECT jsonb_build_object('schema',1,'capturedAt',clock_timestamp(),'scope',p_scope,'filters',p_filters,
  'campaign',jsonb_build_object('id',c.id,'title',c.title,'summary',c.summary,'projectId',c.project_id,'configurationVersionId',c.configuration_version_id),
  'items',COALESCE((SELECT jsonb_agg((to_jsonb(i)-ARRAY['metadata_json','request_id','request_sha256','created_by','review_reason','review_expected_updated_at']) - CASE WHEN p_scope='public' THEN ARRAY['moderation_notes'] ELSE ARRAY[]::text[] END ORDER BY i.created_at,i.id) FROM selected_items i),'[]'::jsonb),
  'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)-ARRAY['metadata_json','respondent_fingerprint','created_by','request_id','request_sha256'] - CASE WHEN p_scope='public' THEN ARRAY['moderation_notes','submitted_by'] ELSE ARRAY[]::text[] END ORDER BY s.created_at,s.id) FROM sessions s),'[]'::jsonb),
  'answers',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.session_id,a.id) FROM answers a),'[]'::jsonb),
  'definitions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sha256',v.definition_sha256,'definition',v.definition_json) ORDER BY v.created_at,v.id) FROM engagement_configuration_versions v WHERE v.campaign_id=p_campaign AND (v.id=c.configuration_version_id OR v.id IN(SELECT configuration_version_id FROM selected_items UNION SELECT configuration_version_id FROM sessions))),'[]'::jsonb),
  'responses',COALESCE((SELECT jsonb_agg(to_jsonb(e)-ARRAY['created_by','updated_by'] ORDER BY e.sort_order,e.id) FROM engagement_closeloop_entries e WHERE e.campaign_id=p_campaign AND e.status='published'
    AND NOT EXISTS(SELECT 1 FROM unnest(e.source_item_ids) source_id WHERE NOT EXISTS(SELECT 1 FROM selected_items i WHERE i.id=source_id))),'[]'::jsonb)
 )::text INTO snap;
 INSERT INTO reports(workspace_id,engagement_campaign_id,title,report_type,status,created_by)
 VALUES(c.workspace_id,c.id,c.title||' - engagement review','board_packet','draft',auth.uid()) RETURNING id INTO r;
 INSERT INTO engagement_report_jobs(workspace_id,campaign_id,report_id,requested_by,request_id,scope,filters_json,snapshot_text,snapshot_sha256)
 VALUES(c.workspace_id,c.id,r,auth.uid(),p_request,p_scope,p_filters,snap,encode(digest(snap,'sha256'),'hex')) RETURNING * INTO j;
 RETURN jsonb_build_object('jobId',j.id,'reportId',j.report_id,'snapshotSha256',j.snapshot_sha256);
END $$;
