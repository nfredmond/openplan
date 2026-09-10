-- Personal, revocable project connections. Native processes never receive a
-- Supabase session or service key. Only the app's authenticated routes can issue
-- a token; only its digest is retained. No business action is executable here.
CREATE TABLE public.assistant_provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'codex' CHECK (provider='codex'),
  device_label text NOT NULL CHECK (length(trim(device_label)) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expected_auth_mode text NOT NULL CHECK (expected_auth_mode IN ('chatgpt','apiKey')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 days'),
  revoked_at timestamptz,
  last_seen_at timestamptz,
  last_status text NOT NULL DEFAULT 'awaiting_connector' CHECK (last_status IN
    ('awaiting_connector','connected','needs_login','auth_mode_changed','unavailable','revoked')),
  UNIQUE(id,user_id,workspace_id,project_id),
  CHECK (expires_at>created_at)
);

CREATE TABLE public.assistant_provider_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  connection_id uuid,
  provider text NOT NULL CHECK (provider IN ('codex','anthropic')),
  model_id text NOT NULL CHECK (length(trim(model_id)) BETWEEN 1 AND 160),
  auth_mode text NOT NULL CHECK (auth_mode IN ('chatgpt','apiKey','workspace_api_key','deployment_api_key')),
  question text NOT NULL CHECK (length(trim(question)) BETWEEN 1 AND 2000),
  packet jsonb NOT NULL CHECK (jsonb_typeof(packet)='object' AND octet_length(packet::text)<=200000),
  packet_canonical text NOT NULL CHECK (octet_length(packet_canonical)<=200000),
  packet_hash text NOT NULL CHECK (packet_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','cancelled','interrupted')),
  attempt_id uuid,
  lease_expires_at timestamptz,
  result jsonb,
  provider_receipt jsonb,
  failure_code text CHECK (length(failure_code) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE(user_id,request_id),
  FOREIGN KEY(connection_id,user_id,workspace_id,project_id)
    REFERENCES public.assistant_provider_connections(id,user_id,workspace_id,project_id) ON DELETE CASCADE,
  CHECK ((provider='codex' AND connection_id IS NOT NULL AND auth_mode IN ('chatgpt','apiKey'))
    OR (provider='anthropic' AND connection_id IS NULL AND auth_mode IN ('workspace_api_key','deployment_api_key'))),
  CHECK (packet=packet_canonical::jsonb AND packet_hash=encode(extensions.digest(convert_to(packet_canonical,'UTF8'),'sha256'),'hex')),
  CHECK ((packet->>'version'='1' AND packet->>'workspaceId'=workspace_id::text
    AND packet->'project'->>'id'=project_id::text
    AND packet->'source'->>'id'='project:'||project_id::text
    AND packet->'source'->>'href'='/projects/'||project_id::text
    AND packet->'source'->>'label'=packet->'project'->>'name') IS TRUE),
  CHECK ((state='queued' AND attempt_id IS NULL AND lease_expires_at IS NULL AND result IS NULL AND finished_at IS NULL)
    OR (state='running' AND attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND result IS NULL AND finished_at IS NULL)
    OR (state='succeeded' AND attempt_id IS NOT NULL AND result IS NOT NULL AND provider_receipt IS NOT NULL AND finished_at IS NOT NULL AND failure_code IS NULL)
    OR (state IN ('failed','cancelled','interrupted') AND result IS NULL AND finished_at IS NOT NULL))
);
CREATE INDEX assistant_provider_turn_queue ON public.assistant_provider_turns(connection_id,created_at) WHERE state='queued';
CREATE INDEX assistant_provider_turn_owner ON public.assistant_provider_turns(user_id,workspace_id,project_id,created_at DESC);

ALTER TABLE public.assistant_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_provider_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_provider_connections,public.assistant_provider_turns FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.assistant_provider_connections,public.assistant_provider_turns TO authenticated;
GRANT ALL ON public.assistant_provider_connections,public.assistant_provider_turns TO service_role;
CREATE POLICY assistant_provider_connection_owner_read ON public.assistant_provider_connections
  FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY assistant_provider_turn_owner_read ON public.assistant_provider_turns
  FOR SELECT TO authenticated USING(user_id=auth.uid()
    AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.user_id=auth.uid() AND m.workspace_id=assistant_provider_turns.workspace_id
      AND lower(trim(coalesce(m.role,''))) IN ('owner','admin','member','viewer'))
    AND EXISTS(SELECT 1 FROM public.projects p WHERE p.id=assistant_provider_turns.project_id AND p.workspace_id=assistant_provider_turns.workspace_id));

-- Current membership and the selected project's current workspace are checked
-- under locks for every native disclosure and result delivery, including retries.
CREATE FUNCTION public.assert_assistant_provider_scope(p_user_id uuid,p_workspace_id uuid,p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_role text;
BEGIN
  SELECT role INTO member_role FROM public.workspace_members WHERE user_id=p_user_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND OR lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin','member','viewer') THEN
    RAISE EXCEPTION 'Provider project access denied' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider project access denied' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_assistant_provider_scope(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_assistant_provider_connection(p_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,p_label text,p_token_hash text,p_auth_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.assistant_provider_connections;
BEGIN
  PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);
  INSERT INTO public.assistant_provider_connections(id,user_id,workspace_id,project_id,device_label,token_hash,expected_auth_mode)
    VALUES(p_id,p_user_id,p_workspace_id,p_project_id,p_label,p_token_hash,p_auth_mode) RETURNING * INTO saved;
  RETURN to_jsonb(saved)-'token_hash';
END $$;
REVOKE ALL ON FUNCTION public.create_assistant_provider_connection(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_assistant_provider_connection(uuid,uuid,uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.revoke_assistant_provider_connection(p_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.assistant_provider_connections WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider connection not found' USING ERRCODE='42501'; END IF;
  UPDATE public.assistant_provider_connections SET revoked_at=coalesce(revoked_at,clock_timestamp()),last_status='revoked' WHERE id=p_id;
  UPDATE public.assistant_provider_turns SET state='cancelled',finished_at=clock_timestamp(),failure_code='connection_revoked'
    WHERE connection_id=p_id AND state IN ('queued','running');
END $$;
REVOKE ALL ON FUNCTION public.revoke_assistant_provider_connection(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_assistant_provider_connection(uuid,uuid) TO service_role;

CREATE FUNCTION public.lock_assistant_provider_connection(p_id uuid,p_token_hash text)
RETURNS public.assistant_provider_connections LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections;
BEGIN
  SELECT * INTO connection FROM public.assistant_provider_connections WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR connection.token_hash IS DISTINCT FROM p_token_hash OR connection.revoked_at IS NOT NULL OR connection.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Provider connection denied' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_assistant_provider_scope(connection.user_id,connection.workspace_id,connection.project_id);
  RETURN connection;
END $$;
REVOKE ALL ON FUNCTION public.lock_assistant_provider_connection(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Native claims are one-shot. An expired attempt becomes interrupted rather than
-- automatically launching a second billable generation after process loss.
CREATE FUNCTION public.claim_assistant_provider_turn(p_connection_id uuid,p_token_hash text,p_auth_mode text,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns; next_status text;
BEGIN
  connection:=public.lock_assistant_provider_connection(p_connection_id,p_token_hash);
  IF p_status NOT IN ('connected','needs_login','unavailable') OR p_status IS NULL THEN
    RAISE EXCEPTION 'Invalid provider status' USING ERRCODE='22023';
  END IF;
  next_status:=CASE WHEN p_status='connected' AND p_auth_mode IS DISTINCT FROM connection.expected_auth_mode THEN 'auth_mode_changed' ELSE p_status END;
  UPDATE public.assistant_provider_connections SET last_seen_at=clock_timestamp(),last_status=next_status WHERE id=connection.id;
  UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='native_attempt_expired'
    WHERE connection_id=connection.id AND state='running' AND lease_expires_at<=clock_timestamp();
  IF next_status<>'connected' OR EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE connection_id=connection.id AND state='running') THEN
    RETURN jsonb_build_object('status',next_status,'turn',NULL);
  END IF;
  SELECT * INTO job FROM public.assistant_provider_turns WHERE connection_id=connection.id AND state='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status',next_status,'turn',NULL); END IF;
  UPDATE public.assistant_provider_turns SET state='running',attempt_id=gen_random_uuid(),started_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '5 minutes'
    WHERE id=job.id RETURNING * INTO job;
  RETURN jsonb_build_object('status',next_status,'turn',to_jsonb(job)-'request_hash'-'result'-'provider_receipt');
END $$;
REVOKE ALL ON FUNCTION public.claim_assistant_provider_turn(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assistant_provider_turn(uuid,text,text,text) TO service_role;

CREATE FUNCTION public.create_assistant_provider_turn(p_request_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_connection_id uuid,p_provider text,p_model_id text,p_auth_mode text,p_question text,p_packet_canonical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns; created boolean; request_digest text;
BEGIN
  PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);
  IF p_provider='codex' THEN
    SELECT * INTO connection FROM public.assistant_provider_connections WHERE id=p_connection_id FOR UPDATE;
    IF NOT FOUND OR connection.user_id IS DISTINCT FROM p_user_id OR connection.workspace_id IS DISTINCT FROM p_workspace_id
      OR connection.project_id IS DISTINCT FROM p_project_id OR connection.expected_auth_mode IS DISTINCT FROM p_auth_mode
      OR connection.revoked_at IS NOT NULL OR connection.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Provider connection denied' USING ERRCODE='42501';
    END IF;
  END IF;
  request_digest:=encode(extensions.digest(convert_to(jsonb_build_object('userId',p_user_id,'workspaceId',p_workspace_id,'projectId',p_project_id,
    'connectionId',p_connection_id,'provider',p_provider,'modelId',p_model_id,'authMode',p_auth_mode,'question',p_question)::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.assistant_provider_turns(request_id,user_id,workspace_id,project_id,connection_id,provider,model_id,auth_mode,question,
      packet,packet_canonical,packet_hash,request_hash,state,attempt_id,started_at,lease_expires_at)
    VALUES(p_request_id,p_user_id,p_workspace_id,p_project_id,p_connection_id,p_provider,p_model_id,p_auth_mode,p_question,
      p_packet_canonical::jsonb,p_packet_canonical,encode(extensions.digest(convert_to(p_packet_canonical,'UTF8'),'sha256'),'hex'),request_digest,
      CASE WHEN p_provider='anthropic' THEN 'running' ELSE 'queued' END,
      CASE WHEN p_provider='anthropic' THEN gen_random_uuid() ELSE NULL END,
      CASE WHEN p_provider='anthropic' THEN clock_timestamp() ELSE NULL END,
      CASE WHEN p_provider='anthropic' THEN clock_timestamp()+interval '60 seconds' ELSE NULL END)
    ON CONFLICT(user_id,request_id) DO NOTHING RETURNING * INTO job;
  created:=FOUND;
  IF NOT created THEN
    SELECT * INTO job FROM public.assistant_provider_turns WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
    IF job.request_hash IS DISTINCT FROM request_digest THEN
      RAISE EXCEPTION 'The saved provider request differs from this retry' USING ERRCODE='PT409';
    END IF;
  END IF;
  RETURN jsonb_build_object('created',created,'turn',to_jsonb(job)-'request_hash');
END $$;
REVOKE ALL ON FUNCTION public.create_assistant_provider_turn(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_assistant_provider_turn(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text) TO service_role;

-- The result is a retained answer/proposal, not a business-effect receipt.
-- Route validation uses the same selected-project schema for both transports.
CREATE FUNCTION public.finish_assistant_provider_turn(p_turn_id uuid,p_attempt_id uuid,p_user_id uuid,p_connection_id uuid,p_token_hash text,
  p_result jsonb,p_provider_receipt jsonb,p_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns; payload jsonb;
BEGIN
  IF p_connection_id IS NOT NULL THEN
    IF p_user_id IS NOT NULL THEN RAISE EXCEPTION 'Ambiguous provider caller' USING ERRCODE='42501'; END IF;
    connection:=public.lock_assistant_provider_connection(p_connection_id,p_token_hash);
  END IF;
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id FOR UPDATE;
  IF NOT FOUND OR job.attempt_id IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RAISE EXCEPTION 'Provider attempt does not match' USING ERRCODE='42501';
  END IF;
  IF p_connection_id IS NOT NULL THEN
    IF job.connection_id IS DISTINCT FROM connection.id OR job.user_id IS DISTINCT FROM connection.user_id
      OR job.workspace_id IS DISTINCT FROM connection.workspace_id OR job.project_id IS DISTINCT FROM connection.project_id THEN
      RAISE EXCEPTION 'Provider attempt does not match' USING ERRCODE='42501';
    END IF;
  ELSE
    IF p_user_id IS NULL OR job.user_id IS DISTINCT FROM p_user_id OR job.provider<>'anthropic' THEN
      RAISE EXCEPTION 'Provider attempt does not match' USING ERRCODE='42501';
    END IF;
    PERFORM public.assert_assistant_provider_scope(job.user_id,job.workspace_id,job.project_id);
  END IF;
  IF job.state IN ('succeeded','failed') THEN
    IF job.result IS DISTINCT FROM p_result OR job.provider_receipt IS DISTINCT FROM p_provider_receipt OR job.failure_code IS DISTINCT FROM p_failure_code THEN
      RAISE EXCEPTION 'The retained provider result differs from this retry' USING ERRCODE='PT409';
    END IF;
    RETURN to_jsonb(job)-'request_hash';
  END IF;
  IF job.state<>'running' THEN RAISE EXCEPTION 'Provider attempt is no longer running' USING ERRCODE='PT409'; END IF;
  IF job.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='provider_attempt_expired' WHERE id=job.id RETURNING * INTO job;
    RETURN to_jsonb(job)-'request_hash';
  END IF;
  IF p_failure_code IS NOT NULL THEN
    IF p_failure_code !~ '^[a-z_]{1,120}$' OR p_result IS NOT NULL OR p_provider_receipt IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid provider failure' USING ERRCODE='22023';
    END IF;
    UPDATE public.assistant_provider_turns SET state='failed',failure_code=p_failure_code,finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
    RETURN to_jsonb(job)-'request_hash';
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR jsonb_typeof(p_result->'answer') IS DISTINCT FROM 'string'
    OR length(trim(p_result->>'answer')) NOT BETWEEN 1 AND 12000 OR octet_length(p_result::text)>80000
    OR jsonb_typeof(p_result->'citations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'citations')<>1
    OR p_result->'citations'->0 IS DISTINCT FROM job.packet->'source'
    OR NOT (p_result ? 'proposal') OR (p_result->'proposal'<>'null'::jsonb AND jsonb_typeof(p_result->'proposal')<>'object') THEN
    RAISE EXCEPTION 'Invalid provider result' USING ERRCODE='22023';
  END IF;
  IF p_result->'proposal'<>'null'::jsonb THEN
    payload:=p_result->'proposal'->'payload';
    IF p_result->'proposal'->>'status' IS DISTINCT FROM 'proposed' OR p_result->'proposal'->>'kind' IS DISTINCT FROM 'create_project_record'
      OR payload->>'kind' IS DISTINCT FROM 'create_project_record' OR payload->>'recordType' IS DISTINCT FROM 'submittal'
      OR payload->>'projectId' IS DISTINCT FROM job.project_id::text OR coalesce(payload->>'status','draft')<>'draft'
      OR jsonb_typeof(payload->'title') IS DISTINCT FROM 'string' OR length(trim(payload->>'title')) NOT BETWEEN 1 AND 160
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) key WHERE key NOT IN ('kind','projectId','recordType','title','submittalType','status','notes')) THEN
      RAISE EXCEPTION 'Provider proposal is outside this project task' USING ERRCODE='22023';
    END IF;
  END IF;
  IF jsonb_typeof(p_provider_receipt) IS DISTINCT FROM 'object' OR p_provider_receipt->>'schemaVersion' IS DISTINCT FROM '1'
    OR p_provider_receipt->>'provider' IS DISTINCT FROM job.provider OR p_provider_receipt->>'model' IS DISTINCT FROM job.model_id
    OR p_provider_receipt->>'authMode' IS DISTINCT FROM job.auth_mode OR octet_length(p_provider_receipt::text)>8000 THEN
    RAISE EXCEPTION 'Provider receipt identity differs from this request' USING ERRCODE='22023';
  END IF;
  UPDATE public.assistant_provider_turns SET state='succeeded',result=p_result,provider_receipt=p_provider_receipt,finished_at=clock_timestamp()
    WHERE id=job.id RETURNING * INTO job;
  RETURN to_jsonb(job)-'request_hash';
END $$;
REVOKE ALL ON FUNCTION public.finish_assistant_provider_turn(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_assistant_provider_turn(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) TO service_role;

CREATE FUNCTION public.cancel_assistant_provider_turn(p_turn_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.assistant_provider_turns;
BEGIN
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
  PERFORM public.assert_assistant_provider_scope(job.user_id,job.workspace_id,job.project_id);
  UPDATE public.assistant_provider_turns SET state='cancelled',finished_at=clock_timestamp(),failure_code='cancelled_by_user'
    WHERE id=job.id AND state IN ('queued','running');
END $$;
REVOKE ALL ON FUNCTION public.cancel_assistant_provider_turn(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_assistant_provider_turn(uuid,uuid) TO service_role;

CREATE FUNCTION public.read_assistant_provider_turn_status(p_turn_id uuid,p_connection_id uuid,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns;
BEGIN
  connection:=public.lock_assistant_provider_connection(p_connection_id,p_token_hash);
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND connection_id=connection.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
  IF job.state='running' AND job.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='provider_attempt_expired' WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN jsonb_build_object('id',job.id,'state',job.state,'attemptId',job.attempt_id,'leaseExpiresAt',job.lease_expires_at);
END $$;
REVOKE ALL ON FUNCTION public.read_assistant_provider_turn_status(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_assistant_provider_turn_status(uuid,uuid,text) TO service_role;

-- Browser recovery reads never start another generation. They make process-loss
-- expiry durable even when the native connector or original HTTP caller is gone.
CREATE FUNCTION public.read_assistant_provider_turn_for_user(p_turn_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.assistant_provider_turns;
BEGIN
  SELECT * INTO job FROM public.assistant_provider_turns WHERE id=p_turn_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider request not found' USING ERRCODE='42501'; END IF;
  PERFORM public.assert_assistant_provider_scope(job.user_id,job.workspace_id,job.project_id);
  IF job.state='running' AND job.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.assistant_provider_turns SET state='interrupted',finished_at=clock_timestamp(),failure_code='provider_attempt_expired' WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN to_jsonb(job)-'request_hash';
END $$;
REVOKE ALL ON FUNCTION public.read_assistant_provider_turn_for_user(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_assistant_provider_turn_for_user(uuid,uuid) TO service_role;

-- Project managers need retention counts, never another person's question,
-- connection identity or answer. Ordinary SELECT remains owner-only.
CREATE FUNCTION public.read_project_provider_retention_counts(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE project_workspace uuid;
BEGIN
  SELECT workspace_id INTO project_workspace FROM public.projects WHERE id=p_project_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=project_workspace
      AND user_id=auth.uid() AND lower(trim(coalesce(role,''))) IN ('owner','admin','member')) THEN
    RAISE EXCEPTION 'Project retention access denied' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'assistant_provider_connections',(SELECT count(*) FROM public.assistant_provider_connections WHERE project_id=p_project_id),
    'assistant_provider_turns',(SELECT count(*) FROM public.assistant_provider_turns WHERE project_id=p_project_id));
END $$;
REVOKE ALL ON FUNCTION public.read_project_provider_retention_counts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_project_provider_retention_counts(uuid) TO authenticated;

-- The dialog is advisory. Keep private history safe if another person cannot
-- see it, or a request races the reference count. Retiring a project is reversible.
CREATE FUNCTION public.preserve_project_provider_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.assistant_provider_connections WHERE project_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE project_id=OLD.id) THEN
    RAISE EXCEPTION 'Retained Planner Agent history prevents project deletion; retire the project instead' USING ERRCODE='23503';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.preserve_project_provider_history() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_project_provider_history BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.preserve_project_provider_history();
