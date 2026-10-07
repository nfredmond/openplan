-- Add current checklist sections without rewriting authored or frozen records.
-- Exact retries retain their original result under current staff permission.
CREATE TABLE public.land_use_plan_rule_reconciliation_commands (
  plan_id uuid NOT NULL,
  command_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_text text NOT NULL CHECK (octet_length(command_text) BETWEEN 2 AND 8192),
  command_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(command_text,'sha256'),'hex')) STORED,
  descriptor_text text NOT NULL CHECK (octet_length(descriptor_text) BETWEEN 2 AND 2000000),
  descriptor_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(descriptor_text,'sha256'),'hex')) STORED,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (plan_id,command_id),
  FOREIGN KEY (plan_id,workspace_id) REFERENCES public.land_use_plans(id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id,workspace_id) REFERENCES public.land_use_plan_versions(id,workspace_id)
);
ALTER TABLE public.land_use_plan_rule_reconciliation_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_use_plan_rule_reconciliation_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.land_use_plan_rule_reconciliation_commands TO service_role;
CREATE TRIGGER land_use_plan_rule_reconciliation_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_rule_reconciliation_commands
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();

CREATE FUNCTION public.reconcile_land_use_plan_rules(
  p_plan_id uuid, p_workspace_id uuid, p_actor_id uuid, p_command_id uuid,
  p_command_text text, p_descriptor_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  plan_row public.land_use_plans%ROWTYPE;
  working public.land_use_plan_versions%ROWTYPE;
  previous public.land_use_plan_rule_reconciliation_commands%ROWTYPE;
  command jsonb; rules jsonb; requirement jsonb; response jsonb;
  added jsonb:='[]'::jsonb; next_keys text[]; next_order bigint; node_id uuid;
  descriptor_hash text; final_revision integer;
BEGIN
  IF p_plan_id IS NULL OR p_workspace_id IS NULL OR p_actor_id IS NULL OR p_command_id IS NULL
    OR p_command_text IS NULL OR octet_length(p_command_text) NOT BETWEEN 2 AND 8192 THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid rule reconciliation command';
  END IF;
  SELECT * INTO plan_row FROM public.land_use_plans
    WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='Plan not found in this workspace'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current plan write permission required';
  END IF;
  SELECT * INTO previous FROM public.land_use_plan_rule_reconciliation_commands
    WHERE plan_id=p_plan_id AND command_id=p_command_id;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor_id OR previous.workspace_id IS DISTINCT FROM p_workspace_id
      OR previous.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='This command ID belongs to another reconciliation request';
    END IF;
    RETURN previous.receipt || jsonb_build_object('replayed',true);
  END IF;
  IF p_descriptor_text IS NULL OR octet_length(p_descriptor_text) NOT BETWEEN 2 AND 2000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='The selected descriptor is required';
  END IF;
  BEGIN
    command:=p_command_text::jsonb; rules:=p_descriptor_text::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid reconciliation JSON';
  END;
  IF jsonb_typeof(command) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid reconciliation command';
  END IF;
  IF (command->>'operation'='reconcile' AND command->>'commandId'=p_command_id::text
    AND command->>'versionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND jsonb_typeof(command->'expectedDraftRevision')='number'
    AND command->>'expectedDraftRevision' ~ '^(0|[1-9][0-9]*)$'
    AND command->>'expectedDescriptorHash' ~ '^[0-9a-f]{64}$'
    AND (SELECT count(*) FROM jsonb_object_keys(command))=5) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid reconciliation command fields';
  END IF;
  IF (command->>'expectedDraftRevision')::numeric>2147483647 THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid draft revision';
  END IF;
  SELECT * INTO working FROM public.land_use_plan_versions
    WHERE id=(command->>'versionId')::uuid AND plan_id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR working.state<>'working' OR plan_row.current_working_version_id IS DISTINCT FROM working.id
    OR working.draft_revision IS DISTINCT FROM (command->>'expectedDraftRevision')::integer THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The working draft changed. Review it before reconciling';
  END IF;
  descriptor_hash:=encode(extensions.digest(p_descriptor_text,'sha256'),'hex');
  IF (jsonb_typeof(rules)='object' AND rules->>'id'=plan_row.descriptor_id
    AND jsonb_typeof(rules->'planKinds')='array' AND jsonb_typeof(rules->'requirements')='array'
    AND descriptor_hash=command->>'expectedDescriptorHash') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The selected rules changed';
  END IF;
  IF jsonb_array_length(rules->'planKinds')<>1 OR rules#>>'{planKinds,0,key}' IS DISTINCT FROM plan_row.plan_kind_key THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The rules do not select this plan kind';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(rules->'requirements') r
    WHERE (jsonb_typeof(r)='object' AND jsonb_typeof(r->'key')='string'
      AND length(btrim(r->>'key')) BETWEEN 1 AND 120 AND r->>'key'=btrim(r->>'key')
      AND jsonb_typeof(r->'label')='string' AND length(btrim(r->>'label'))>0
      AND r->>'applicability' IN ('required','conditional','locally_defined')) IS NOT TRUE)
    OR (SELECT count(*) FROM jsonb_array_elements(rules->'requirements'))<>
       (SELECT count(DISTINCT r->>'key') FROM jsonb_array_elements(rules->'requirements') r) THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid selected requirements';
  END IF;
  next_keys:=working.applicable_requirement_keys;
  IF EXISTS (SELECT 1 FROM unnest(next_keys) value WHERE value IS NULL OR btrim(value)='') THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Existing applicability keys need review';
  END IF;
  SELECT greatest(coalesce(max(sort_order)::bigint,-1),-1)+1 INTO next_order
    FROM public.land_use_plan_content_nodes WHERE version_id=working.id;
  FOR requirement IN SELECT value FROM jsonb_array_elements(rules->'requirements') LOOP
    IF requirement->>'applicability'<>'conditional' AND NOT (requirement->>'key'=ANY(next_keys)) THEN
      next_keys:=array_append(next_keys,requirement->>'key');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_content_nodes
      WHERE version_id=working.id AND node_kind='section' AND requirement_key=requirement->>'key') THEN
      IF next_order>2147483647 THEN
        RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The draft section ordering needs review';
      END IF;
      node_id:=gen_random_uuid();
      INSERT INTO public.land_use_plan_content_nodes(id,workspace_id,version_id,node_kind,requirement_key,title,sort_order,created_by)
        VALUES(node_id,p_workspace_id,working.id,'section',requirement->>'key',requirement->>'label',next_order::integer,p_actor_id);
      added:=added||jsonb_build_array(jsonb_build_object('id',node_id,'requirementKey',requirement->>'key'));
      next_order:=next_order+1;
    END IF;
  END LOOP;
  IF next_keys IS DISTINCT FROM working.applicable_requirement_keys THEN
    UPDATE public.land_use_plan_versions SET applicable_requirement_keys=next_keys WHERE id=working.id;
  END IF;
  SELECT draft_revision INTO final_revision FROM public.land_use_plan_versions WHERE id=working.id;
  response:=jsonb_build_object('replayed',false,'commandId',p_command_id,'planId',p_plan_id,
    'workspaceId',p_workspace_id,'actorId',p_actor_id,'versionId',working.id,
    'previousDraftRevision',working.draft_revision,'draftRevision',final_revision,
    'descriptorHash',descriptor_hash,'addedSections',added,'applicableRequirementKeys',to_jsonb(next_keys),
    'reconciledAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO public.land_use_plan_rule_reconciliation_commands(plan_id,command_id,workspace_id,version_id,actor_id,command_text,descriptor_text,receipt)
    VALUES(p_plan_id,p_command_id,p_workspace_id,working.id,p_actor_id,p_command_text,p_descriptor_text,response);
  RETURN response;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The plan is being changed. Keep the exact reconciliation request and retry';
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text) TO service_role;
