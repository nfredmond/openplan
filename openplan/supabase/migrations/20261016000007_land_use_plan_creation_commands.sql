-- Creation owns one command before a plan exists. The key is scoped to the
-- workspace; attribution and original bytes cannot change on retry.
CREATE TABLE public.land_use_plan_creation_commands (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  version_id uuid NOT NULL,
  command_text text NOT NULL CHECK (octet_length(command_text) BETWEEN 2 AND 2000000),
  descriptor_text text NOT NULL,
  descriptor_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(descriptor_text, 'sha256'), 'hex')) STORED,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, command_id),
  UNIQUE (plan_id),
  -- Individual plan deletion cannot erase the creation key and permit a retry
  -- to create it again. Workspace deletion still cascades both owned records.
  FOREIGN KEY (plan_id, workspace_id) REFERENCES public.land_use_plans(id, workspace_id) ON DELETE NO ACTION,
  FOREIGN KEY (version_id, workspace_id) REFERENCES public.land_use_plan_versions(id, workspace_id)
);
ALTER TABLE public.land_use_plan_creation_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_use_plan_creation_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.land_use_plan_creation_commands TO service_role;
CREATE TRIGGER land_use_plan_creation_commands_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_creation_commands
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();

-- The authenticated server resolves place identity and validates the adapter.
-- Current membership, exact replay and every creation write share this transaction.
CREATE FUNCTION public.create_land_use_plan_with_context(
  p_workspace_id uuid, p_actor_id uuid, p_command_id uuid, p_command_text text,
  p_prepared_context jsonb, p_descriptor_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  previous public.land_use_plan_creation_commands%ROWTYPE;
  command jsonb; rules jsonb; retained jsonb; response jsonb;
  plan_id uuid := gen_random_uuid(); version_id uuid := gen_random_uuid();
  context_hash text; descriptor_hash text; applicable_keys text[];
BEGIN
  IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_command_id IS NULL
     OR p_command_text IS NULL OR octet_length(p_command_text) NOT BETWEEN 2 AND 2000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid plan creation command';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current plan write permission required';
  END IF;
  -- A nonblocking lock prevents two absent-journal reads from creating two plans.
  -- A hash collision can only defer unrelated work; it cannot authorize or mix it.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('land-use-create:' || p_workspace_id::text || ':' || p_command_id::text, 0)) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This creation command is running. Keep the same request and retry';
  END IF;
  SELECT * INTO previous FROM public.land_use_plan_creation_commands
    WHERE workspace_id=p_workspace_id AND command_id=p_command_id;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor_id OR previous.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This command ID belongs to another plan creation request';
    END IF;
    RETURN previous.receipt || jsonb_build_object('replayed',true);
  END IF;
  BEGIN
    command := p_command_text::jsonb; rules := p_descriptor_text::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid creation JSON';
  END;
  descriptor_hash := encode(extensions.digest(p_descriptor_text,'sha256'),'hex');
  IF (jsonb_typeof(command)='object' AND command->>'commandId'=p_command_id::text
      AND length(btrim(command->>'title')) BETWEEN 1 AND 180
      AND length(btrim(command->>'authorityLabel')) BETWEEN 1 AND 180
      AND jsonb_typeof(rules)='object' AND rules->>'id'=command->>'descriptorId'
      AND command->>'expectedDescriptorHash'=descriptor_hash
      AND jsonb_typeof(rules->'planKinds')='array'
      AND jsonb_typeof(rules->'requirements')='array'
      AND jsonb_typeof(rules->'configured')='boolean'
      AND jsonb_typeof(p_prepared_context)='object'
      AND p_prepared_context->'assessment'=command->'assessment'
      AND jsonb_typeof(p_prepared_context->'place')='object'
      AND p_prepared_context#>>'{place,label}'=command#>>'{place,label}') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Prepared creation does not match the command';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rules->'planKinds') kind WHERE kind->>'key'=command->>'planKindKey') THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Plan kind is outside the selected descriptor';
  END IF;
  IF command#>>'{place,mode}' IN ('drawn','uploaded') THEN
    IF (p_prepared_context#>'{place,geometry}'=command#>'{place,geometry}'
      AND p_prepared_context#>>'{place,source}'=CASE command#>>'{place,mode}' WHEN 'drawn' THEN 'drawn' ELSE 'uploaded_file' END
      AND p_prepared_context#>'{place,kind}'='null'::jsonb
      AND p_prepared_context#>'{place,ref}'='null'::jsonb
      AND p_prepared_context#>'{place,countryCode}'='null'::jsonb
      AND p_prepared_context#>'{place,subdivisionCode}'='null'::jsonb) IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Captured plan boundary changed';
    END IF;
  ELSIF command#>>'{place,mode}'='place' THEN
    IF (p_prepared_context#>>'{place,source}'='tigerweb'
      AND p_prepared_context#>>'{place,kind}'=command#>>'{place,kind}'
      AND p_prepared_context#>>'{place,ref}'=command#>>'{place,geoid}') IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Resolved plan place changed';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Creation requires a new plan boundary';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(rules->'requirements') r
      WHERE (length(btrim(r->>'key'))>0 AND length(btrim(r->>'label'))>0
        AND r->>'applicability' IN ('required','conditional','locally_defined')) IS NOT TRUE)
    OR (SELECT count(*) FROM jsonb_array_elements(rules->'requirements')) <>
       (SELECT count(DISTINCT r->>'key') FROM jsonb_array_elements(rules->'requirements') r) THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid descriptor requirements';
  END IF;
  retained := (p_prepared_context-'savedBy'-'savedAt') || jsonb_build_object('savedBy',p_actor_id,
    'savedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  SELECT coalesce(array_agg(r->>'key' ORDER BY position),ARRAY[]::text[]) INTO applicable_keys
    FROM jsonb_array_elements(rules->'requirements') WITH ORDINALITY entries(r,position)
    WHERE r->>'applicability'<>'conditional';
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,
    geography_label,geography_geojson,local_requirements_notice,created_by,plan_context)
  VALUES(plan_id,p_workspace_id,command->>'title',command->>'descriptorId',command->>'planKindKey',command->>'authorityLabel',
    retained#>>'{place,label}',retained#>'{place,geometry}',CASE WHEN (rules->>'configured')::boolean THEN NULL ELSE rules->>'disclosure' END,p_actor_id,retained)
    RETURNING plan_context_hash INTO context_hash;
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind,state,applicable_requirement_keys,created_by)
    VALUES(version_id,p_workspace_id,plan_id,1,'original','working',applicable_keys,p_actor_id);
  INSERT INTO public.land_use_plan_content_nodes(workspace_id,version_id,node_kind,requirement_key,title,sort_order,created_by)
    SELECT p_workspace_id,version_id,'section',r->>'key',r->>'label',(position-1)::integer,p_actor_id
    FROM jsonb_array_elements(rules->'requirements') WITH ORDINALITY entries(r,position);
  UPDATE public.land_use_plans SET current_working_version_id=version_id WHERE id=plan_id;
  response := jsonb_build_object('replayed',false,'commandId',p_command_id,'workspaceId',p_workspace_id,'actorId',p_actor_id,
    'planId',plan_id,'versionId',version_id,'context',retained,'contextHash',context_hash,'descriptorHash',descriptor_hash,
    'descriptorId',command->>'descriptorId','planKindKey',command->>'planKindKey',
    'title',command->>'title','authorityLabel',command->>'authorityLabel');
  INSERT INTO public.land_use_plan_creation_commands(workspace_id,command_id,actor_id,plan_id,version_id,command_text,descriptor_text,receipt)
    VALUES(p_workspace_id,p_command_id,p_actor_id,plan_id,version_id,p_command_text,p_descriptor_text,response);
  RETURN response;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Plan creation conflicted. Keep the same request and retry';
END;
$$;
REVOKE ALL ON FUNCTION public.create_land_use_plan_with_context(uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_land_use_plan_with_context(uuid,uuid,uuid,text,jsonb,text) TO service_role;
