-- Retain opaque thematic evidence frames under the shared immutable task ledger.
-- The seal adds a distinct final proposal reference. Neither grants execution.
CREATE TABLE public.engagement_synthesis_thematic_frames (
 request_id uuid NOT NULL REFERENCES public.engagement_synthesis_thematic_requests(request_id),
 frame_index bigint NOT NULL CHECK(frame_index>=0),
 frame_text text NOT NULL CHECK(frame_text IS JSON OBJECT AND octet_length(frame_text)<=1048576),
 frame_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(frame_text,'sha256'),'hex')) STORED,
 frame_bytes integer GENERATED ALWAYS AS (octet_length(frame_text)) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,frame_index),
 FOREIGN KEY(request_id,frame_index) REFERENCES public.engagement_synthesis_generation_plan_tasks(request_id,task_index)
);
ALTER TABLE public.engagement_synthesis_thematic_frames ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_thematic_frames FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_thematic_frames TO service_role;
CREATE TRIGGER synthesis_thematic_frame_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_thematic_frames
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.lock_synthesis_thematic_plan_scope(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity jsonb;
BEGIN
 -- The existing identity reader locks this thematic request, its current staff
 -- membership and campaign, and checks the original source scope and hash.
 identity:=synthesis_thematic_input_inventory_identity(p_request);
 IF identity->'seal'='null'::jsonb THEN RAISE EXCEPTION 'Sealed thematic inputs required' USING ERRCODE='PT409'; END IF;
 RETURN identity;
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_thematic_plan_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_thematic_plan(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity jsonb; plan public.engagement_synthesis_generation_plans;
 last_frame public.engagement_synthesis_generation_plan_tasks; seal public.engagement_synthesis_generation_plan_seals; header jsonb; seed text;
BEGIN
 identity:=lock_synthesis_thematic_plan_scope(p_request);
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
 IF plan.request_id IS NULL THEN RAISE EXCEPTION 'Thematic plan unavailable' USING ERRCODE='PT409'; END IF;
 header:=plan.header_text::jsonb;
 SELECT task.* INTO last_frame FROM engagement_synthesis_generation_plan_tasks task
 JOIN engagement_synthesis_thematic_frames frame ON frame.request_id=task.request_id AND frame.frame_index=task.task_index
 WHERE task.request_id=p_request ORDER BY task.task_index DESC LIMIT 1;
 SELECT * INTO seal FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request;
 seed:=encode(extensions.digest('synthesis-thematic-frames-v1:'||p_request::text||':'||(header->>'continuationHeaderSha256')||':'||
  (header->>'inputManifestSha256')||':'||(header->>'inputSealSha256'),'sha256'),'hex');
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'campaignId',identity->'campaignId','workspaceId',identity->'workspaceId',
  'headerText',plan.header_text,'headerSha256',plan.header_sha256,'nextIndex',coalesce(last_frame.task_index+1,0),
  'frameBytes',coalesce(last_frame.cumulative_bytes,0),'tailSha256',coalesce(last_frame.chain_sha256,seed),
  'cancelled',identity#>'{thematic,cancellation}'<>'null'::jsonb,
  'seal',CASE WHEN seal.request_id IS NULL THEN NULL ELSE jsonb_build_object('receiptText',seal.receipt_text,'receiptSha256',seal.receipt_sha256) END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_plan(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_plan(uuid) TO service_role;

CREATE FUNCTION public.prepare_engagement_synthesis_thematic_plan(p_request uuid,p_header_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity jsonb; plan public.engagement_synthesis_generation_plans; header jsonb; binding jsonb; intent jsonb;
BEGIN
 identity:=lock_synthesis_thematic_plan_scope(p_request);
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
 IF plan.request_id IS NOT NULL THEN
  IF plan.header_text IS DISTINCT FROM p_header_text THEN RAISE EXCEPTION 'Thematic plan retry differs' USING ERRCODE='PT409'; END IF;
  RETURN read_engagement_synthesis_thematic_plan(p_request);
 END IF;
 IF identity#>'{thematic,cancellation}'<>'null'::jsonb THEN RAISE EXCEPTION 'Thematic request was cancelled' USING ERRCODE='PT409'; END IF;
 IF p_header_text IS NULL OR octet_length(p_header_text)>8192 OR p_header_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid thematic plan header' USING ERRCODE='22023';
 END IF;
 header:=p_header_text::jsonb; binding:=(identity#>>'{thematic,thematic,thematicText}')::jsonb; intent:=(identity#>>'{thematic,request,intentText}')::jsonb;
 IF NOT header ?& ARRAY['schemaVersion','purpose','requestId','campaignId','workspaceId','actorId','intentSha256','thematicRequestSha256','recipeId','recipeSha256',
  'continuationHeaderSha256','contentManifestSha256','inputManifestSha256','inputSealSha256','frameByteLimit','taskByteLimit','frameCount','taskCount','frameBytes','tailSha256']
 OR (SELECT count(*) FROM jsonb_object_keys(header))<>20 OR header->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR header->>'purpose' IS DISTINCT FROM 'private_synthesis_thematic_frame_plan'
 OR header->>'requestId' IS DISTINCT FROM p_request::text OR header->'campaignId' IS DISTINCT FROM identity->'campaignId'
 OR header->'workspaceId' IS DISTINCT FROM identity->'workspaceId' OR header->'actorId' IS DISTINCT FROM identity#>'{thematic,request,actorId}'
 OR header->'intentSha256' IS DISTINCT FROM identity#>'{thematic,request,intentSha256}'
 OR header->'thematicRequestSha256' IS DISTINCT FROM identity#>'{thematic,thematic,thematicSha256}'
 OR header->>'recipeId' IS DISTINCT FROM 'openplan.engagement.synthesis.thematic.v1'
 OR header->>'recipeSha256' IS DISTINCT FROM '7310c615ecff9ec8d67f498d188321c2bc104cec6020b206481953c7f88eda69'
 OR header->'inputManifestSha256' IS DISTINCT FROM identity#>'{seal,manifestSha256}'
 OR header->'inputSealSha256' IS DISTINCT FROM identity#>'{seal,receiptSha256}'
 OR header->'frameByteLimit' IS DISTINCT FROM binding->'frameByteLimit' OR header->'taskByteLimit' IS DISTINCT FROM intent->'taskByteLimit'
 OR EXISTS(SELECT 1 FROM jsonb_each(header) e WHERE e.key IN ('purpose','requestId','campaignId','workspaceId','actorId','intentSha256','thematicRequestSha256',
  'recipeId','recipeSha256','continuationHeaderSha256','contentManifestSha256','inputManifestSha256','inputSealSha256','tailSha256') AND jsonb_typeof(e.value)<>'string')
 OR header->>'continuationHeaderSha256' !~ '^[a-f0-9]{64}$' OR header->>'contentManifestSha256' !~ '^[a-f0-9]{64}$' OR header->>'tailSha256' !~ '^[a-f0-9]{64}$'
 OR EXISTS(SELECT 1 FROM jsonb_each(header) e WHERE e.key IN ('frameCount','taskCount','frameBytes') AND
  (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]+$' OR e.value::text::numeric NOT BETWEEN 1 AND 9007199254740991))
 OR (header->>'taskCount')::numeric<>(header->>'frameCount')::numeric+1 THEN
  RAISE EXCEPTION 'Invalid thematic frame plan header' USING ERRCODE='22023';
 END IF;
 INSERT INTO engagement_synthesis_generation_plans(request_id,header_text) VALUES(p_request,p_header_text);
 RETURN read_engagement_synthesis_thematic_plan(p_request);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid thematic plan header' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.prepare_engagement_synthesis_thematic_plan(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_engagement_synthesis_thematic_plan(uuid,text) TO service_role;

CREATE FUNCTION public.stage_engagement_synthesis_thematic_frames(p_request uuid,p_start bigint,p_previous_sha256 text,p_frames_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb; header jsonb; frames jsonb; entry jsonb; frame_text text; position bigint; count_frames bigint;
 next_index bigint; bytes bigint; tail text; expected_previous text; existing text; sha text; reference_text text;
BEGIN
 state:=read_engagement_synthesis_thematic_plan(p_request); header:=(state->>'headerText')::jsonb;
 IF p_start IS NULL OR p_start<0 OR p_previous_sha256 IS NULL OR p_previous_sha256 !~ '^[a-f0-9]{64}$'
 OR p_frames_text IS NULL OR octet_length(p_frames_text)>4194304 OR p_frames_text IS NOT JSON ARRAY THEN
  RAISE EXCEPTION 'Invalid thematic frame batch' USING ERRCODE='22023';
 END IF;
 frames:=p_frames_text::jsonb; count_frames:=jsonb_array_length(frames);
 IF count_frames NOT BETWEEN 1 AND 128 OR EXISTS(SELECT 1 FROM jsonb_array_elements(frames) e WHERE jsonb_typeof(e)<>'string') THEN
  RAISE EXCEPTION 'Invalid thematic frame batch' USING ERRCODE='22023';
 END IF;
 next_index:=(state->>'nextIndex')::bigint;
 IF p_start>next_index OR p_start+count_frames>(header->>'frameCount')::bigint THEN RAISE EXCEPTION 'Thematic frame batch is out of sequence' USING ERRCODE='PT409'; END IF;
 IF p_start=0 THEN
  expected_previous:=encode(extensions.digest('synthesis-thematic-frames-v1:'||p_request::text||':'||(header->>'continuationHeaderSha256')||':'||
   (header->>'inputManifestSha256')||':'||(header->>'inputSealSha256'),'sha256'),'hex');
 ELSE SELECT chain_sha256 INTO expected_previous FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request AND task_index=p_start-1;
 END IF;
 IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN RAISE EXCEPTION 'Thematic frame prefix differs' USING ERRCODE='PT409'; END IF;
 IF p_start<next_index THEN
  IF p_start+count_frames>next_index THEN RAISE EXCEPTION 'Thematic frame retry overlaps new work' USING ERRCODE='PT409'; END IF;
  position:=p_start;
  FOR entry IN SELECT value FROM jsonb_array_elements(frames) LOOP
   SELECT frame.frame_text INTO existing FROM engagement_synthesis_thematic_frames frame WHERE request_id=p_request AND frame_index=position;
   IF existing IS DISTINCT FROM entry#>>'{}' THEN RAISE EXCEPTION 'Thematic frame retry differs' USING ERRCODE='PT409'; END IF;
   position:=position+1;
  END LOOP;
  RETURN state;
 END IF;
 IF state->>'cancelled'='true' OR state->'seal'<>'null'::jsonb THEN RAISE EXCEPTION 'Thematic plan is cancelled or sealed' USING ERRCODE='PT409'; END IF;
 tail:=p_previous_sha256; bytes:=(state->>'frameBytes')::bigint; position:=p_start;
 FOR entry IN SELECT value FROM jsonb_array_elements(frames) LOOP
  frame_text:=entry#>>'{}';
  IF frame_text IS NOT JSON OBJECT OR octet_length(frame_text)>(header->>'frameByteLimit')::integer THEN RAISE EXCEPTION 'Invalid thematic frame text' USING ERRCODE='22023'; END IF;
  -- Preserve syntax-valid opaque bytes, including JSON Unicode that jsonb cannot
  -- decode. Workers must reconstruct original content before any execution.
  sha:=encode(extensions.digest(frame_text,'sha256'),'hex'); bytes:=bytes+octet_length(frame_text);
  IF bytes>(header->>'frameBytes')::bigint THEN RAISE EXCEPTION 'Thematic frame byte total exceeded' USING ERRCODE='PT409'; END IF;
  tail:=encode(extensions.digest(tail||':'||position::text||':'||sha||':'||octet_length(frame_text)::text,'sha256'),'hex');
  reference_text:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_frame_reference',
   'frameIndex',position,'frameSha256',sha,'frameBytes',octet_length(frame_text),
   'inputManifestSha256',header->>'inputManifestSha256','contentManifestSha256',header->>'contentManifestSha256')::text;
  INSERT INTO engagement_synthesis_generation_plan_tasks(request_id,task_index,task_text,cumulative_bytes,chain_sha256) VALUES(p_request,position,reference_text,bytes,tail);
  INSERT INTO engagement_synthesis_thematic_frames(request_id,frame_index,frame_text) VALUES(p_request,position,frame_text);
  position:=position+1;
 END LOOP;
 RETURN read_engagement_synthesis_thematic_plan(p_request);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid thematic frame batch' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.stage_engagement_synthesis_thematic_frames(uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stage_engagement_synthesis_thematic_frames(uuid,bigint,text,text) TO service_role;

CREATE FUNCTION public.seal_engagement_synthesis_thematic_plan(p_request uuid,p_header_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb; header jsonb; receipt text; reference_text text;
BEGIN
 state:=read_engagement_synthesis_thematic_plan(p_request); header:=(state->>'headerText')::jsonb;
 IF p_header_sha256 IS DISTINCT FROM state->>'headerSha256' THEN RAISE EXCEPTION 'Thematic plan identity differs' USING ERRCODE='PT409'; END IF;
 IF state->'seal'<>'null'::jsonb THEN RETURN state; END IF;
 IF state->>'cancelled'='true' THEN RAISE EXCEPTION 'Thematic request was cancelled' USING ERRCODE='PT409'; END IF;
 IF state->'nextIndex' IS DISTINCT FROM header->'frameCount' OR state->'frameBytes' IS DISTINCT FROM header->'frameBytes'
 OR state->>'tailSha256' IS DISTINCT FROM header->>'tailSha256'
 OR (SELECT count(*) FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request)<>(header->>'frameCount')::bigint THEN
  RAISE EXCEPTION 'Thematic plan is incomplete or differs' USING ERRCODE='PT409';
 END IF;
 reference_text:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_proposal_reference','taskIndex',header->'frameCount',
  'inputManifestSha256',header->>'inputManifestSha256','inputSealSha256',header->>'inputSealSha256',
  'continuationHeaderSha256',header->>'continuationHeaderSha256','contentManifestSha256',header->>'contentManifestSha256','frameTailSha256',header->>'tailSha256')::text;
 -- The final slot references the complete sealed frames. Its chain value remains
 -- the frame tail; it is not falsely counted as another evidence frame.
 INSERT INTO engagement_synthesis_generation_plan_tasks(request_id,task_index,task_text,cumulative_bytes,chain_sha256)
 VALUES(p_request,(header->>'frameCount')::bigint,reference_text,(header->>'frameBytes')::bigint,header->>'tailSha256');
 receipt:=jsonb_build_object('schemaVersion',1,'requestId',p_request,'headerSha256',state->>'headerSha256',
  'frameCount',state->'nextIndex','taskCount',header->'taskCount','frameBytes',state->'frameBytes','tailSha256',state->>'tailSha256',
  'proposalReferenceText',reference_text,'proposalReferenceSha256',encode(extensions.digest(reference_text,'sha256'),'hex'),'sealedAt',clock_timestamp())::text;
 INSERT INTO engagement_synthesis_generation_plan_seals(request_id,receipt_text) VALUES(p_request,receipt);
 RETURN read_engagement_synthesis_thematic_plan(p_request);
END $$;
REVOKE ALL ON FUNCTION public.seal_engagement_synthesis_thematic_plan(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.seal_engagement_synthesis_thematic_plan(uuid,text) TO service_role;
