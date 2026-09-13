-- Browse retained staff generation requests independently of browser storage.
-- Keyset pagination preserves PostgreSQL microseconds and UUID tie ordering.
CREATE FUNCTION public.list_translation_generation_requests(p_campaign uuid,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_scope(p_campaign,auth.uid());
 IF (p_before_created_at IS NULL) IS DISTINCT FROM (p_before_id IS NULL) THEN
  RAISE EXCEPTION 'Both pagination cursor values are required' USING ERRCODE='22023';
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT r.* FROM engagement_translation_generation_requests r
  WHERE r.campaign_id=p_campaign AND r.workspace_id=workspace
   AND (p_before_created_at IS NULL OR (r.created_at,r.id)<(p_before_created_at,p_before_id))
  ORDER BY r.created_at DESC,r.id DESC LIMIT 21
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT 20
 ), rows AS (
  SELECT r.id,r.created_at,jsonb_build_object('id',r.id,'actorId',r.actor_id,'locale',r.locale,
   'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'fieldCount',jsonb_array_length(r.intent->'fields'),'counts',
   (SELECT jsonb_build_object('queued',count(*) FILTER(WHERE f.state='queued'),'reserved',count(*) FILTER(WHERE f.state='reserved'),
    'running',count(*) FILTER(WHERE f.state='running'),'completed',count(*) FILTER(WHERE f.state='completed'),
    'incomplete',count(*) FILTER(WHERE f.state='incomplete'),'failed',count(*) FILTER(WHERE f.state='failed'),
    'interrupted',count(*) FILTER(WHERE f.state='interrupted'),'cancelled',count(*) FILTER(WHERE f.state='cancelled'))
    FROM engagement_translation_generation_fields f WHERE f.request_id=r.id)) AS value
  FROM page r
 )
 SELECT jsonb_build_object('schema',1,'campaignId',p_campaign,'workspaceId',workspace,
  'requests',coalesce((SELECT jsonb_agg(value ORDER BY created_at DESC,id DESC) FROM rows),'[]'::jsonb),
  'next',CASE WHEN (SELECT count(*) FROM candidates)>20 THEN
   (SELECT jsonb_build_object('createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',id)
    FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END) INTO result;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN result;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Generation request list is busy; retry the read' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.list_translation_generation_requests(uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_translation_generation_requests(uuid,timestamptz,uuid) TO authenticated;
