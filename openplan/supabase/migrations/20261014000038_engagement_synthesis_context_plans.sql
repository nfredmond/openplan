-- The generic task ledger requires JSON unique-key validation, which rejects
-- some original provider strings. Preserve raw frames separately and keep safe
-- references in the shared ledger. Context commands grant no dispatch authority.
CREATE TABLE public.engagement_synthesis_context_frames (
 request_id uuid NOT NULL,
 frame_index bigint NOT NULL CHECK(frame_index>=0),
 frame_text text NOT NULL CHECK(frame_text IS JSON OBJECT AND octet_length(frame_text)<=1048576),
 frame_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(frame_text,'sha256'),'hex')) STORED,
 frame_bytes integer GENERATED ALWAYS AS (octet_length(frame_text)) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,frame_index),
 FOREIGN KEY(request_id,frame_index) REFERENCES public.engagement_synthesis_generation_plan_tasks(request_id,task_index),
 FOREIGN KEY(request_id) REFERENCES public.engagement_synthesis_context_requests(request_id)
);
ALTER TABLE public.engagement_synthesis_context_frames ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_context_frames FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_context_frames TO service_role;
CREATE TRIGGER synthesis_context_frame_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_context_frames
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.lock_synthesis_context_plan_scope(p_request uuid)
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
  RAISE EXCEPTION 'Context request is busy; retry the same plan command' USING ERRCODE='PT503';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'A retained context request is required' USING ERRCODE='0A000';
 END IF;
 RETURN saved;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Context request is busy; retry the same plan command' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_context_plan_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_context_plan(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; plan public.engagement_synthesis_generation_plans;
 last_task public.engagement_synthesis_generation_plan_tasks; seal public.engagement_synthesis_generation_plan_seals; seed text;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request);
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
 IF plan.request_id IS NULL THEN RAISE EXCEPTION 'Context plan has not been prepared' USING ERRCODE='PT409'; END IF;
 SELECT * INTO last_task FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request ORDER BY task_index DESC LIMIT 1;
 SELECT * INTO seal FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request;
 seed:=encode(extensions.digest('synthesis-context-frames-v1:'||p_request::text||':'||(plan.header_text::jsonb->>'continuationHeaderSha256')||':'||
  (plan.header_text::jsonb->>'contextRequestSha256'),'sha256'),'hex');
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'headerText',plan.header_text,'headerSha256',plan.header_sha256,
  'nextIndex',coalesce(last_task.task_index+1,0),'frameBytes',coalesce(last_task.cumulative_bytes,0),'tailSha256',coalesce(last_task.chain_sha256,seed),
  'cancelled',EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request),
  'seal',CASE WHEN seal.request_id IS NULL THEN NULL ELSE jsonb_build_object('receiptText',seal.receipt_text,'receiptSha256',seal.receipt_sha256) END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_context_plan(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_context_plan(uuid) TO service_role;

CREATE FUNCTION public.prepare_engagement_synthesis_context_plan(p_request uuid,p_header_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; plan public.engagement_synthesis_generation_plans; header jsonb; context public.engagement_synthesis_context_requests; binding jsonb;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request);
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
 IF plan.request_id IS NOT NULL THEN
  IF plan.header_text IS DISTINCT FROM p_header_text THEN RAISE EXCEPTION 'Context plan retry differs' USING ERRCODE='PT409'; END IF;
  -- Exact acknowledgement recovery does not create new work after cancellation.
  RETURN read_engagement_synthesis_context_plan(p_request);
 END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Context request was cancelled' USING ERRCODE='PT409';
 END IF;
 IF p_header_text IS NULL OR octet_length(p_header_text)>4096 OR p_header_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid context plan header' USING ERRCODE='22023';
 END IF;
 header:=p_header_text::jsonb;
 SELECT * INTO context FROM engagement_synthesis_context_requests WHERE request_id=p_request;
 binding:=context.context_text::jsonb;
 IF NOT header ?& ARRAY['schemaVersion','purpose','requestId','actorId','intentSha256','contextRequestSha256','recipeId','recipeSha256',
   'continuationHeaderSha256','contentManifestSha256','contextManifestSha256','targetRecordId','frameByteLimit','frameCount','frameBytes','tailSha256']
 OR (SELECT count(*) FROM jsonb_object_keys(header))<>16 OR header->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR header->>'purpose' IS DISTINCT FROM 'private_synthesis_context_frame_plan'
 OR header->>'requestId' IS DISTINCT FROM p_request::text OR header->>'actorId' IS DISTINCT FROM request.actor_id::text
 OR header->>'intentSha256' IS DISTINCT FROM request.intent_sha256 OR header->>'contextRequestSha256' IS DISTINCT FROM context.context_sha256
 OR header->>'recipeId' IS DISTINCT FROM 'openplan.engagement.synthesis.context.v1'
 OR header->>'recipeSha256' IS DISTINCT FROM '1ef05631ff83fbf8a85e08110c800f820586580b91c76824728de944d0d88abc'
 OR header->'contentManifestSha256' IS DISTINCT FROM binding->'contentManifestSha256'
 OR header->'contextManifestSha256' IS DISTINCT FROM binding->'contextManifestSha256'
 OR header->'targetRecordId' IS DISTINCT FROM binding->'targetRecordId'
 OR header->'frameByteLimit' IS DISTINCT FROM binding->'frameByteLimit'
 OR EXISTS(SELECT 1 FROM jsonb_each(header) e WHERE e.key IN ('purpose','requestId','actorId','intentSha256','contextRequestSha256','recipeId','recipeSha256',
   'continuationHeaderSha256','contentManifestSha256','contextManifestSha256','targetRecordId','tailSha256') AND jsonb_typeof(e.value)<>'string')
 OR header->>'continuationHeaderSha256' !~ '^[a-f0-9]{64}$' OR header->>'tailSha256' !~ '^[a-f0-9]{64}$'
 OR EXISTS(SELECT 1 FROM jsonb_each(header) e WHERE e.key IN ('frameCount','frameBytes') AND
   (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]+$' OR e.value::text::numeric NOT BETWEEN 1 AND 9007199254740991)) THEN
  RAISE EXCEPTION 'Invalid context frame plan header' USING ERRCODE='22023';
 END IF;
 INSERT INTO engagement_synthesis_generation_plans(request_id,header_text) VALUES(p_request,p_header_text);
 RETURN read_engagement_synthesis_context_plan(p_request);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid context plan header' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.prepare_engagement_synthesis_context_plan(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_engagement_synthesis_context_plan(uuid,text) TO service_role;

CREATE FUNCTION public.stage_engagement_synthesis_context_frames(p_request uuid,p_start bigint,p_previous_sha256 text,p_frames_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; state jsonb; header jsonb; tasks jsonb; entry jsonb; task text;
 position bigint; task_count bigint; next_index bigint; bytes bigint; tail text; expected_previous text; existing text; sha text; reference_text text;
BEGIN
 request:=lock_synthesis_context_plan_scope(p_request);
 state:=read_engagement_synthesis_context_plan(p_request); header:=(state->>'headerText')::jsonb;
 IF p_start IS NULL OR p_start<0 OR p_previous_sha256 IS NULL OR p_previous_sha256 !~ '^[a-f0-9]{64}$'
 OR p_frames_text IS NULL OR octet_length(p_frames_text)>4194304 OR p_frames_text IS NOT JSON ARRAY THEN
  RAISE EXCEPTION 'Invalid context frame batch' USING ERRCODE='22023';
 END IF;
 tasks:=p_frames_text::jsonb; task_count:=jsonb_array_length(tasks);
 IF task_count NOT BETWEEN 1 AND 128 OR EXISTS(SELECT 1 FROM jsonb_array_elements(tasks) e WHERE jsonb_typeof(e)<>'string') THEN
  RAISE EXCEPTION 'Invalid context frame batch' USING ERRCODE='22023';
 END IF;
 next_index:=(state->>'nextIndex')::bigint;
 IF p_start>next_index OR p_start+task_count>(header->>'frameCount')::bigint THEN
  RAISE EXCEPTION 'Context task batch is out of sequence' USING ERRCODE='PT409';
 END IF;
 IF p_start=0 THEN
  expected_previous:=encode(extensions.digest('synthesis-context-frames-v1:'||p_request::text||':'||(header->>'continuationHeaderSha256')||':'||
   (header->>'contextRequestSha256'),'sha256'),'hex');
 ELSE SELECT chain_sha256 INTO expected_previous FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request AND task_index=p_start-1;
 END IF;
 IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN RAISE EXCEPTION 'Context task prefix differs' USING ERRCODE='PT409'; END IF;
 IF p_start<next_index THEN
  IF p_start+task_count>next_index THEN RAISE EXCEPTION 'Context task retry overlaps new work' USING ERRCODE='PT409'; END IF;
  position:=p_start;
  FOR entry IN SELECT value FROM jsonb_array_elements(tasks) LOOP
   SELECT frame_text INTO existing FROM engagement_synthesis_context_frames WHERE request_id=p_request AND frame_index=position;
   IF existing IS DISTINCT FROM entry#>>'{}' THEN RAISE EXCEPTION 'Context task retry differs' USING ERRCODE='PT409'; END IF;
   position:=position+1;
  END LOOP;
  RETURN state;
 END IF;
 IF state->>'cancelled'='true' OR state->'seal'<>'null'::jsonb THEN
  RAISE EXCEPTION 'Context plan is cancelled or sealed' USING ERRCODE='PT409';
 END IF;
 tail:=p_previous_sha256; bytes:=(state->>'frameBytes')::bigint; position:=p_start;
 FOR entry IN SELECT value FROM jsonb_array_elements(tasks) LOOP
  task:=entry#>>'{}';
  IF task IS NOT JSON OBJECT OR octet_length(task)>(header->>'frameByteLimit')::integer THEN
   RAISE EXCEPTION 'Invalid context frame text' USING ERRCODE='22023';
  END IF;
  -- Even json field access and uniqueness checks can decode unsupported
  -- Unicode. Native staging retains syntax-valid opaque frame text. The worker
  -- must reconstruct every original frame and compare the committed chain;
  -- a plan seal establishes byte custody, never semantic input authenticity.
  sha:=encode(extensions.digest(task,'sha256'),'hex'); bytes:=bytes+octet_length(task);
  IF bytes>(header->>'frameBytes')::bigint THEN RAISE EXCEPTION 'Context plan byte total exceeded' USING ERRCODE='PT409'; END IF;
  tail:=encode(extensions.digest(tail||':'||position::text||':'||sha||':'||octet_length(task)::text,'sha256'),'hex');
  reference_text:=jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_context_frame_reference',
   'frameIndex',position,'frameSha256',sha,'frameBytes',octet_length(task),
   'contextManifestSha256',header->>'contextManifestSha256','targetRecordId',header->>'targetRecordId')::text;
  INSERT INTO engagement_synthesis_generation_plan_tasks(request_id,task_index,task_text,cumulative_bytes,chain_sha256)
   VALUES(p_request,position,reference_text,bytes,tail);
  INSERT INTO engagement_synthesis_context_frames(request_id,frame_index,frame_text) VALUES(p_request,position,task);
  position:=position+1;
 END LOOP;
 RETURN read_engagement_synthesis_context_plan(p_request);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid context frame batch' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.stage_engagement_synthesis_context_frames(uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stage_engagement_synthesis_context_frames(uuid,bigint,text,text) TO service_role;

CREATE FUNCTION public.seal_engagement_synthesis_context_plan(p_request uuid,p_header_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb; header jsonb; receipt text;
BEGIN
 state:=read_engagement_synthesis_context_plan(p_request); header:=(state->>'headerText')::jsonb;
 IF p_header_sha256 IS DISTINCT FROM state->>'headerSha256' THEN RAISE EXCEPTION 'Context plan identity differs' USING ERRCODE='PT409'; END IF;
 IF state->'seal'<>'null'::jsonb THEN RETURN state; END IF;
 IF state->>'cancelled'='true' THEN RAISE EXCEPTION 'Context request was cancelled' USING ERRCODE='PT409'; END IF;
 IF state->'nextIndex' IS DISTINCT FROM header->'frameCount' OR state->'frameBytes' IS DISTINCT FROM header->'frameBytes'
 OR state->>'tailSha256' IS DISTINCT FROM header->>'tailSha256' THEN
  RAISE EXCEPTION 'Context plan is incomplete or differs' USING ERRCODE='PT409';
 END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'requestId',p_request,'headerSha256',state->>'headerSha256',
  'frameCount',state->'nextIndex','frameBytes',state->'frameBytes','tailSha256',state->>'tailSha256','sealedAt',clock_timestamp())::text;
 INSERT INTO engagement_synthesis_generation_plan_seals(request_id,receipt_text) VALUES(p_request,receipt);
 RETURN read_engagement_synthesis_context_plan(p_request);
END $$;
REVOKE ALL ON FUNCTION public.seal_engagement_synthesis_context_plan(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.seal_engagement_synthesis_context_plan(uuid,text) TO service_role;
