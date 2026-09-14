-- Durable resolution of an unreadable or interrupted browser request. Opaque
-- copy_json strings preserve even JSON escapes unsupported by PostgreSQL text.
CREATE TABLE public.engagement_translation_generation_resolutions (
 id uuid PRIMARY KEY, request_id uuid NOT NULL, campaign_id uuid NOT NULL,
 workspace_id uuid NOT NULL, actor_id uuid NOT NULL,
 payload_json json NOT NULL, result_json json NOT NULL,
 payload_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(payload_json::text,'sha256'),'hex')) STORED,
 result_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(result_json::text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(octet_length(payload_json::text)<=33562624),
 CHECK(json_typeof(payload_json)='object' AND json_typeof(result_json)='object')
);
CREATE INDEX translation_generation_resolved_request ON public.engagement_translation_generation_resolutions(campaign_id,actor_id,request_id);
ALTER TABLE public.engagement_translation_generation_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_translation_generation_resolutions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_translation_generation_resolutions TO authenticated;
GRANT SELECT(request_id,campaign_id,workspace_id,actor_id) ON public.engagement_translation_generation_resolutions TO service_role;
CREATE POLICY translation_generation_resolution_owner ON public.engagement_translation_generation_resolutions FOR SELECT TO authenticated
 USING(actor_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workspace_members m
  WHERE m.workspace_id=engagement_translation_generation_resolutions.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')));
CREATE TRIGGER translation_generation_resolution_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_generation_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_request();

CREATE FUNCTION public.resolve_translation_generation_request(p_resolution uuid,p_request uuid,p_campaign uuid,p_copy_json text,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; actor uuid:=auth.uid(); payload jsonb; outcome jsonb;
 saved public.engagement_translation_generation_resolutions; request public.engagement_translation_generation_requests;
 field public.engagement_translation_generation_fields; fields jsonb:='[]'::jsonb; existed boolean; next_state text;
 old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_scope(p_campaign,actor);
 IF p_resolution IS NULL OR p_request IS NULL OR p_copy_json IS NULL OR octet_length(p_copy_json)>16777216
  OR json_typeof(p_copy_json::json) IS DISTINCT FROM 'string' OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 4000
  OR translation_source_compatibility_hash(p_reason)=translation_source_compatibility_hash('') THEN
  RAISE EXCEPTION 'Invalid generation resolution' USING ERRCODE='22023';
 END IF;
 payload:=jsonb_build_object('schema',1,'resolutionId',p_resolution,'requestId',p_request,'campaignId',p_campaign,
  'workspaceId',workspace,'actorId',actor,'copyJson',p_copy_json,'reason',p_reason);
 SELECT * INTO saved FROM engagement_translation_generation_resolutions WHERE id=p_resolution;
 IF FOUND THEN
  IF saved.campaign_id IS DISTINCT FROM p_campaign OR saved.workspace_id IS DISTINCT FROM workspace OR saved.actor_id IS DISTINCT FROM actor
   THEN RAISE EXCEPTION 'Resolution is not available' USING ERRCODE='42501'; END IF;
  IF saved.payload_json::jsonb IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Resolution retry differs' USING ERRCODE='PT409'; END IF;
  PERFORM set_config('lock_timeout',old_timeout,true);
  RETURN jsonb_build_object('payloadText',saved.payload_json::text,'payloadSha256',saved.payload_sha256,
   'resultText',saved.result_json::text,'resultSha256',saved.result_sha256,'replayed',true);
 END IF;
 SELECT * INTO request FROM engagement_translation_generation_requests WHERE id=p_request;
 existed:=FOUND;
 IF existed AND (request.campaign_id IS DISTINCT FROM p_campaign OR request.workspace_id IS DISTINCT FROM workspace OR request.actor_id IS DISTINCT FROM actor) THEN
  RAISE EXCEPTION 'Only the original requester can resolve this request' USING ERRCODE='42501';
 END IF;
 IF existed THEN
  FOR field IN SELECT * FROM engagement_translation_generation_fields WHERE request_id=p_request ORDER BY ordinal FOR UPDATE NOWAIT LOOP
   IF field.state IN ('completed','incomplete') AND NOT EXISTS(SELECT 1 FROM engagement_translation_generation_outputs WHERE field_id=field.id) THEN
    RAISE EXCEPTION 'Retained generation output is incomplete' USING ERRCODE='PT503';
   END IF;
   next_state:=CASE WHEN field.state IN ('queued','reserved') THEN 'cancelled' WHEN field.state='running' THEN 'interrupted' ELSE field.state END;
   IF next_state IS DISTINCT FROM field.state THEN
    UPDATE engagement_translation_generation_fields SET state=next_state,failure_code='translation_request_resolved',finished_at=clock_timestamp() WHERE id=field.id;
   END IF;
   fields:=fields||jsonb_build_array(jsonb_build_object('fieldId',field.id,'previousState',field.state,'state',next_state,
    'attemptId',field.attempt_id,'outputRetained',EXISTS(SELECT 1 FROM engagement_translation_generation_outputs WHERE field_id=field.id)));
  END LOOP;
  IF jsonb_array_length(fields)<>jsonb_array_length(request.intent->'fields') THEN RAISE EXCEPTION 'Resolution fields are incomplete' USING ERRCODE='PT503'; END IF;
 END IF;
 outcome:=jsonb_build_object('schema',1,'resolutionId',p_resolution,'requestId',p_request,'campaignId',p_campaign,
  'workspaceId',workspace,'actorId',actor,'requestExisted',existed,'fields',fields,'resolvedAt',clock_timestamp());
 INSERT INTO engagement_translation_generation_resolutions(id,request_id,campaign_id,workspace_id,actor_id,payload_json,result_json)
 VALUES(p_resolution,p_request,p_campaign,workspace,actor,payload::json,outcome::json) RETURNING * INTO saved;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('payloadText',saved.payload_json::text,'payloadSha256',saved.payload_sha256,
  'resultText',saved.result_json::text,'resultSha256',saved.result_sha256,'replayed',false);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid resolution encoding' USING ERRCODE='22023';
 WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation resolution is busy; retry the same resolution' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.resolve_translation_generation_request(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_translation_generation_request(uuid,uuid,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_translation_generation_request(p_request uuid,p_actor uuid,p_campaign uuid,p_locale text,
 p_fields jsonb,p_credential jsonb,p_selected_hash text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; saved public.engagement_translation_generation_requests; intent jsonb; entry jsonb; actual jsonb; packet jsonb;
 old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 workspace:=lock_translation_generation_scope(p_campaign,p_actor);
 IF EXISTS(SELECT 1 FROM engagement_translation_generation_resolutions
  WHERE request_id=p_request AND campaign_id=p_campaign AND actor_id=p_actor) THEN
  RAISE EXCEPTION 'Generation request was resolved; retain its resolution receipt' USING ERRCODE='PT409';
 END IF;
 IF p_request IS NULL OR p_locale IS NULL OR p_locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR length(p_locale)>35
 OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) NOT BETWEEN 1 AND 25 OR octet_length(p_fields::text)>8388608 THEN
  RAISE EXCEPTION 'Invalid generation request' USING ERRCODE='22023';
 END IF;
 intent:=jsonb_build_object('requestId',p_request,'actorId',p_actor,'campaignId',p_campaign,'locale',p_locale,'fields',p_fields);
 SELECT * INTO saved FROM engagement_translation_generation_requests WHERE id=p_request;
 IF FOUND THEN
  IF saved.intent IS DISTINCT FROM intent THEN RAISE EXCEPTION 'Generation retry differs' USING ERRCODE='PT409'; END IF;
  PERFORM set_config('lock_timeout',old_timeout,true);
  RETURN jsonb_build_object('requestId',saved.id,'created',false);
 END IF;
 IF jsonb_typeof(p_credential) IS DISTINCT FROM 'object' OR p_credential->>'workspaceId' IS DISTINCT FROM workspace::text
 OR p_credential->>'requestId' IS DISTINCT FROM p_request::text OR p_credential->>'credentialId' IS NULL
 OR p_credential#>>'{configuration,provider}' IS DISTINCT FROM 'anthropic' OR p_credential#>>'{configuration,recipeVersion}' IS DISTINCT FROM '1'
 OR coalesce(length(p_credential#>>'{configuration,modelId}'),0) NOT BETWEEN 1 AND 160
 OR coalesce(p_credential->>'configurationHash','') !~ '^[a-f0-9]{64}$'
 OR coalesce(length(p_credential->>'credentialCiphertext'),0) NOT BETWEEN 1 AND 32000 THEN
  RAISE EXCEPTION 'Invalid captured credential' USING ERRCODE='22023';
 END IF;
 PERFORM (p_credential->>'credentialId')::uuid;
 PERFORM assert_translation_generation_selection(workspace,p_credential,p_selected_hash);
 IF (SELECT count(*) FROM jsonb_array_elements(p_fields))<>(SELECT count(DISTINCT (e#>>'{address,entityType}',e#>>'{address,entityId}',e#>>'{address,field}')) FROM jsonb_array_elements(p_fields) e)
 OR (SELECT count(*) FROM jsonb_array_elements(p_fields))<>(SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_fields) e) THEN
  RAISE EXCEPTION 'Duplicate generation field' USING ERRCODE='22023';
 END IF;
 INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,locale,intent,credential,selected_key_ciphertext_hash)
 VALUES(p_request,p_campaign,workspace,p_actor,p_locale,intent,p_credential,p_selected_hash);
 FOR entry IN SELECT value FROM jsonb_array_elements(p_fields) ORDER BY value#>>'{address,entityType}',value#>>'{address,entityId}',value#>>'{address,field}' LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['id','address','packetCanonical']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('id','address','packetCanonical'))
  OR jsonb_typeof(entry->'packetCanonical') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid generation field' USING ERRCODE='22023'; END IF;
  actual:=assert_translation_generation_source(p_campaign,p_locale,entry->'address');
  packet:=(entry->>'packetCanonical')::jsonb;
  IF packet IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'workspaceId',workspace,'campaignId',p_campaign,'fieldId',(entry->>'id')::uuid,
    'sourceText',actual->>'text','targetLanguage',p_locale) THEN RAISE EXCEPTION 'Generation packet differs from source' USING ERRCODE='22023'; END IF;
  INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical)
   VALUES((entry->>'id')::uuid,p_request,(SELECT ord FROM jsonb_array_elements(p_fields) WITH ORDINALITY a(v,ord) WHERE v=entry),entry->'address',entry->>'packetCanonical');
 END LOOP;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('requestId',p_request,'created',true);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation sources are busy; retry this request' USING ERRCODE='PT503';
END $$;
