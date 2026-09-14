-- Complete private source custody for synthesis. Generation/review activation follows.
-- No existing mutable synthesis or retained report snapshot is rewritten.
CREATE TABLE public.engagement_synthesis_sources (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL,
 selection_json jsonb NOT NULL CHECK(jsonb_typeof(selection_json)='object'),
 snapshot_text text NOT NULL CHECK(snapshot_text IS JSON OBJECT),
 snapshot_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(snapshot_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX engagement_synthesis_sources_campaign ON public.engagement_synthesis_sources(campaign_id,created_at,id);
ALTER TABLE public.engagement_synthesis_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_sources FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_sources TO service_role;
CREATE TRIGGER engagement_synthesis_sources_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_sources
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Staff-only RPCs return exact retained text. Table reads and public derivatives
-- are deliberately absent; a saved internal source is never a publication grant.
CREATE FUNCTION public.capture_engagement_synthesis_sources(p_campaign uuid,p_request uuid,p_selection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.engagement_campaigns; saved public.engagement_synthesis_sources;
 actor uuid:=auth.uid(); states text[]; cats uuid[]; after_date timestamptz; before_date timestamptz; snap text;
BEGIN
 IF actor IS NULL OR p_request IS NULL OR NOT EXISTS(SELECT 1 FROM engagement_campaigns ec JOIN workspace_members m ON m.workspace_id=ec.workspace_id
   WHERE ec.id=p_campaign AND m.user_id=actor AND m.role IN ('owner','admin','member')) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-request:'||p_request::text,0))
 OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Synthesis source capture is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO c FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=actor
   AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 -- Verify access before retry identity, then return the original without reading
 -- changed contributions or rebuilding its old category/question definitions.
 SELECT * INTO saved FROM engagement_synthesis_sources WHERE id=p_request;
 IF FOUND THEN
  IF saved.campaign_id IS DISTINCT FROM p_campaign OR saved.workspace_id IS DISTINCT FROM c.workspace_id
  OR saved.actor_id IS DISTINCT FROM actor OR saved.selection_json IS DISTINCT FROM p_selection THEN
   RAISE EXCEPTION 'Synthesis source retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN jsonb_build_object('requestId',saved.id,'campaignId',saved.campaign_id,'workspaceId',saved.workspace_id,
   'snapshotSha256',saved.snapshot_sha256,'createdAt',saved.created_at,'counts',saved.snapshot_text::jsonb->'counts','replayed',true);
 END IF;
 IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR NOT p_selection ?& ARRAY['statuses','includeItems','includeSurveys','categoryIds','from','to']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_selection) k WHERE k NOT IN ('statuses','includeItems','includeSurveys','categoryIds','from','to'))
 OR jsonb_typeof(p_selection->'statuses') IS DISTINCT FROM 'array' OR jsonb_typeof(p_selection->'categoryIds') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_selection->'includeItems') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_selection->'includeSurveys') IS DISTINCT FROM 'boolean'
 OR NOT ((p_selection->>'includeItems')::boolean OR (p_selection->>'includeSurveys')::boolean)
 OR jsonb_typeof(p_selection->'from') NOT IN ('null','string') OR jsonb_typeof(p_selection->'to') NOT IN ('null','string') THEN
  RAISE EXCEPTION 'Invalid synthesis source selection' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_selection->'statuses') NOT BETWEEN 1 AND 4
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_selection->'statuses') v WHERE jsonb_typeof(v)<>'string' OR v#>>'{}' NOT IN ('pending','approved','rejected','flagged'))
 OR (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(p_selection->'statuses') v)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_selection->'categoryIds') v WHERE jsonb_typeof(v)<>'string')
 OR (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(p_selection->'categoryIds') v) THEN
  RAISE EXCEPTION 'Invalid synthesis source selection' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(p_selection) e WHERE e.key IN ('from','to') AND e.value IS NOT NULL
   AND e.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$') THEN
  RAISE EXCEPTION 'Use explicit timestamp offsets for synthesis source dates' USING ERRCODE='22023';
 END IF;
 SELECT array_agg(v) INTO states FROM jsonb_array_elements_text(p_selection->'statuses') v;
 SELECT array_agg(v::uuid) INTO cats FROM jsonb_array_elements_text(p_selection->'categoryIds') v;
 after_date:=(p_selection->>'from')::timestamptz; before_date:=(p_selection->>'to')::timestamptz;
 IF (after_date IS NOT NULL AND NOT isfinite(after_date)) OR (before_date IS NOT NULL AND NOT isfinite(before_date))
 OR (after_date IS NOT NULL AND before_date IS NOT NULL AND before_date<=after_date) THEN
  RAISE EXCEPTION 'Invalid synthesis source dates' USING ERRCODE='22023';
 END IF;
 IF cats IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(cats) category WHERE NOT EXISTS(
   SELECT 1 FROM engagement_configuration_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition_json->'categories') d
    WHERE v.campaign_id=p_campaign AND d->>'id'=category::text)) THEN
  RAISE EXCEPTION 'Category is not part of this campaign history' USING ERRCODE='22023';
 END IF;
 -- One statement captures contributions, surveys, immutable definitions and
 -- counts from one MVCC snapshot. No row or text cap and no changing offset scan.
 WITH selected_items AS MATERIALIZED (
  SELECT i.* FROM engagement_items i WHERE i.campaign_id=p_campaign AND (p_selection->>'includeItems')::boolean
   AND i.status=ANY(states) AND (cats IS NULL OR i.category_id=ANY(cats))
   AND (after_date IS NULL OR i.created_at>=after_date) AND (before_date IS NULL OR i.created_at<before_date)
 ), selected_sessions AS MATERIALIZED (
  SELECT s.* FROM engagement_survey_response_sessions s WHERE s.campaign_id=p_campaign AND (p_selection->>'includeSurveys')::boolean
   AND s.status=ANY(states) AND (after_date IS NULL OR s.created_at>=after_date) AND (before_date IS NULL OR s.created_at<before_date)
 ), selected_answers AS MATERIALIZED (
  SELECT a.* FROM engagement_survey_answers a JOIN selected_sessions s ON s.id=a.session_id
   WHERE a.campaign_id=p_campaign AND (cats IS NULL OR EXISTS(
    SELECT 1 FROM engagement_configuration_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition_json->'questions') q
    WHERE v.id=s.configuration_version_id AND v.campaign_id=p_campaign AND q->>'id'=a.question_id::text AND (q->>'category_id')::uuid=ANY(cats)))
 ), included_sessions AS MATERIALIZED (
  SELECT s.* FROM selected_sessions s WHERE cats IS NULL OR EXISTS(SELECT 1 FROM selected_answers a WHERE a.session_id=s.id)
 )
 SELECT jsonb_build_object('schemaVersion',1,'scope','internal','capturedAt',clock_timestamp(),
  'requestId',p_request,'workspaceId',c.workspace_id,'campaignId',p_campaign,'selection',p_selection,
  'campaign',jsonb_build_object('id',c.id,'title',c.title,'summary',c.summary,'projectId',c.project_id,'configurationVersionId',c.configuration_version_id),
  'counts',jsonb_build_object('items',(SELECT count(*) FROM selected_items),'sessions',(SELECT count(*) FROM included_sessions),'answers',(SELECT count(*) FROM selected_answers),
   'campaignItems',(SELECT count(*) FROM engagement_items WHERE campaign_id=p_campaign),
   'campaignSessions',(SELECT count(*) FROM engagement_survey_response_sessions WHERE campaign_id=p_campaign),
   'campaignAnswers',(SELECT count(*) FROM engagement_survey_answers WHERE campaign_id=p_campaign)),
  'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)-ARRAY['metadata_json','request_id','request_sha256','created_by','submitted_by'] ORDER BY i.created_at,i.id) FROM selected_items i),'[]'::jsonb),
  'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)-ARRAY['metadata_json','respondent_fingerprint','created_by','submitted_by','request_id','request_sha256'] ORDER BY s.created_at,s.id) FROM included_sessions s),'[]'::jsonb),
  'answers',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.session_id,a.id) FROM selected_answers a),'[]'::jsonb),
  'definitions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'campaignId',v.campaign_id,'sha256',v.definition_sha256,'definitionText',v.definition_json::text) ORDER BY v.created_at,v.id)
   FROM engagement_configuration_versions v WHERE v.campaign_id=p_campaign AND (v.id=c.configuration_version_id
    OR v.id IN(SELECT configuration_version_id FROM selected_items UNION SELECT configuration_version_id FROM included_sessions))),'[]'::jsonb)
 )::text INTO snap;
 INSERT INTO engagement_synthesis_sources(id,campaign_id,workspace_id,actor_id,selection_json,snapshot_text)
 VALUES(p_request,p_campaign,c.workspace_id,actor,p_selection,snap) RETURNING * INTO saved;
 RETURN jsonb_build_object('requestId',saved.id,'campaignId',saved.campaign_id,'workspaceId',saved.workspace_id,
  'snapshotSha256',saved.snapshot_sha256,'createdAt',saved.created_at,'counts',saved.snapshot_text::jsonb->'counts','replayed',false);
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Synthesis source capture is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.capture_engagement_synthesis_sources(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.capture_engagement_synthesis_sources(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.read_engagement_synthesis_sources(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.engagement_synthesis_sources;
BEGIN
 SELECT s.* INTO saved FROM engagement_synthesis_sources s JOIN engagement_campaigns c ON c.id=s.campaign_id AND c.workspace_id=s.workspace_id
  JOIN workspace_members m ON m.workspace_id=s.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')
  WHERE s.id=p_request AND s.campaign_id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved synthesis source not accessible' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('requestId',saved.id,'campaignId',saved.campaign_id,'workspaceId',saved.workspace_id,
  'snapshotText',saved.snapshot_text,'snapshotSha256',saved.snapshot_sha256,'createdAt',saved.created_at);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_sources(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_sources(uuid,uuid) TO authenticated;
