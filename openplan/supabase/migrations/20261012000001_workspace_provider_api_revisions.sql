-- Versioned API configuration, separate from personal native connector tokens.
-- No generation is dispatched by configuration or metadata reads.
BEGIN;

CREATE FUNCTION public.valid_workspace_provider_api_configuration(config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF jsonb_typeof(config) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(config))<>7 OR
    NOT config ?& ARRAY['label','protocol','endpoint','modelIds','structuredOutput','authMode','timeoutSeconds'] OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(config) k WHERE k NOT IN
      ('label','protocol','endpoint','modelIds','structuredOutput','authMode','timeoutSeconds')) THEN RETURN false; END IF;
  IF (jsonb_typeof(config->'label')='string' AND length(btrim(config->>'label')) BETWEEN 1 AND 120
    AND config->>'protocol'='openai_chat_completions'
    AND jsonb_typeof(config->'endpoint')='string' AND length(config->>'endpoint') BETWEEN 1 AND 2048
    AND config->>'endpoint' ~ '^https?://[^/]+/' AND right(config->>'endpoint',1)='/'
    AND config->>'endpoint' !~ '[?#[:space:][:cntrl:]\\]' AND config->>'endpoint' !~ '^https?://[^/]*@'
    AND config->'structuredOutput'='true'::jsonb AND config->>'authMode' IN ('api_key','none')
    AND jsonb_typeof(config->'timeoutSeconds')='number') IS NOT TRUE THEN RETURN false; END IF;
  IF (config->>'timeoutSeconds')::numeric NOT BETWEEN 1 AND 900 OR
    (config->>'timeoutSeconds')::numeric<>trunc((config->>'timeoutSeconds')::numeric) OR
    jsonb_typeof(config->'modelIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(config->'modelIds') NOT BETWEEN 1 AND 32 OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(config->'modelIds') model
      WHERE jsonb_typeof(model)<>'string' OR length(model#>>'{}') NOT BETWEEN 1 AND 160 OR model#>>'{}' ~ '[[:space:][:cntrl:]]') OR
    (SELECT count(DISTINCT model) FROM jsonb_array_elements(config->'modelIds') model)<>jsonb_array_length(config->'modelIds') THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE TABLE public.workspace_provider_api_connections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  current_revision_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(id,workspace_id)
);
CREATE TABLE public.workspace_provider_api_revisions (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  previous_revision_id uuid,
  configuration jsonb NOT NULL,
  configuration_canonical text NOT NULL CHECK(octet_length(configuration_canonical)<=32000),
  configuration_hash text NOT NULL CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
  configured_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,connection_id,workspace_id),
  FOREIGN KEY(connection_id,workspace_id) REFERENCES public.workspace_provider_api_connections(id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(previous_revision_id,connection_id,workspace_id) REFERENCES public.workspace_provider_api_revisions(id,connection_id,workspace_id),
  CHECK(configuration=configuration_canonical::jsonb AND configuration_hash=encode(extensions.digest(convert_to(configuration_canonical,'UTF8'),'sha256'),'hex')),
  CHECK(public.valid_workspace_provider_api_configuration(configuration))
);
ALTER TABLE public.workspace_provider_api_connections ADD CONSTRAINT workspace_provider_api_current_revision
  FOREIGN KEY(current_revision_id,id,workspace_id) REFERENCES public.workspace_provider_api_revisions(id,connection_id,workspace_id);
CREATE TABLE public.workspace_provider_api_credentials (
  revision_id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  credential_ciphertext text CHECK(length(credential_ciphertext) BETWEEN 1 AND 32000),
  FOREIGN KEY(revision_id,connection_id,workspace_id) REFERENCES public.workspace_provider_api_revisions(id,connection_id,workspace_id) ON DELETE CASCADE
);

ALTER TABLE public.workspace_provider_api_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_provider_api_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_provider_api_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_provider_api_connections,public.workspace_provider_api_revisions,public.workspace_provider_api_credentials FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.workspace_provider_api_connections,public.workspace_provider_api_revisions TO authenticated;
GRANT ALL ON public.workspace_provider_api_connections,public.workspace_provider_api_revisions,public.workspace_provider_api_credentials TO service_role;
CREATE POLICY workspace_provider_api_connection_read ON public.workspace_provider_api_connections
  FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.user_id=auth.uid()
    AND m.workspace_id=workspace_provider_api_connections.workspace_id AND lower(trim(m.role)) IN ('owner','admin','member','viewer')));
CREATE POLICY workspace_provider_api_revision_read ON public.workspace_provider_api_revisions
  FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.user_id=auth.uid()
    AND m.workspace_id=workspace_provider_api_revisions.workspace_id AND lower(trim(m.role)) IN ('owner','admin','member','viewer')));

