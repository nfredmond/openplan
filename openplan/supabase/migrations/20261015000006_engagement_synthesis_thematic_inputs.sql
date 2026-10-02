-- Retain the worker's reconstructed contribution and original final output.
-- These records establish byte custody, not execution permission or semantic
-- authenticity. A later executor must replay originals before using a seal.
CREATE TABLE public.engagement_synthesis_thematic_inputs (
 request_id uuid NOT NULL,
 target_record_id text NOT NULL,
 proof_text text NOT NULL CHECK(proof_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(proof_text)<=8192),
 proof_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(proof_text,'sha256'),'hex')) STORED,
 -- Raw JSON output stays text: escaped provider Unicode must not be coerced to jsonb.
 output_text text NOT NULL CHECK(octet_length(output_text) BETWEEN 1 AND 4194304),
 output_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(output_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,target_record_id),
 FOREIGN KEY(request_id,target_record_id) REFERENCES public.engagement_synthesis_thematic_choices(request_id,target_record_id)
);
ALTER TABLE public.engagement_synthesis_thematic_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_thematic_inputs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_thematic_inputs TO service_role;
CREATE TRIGGER synthesis_thematic_input_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_thematic_inputs
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Unlike fresh preparation, exact custody recovery may follow cancellation.
-- The original thematic requester must still have current staff membership.
CREATE FUNCTION public.lock_synthesis_thematic_input_scope(p_request uuid)
RETURNS public.engagement_synthesis_generation_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.engagement_synthesis_generation_requests;
BEGIN
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF saved.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=saved.workspace_id
  AND m.user_id=saved.actor_id AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Thematic requester staff access required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=saved.campaign_id AND workspace_id=saved.workspace_id FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Thematic campaign scope differs' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||p_request::text,0)) THEN
  RAISE EXCEPTION 'Thematic preparation is busy' USING ERRCODE='PT503';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'A retained thematic request is required' USING ERRCODE='0A000';
 END IF;
 RETURN saved;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Thematic preparation is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_thematic_input_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION public.synthesis_thematic_input_record(p_request uuid,p_target text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('schemaVersion',1,'requestId',request_id,'targetRecordId',target_record_id,
  'proofText',proof_text,'proofSha256',proof_sha256,'outputText',output_text,'outputSha256',output_sha256,'createdAt',created_at)
 FROM engagement_synthesis_thematic_inputs WHERE request_id=p_request AND target_record_id=p_target;
$$;
REVOKE ALL ON FUNCTION public.synthesis_thematic_input_record(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_thematic_input(p_request uuid,p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM lock_synthesis_thematic_input_scope(p_request);
 RETURN synthesis_thematic_input_record(p_request,p_target);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_input(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_input(uuid,text) TO service_role;

-- Current staff inspection remains separate from service preparation, including
-- a departed requester's history. It cannot create inputs or restart execution.
CREATE FUNCTION public.read_engagement_synthesis_thematic_input_history(p_campaign uuid,p_request uuid,p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM read_engagement_synthesis_thematic_request(p_campaign,p_request);
 RETURN synthesis_thematic_input_record(p_request,p_target);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_input_history(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_input_history(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.retain_engagement_synthesis_thematic_input(p_request uuid,p_target text,p_proof_text text,p_output_text text)
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
