-- Staff may inspect retained generation requests without gaining table access to
-- their encrypted credentials. This reads saved state; workers reconcile expiry.
CREATE FUNCTION public.read_translation_generation_request(p_campaign uuid,p_request uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request public.engagement_translation_generation_requests; fields jsonb; workspace uuid;
 old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_scope(p_campaign,auth.uid());
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
