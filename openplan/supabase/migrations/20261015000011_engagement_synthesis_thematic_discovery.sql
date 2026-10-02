-- Browse private thematic requests for one retained source. A listing is not
-- proof of complete outputs, permission to execute, or approval of a proposal.
CREATE INDEX synthesis_generation_requests_source_created
 ON public.engagement_synthesis_generation_requests(source_id,created_at,id);

CREATE FUNCTION public.list_engagement_synthesis_thematic_requests(p_campaign uuid,p_source uuid,p_before jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; source_hash text; before_time timestamptz; before_id uuid; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT s.snapshot_sha256 INTO source_hash FROM engagement_synthesis_sources s
  WHERE s.id=p_source AND s.campaign_id=p_campaign AND s.workspace_id=workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved source not accessible' USING ERRCODE='42501'; END IF;
 IF p_before IS NOT NULL THEN
  IF jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR NOT p_before ?& ARRAY['createdAt','id']
   OR (SELECT count(*) FROM jsonb_object_keys(p_before))<>2
   OR jsonb_typeof(p_before->'createdAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_before->'id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid thematic request cursor' USING ERRCODE='22023';
  END IF;
  IF p_before->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
   RAISE EXCEPTION 'Invalid thematic request cursor' USING ERRCODE='22023';
  END IF;
  before_time:=(p_before->>'createdAt')::timestamptz; before_id:=(p_before->>'id')::uuid;
  IF NOT isfinite(before_time) THEN RAISE EXCEPTION 'Invalid thematic request cursor' USING ERRCODE='22023'; END IF;
 END IF;
 WITH page AS MATERIALIZED (
  SELECT r.id,r.created_at,r.actor_id,t.parent_request_id,
   EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations c WHERE c.request_id=r.id) cancelled
  FROM engagement_synthesis_generation_requests r JOIN engagement_synthesis_thematic_requests t ON t.request_id=r.id
  WHERE r.source_id=p_source AND r.campaign_id=p_campaign AND r.workspace_id=workspace
   AND (p_before IS NULL OR (r.created_at,r.id)<(before_time,before_id))
  ORDER BY r.created_at DESC,r.id DESC LIMIT 26
 ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 25)
 SELECT jsonb_build_object('schemaVersion',1,'campaignId',p_campaign,'workspaceId',workspace,
  'sourceId',p_source,'sourceSha256',source_hash,'pageSize',25,
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('requestId',v.id,'createdAt',v.created_at,
   'actorId',v.actor_id,'parentRequestId',v.parent_request_id,'cancelled',v.cancelled) ORDER BY v.created_at DESC,v.id DESC)
   FROM visible v),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN
   (SELECT jsonb_build_object('createdAt',created_at,'id',id) FROM visible ORDER BY created_at,id LIMIT 1) ELSE NULL END
 ) INTO result;
 RETURN result;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Thematic history is busy; retry the same read' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.list_engagement_synthesis_thematic_requests(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_engagement_synthesis_thematic_requests(uuid,uuid,jsonb) TO authenticated;
