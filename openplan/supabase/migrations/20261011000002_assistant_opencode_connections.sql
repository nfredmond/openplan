-- Extend the retained native project task to OpenCode API accounts.
-- Existing connection identities, private answers and retry hashes are preserved.
BEGIN;

ALTER TABLE public.assistant_provider_connections
  DROP CONSTRAINT assistant_provider_connections_provider_check,
  DROP CONSTRAINT assistant_provider_connections_expected_auth_mode_check,
  DROP CONSTRAINT assistant_provider_connection_mode,
  ADD CONSTRAINT assistant_provider_connections_provider_check CHECK (provider IN ('codex','claude','opencode')),
  ADD CONSTRAINT assistant_provider_connections_expected_auth_mode_check CHECK (expected_auth_mode IN ('chatgpt','apiKey','claude_subscription','opencode_api')),
  ADD CONSTRAINT assistant_provider_connection_mode CHECK (
    (provider='codex' AND expected_auth_mode IN ('chatgpt','apiKey')) OR
    (provider='claude' AND expected_auth_mode='claude_subscription') OR
    (provider='opencode' AND expected_auth_mode='opencode_api'));

ALTER TABLE public.assistant_provider_turns
  DROP CONSTRAINT assistant_provider_turns_provider_check,
  DROP CONSTRAINT assistant_provider_turns_auth_mode_check,
  DROP CONSTRAINT assistant_provider_turns_check,
  ADD CONSTRAINT assistant_provider_turns_provider_check CHECK (provider IN ('codex','claude','opencode','anthropic')),
  ADD CONSTRAINT assistant_provider_turns_auth_mode_check CHECK (auth_mode IN ('chatgpt','apiKey','claude_subscription','opencode_api','workspace_api_key','deployment_api_key')),
  ADD CONSTRAINT assistant_provider_turns_check CHECK (
    (provider='codex' AND connection_id IS NOT NULL AND auth_mode IN ('chatgpt','apiKey')) OR
    (provider='claude' AND connection_id IS NOT NULL AND auth_mode='claude_subscription') OR
    (provider='opencode' AND connection_id IS NOT NULL AND auth_mode='opencode_api') OR
    (provider='anthropic' AND connection_id IS NULL AND auth_mode IN ('workspace_api_key','deployment_api_key'))),
  ADD CONSTRAINT assistant_provider_opencode_model CHECK (provider<>'opencode' OR model_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,139}$');

CREATE OR REPLACE FUNCTION public.create_assistant_provider_turn(p_request_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_connection_id uuid,p_provider text,p_model_id text,p_auth_mode text,p_question text,p_packet_canonical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.assistant_provider_turns; created boolean; request_digest text;
BEGIN
  PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);
  IF p_provider IN ('codex','claude','opencode') THEN
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
