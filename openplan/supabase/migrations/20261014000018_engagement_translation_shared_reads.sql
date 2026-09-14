-- Retained generation readers share custody locks. The write-side helper stays
-- exclusive so source, membership and worker changes cannot race these reads.
CREATE FUNCTION public.lock_translation_generation_read_scope(p_campaign uuid,p_actor uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=p_actor AND m.role IN ('owner','admin','member')) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Translation sources are busy' USING ERRCODE='PT503';
 END IF;
 SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=workspace AND user_id=p_actor
  AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 RETURN workspace;
END $$;
REVOKE ALL ON FUNCTION public.lock_translation_generation_read_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_translation_generation_request(p_campaign uuid,p_request uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request public.engagement_translation_generation_requests; fields jsonb; workspace uuid;
 old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_read_scope(p_campaign,auth.uid());
 SELECT * INTO request FROM engagement_translation_generation_requests WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation request is not available' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'address',f.address,'packetCanonical',f.packet_canonical,'packetHash',f.packet_hash,
   'state',f.state,'attemptId',f.attempt_id,'reservationId',f.reservation_id,'leaseExpiresAt',f.lease_expires_at,'failureCode',f.failure_code,
   'output',CASE WHEN o.field_id IS NULL THEN NULL ELSE jsonb_build_object('status',o.status,'outputJson',o.output_json,
    'bindingCanonical',o.binding_canonical,'providerMetadataJson',o.provider_metadata_json,'digest',o.delivery_digest,'acceptedState',o.accepted_state) END)
   ORDER BY f.ordinal),'[]'::jsonb) INTO fields
 FROM engagement_translation_generation_fields f LEFT JOIN engagement_translation_generation_outputs o ON o.field_id=f.id AND o.attempt_id=f.attempt_id
 WHERE f.request_id=request.id;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('schema',1,'requestId',request.id,'campaignId',request.campaign_id,'workspaceId',request.workspace_id,
  'actorId',request.actor_id,'locale',request.locale,'createdAt',request.created_at,
  'credential',jsonb_build_object('id',request.credential->>'credentialId','configurationHash',request.credential->>'configurationHash',
    'model',request.credential#>>'{configuration,modelId}','source',request.credential->>'source'),
  'fields',fields,'count',jsonb_array_length(request.intent->'fields'));
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Generation request is busy; retry the read' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.read_translation_generation_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_translation_generation_request(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_translation_generation_requests(p_campaign uuid,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_read_scope(p_campaign,auth.uid());
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
