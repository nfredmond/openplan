-- Campaign exports use existing Reports and artifact storage. Only rendering is asynchronous.
CREATE TABLE public.engagement_report_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  report_id uuid NOT NULL REFERENCES public.reports(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  scope text NOT NULL CHECK(scope IN ('public','internal')),
  filters_json jsonb NOT NULL,
  snapshot_text text NOT NULL,
  snapshot_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed','cancelled')),
  phase text NOT NULL DEFAULT 'Waiting for export worker',
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid, lease_until timestamptz,
  artifacts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_detail text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(campaign_id,request_id)
);
ALTER TABLE public.engagement_report_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_report_jobs FROM anon,authenticated;
GRANT SELECT ON public.engagement_report_jobs TO authenticated;
CREATE POLICY engagement_export_read ON public.engagement_report_jobs FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=engagement_report_jobs.workspace_id AND m.user_id=auth.uid() AND (scope='public' OR m.role IN ('owner','admin','member')))
);
CREATE FUNCTION public.guard_engagement_export_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.workspace_id,NEW.campaign_id,NEW.report_id,NEW.requested_by,NEW.request_id,NEW.scope,NEW.filters_json,NEW.snapshot_text,NEW.snapshot_sha256) IS DISTINCT FROM ROW(OLD.workspace_id,OLD.campaign_id,OLD.report_id,OLD.requested_by,OLD.request_id,OLD.scope,OLD.filters_json,OLD.snapshot_text,OLD.snapshot_sha256) THEN
  RAISE EXCEPTION 'The campaign export snapshot and identity are immutable';
 END IF;
 NEW.updated_at=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER engagement_export_snapshot_guard BEFORE UPDATE OR DELETE ON public.engagement_report_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_engagement_export_snapshot();
REVOKE ALL ON FUNCTION public.guard_engagement_export_snapshot() FROM PUBLIC;

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
  'items',COALESCE((SELECT jsonb_agg((to_jsonb(i)-ARRAY['metadata_json','request_id','request_sha256','created_by']) - CASE WHEN p_scope='public' THEN ARRAY['moderation_notes'] ELSE ARRAY[]::text[] END ORDER BY i.created_at,i.id) FROM selected_items i),'[]'::jsonb),
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
REVOKE ALL ON FUNCTION public.queue_engagement_report(uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_engagement_report(uuid,uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.claim_engagement_report(p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j engagement_report_jobs;
BEGIN
 SELECT * INTO j FROM engagement_report_jobs WHERE status='queued' OR (status='running' AND lease_until<clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by AND role IN ('owner','admin','member')) THEN
  UPDATE engagement_report_jobs SET status='cancelled',phase='Requester access was revoked' WHERE id=j.id; RETURN NULL;
 END IF;
 UPDATE engagement_report_jobs SET status='running',phase='Rendering frozen campaign',attempts=attempts+1,lease_token=p_token,lease_until=clock_timestamp()+interval '10 minutes',failure_detail=NULL WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;
REVOKE ALL ON FUNCTION public.claim_engagement_report(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_engagement_report(uuid) TO service_role;

CREATE FUNCTION public.control_engagement_report(p_job uuid,p_action text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j engagement_report_jobs;
BEGIN
 SELECT * INTO j FROM engagement_report_jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=j.workspace_id AND user_id=auth.uid() AND role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Engagement write access required'; END IF;
 IF p_action='cancel' AND j.status IN ('queued','running') THEN
  UPDATE engagement_report_jobs SET status='cancelled',phase='Cancelled; snapshot retained',lease_token=NULL,lease_until=NULL WHERE id=j.id;
 ELSIF p_action='retry' AND j.status IN ('failed','cancelled') THEN
  UPDATE engagement_report_jobs SET status='queued',phase='Retry queued from the same snapshot',lease_token=NULL,lease_until=NULL,failure_detail=NULL WHERE id=j.id;
 ELSE RAISE EXCEPTION 'This job cannot perform that transition'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.control_engagement_report(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.control_engagement_report(uuid,text) TO authenticated;
