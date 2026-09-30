-- Segment plans are private preparation records, not provider authorization.
-- Immutable batches permit recovery without sending a partial plan to a provider.
CREATE TABLE public.engagement_synthesis_generation_plans (
 request_id uuid PRIMARY KEY REFERENCES public.engagement_synthesis_generation_requests(id),
 header_text text NOT NULL CHECK(header_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(header_text)<=4096),
 header_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(header_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.engagement_synthesis_generation_plan_tasks (
 request_id uuid NOT NULL REFERENCES public.engagement_synthesis_generation_plans(request_id),
 task_index bigint NOT NULL CHECK(task_index>=0),
 task_text text NOT NULL CHECK(task_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(task_text)<=1048576),
 task_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(task_text,'sha256'),'hex')) STORED,
 task_bytes integer GENERATED ALWAYS AS (octet_length(task_text)) STORED,
 cumulative_bytes bigint NOT NULL CHECK(cumulative_bytes>=0),
 chain_sha256 text NOT NULL CHECK(chain_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(request_id,task_index)
);
CREATE TABLE public.engagement_synthesis_generation_plan_seals (
 request_id uuid PRIMARY KEY REFERENCES public.engagement_synthesis_generation_plans(request_id),
 receipt_text text NOT NULL CHECK(receipt_text IS JSON OBJECT WITH UNIQUE KEYS),
 receipt_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(receipt_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.engagement_synthesis_generation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_synthesis_generation_plan_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_synthesis_generation_plan_seals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_generation_plans,public.engagement_synthesis_generation_plan_tasks,public.engagement_synthesis_generation_plan_seals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_generation_plans,public.engagement_synthesis_generation_plan_tasks,public.engagement_synthesis_generation_plan_seals TO service_role;
CREATE TRIGGER synthesis_generation_plan_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_generation_plans
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
CREATE TRIGGER synthesis_generation_plan_task_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_generation_plan_tasks
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
CREATE TRIGGER synthesis_generation_plan_seal_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_generation_plan_seals
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Worker authority comes from the retained requester and current membership.
-- It does not use a staff JWT claim or grant access to authenticated callers.
CREATE FUNCTION public.lock_synthesis_generation_plan_scope(p_request uuid)
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
 RETURN saved;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Synthesis request is busy; retry the same plan command' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_generation_plan_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_generation_plan(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; plan public.engagement_synthesis_generation_plans;
 last_task public.engagement_synthesis_generation_plan_tasks; seal public.engagement_synthesis_generation_plan_seals; seed text;
BEGIN
 request:=lock_synthesis_generation_plan_scope(p_request);
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
 IF plan.request_id IS NULL THEN RAISE EXCEPTION 'Synthesis plan has not been prepared' USING ERRCODE='PT409'; END IF;
 SELECT * INTO last_task FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request ORDER BY task_index DESC LIMIT 1;
 SELECT * INTO seal FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request;
 seed:=encode(extensions.digest('synthesis-plan-v1:'||p_request::text||':'||request.intent_sha256||':'||
  (plan.header_text::jsonb->>'recipeSha256')||':'||(plan.header_text::jsonb->>'taskManifestSha256'),'sha256'),'hex');
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'headerText',plan.header_text,'headerSha256',plan.header_sha256,
  'nextIndex',coalesce(last_task.task_index+1,0),'taskBytes',coalesce(last_task.cumulative_bytes,0),'tailSha256',coalesce(last_task.chain_sha256,seed),
  'cancelled',EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request),
  'seal',CASE WHEN seal.request_id IS NULL THEN NULL ELSE jsonb_build_object('receiptText',seal.receipt_text,'receiptSha256',seal.receipt_sha256) END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_generation_plan(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_generation_plan(uuid) TO service_role;

CREATE FUNCTION public.prepare_engagement_synthesis_generation_plan(p_request uuid,p_header_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; plan public.engagement_synthesis_generation_plans; header jsonb;
BEGIN
 request:=lock_synthesis_generation_plan_scope(p_request);
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=p_request;
 IF plan.request_id IS NOT NULL THEN
  IF plan.header_text IS DISTINCT FROM p_header_text THEN RAISE EXCEPTION 'Synthesis plan retry differs' USING ERRCODE='PT409'; END IF;
  -- Exact acknowledgement recovery does not create new work after cancellation.
  RETURN read_engagement_synthesis_generation_plan(p_request);
 END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409';
 END IF;
 IF p_header_text IS NULL OR octet_length(p_header_text)>4096 OR p_header_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid synthesis plan header' USING ERRCODE='22023';
 END IF;
 header:=p_header_text::jsonb;
 IF NOT header ?& ARRAY['schemaVersion','purpose','requestId','intentSha256','recipeId','recipeSha256','taskManifestSha256','taskCount','taskBytes','contributionCount','tailSha256']
 OR (SELECT count(*) FROM jsonb_object_keys(header))<>11 OR header->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR header->>'purpose' IS DISTINCT FROM 'private_synthesis_segment_plan'
 OR header->>'requestId' IS DISTINCT FROM p_request::text OR header->>'intentSha256' IS DISTINCT FROM request.intent_sha256
 OR header->>'recipeId' IS DISTINCT FROM 'openplan.engagement.synthesis.segment.v1'
 OR header->>'recipeSha256' IS DISTINCT FROM 'bc91bcf4ca0a31468a8a9c7aa4b383855382f7888eeb70ed7bb143ff2f8a473b'
 OR EXISTS(SELECT 1 FROM jsonb_each(header) e WHERE e.key IN ('purpose','requestId','intentSha256','recipeId','recipeSha256','taskManifestSha256','tailSha256') AND jsonb_typeof(e.value)<>'string')
 OR header->>'taskManifestSha256' !~ '^[a-f0-9]{64}$' OR header->>'tailSha256' !~ '^[a-f0-9]{64}$'
 OR EXISTS(SELECT 1 FROM jsonb_each(header) e WHERE e.key IN ('taskCount','taskBytes','contributionCount') AND
  (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]+$' OR e.value::text::numeric>9007199254740991)) THEN
  RAISE EXCEPTION 'Invalid synthesis plan header' USING ERRCODE='22023';
 END IF;
 INSERT INTO engagement_synthesis_generation_plans(request_id,header_text) VALUES(p_request,p_header_text);
 RETURN read_engagement_synthesis_generation_plan(p_request);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid synthesis plan header' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.prepare_engagement_synthesis_generation_plan(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_engagement_synthesis_generation_plan(uuid,text) TO service_role;

CREATE FUNCTION public.stage_engagement_synthesis_generation_tasks(p_request uuid,p_start bigint,p_previous_sha256 text,p_tasks_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; state jsonb; header jsonb; tasks jsonb; entry jsonb; task text;
 position bigint; task_count bigint; next_index bigint; bytes bigint; tail text; expected_previous text; existing text; sha text;
BEGIN
 request:=lock_synthesis_generation_plan_scope(p_request);
 state:=read_engagement_synthesis_generation_plan(p_request); header:=(state->>'headerText')::jsonb;
 IF p_start IS NULL OR p_start<0 OR p_previous_sha256 IS NULL OR p_previous_sha256 !~ '^[a-f0-9]{64}$'
 OR p_tasks_text IS NULL OR octet_length(p_tasks_text)>4194304 OR p_tasks_text IS NOT JSON ARRAY THEN
  RAISE EXCEPTION 'Invalid synthesis task batch' USING ERRCODE='22023';
 END IF;
 tasks:=p_tasks_text::jsonb; task_count:=jsonb_array_length(tasks);
 IF task_count NOT BETWEEN 1 AND 128 OR EXISTS(SELECT 1 FROM jsonb_array_elements(tasks) e WHERE jsonb_typeof(e)<>'string') THEN
  RAISE EXCEPTION 'Invalid synthesis task batch' USING ERRCODE='22023';
 END IF;
 next_index:=(state->>'nextIndex')::bigint;
 IF p_start>next_index OR p_start+task_count>(header->>'taskCount')::bigint THEN
  RAISE EXCEPTION 'Synthesis task batch is out of sequence' USING ERRCODE='PT409';
 END IF;
 IF p_start=0 THEN
  expected_previous:=encode(extensions.digest('synthesis-plan-v1:'||p_request::text||':'||request.intent_sha256||':'||
   (header->>'recipeSha256')||':'||(header->>'taskManifestSha256'),'sha256'),'hex');
 ELSE SELECT chain_sha256 INTO expected_previous FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request AND task_index=p_start-1;
 END IF;
 IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN RAISE EXCEPTION 'Synthesis task prefix differs' USING ERRCODE='PT409'; END IF;
 IF p_start<next_index THEN
  IF p_start+task_count>next_index THEN RAISE EXCEPTION 'Synthesis task retry overlaps new work' USING ERRCODE='PT409'; END IF;
  position:=p_start;
  FOR entry IN SELECT value FROM jsonb_array_elements(tasks) LOOP
   SELECT task_text INTO existing FROM engagement_synthesis_generation_plan_tasks WHERE request_id=p_request AND task_index=position;
   IF existing IS DISTINCT FROM entry#>>'{}' THEN RAISE EXCEPTION 'Synthesis task retry differs' USING ERRCODE='PT409'; END IF;
   position:=position+1;
  END LOOP;
  RETURN state;
 END IF;
 IF state->>'cancelled'='true' OR state->'seal'<>'null'::jsonb THEN
  RAISE EXCEPTION 'Synthesis plan is cancelled or sealed' USING ERRCODE='PT409';
 END IF;
 tail:=p_previous_sha256; bytes:=(state->>'taskBytes')::bigint; position:=p_start;
 FOR entry IN SELECT value FROM jsonb_array_elements(tasks) LOOP
  task:=entry#>>'{}';
  IF task IS NOT JSON OBJECT WITH UNIQUE KEYS OR octet_length(task)>(request.intent_text::jsonb->>'taskByteLimit')::integer THEN
   RAISE EXCEPTION 'Invalid synthesis task text' USING ERRCODE='22023';
  END IF;
  IF task::jsonb->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR task::jsonb#>>'{input,source,requestId}' IS DISTINCT FROM request.source_id::text
  OR task::jsonb#>>'{input,source,campaignId}' IS DISTINCT FROM request.campaign_id::text
  OR task::jsonb#>>'{input,source,workspaceId}' IS DISTINCT FROM request.workspace_id::text
  OR task::jsonb#>>'{input,source,sha256}' IS DISTINCT FROM request.intent_text::jsonb->>'sourceSha256' THEN
   RAISE EXCEPTION 'Synthesis task source differs' USING ERRCODE='PT409';
  END IF;
  sha:=encode(extensions.digest(task,'sha256'),'hex'); bytes:=bytes+octet_length(task);
  IF bytes>(header->>'taskBytes')::bigint THEN RAISE EXCEPTION 'Synthesis plan byte total exceeded' USING ERRCODE='PT409'; END IF;
  tail:=encode(extensions.digest(tail||':'||position::text||':'||sha||':'||octet_length(task)::text,'sha256'),'hex');
  INSERT INTO engagement_synthesis_generation_plan_tasks(request_id,task_index,task_text,cumulative_bytes,chain_sha256)
   VALUES(p_request,position,task,bytes,tail);
  position:=position+1;
 END LOOP;
 RETURN read_engagement_synthesis_generation_plan(p_request);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid synthesis task batch' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.stage_engagement_synthesis_generation_tasks(uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stage_engagement_synthesis_generation_tasks(uuid,bigint,text,text) TO service_role;

CREATE FUNCTION public.seal_engagement_synthesis_generation_plan(p_request uuid,p_header_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb; header jsonb; receipt text;
BEGIN
 state:=read_engagement_synthesis_generation_plan(p_request); header:=(state->>'headerText')::jsonb;
 IF p_header_sha256 IS DISTINCT FROM state->>'headerSha256' THEN RAISE EXCEPTION 'Synthesis plan identity differs' USING ERRCODE='PT409'; END IF;
 IF state->'seal'<>'null'::jsonb THEN RETURN state; END IF;
 IF state->>'cancelled'='true' THEN RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409'; END IF;
 IF state->'nextIndex' IS DISTINCT FROM header->'taskCount' OR state->'taskBytes' IS DISTINCT FROM header->'taskBytes'
 OR state->>'tailSha256' IS DISTINCT FROM header->>'tailSha256' THEN
  RAISE EXCEPTION 'Synthesis plan is incomplete or differs' USING ERRCODE='PT409';
 END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'requestId',p_request,'headerSha256',state->>'headerSha256',
  'taskCount',state->'nextIndex','taskBytes',state->'taskBytes','tailSha256',state->>'tailSha256','sealedAt',clock_timestamp())::text;
 INSERT INTO engagement_synthesis_generation_plan_seals(request_id,receipt_text) VALUES(p_request,receipt);
 RETURN read_engagement_synthesis_generation_plan(p_request);
END $$;
REVOKE ALL ON FUNCTION public.seal_engagement_synthesis_generation_plan(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.seal_engagement_synthesis_generation_plan(uuid,text) TO service_role;
