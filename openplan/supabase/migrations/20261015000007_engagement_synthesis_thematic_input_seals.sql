-- Complete retained input custody. Execution must still reconstruct originals
-- and obtain its own explicit resource authorization under a thematic recipe.
CREATE TABLE public.engagement_synthesis_thematic_input_seals (
 request_id uuid PRIMARY KEY REFERENCES public.engagement_synthesis_thematic_requests(request_id),
 manifest_text text NOT NULL CHECK(manifest_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(manifest_text)<=8192),
 manifest_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(manifest_text,'sha256'),'hex')) STORED,
 receipt_text text NOT NULL CHECK(receipt_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(receipt_text)<=8192),
 receipt_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(receipt_text,'sha256'),'hex')) STORED
);
ALTER TABLE public.engagement_synthesis_thematic_input_seals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_thematic_input_seals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_thematic_input_seals TO service_role;
CREATE TRIGGER synthesis_thematic_input_seal_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_thematic_input_seals
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.synthesis_thematic_input_seal_record(p_request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('manifestText',manifest_text,'manifestSha256',manifest_sha256,
  'receiptText',receipt_text,'receiptSha256',receipt_sha256)
 FROM engagement_synthesis_thematic_input_seals WHERE request_id=p_request;
$$;
REVOKE ALL ON FUNCTION public.synthesis_thematic_input_seal_record(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Match the explicit byte ordering used by bounded cursor reads, independent
-- of the installation's default text collation.
CREATE INDEX synthesis_thematic_inputs_request_target_c
 ON public.engagement_synthesis_thematic_inputs(request_id,target_record_id COLLATE "C");

-- Check the new requester's current scope even when recovering a cancelled seal.
CREATE FUNCTION public.synthesis_thematic_input_inventory_identity(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; thematic public.engagement_synthesis_thematic_requests;
 source public.engagement_synthesis_sources;
BEGIN
 request:=lock_synthesis_thematic_input_scope(p_request);
 SELECT * INTO thematic FROM engagement_synthesis_thematic_requests WHERE request_id=p_request;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=request.source_id;
 IF source.id IS NULL OR source.campaign_id IS DISTINCT FROM request.campaign_id OR source.workspace_id IS DISTINCT FROM request.workspace_id
 OR request.intent_text::jsonb->>'sourceId' IS DISTINCT FROM source.id::text
 OR request.intent_text::jsonb->>'sourceSha256' IS DISTINCT FROM source.snapshot_sha256 THEN
  RAISE EXCEPTION 'Thematic inventory source differs' USING ERRCODE='PT409';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'campaignId',request.campaign_id,'workspaceId',request.workspace_id,
  'thematic',synthesis_preparation_request_record(p_request)||jsonb_build_object('thematic',jsonb_build_object(
    'parentRequestId',thematic.parent_request_id,'thematicText',thematic.thematic_text,'thematicSha256',thematic.thematic_sha256,'createdAt',thematic.created_at)),
  'source',jsonb_build_object('requestId',source.id,'campaignId',source.campaign_id,'workspaceId',source.workspace_id,
    'snapshotSha256',source.snapshot_sha256,'createdAt',source.created_at),
  'seal',synthesis_thematic_input_seal_record(p_request));
END $$;
REVOKE ALL ON FUNCTION public.synthesis_thematic_input_inventory_identity(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Return bounded proof metadata, never a page of potentially large raw outputs.
CREATE FUNCTION public.read_engagement_synthesis_thematic_input_inventory(p_request uuid,p_after_target text DEFAULT NULL,p_limit integer DEFAULT 128)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity jsonb; entries jsonb;
BEGIN
 identity:=synthesis_thematic_input_inventory_identity(p_request);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128 OR (p_after_target IS NOT NULL
  AND p_after_target !~ '^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN
  RAISE EXCEPTION 'Invalid thematic inventory page' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('targetRecordId',target_record_id,'proofText',proof_text,'proofSha256',proof_sha256,
  'outputSha256',output_sha256,'outputBytes',octet_length(output_text)) ORDER BY target_record_id COLLATE "C"),'[]') INTO entries
 FROM (SELECT * FROM engagement_synthesis_thematic_inputs WHERE request_id=p_request
  AND (p_after_target IS NULL OR target_record_id COLLATE "C">p_after_target COLLATE "C")
  ORDER BY target_record_id COLLATE "C" LIMIT p_limit+1) bounded;
 RETURN identity||jsonb_build_object('afterTargetRecordId',p_after_target,'hasMore',jsonb_array_length(entries)>p_limit,
  'entries',CASE WHEN jsonb_array_length(entries)>p_limit THEN entries-p_limit ELSE entries END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_input_inventory(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_input_inventory(uuid,text,integer) TO service_role;

CREATE FUNCTION public.read_engagement_synthesis_thematic_input_seal_history(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM read_engagement_synthesis_thematic_request(p_campaign,p_request);
 RETURN synthesis_thematic_input_seal_record(p_request);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_input_seal_history(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_input_seal_history(uuid,uuid) TO authenticated;

CREATE FUNCTION public.seal_engagement_synthesis_thematic_inputs(p_request uuid,p_manifest_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity jsonb; request public.engagement_synthesis_generation_requests; source public.engagement_synthesis_sources;
 existing public.engagement_synthesis_thematic_input_seals; members text[]; member_count bigint; distinct_count bigint;
 row public.engagement_synthesis_thematic_inputs; seed text; tail text; total_bytes bigint:=0; input_count bigint:=0;
 expected jsonb; receipt text;
BEGIN
 identity:=synthesis_thematic_input_inventory_identity(p_request);
 IF p_manifest_text IS NULL OR octet_length(p_manifest_text)>8192 OR p_manifest_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid thematic input manifest' USING ERRCODE='22023';
 END IF;
 SELECT * INTO existing FROM engagement_synthesis_thematic_input_seals WHERE request_id=p_request;
 IF existing.request_id IS NOT NULL THEN
  IF existing.manifest_text IS DISTINCT FROM p_manifest_text THEN RAISE EXCEPTION 'Thematic seal retry differs' USING ERRCODE='PT409'; END IF;
  RETURN synthesis_thematic_input_seal_record(p_request);
 END IF;
 IF identity#>'{thematic,cancellation}'<>'null'::jsonb THEN RAISE EXCEPTION 'Thematic input sealing was cancelled' USING ERRCODE='PT409'; END IF;
 SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id=p_request;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=request.source_id;
 IF jsonb_typeof(source.snapshot_text::jsonb->'items') IS DISTINCT FROM 'array'
 OR jsonb_typeof(source.snapshot_text::jsonb->'answers') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Thematic input source membership is invalid' USING ERRCODE='PT409';
 END IF;
 SELECT array_agg(target ORDER BY target COLLATE "C"),count(*),count(DISTINCT target) INTO members,member_count,distinct_count FROM (
  SELECT 'item:'||(value->>'id') target FROM jsonb_array_elements(source.snapshot_text::jsonb->'items')
  UNION ALL SELECT 'answer:'||(value->>'id') FROM jsonb_array_elements(source.snapshot_text::jsonb->'answers')
 ) selected;
 IF member_count=0 OR member_count<>distinct_count OR EXISTS(SELECT 1 FROM unnest(members) member WHERE member IS NULL
  OR member !~ '^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN
  RAISE EXCEPTION 'Thematic input source membership is invalid' USING ERRCODE='PT409';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(members) member WHERE NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_choices c
    WHERE c.request_id=p_request AND c.target_record_id=member)
  OR NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_inputs i WHERE i.request_id=p_request AND i.target_record_id=member))
 OR EXISTS(SELECT 1 FROM engagement_synthesis_thematic_choices WHERE request_id=p_request AND NOT(target_record_id=ANY(members)))
 OR EXISTS(SELECT 1 FROM engagement_synthesis_thematic_inputs WHERE request_id=p_request AND NOT(target_record_id=ANY(members))) THEN
  RAISE EXCEPTION 'Thematic inputs do not cover the exact retained source' USING ERRCODE='PT409';
 END IF;
 seed:=encode(extensions.digest('synthesis-thematic-inputs-v1:'||p_request::text||':'||request.campaign_id::text||':'||request.workspace_id::text||':'||
  request.actor_id::text||':'||request.intent_sha256||':'||(identity#>>'{thematic,thematic,thematicSha256}')||':'||source.id::text||':'||source.snapshot_sha256,'sha256'),'hex');
 tail:=seed;
 FOR row IN SELECT * FROM engagement_synthesis_thematic_inputs WHERE request_id=p_request ORDER BY target_record_id COLLATE "C" LOOP
  tail:=encode(extensions.digest(tail||':'||row.target_record_id||':'||row.proof_sha256||':'||row.output_sha256||':'||octet_length(row.output_text)::text,'sha256'),'hex');
  total_bytes:=total_bytes+octet_length(row.output_text); input_count:=input_count+1;
 END LOOP;
 IF total_bytes>9007199254740991 OR input_count>9007199254740991 THEN RAISE EXCEPTION 'Thematic input accounting exceeds exact range' USING ERRCODE='22023'; END IF;
 expected:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_input_manifest','requestId',p_request,
  'campaignId',request.campaign_id,'workspaceId',request.workspace_id,'actorId',request.actor_id,'intentSha256',request.intent_sha256,
  'thematicSha256',identity#>>'{thematic,thematic,thematicSha256}','sourceId',source.id,'sourceSha256',source.snapshot_sha256,
  'inputCount',input_count,'outputBytes',total_bytes,'seedSha256',seed,'tailSha256',tail);
 IF p_manifest_text::jsonb IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Thematic input manifest differs from retained bytes' USING ERRCODE='PT409'; END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_input_seal','requestId',p_request,
  'manifestSha256',encode(extensions.digest(p_manifest_text,'sha256'),'hex'),'sealedAt',clock_timestamp())::text;
 INSERT INTO engagement_synthesis_thematic_input_seals(request_id,manifest_text,receipt_text) VALUES(p_request,p_manifest_text,receipt);
 RETURN synthesis_thematic_input_seal_record(p_request);
END $$;
REVOKE ALL ON FUNCTION public.seal_engagement_synthesis_thematic_inputs(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.seal_engagement_synthesis_thematic_inputs(uuid,text) TO service_role;

-- Existing exact retries remain recoverable; a seal stops all fresh input writes.
CREATE OR REPLACE FUNCTION public.retain_engagement_synthesis_thematic_input(p_request uuid,p_target text,p_proof_text text,p_output_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE previous public.engagement_synthesis_thematic_inputs; delegation jsonb; expected jsonb; choice jsonb;
BEGIN
 PERFORM lock_synthesis_thematic_input_scope(p_request);
 IF p_proof_text IS NULL OR octet_length(p_proof_text)>8192 OR p_proof_text IS NOT JSON OBJECT WITH UNIQUE KEYS
 OR p_output_text IS NULL OR octet_length(p_output_text) NOT BETWEEN 1 AND 4194304 THEN
  RAISE EXCEPTION 'Invalid thematic input bytes' USING ERRCODE='22023';
 END IF;
 SELECT * INTO previous FROM engagement_synthesis_thematic_inputs WHERE request_id=p_request AND target_record_id=p_target;
 IF previous.request_id IS NOT NULL THEN
  IF previous.proof_text IS DISTINCT FROM p_proof_text OR previous.output_text IS DISTINCT FROM p_output_text THEN
   RAISE EXCEPTION 'Thematic input retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN synthesis_thematic_input_record(p_request,p_target)||jsonb_build_object('replayed',true);
 END IF;
 -- Fresh writes recheck the complete native delegation and cancellation while
 -- holding the same request lock used by cancellation and choice retention.
 IF EXISTS(SELECT 1 FROM engagement_synthesis_thematic_input_seals WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Thematic inputs are sealed' USING ERRCODE='PT409';
 END IF;
 delegation:=read_engagement_synthesis_thematic_preparation(p_request,p_target);
 choice:=(delegation#>>'{choice,choiceText}')::jsonb;
 expected:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_input',
  'requestId',p_request,'campaignId',delegation#>>'{thematic,campaignId}','workspaceId',delegation#>>'{thematic,workspaceId}',
  'actorId',delegation#>>'{thematic,request,actorId}',
  'intentSha256',delegation#>>'{thematic,request,intentSha256}',
  'thematicSha256',delegation#>>'{thematic,thematic,thematicSha256}',
  'sourceId',delegation#>>'{source,requestId}','sourceSha256',delegation#>>'{source,snapshotSha256}',
  'targetRecordId',p_target,'choiceSha256',delegation#>>'{choice,choiceSha256}',
  'contextRequestId',choice->>'contextRequestId','contextRequestSha256',delegation#>>'{context,context,contextSha256}',
  'historyManifestSha256',choice->>'historyManifestSha256','finalCaptureSha256',choice->>'finalCaptureSha256',
  'finalResultSha256',choice->>'finalResultSha256','outputSha256',encode(extensions.digest(p_output_text,'sha256'),'hex'));
 IF p_proof_text::jsonb IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Thematic input differs from retained delegation' USING ERRCODE='PT409';
 END IF;
 INSERT INTO engagement_synthesis_thematic_inputs(request_id,target_record_id,proof_text,output_text)
 VALUES(p_request,p_target,p_proof_text,p_output_text);
 RETURN synthesis_thematic_input_record(p_request,p_target)||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_synthesis_thematic_input(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_thematic_input(uuid,text,text,text) TO service_role;
