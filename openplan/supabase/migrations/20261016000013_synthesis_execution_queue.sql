-- Explicit scheduling is separate from permission. Installing this migration
-- does not enqueue historical allowances or create any provider attempt.
CREATE TABLE public.engagement_synthesis_execution_queue (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES public.engagement_synthesis_generation_requests(id),
 authorization_id uuid NOT NULL UNIQUE REFERENCES public.engagement_synthesis_generation_authorizations(id),
 stage text NOT NULL CHECK(stage IN ('segment','context','thematic')),
 command_text text NOT NULL CHECK(command_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(command_text)<=4096),
 command_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(command_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.engagement_synthesis_execution_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_execution_queue FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_execution_queue TO service_role;
CREATE TRIGGER synthesis_execution_queue_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_execution_queue
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.enqueue_engagement_synthesis_execution(p_command_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE command jsonb; workspace uuid; request public.engagement_synthesis_generation_requests;
 permission public.engagement_synthesis_generation_authorizations; saved public.engagement_synthesis_execution_queue;
 actual_stage text; key text; credential_hash text;
BEGIN
 IF p_command_text IS NULL OR octet_length(p_command_text)>4096 OR p_command_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid execution queue command' USING ERRCODE='22023';
 END IF;
 command:=p_command_text::jsonb;
 IF NOT command ?& ARRAY['schemaVersion','queueId','authorizationId','authorizationIntentSha256','campaignId','workspaceId','requestId','actorId','sourceId','sourceSha256','requestIntentSha256','stage']
 OR (SELECT count(*) FROM jsonb_object_keys(command))<>12 OR command->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
  RAISE EXCEPTION 'Invalid execution queue command' USING ERRCODE='22023';
 END IF;
 FOREACH key IN ARRAY ARRAY['queueId','authorizationId','campaignId','workspaceId','requestId','actorId','sourceId'] LOOP
  IF jsonb_typeof(command->key) IS DISTINCT FROM 'string' OR command->>key !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   RAISE EXCEPTION 'Invalid execution queue identity' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['authorizationIntentSha256','sourceSha256','requestIntentSha256'] LOOP
  IF jsonb_typeof(command->key) IS DISTINCT FROM 'string' OR command->>key !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid execution queue hash' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF jsonb_typeof(command->'stage') IS DISTINCT FROM 'string' OR command->>'stage' NOT IN ('segment','context','thematic') THEN
  RAISE EXCEPTION 'Invalid execution queue stage' USING ERRCODE='22023';
 END IF;
 workspace:=lock_synthesis_generation_request_scope((command->>'campaignId')::uuid,(command->>'requestId')::uuid);
 SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id=(command->>'requestId')::uuid;
 IF request.id IS NULL OR request.actor_id IS DISTINCT FROM auth.uid() OR (command->>'actorId')::uuid IS DISTINCT FROM auth.uid()
 OR request.workspace_id IS DISTINCT FROM workspace OR (command->>'workspaceId')::uuid IS DISTINCT FROM workspace
 OR request.campaign_id IS DISTINCT FROM (command->>'campaignId')::uuid THEN
  RAISE EXCEPTION 'Original execution requester access required' USING ERRCODE='42501';
 END IF;
 actual_stage:=CASE WHEN EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=request.id) THEN 'thematic'
  WHEN EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=request.id) THEN 'context' ELSE 'segment' END;
 IF actual_stage IS DISTINCT FROM command->>'stage' OR request.source_id IS DISTINCT FROM (command->>'sourceId')::uuid
 OR request.intent_sha256 IS DISTINCT FROM command->>'requestIntentSha256'
 OR request.intent_text::jsonb->>'sourceSha256' IS DISTINCT FROM command->>'sourceSha256' THEN
  RAISE EXCEPTION 'Execution queue source or stage differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO permission FROM engagement_synthesis_generation_authorizations WHERE id=(command->>'authorizationId')::uuid;
 IF permission.id IS NULL OR permission.request_id IS DISTINCT FROM request.id
 OR permission.intent_sha256 IS DISTINCT FROM command->>'authorizationIntentSha256' THEN
  RAISE EXCEPTION 'Execution queue permission differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO saved FROM engagement_synthesis_execution_queue WHERE id=(command->>'queueId')::uuid;
 IF FOUND THEN
  IF saved.command_text IS DISTINCT FROM p_command_text THEN
   RAISE EXCEPTION 'Execution queue retry differs' USING ERRCODE='PT409';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM engagement_synthesis_execution_queue WHERE authorization_id=permission.id) THEN
   RAISE EXCEPTION 'Execution permission already queued under another command' USING ERRCODE='PT409';
  END IF;
  IF (permission.intent_text::jsonb->>'expiresAt')::timestamptz<=clock_timestamp() THEN
   RAISE EXCEPTION 'Execution queue permission expired' USING ERRCODE='PT409';
  END IF;
  credential_hash:=CASE actual_stage
   WHEN 'context' THEN assert_synthesis_context_execution_current(request.id)
   WHEN 'thematic' THEN assert_synthesis_thematic_execution_current(request.id)
   ELSE assert_synthesis_generation_execution_current(request.id) END;
  IF credential_hash IS DISTINCT FROM permission.credential_sha256 THEN
   RAISE EXCEPTION 'Execution queue credential changed' USING ERRCODE='PT409';
  END IF;
  INSERT INTO engagement_synthesis_execution_queue(id,request_id,authorization_id,stage,command_text)
   VALUES((command->>'queueId')::uuid,request.id,permission.id,actual_stage,p_command_text) RETURNING * INTO saved;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'queueId',saved.id,'commandText',saved.command_text,
  'commandSha256',saved.command_sha256,'createdAt',saved.created_at);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid execution queue command' USING ERRCODE='22023';
 WHEN unique_violation THEN RAISE EXCEPTION 'Execution queue identity already used' USING ERRCODE='PT409';
END $$;
REVOKE ALL ON FUNCTION public.enqueue_engagement_synthesis_execution(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_engagement_synthesis_execution(text) TO authenticated;
