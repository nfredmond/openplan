-- Browse retained source selections without downloading each complete source.
CREATE FUNCTION public.list_engagement_synthesis_sources(p_campaign uuid,p_before jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; before_time timestamptz; before_id uuid; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member');
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 IF p_before IS NOT NULL THEN
  IF jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR NOT p_before ?& ARRAY['createdAt','id']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_before) k WHERE k NOT IN ('createdAt','id'))
  OR jsonb_typeof(p_before->'createdAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_before->'id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid saved source cursor' USING ERRCODE='22023';
  END IF;
  IF p_before->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'Invalid saved source cursor' USING ERRCODE='22023'; END IF;
  before_time:=(p_before->>'createdAt')::timestamptz; before_id:=(p_before->>'id')::uuid;
  IF NOT isfinite(before_time) THEN RAISE EXCEPTION 'Invalid saved source cursor' USING ERRCODE='22023'; END IF;
 END IF;
 WITH page AS MATERIALIZED (
  SELECT s.id,s.created_at,s.snapshot_sha256,s.selection_json,s.snapshot_text::jsonb->'counts' counts
   FROM engagement_synthesis_sources s WHERE s.campaign_id=p_campaign AND s.workspace_id=workspace
    AND (p_before IS NULL OR (s.created_at,s.id)<(before_time,before_id))
   ORDER BY s.created_at DESC,s.id DESC LIMIT 26
 ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 25)
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'pageSize',25,
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('requestId',v.id,'campaignId',p_campaign,'workspaceId',workspace,
    'createdAt',v.created_at,'snapshotSha256',v.snapshot_sha256,'selection',v.selection_json,'counts',v.counts) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN (SELECT jsonb_build_object('createdAt',created_at,'id',id) FROM visible ORDER BY created_at,id LIMIT 1) ELSE NULL END
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_engagement_synthesis_sources(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_engagement_synthesis_sources(uuid,jsonb) TO authenticated;
