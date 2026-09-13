-- Retain completed and incomplete output separately from terminal job state.
-- Run after generation-queue-candidate.sql in an identified proof database.
ALTER TABLE public.engagement_translation_generation_fields ADD CONSTRAINT translation_generation_field_attempt_identity UNIQUE(id,attempt_id);
CREATE TABLE public.engagement_translation_generation_outputs (
 field_id uuid PRIMARY KEY, attempt_id uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('completed','incomplete')),
 output_json text NOT NULL, binding_canonical text NOT NULL, provider_metadata_json text NOT NULL,
 delivery_digest text GENERATED ALWAYS AS (encode(extensions.digest(status||chr(10)||output_json||chr(10)||binding_canonical||chr(10)||provider_metadata_json,'sha256'),'hex')) STORED,
 accepted_state text NOT NULL CHECK(accepted_state IN ('completed','incomplete','failed','interrupted','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(field_id,attempt_id) REFERENCES public.engagement_translation_generation_fields(id,attempt_id),
 CHECK(octet_length(output_json)+octet_length(binding_canonical)+octet_length(provider_metadata_json)<=200000)
);
ALTER TABLE public.engagement_translation_generation_outputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_translation_generation_outputs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_translation_generation_outputs TO service_role;
CREATE FUNCTION public.preserve_translation_generation_output() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Generated output is retained unchanged' USING ERRCODE='23514'; END $$;
CREATE TRIGGER translation_generation_output_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_generation_outputs
 FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_output();
REVOKE ALL ON FUNCTION public.preserve_translation_generation_output() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.retain_translation_generation_output(p_field uuid,p_attempt uuid,p_status text,
 p_output_json text,p_binding_canonical text,p_provider_metadata_json text,p_digest text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.engagement_translation_generation_fields; request public.engagement_translation_generation_requests;
 saved public.engagement_translation_generation_outputs; binding jsonb; expected jsonb; packet jsonb; words text; key text;
 actual_digest text; old_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('lock_timeout','100ms',true);
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=p_field;
 IF NOT FOUND OR p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt OR job.dispatch_authorized_at IS NULL THEN
  RAISE EXCEPTION 'No matching authorized generation attempt' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 IF p_status IS NULL OR p_status NOT IN ('completed','incomplete') OR p_output_json IS NULL OR p_binding_canonical IS NULL OR p_provider_metadata_json IS NULL
 OR octet_length(p_output_json)+octet_length(p_binding_canonical)+octet_length(p_provider_metadata_json)>200000
 OR position(chr(10) IN p_output_json||p_binding_canonical||p_provider_metadata_json)>0 THEN
  RAISE EXCEPTION 'Invalid retained generation encoding' USING ERRCODE='22023';
 END IF;
 actual_digest:=encode(extensions.digest(p_status||chr(10)||p_output_json||chr(10)||p_binding_canonical||chr(10)||p_provider_metadata_json,'sha256'),'hex');
 IF p_digest IS DISTINCT FROM actual_digest THEN RAISE EXCEPTION 'Generation delivery digest differs' USING ERRCODE='22023'; END IF;
 -- JSON (not JSONB) checks syntax without converting unsupported escapes into
 -- PostgreSQL text. Never extract values from the opaque provider metadata.
 IF json_typeof(p_output_json::json) IS DISTINCT FROM 'string' OR json_typeof(p_provider_metadata_json::json) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid retained generation shape' USING ERRCODE='22023';
 END IF;
 binding:=p_binding_canonical::jsonb; packet:=job.packet_canonical::jsonb;
 expected:=jsonb_build_object('schemaVersion',1,'provider','anthropic','workspaceId',request.workspace_id,'campaignId',request.campaign_id,
  'requestId',request.id,'attemptId',job.attempt_id,'fieldId',job.id,'reservationId',job.reservation_id,
  'credentialId',request.credential->>'credentialId','configurationHash',request.credential->>'configurationHash','packetHash',job.packet_hash,
  'leaseExpiresAt',binding->'leaseExpiresAt','model',request.credential#>>'{configuration,modelId}',
  'credentialSource',request.credential->>'source','recipeVersion',1,'targetLanguage',request.locale,
  'sourceHash',encode(extensions.digest(packet->>'sourceText','sha256'),'hex'));
 IF (binding-ARRAY['outputHash','finishReason','inputTokens','outputTokens']) IS DISTINCT FROM expected
 OR (binding->>'leaseExpiresAt')::timestamptz IS DISTINCT FROM job.lease_expires_at
 OR coalesce(binding->>'outputHash','') !~ '^[a-f0-9]{64}$'
 OR NOT binding ?& ARRAY['finishReason','inputTokens','outputTokens']
 OR (binding->'finishReason'<>'null'::jsonb AND binding->>'finishReason' NOT IN ('stop','length','content-filter','tool-calls','error','other','unknown')) THEN
  RAISE EXCEPTION 'Generation receipt differs from the claimed packet' USING ERRCODE='22023';
 END IF;
 FOREACH key IN ARRAY ARRAY['inputTokens','outputTokens'] LOOP
  IF jsonb_typeof(binding->key) NOT IN ('null','number') THEN RAISE EXCEPTION 'Invalid generation token count' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(binding->key)='number' AND ((binding->>key)::numeric<0 OR (binding->>key)::numeric>9007199254740991 OR trunc((binding->>key)::numeric)<>(binding->>key)::numeric) THEN
   RAISE EXCEPTION 'Invalid generation token count' USING ERRCODE='22023';
  END IF;
 END LOOP;
 BEGIN words:=p_output_json::jsonb#>>'{}';
 EXCEPTION WHEN data_exception THEN words:=NULL;
 END;
 IF words IS NOT NULL AND binding->>'outputHash' IS DISTINCT FROM encode(extensions.digest(words,'sha256'),'hex') THEN
  RAISE EXCEPTION 'Retained output hash differs' USING ERRCODE='22023';
 END IF;
 IF ((binding->>'finishReason'='stop' AND words IS NOT NULL AND length(words) BETWEEN 1 AND 8000
  AND translation_source_compatibility_hash(words)<>translation_source_compatibility_hash('')) IS TRUE) IS DISTINCT FROM (p_status='completed') THEN
  RAISE EXCEPTION 'Output completeness differs from delivery' USING ERRCODE='22023';
 END IF;
 -- Serialize on the common scope/job lock order. The worker-only status may
 -- mark an active job interrupted when source, authority, key or lease changed.
 -- Its output is still retained; late arrival never revives that terminal job.
 PERFORM read_translation_generation_status(job.id,job.attempt_id);
 SELECT * INTO STRICT job FROM engagement_translation_generation_fields WHERE id=p_field FOR UPDATE NOWAIT;
 SELECT * INTO saved FROM engagement_translation_generation_outputs WHERE field_id=job.id;
 IF FOUND THEN
  IF saved.attempt_id IS DISTINCT FROM p_attempt OR saved.status IS DISTINCT FROM p_status OR saved.output_json IS DISTINCT FROM p_output_json
   OR saved.binding_canonical IS DISTINCT FROM p_binding_canonical OR saved.provider_metadata_json IS DISTINCT FROM p_provider_metadata_json OR saved.delivery_digest IS DISTINCT FROM p_digest THEN
   RAISE EXCEPTION 'Retained generation delivery differs from retry' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF job.state='running' THEN
   UPDATE engagement_translation_generation_fields SET state=p_status,finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  ELSIF job.state NOT IN ('failed','interrupted','cancelled') THEN RAISE EXCEPTION 'Generation state cannot receive output' USING ERRCODE='PT409'; END IF;
  INSERT INTO engagement_translation_generation_outputs(field_id,attempt_id,status,output_json,binding_canonical,provider_metadata_json,accepted_state)
  VALUES(job.id,job.attempt_id,p_status,p_output_json,p_binding_canonical,p_provider_metadata_json,job.state) RETURNING * INTO saved;
 END IF;
 PERFORM set_config('lock_timeout',old_timeout,true);
 RETURN jsonb_build_object('fieldId',saved.field_id,'attemptId',saved.attempt_id,'status',saved.status,'state',saved.accepted_state,'digest',saved.delivery_digest);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid generation delivery value' USING ERRCODE='22023';
 WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Generation delivery is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_translation_generation_output(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_translation_generation_output(uuid,uuid,text,text,text,text,text) TO service_role;
