-- Staff request custody for the next recipe. Requested hashes are not verified
-- content or execution authority. A versioned executor must reconstruct them.
CREATE TABLE public.engagement_synthesis_thematic_requests (
 request_id uuid PRIMARY KEY REFERENCES public.engagement_synthesis_generation_requests(id),
 parent_request_id uuid NOT NULL REFERENCES public.engagement_synthesis_generation_requests(id),
 thematic_text text NOT NULL CHECK(thematic_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(thematic_text)<=4096),
 thematic_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(thematic_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(request_id<>parent_request_id)
);
CREATE INDEX synthesis_thematic_parent ON public.engagement_synthesis_thematic_requests(parent_request_id,request_id);
ALTER TABLE public.engagement_synthesis_thematic_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_thematic_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_thematic_requests TO service_role;
CREATE TRIGGER synthesis_thematic_request_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_thematic_requests
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.read_engagement_synthesis_thematic_request(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb; thematic public.engagement_synthesis_thematic_requests;
BEGIN
 state:=read_engagement_synthesis_generation_request(p_campaign,p_request);
 SELECT * INTO thematic FROM engagement_synthesis_thematic_requests WHERE request_id=p_request;
 IF thematic.request_id IS NULL THEN RAISE EXCEPTION 'Thematic request not accessible' USING ERRCODE='42501'; END IF;
 RETURN state||jsonb_build_object('thematic',jsonb_build_object('parentRequestId',thematic.parent_request_id,
  'thematicText',thematic.thematic_text,'thematicSha256',thematic.thematic_sha256,'createdAt',thematic.created_at));
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_request(uuid,uuid) TO authenticated;

CREATE FUNCTION public.create_engagement_synthesis_thematic_request(p_campaign uuid,p_request uuid,p_intent_text text,p_thematic_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; thematic public.engagement_synthesis_thematic_requests; binding jsonb;
 parent public.engagement_synthesis_generation_requests; existing public.engagement_synthesis_generation_requests;
 base_state jsonb; through_sequence numeric; sequence bigint;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 SELECT * INTO thematic FROM engagement_synthesis_thematic_requests WHERE request_id=p_request;
 IF thematic.request_id IS NOT NULL THEN
  -- The existing command checks exact actor, scope and original base bytes.
  -- It permits acknowledgement recovery after cancellation or provider changes.
  base_state:=create_engagement_synthesis_generation_request(p_campaign,p_request,p_intent_text);
  IF thematic.thematic_text IS DISTINCT FROM p_thematic_text THEN
   RAISE EXCEPTION 'Thematic request retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN read_engagement_synthesis_thematic_request(p_campaign,p_request)||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO existing FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF existing.id IS NOT NULL THEN
  IF existing.campaign_id IS DISTINCT FROM p_campaign OR existing.workspace_id IS DISTINCT FROM workspace
  OR existing.actor_id IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Thematic request not accessible' USING ERRCODE='42501';
  END IF;
  RAISE EXCEPTION 'Existing segment request cannot become a thematic request' USING ERRCODE='PT409';
 END IF;
 IF p_thematic_text IS NULL OR octet_length(p_thematic_text)>4096 OR p_thematic_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid thematic request binding' USING ERRCODE='22023';
 END IF;
 binding:=p_thematic_text::jsonb;
 IF NOT binding ?& ARRAY['schemaVersion','parentRequestId','selectionSequence','segmentResultsManifestSha256','contextManifestSha256','frameByteLimit']
 OR (SELECT count(*) FROM jsonb_object_keys(binding))<>6 OR binding->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(binding) e WHERE e.key IN ('parentRequestId','segmentResultsManifestSha256','contextManifestSha256') AND jsonb_typeof(e.value)<>'string')
 OR binding->>'segmentResultsManifestSha256' !~ '^[a-f0-9]{64}$' OR binding->>'contextManifestSha256' !~ '^[a-f0-9]{64}$'
 OR jsonb_typeof(binding->'selectionSequence') IS DISTINCT FROM 'number'
 OR jsonb_typeof(binding->'frameByteLimit') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Invalid thematic request binding' USING ERRCODE='22023';
 END IF;
 through_sequence:=(binding->>'selectionSequence')::numeric;
 IF through_sequence NOT BETWEEN 0 AND 9007199254740991 OR through_sequence<>trunc(through_sequence)
 OR (binding->>'frameByteLimit')::numeric NOT BETWEEN 4096 AND 1048576
 OR (binding->>'frameByteLimit')::numeric<>trunc((binding->>'frameByteLimit')::numeric) THEN
  RAISE EXCEPTION 'Invalid thematic request bounds' USING ERRCODE='22023';
 END IF;
 IF (binding->>'parentRequestId')::uuid=p_request THEN
  RAISE EXCEPTION 'Thematic request cannot reference itself' USING ERRCODE='22023';
 END IF;
 PERFORM lock_synthesis_generation_request_scope(p_campaign,(binding->>'parentRequestId')::uuid);
 SELECT * INTO parent FROM engagement_synthesis_generation_requests WHERE id=(binding->>'parentRequestId')::uuid
  AND campaign_id=p_campaign AND workspace_id=workspace;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'Thematic parent not accessible' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=parent.id)
 OR EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=parent.id) THEN
  RAISE EXCEPTION 'Thematic parent must be a retained segment request' USING ERRCODE='PT409';
 END IF;
 SELECT coalesce(max(sequence_no),0) INTO sequence FROM engagement_synthesis_generation_selections WHERE request_id=parent.id;
 IF through_sequence>sequence THEN RAISE EXCEPTION 'Thematic sequence is not retained' USING ERRCODE='PT409'; END IF;
 -- Creation preserves current staff authorship. Parent cancellation and the
 -- parent's former actor do not grant or deny this new staff request.
 base_state:=create_engagement_synthesis_generation_request(p_campaign,p_request,p_intent_text);
 IF (base_state#>>'{request,intentText}')::jsonb->>'sourceId' IS DISTINCT FROM parent.source_id::text THEN
  RAISE EXCEPTION 'Thematic request source differs from its parent' USING ERRCODE='PT409';
 END IF;
 INSERT INTO engagement_synthesis_thematic_requests(request_id,parent_request_id,thematic_text)
 VALUES(p_request,parent.id,p_thematic_text);
 RETURN read_engagement_synthesis_thematic_request(p_campaign,p_request)||jsonb_build_object('replayed',false);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid thematic request binding' USING ERRCODE='22023';
 WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Thematic request is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.create_engagement_synthesis_thematic_request(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_engagement_synthesis_thematic_request(uuid,uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.lock_synthesis_generation_plan_scope(p_request uuid)
RETURNS public.engagement_synthesis_generation_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.engagement_synthesis_generation_requests;
BEGIN
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF saved.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=saved.workspace_id
  AND m.user_id=saved.actor_id AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Retained requester staff access required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=saved.campaign_id AND workspace_id=saved.workspace_id FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Retained request campaign differs' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||p_request::text,0)) THEN
  RAISE EXCEPTION 'Synthesis request is busy; retry the same plan command' USING ERRCODE='PT503';
 END IF;
 -- A dependent request cannot be reinterpreted as the segment recipe.
 IF EXISTS(SELECT 1 FROM public.engagement_synthesis_context_requests WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Context stage execution is not connected' USING ERRCODE='0A000';
 END IF;
 IF EXISTS(SELECT 1 FROM public.engagement_synthesis_thematic_requests WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Thematic stage cannot use the segment executor' USING ERRCODE='0A000';
 END IF;
 RETURN saved;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Synthesis request is busy; retry the same plan command' USING ERRCODE='PT503';
END $$;

-- Existing context creation stays byte-compatible. New thematic requests cannot
-- become segment parents through that older entry point.
CREATE FUNCTION public.refuse_synthesis_thematic_context_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.engagement_synthesis_thematic_requests WHERE request_id=NEW.parent_request_id) THEN
  RAISE EXCEPTION 'Context parent must be a retained segment request' USING ERRCODE='PT409';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refuse_synthesis_thematic_context_parent() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER synthesis_context_parent_stage BEFORE INSERT ON public.engagement_synthesis_context_requests
 FOR EACH ROW EXECUTE FUNCTION public.refuse_synthesis_thematic_context_parent();
