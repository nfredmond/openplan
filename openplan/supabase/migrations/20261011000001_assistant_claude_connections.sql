-- Extend the existing personal native connection and frozen request workflow.
-- Existing Codex rows, setup files, functions and retained answers stay valid.
BEGIN;

ALTER TABLE public.assistant_provider_connections
  DROP CONSTRAINT assistant_provider_connections_provider_check,
  DROP CONSTRAINT assistant_provider_connections_expected_auth_mode_check,
  ADD CONSTRAINT assistant_provider_connections_provider_check CHECK (provider IN ('codex','claude')),
  ADD CONSTRAINT assistant_provider_connections_expected_auth_mode_check CHECK (expected_auth_mode IN ('chatgpt','apiKey','claude_subscription')),
  ADD CONSTRAINT assistant_provider_connection_mode CHECK (
    (provider='codex' AND expected_auth_mode IN ('chatgpt','apiKey')) OR
    (provider='claude' AND expected_auth_mode='claude_subscription')),
  ADD CONSTRAINT assistant_provider_connection_identity UNIQUE(id,user_id,workspace_id,project_id,provider,expected_auth_mode);

ALTER TABLE public.assistant_provider_turns
  DROP CONSTRAINT assistant_provider_turns_provider_check,
  DROP CONSTRAINT assistant_provider_turns_auth_mode_check,
  DROP CONSTRAINT assistant_provider_turns_check,
  ADD CONSTRAINT assistant_provider_turns_provider_check CHECK (provider IN ('codex','claude','anthropic')),
  ADD CONSTRAINT assistant_provider_turns_auth_mode_check CHECK (auth_mode IN ('chatgpt','apiKey','claude_subscription','workspace_api_key','deployment_api_key')),
  ADD CONSTRAINT assistant_provider_turns_check CHECK (
    (provider='codex' AND connection_id IS NOT NULL AND auth_mode IN ('chatgpt','apiKey')) OR
    (provider='claude' AND connection_id IS NOT NULL AND auth_mode='claude_subscription') OR
    (provider='anthropic' AND connection_id IS NULL AND auth_mode IN ('workspace_api_key','deployment_api_key'))),
  ADD CONSTRAINT assistant_provider_claude_model CHECK (provider<>'claude' OR model_id ~ '^claude-[a-z0-9-]{1,140}$'),
  ADD CONSTRAINT assistant_provider_turn_connection_identity
    FOREIGN KEY(connection_id,user_id,workspace_id,project_id,provider,auth_mode)
    REFERENCES public.assistant_provider_connections(id,user_id,workspace_id,project_id,provider,expected_auth_mode) ON DELETE CASCADE;

-- A separate versioned RPC avoids overload ambiguity and preserves old clients.
CREATE FUNCTION public.create_assistant_provider_connection_v2(p_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_label text,p_token_hash text,p_auth_mode text,p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.assistant_provider_connections;
BEGIN
  PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);
  INSERT INTO public.assistant_provider_connections(id,user_id,workspace_id,project_id,device_label,token_hash,expected_auth_mode,provider)
    VALUES(p_id,p_user_id,p_workspace_id,p_project_id,p_label,p_token_hash,p_auth_mode,p_provider) RETURNING * INTO saved;
  RETURN to_jsonb(saved)-'token_hash';
END $$;
REVOKE ALL ON FUNCTION public.create_assistant_provider_connection_v2(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_assistant_provider_connection_v2(uuid,uuid,uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_assistant_provider_turn(p_request_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_connection_id uuid,p_provider text,p_model_id text,p_auth_mode text,p_question text,p_packet_canonical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns; created boolean; request_digest text;
BEGIN
  PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);
  IF p_provider IN ('codex','claude') THEN
    SELECT * INTO connection FROM public.assistant_provider_connections WHERE id=p_connection_id FOR UPDATE;
    IF NOT FOUND OR connection.user_id IS DISTINCT FROM p_user_id OR connection.workspace_id IS DISTINCT FROM p_workspace_id
      OR connection.project_id IS DISTINCT FROM p_project_id OR connection.expected_auth_mode IS DISTINCT FROM p_auth_mode
      OR connection.provider IS DISTINCT FROM p_provider
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

COMMIT;