CREATE FUNCTION public.assert_workspace_provider_api_manager(p_user_id uuid,p_workspace_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_role text;
BEGIN
  SELECT role INTO member_role FROM public.workspace_members WHERE user_id=p_user_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND OR lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'API connection management denied' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_workspace_provider_api_manager(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.preserve_workspace_provider_api_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'API connection revisions and credentials are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_provider_api_revision_immutable BEFORE UPDATE ON public.workspace_provider_api_revisions
  FOR EACH ROW EXECUTE FUNCTION public.preserve_workspace_provider_api_revision();
CREATE TRIGGER workspace_provider_api_credential_immutable BEFORE UPDATE ON public.workspace_provider_api_credentials
  FOR EACH ROW EXECUTE FUNCTION public.preserve_workspace_provider_api_revision();

-- Actor UUIDs are retained as historical attribution after account removal.
-- A revoked connection cannot be revived or pointed back at an older revision.
CREATE FUNCTION public.preserve_workspace_provider_api_connection()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.id,NEW.workspace_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.created_by,OLD.created_at) OR
    (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'API connection identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id AND
    (OLD.revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_provider_api_revisions r WHERE r.id=NEW.current_revision_id
      AND r.connection_id=NEW.id AND r.workspace_id=NEW.workspace_id AND r.previous_revision_id IS NOT DISTINCT FROM OLD.current_revision_id)) THEN
    RAISE EXCEPTION 'API connection revision must advance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_provider_api_connection_immutable BEFORE UPDATE ON public.workspace_provider_api_connections
  FOR EACH ROW EXECUTE FUNCTION public.preserve_workspace_provider_api_connection();
REVOKE ALL ON FUNCTION public.preserve_workspace_provider_api_connection() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_workspace_provider_api_revision(p_user_id uuid,p_workspace_id uuid,p_connection_id uuid,p_revision_id uuid,
  p_expected_revision_id uuid,p_configuration_canonical text,p_credential_ciphertext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.workspace_provider_api_connections; revision public.workspace_provider_api_revisions; config jsonb; stored_ciphertext text;
BEGIN
  PERFORM public.assert_workspace_provider_api_manager(p_user_id,p_workspace_id);
  IF p_connection_id IS NULL OR p_revision_id IS NULL OR p_configuration_canonical IS NULL OR octet_length(p_configuration_canonical)>32000 THEN
    RAISE EXCEPTION 'Invalid API connection configuration' USING ERRCODE='22023';
  END IF;
  config:=p_configuration_canonical::jsonb;
  IF NOT public.valid_workspace_provider_api_configuration(config) OR
    ((config->>'authMode'='none' AND p_credential_ciphertext IS NOT NULL) OR
     (config->>'authMode'='api_key' AND (p_credential_ciphertext IS NULL OR p_credential_ciphertext NOT LIKE 'v2:%'))) THEN
    RAISE EXCEPTION 'Invalid API connection configuration' USING ERRCODE='22023';
  END IF;
  IF p_expected_revision_id IS NULL THEN
    INSERT INTO public.workspace_provider_api_connections(id,workspace_id,created_by)
      VALUES(p_connection_id,p_workspace_id,p_user_id) ON CONFLICT(id) DO NOTHING;
  END IF;
  SELECT * INTO connection FROM public.workspace_provider_api_connections WHERE id=p_connection_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'API connection denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO revision FROM public.workspace_provider_api_revisions WHERE id=p_revision_id;
  IF FOUND THEN
    SELECT credential_ciphertext INTO stored_ciphertext FROM public.workspace_provider_api_credentials WHERE revision_id=revision.id;
    IF NOT FOUND OR revision.connection_id IS DISTINCT FROM p_connection_id OR revision.workspace_id IS DISTINCT FROM p_workspace_id
      OR revision.previous_revision_id IS DISTINCT FROM p_expected_revision_id OR revision.configured_by IS DISTINCT FROM p_user_id
      OR revision.configuration_canonical IS DISTINCT FROM p_configuration_canonical OR stored_ciphertext IS DISTINCT FROM p_credential_ciphertext THEN
      RAISE EXCEPTION 'API connection retry differs' USING ERRCODE='PT409';
    END IF;
    RETURN jsonb_build_object('created',false,'connection',to_jsonb(connection),'revision',to_jsonb(revision));
  END IF;
  IF connection.revoked_at IS NOT NULL OR connection.current_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    RAISE EXCEPTION 'API connection changed before save' USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.workspace_provider_api_revisions(id,connection_id,workspace_id,previous_revision_id,configuration,configuration_canonical,configuration_hash,configured_by)
    VALUES(p_revision_id,p_connection_id,p_workspace_id,p_expected_revision_id,config,p_configuration_canonical,
      encode(extensions.digest(convert_to(p_configuration_canonical,'UTF8'),'sha256'),'hex'),p_user_id) RETURNING * INTO revision;
  INSERT INTO public.workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
    VALUES(p_revision_id,p_connection_id,p_workspace_id,p_credential_ciphertext);
  UPDATE public.workspace_provider_api_connections SET current_revision_id=p_revision_id WHERE id=connection.id RETURNING * INTO connection;
  RETURN jsonb_build_object('created',true,'connection',to_jsonb(connection),'revision',to_jsonb(revision));
END $$;
REVOKE ALL ON FUNCTION public.save_workspace_provider_api_revision(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_workspace_provider_api_revision(uuid,uuid,uuid,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.revoke_workspace_provider_api_connection(p_user_id uuid,p_workspace_id uuid,p_connection_id uuid,p_expected_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.workspace_provider_api_connections;
BEGIN
  PERFORM public.assert_workspace_provider_api_manager(p_user_id,p_workspace_id);
  SELECT * INTO connection FROM public.workspace_provider_api_connections WHERE id=p_connection_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'API connection denied' USING ERRCODE='42501'; END IF;
  IF p_expected_revision_id IS NULL OR connection.current_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    RAISE EXCEPTION 'API connection changed before revoke' USING ERRCODE='PT409';
  END IF;
  UPDATE public.workspace_provider_api_connections SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=connection.id RETURNING * INTO connection;
  RETURN to_jsonb(connection);
END $$;
REVOKE ALL ON FUNCTION public.revoke_workspace_provider_api_connection(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_provider_api_connection(uuid,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.valid_workspace_provider_api_configuration(jsonb),public.preserve_workspace_provider_api_revision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valid_workspace_provider_api_configuration(jsonb) TO service_role;

COMMIT;
