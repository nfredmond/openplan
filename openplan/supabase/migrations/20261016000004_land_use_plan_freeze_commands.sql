-- Commit a freeze, its working pointer and its review event as one command.
-- Only the verified server path may call this function. The browser retains
-- exact command bytes and receives the original result on permission-checked replay.
CREATE TABLE public.land_use_plan_freeze_commands (
  plan_id uuid NOT NULL,
  command_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  expected_draft_revision integer NOT NULL CHECK (expected_draft_revision >= 0),
  command_text text NOT NULL CHECK (octet_length(command_text) BETWEEN 2 AND 8192),
  command_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(command_text, 'sha256'), 'hex')) STORED,
  frozen_snapshot_text text NOT NULL,
  content_hash text GENERATED ALWAYS AS (encode(extensions.digest(frozen_snapshot_text, 'sha256'), 'hex')) STORED,
  frozen_at timestamptz NOT NULL,
  review_event_id uuid NOT NULL,
  PRIMARY KEY (plan_id, command_id),
  UNIQUE (version_id),
  FOREIGN KEY (plan_id, workspace_id) REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id) REFERENCES public.land_use_plan_versions(id, workspace_id),
  FOREIGN KEY (review_event_id, workspace_id) REFERENCES public.land_use_plan_review_events(id, workspace_id)
);
ALTER TABLE public.land_use_plan_freeze_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_use_plan_freeze_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.land_use_plan_freeze_commands TO service_role;
CREATE TRIGGER land_use_plan_freeze_commands_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_freeze_commands
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();

-- Reconstruct the public authored fields under the version lock. Keeping the
-- exact projection here prevents an incomplete server snapshot from freezing.
CREATE FUNCTION public.land_use_plan_freeze_content(p_version_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object(
    'nodes', coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order,n.id) FROM (
      SELECT id,parent_node_id,node_kind,requirement_key,title,body,sort_order,evidence_document_id,evidence_url
      FROM public.land_use_plan_content_nodes WHERE version_id=p_version_id
    ) n),'[]'::jsonb),
    'relationships', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM (
      SELECT id,related_plan_id,related_plan_label,relationship_kind,notes
      FROM public.land_use_plan_relationships WHERE version_id=p_version_id
    ) r),'[]'::jsonb),
    'designations', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM (
      SELECT d.id,d.layer_id,d.layer_version_id,d.designation_set_label,d.legend_metadata,
        d.public_field_keys,d.legend_field,d.map_note,
        coalesce((SELECT jsonb_agg(jsonb_build_object('policy_node_id',l.policy_node_id) ORDER BY l.policy_node_id)
          FROM public.land_use_plan_designation_policy_links l WHERE l.designation_id=d.id AND l.version_id=p_version_id),
          '[]'::jsonb) AS land_use_plan_designation_policy_links,
        (SELECT to_jsonb(g) FROM (SELECT id,feature_hash,feature_hash_computed_at,feature_count,bbox,geometry_kinds
          FROM public.workspace_gis_layer_versions WHERE id=d.layer_version_id) g) AS layer_version_evidence
      FROM public.land_use_plan_designations d WHERE d.version_id=p_version_id
    ) d),'[]'::jsonb),
    'implementationActions', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM (
      SELECT id,content_node_id,title,description,responsible_party,due_on,status,project_id,program_id,evidence_document_id
      FROM public.land_use_plan_implementation_actions WHERE version_id=p_version_id
    ) a),'[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.land_use_plan_freeze_content(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.land_use_plan_freeze_content(uuid) TO service_role;

CREATE FUNCTION public.freeze_land_use_plan_version(
  p_plan_id uuid, p_version_id uuid, p_actor_id uuid, p_command_id uuid,
  p_expected_draft_revision integer, p_command_text text, p_snapshot_text text, p_descriptor_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  plan_row public.land_use_plans%ROWTYPE;
  working public.land_use_plan_versions%ROWTYPE;
  previous public.land_use_plan_freeze_commands%ROWTYPE;
  command jsonb; snapshot jsonb; rules jsonb; current_content jsonb; declared_rules jsonb;
  snapshot_hash text; frozen_time timestamptz; event_id uuid;
  required_key text;
  -- Same whitespace set as JavaScript String.trim for section readiness.
  trim_chars text := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  SELECT * INTO plan_row FROM public.land_use_plans WHERE id=p_plan_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='Plan not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE workspace_id=plan_row.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current plan write permission required';
  END IF;
  IF p_command_id IS NULL OR p_version_id IS NULL OR p_expected_draft_revision IS NULL OR p_expected_draft_revision < 0
     OR p_command_text IS NULL OR octet_length(p_command_text) NOT BETWEEN 2 AND 8192 THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid freeze command';
  END IF;
  SELECT * INTO previous FROM public.land_use_plan_freeze_commands WHERE plan_id=p_plan_id AND command_id=p_command_id;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor_id OR previous.version_id IS DISTINCT FROM p_version_id
       OR previous.expected_draft_revision IS DISTINCT FROM p_expected_draft_revision
       OR previous.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This command ID belongs to a different freeze';
    END IF;
    RETURN jsonb_build_object('replayed',true,'commandId',p_command_id,'versionId',previous.version_id,
      'draftRevision',previous.expected_draft_revision,'contentHash',previous.content_hash,
      'frozenAt',previous.frozen_at,'reviewEventId',previous.review_event_id);
  END IF;
  SELECT * INTO working FROM public.land_use_plan_versions
    WHERE id=p_version_id AND plan_id=p_plan_id AND workspace_id=plan_row.workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR working.state <> 'working' OR plan_row.current_working_version_id IS DISTINCT FROM p_version_id THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The selected working version is no longer current';
  END IF;
  IF working.draft_revision IS DISTINCT FROM p_expected_draft_revision THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The working plan changed. Review its current content before freezing';
  END IF;
  IF p_snapshot_text IS NULL OR octet_length(p_snapshot_text) NOT BETWEEN 2 AND 64000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='A complete prepared snapshot is required';
  END IF;
  BEGIN
    command:=p_command_text::jsonb; snapshot:=p_snapshot_text::jsonb; declared_rules:=p_descriptor_text::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid freeze command or snapshot JSON';
  END;
  IF (jsonb_typeof(command)='object' AND command->>'state'='public_review'
    AND command->>'commandId'=p_command_id::text AND command->>'versionId'=p_version_id::text
    AND command->'expectedDraftRevision'=to_jsonb(p_expected_draft_revision)
    AND command->>'expectedDescriptorHash' ~ '^[0-9a-f]{64}$'
    AND (SELECT count(*) FROM jsonb_object_keys(command))=5) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Freeze command fields do not match the retained request';
  END IF;
  IF (jsonb_typeof(snapshot)='object'
    AND snapshot#>>'{plan,id}'=p_plan_id::text
    AND snapshot#>>'{plan,descriptorId}'=plan_row.descriptor_id
    AND snapshot#>>'{plan,planKindKey}'=plan_row.plan_kind_key
    AND snapshot#>>'{plan,title}'=plan_row.title
    AND snapshot#>>'{plan,authorityLabel}'=plan_row.authority_label
    AND snapshot#>>'{plan,geographyLabel}'=plan_row.geography_label
    AND snapshot#>>'{version,id}'=p_version_id::text
    AND snapshot#>'{version,versionNumber}'=to_jsonb(working.version_number)
    AND snapshot#>>'{version,versionKind}'=working.version_kind
    AND snapshot#>'{version,basedOnVersionId}'=coalesce(to_jsonb(working.based_on_version_id),'null'::jsonb)
    AND snapshot#>'{version,applicableRequirementKeys}'=to_jsonb(working.applicable_requirement_keys)
    AND snapshot#>'{version,draftRevision}'=to_jsonb(p_expected_draft_revision)
    AND snapshot->'planContext'=coalesce(plan_row.plan_context,'null'::jsonb)
    AND jsonb_typeof(snapshot->'nodes')='array' AND jsonb_typeof(snapshot->'relationships')='array'
    AND jsonb_typeof(snapshot->'designations')='array' AND jsonb_typeof(snapshot->'implementationActions')='array') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The prepared snapshot does not match this working plan';
  END IF;
  rules:=snapshot->'descriptorSnapshot';
  IF (jsonb_typeof(rules)='object' AND rules->>'id'=plan_row.descriptor_id
    AND jsonb_typeof(rules->'planKinds')='array' AND jsonb_typeof(rules->'requirements')='array'
    AND jsonb_typeof(rules->'processSteps')='array') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='The prepared descriptor is incomplete';
  END IF;
  IF p_descriptor_text IS NULL OR declared_rules IS DISTINCT FROM rules
     OR encode(extensions.digest(p_descriptor_text,'sha256'),'hex') IS DISTINCT FROM command->>'expectedDescriptorHash' THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The prepared descriptor differs from the reviewed edition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rules->'planKinds') kind WHERE kind->>'key'=plan_row.plan_kind_key) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The prepared descriptor does not support this plan kind';
  END IF;
  current_content:=public.land_use_plan_freeze_content(p_version_id);
  IF snapshot->'nodes' IS DISTINCT FROM current_content->'nodes'
    OR snapshot->'relationships' IS DISTINCT FROM current_content->'relationships'
    OR snapshot->'designations' IS DISTINCT FROM current_content->'designations'
    OR snapshot->'implementationActions' IS DISTINCT FROM current_content->'implementationActions' THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The prepared authored content no longer matches the working plan';
  END IF;
  FOR required_key IN
    SELECT unnest(working.applicable_requirement_keys)
    UNION SELECT requirement->>'key' FROM jsonb_array_elements(rules->'requirements') requirement WHERE requirement->>'applicability'='required'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_content_nodes WHERE version_id=p_version_id
      AND node_kind='section' AND requirement_key=required_key AND btrim(body,trim_chars)<>'') THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Complete the applicable plan sections before freezing';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_designations d JOIN public.workspace_gis_layer_versions g
      ON g.id=d.layer_version_id AND g.layer_id=d.layer_id AND g.workspace_id=d.workspace_id
      WHERE d.version_id=p_version_id AND g.ingest_status='ready' AND g.feature_hash IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.land_use_plan_designations d LEFT JOIN public.workspace_gis_layer_versions g
      ON g.id=d.layer_version_id AND g.layer_id=d.layer_id AND g.workspace_id=d.workspace_id
      WHERE d.version_id=p_version_id AND (g.id IS NULL OR g.ingest_status<>'ready' OR g.feature_hash IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Attach ready versioned mapped designations before freezing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_implementation_actions WHERE version_id=p_version_id) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Add an implementation action before freezing';
  END IF;
  FOR required_key IN SELECT step->>'key' FROM jsonb_array_elements(rules->'processSteps') step
    WHERE step->'required'='true'::jsonb AND step->'reviewPrerequisite'='true'::jsonb
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_process_records WHERE version_id=p_version_id
      AND process_key=required_key AND descriptor_id=plan_row.descriptor_id AND status='complete' AND completed_on IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Complete the review prerequisites before freezing';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(rules->'processSteps') step WHERE step->>'key'='tribal_consultation' AND step->'required'='true'::jsonb)
     AND NOT EXISTS (SELECT 1 FROM public.land_use_plan_consultation_records WHERE version_id=p_version_id AND status IN ('complete','not_applicable')) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Resolve the private consultation status before freezing';
  END IF;
  snapshot_hash:=encode(extensions.digest(p_snapshot_text,'sha256'),'hex');
  frozen_time:=clock_timestamp(); event_id:=gen_random_uuid();
  UPDATE public.land_use_plan_versions SET state='public_review',content_hash=snapshot_hash,
    frozen_snapshot=snapshot,frozen_at=frozen_time,frozen_by=p_actor_id WHERE id=p_version_id;
  UPDATE public.land_use_plans SET current_working_version_id=NULL WHERE id=p_plan_id;
  INSERT INTO public.land_use_plan_review_events(id,workspace_id,version_id,event_kind,occurred_on,notes,created_by)
    VALUES(event_id,plan_row.workspace_id,p_version_id,'public_draft',(frozen_time AT TIME ZONE 'UTC')::date,'Frozen public draft '||snapshot_hash,p_actor_id);
  INSERT INTO public.land_use_plan_freeze_commands(plan_id,command_id,workspace_id,version_id,actor_id,expected_draft_revision,
    command_text,frozen_snapshot_text,frozen_at,review_event_id)
    VALUES(p_plan_id,p_command_id,plan_row.workspace_id,p_version_id,p_actor_id,p_expected_draft_revision,p_command_text,p_snapshot_text,frozen_time,event_id);
  RETURN jsonb_build_object('replayed',false,'commandId',p_command_id,'versionId',p_version_id,
    'draftRevision',p_expected_draft_revision,'contentHash',snapshot_hash,'frozenAt',frozen_time,'reviewEventId',event_id);
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='The plan is being changed. Keep the exact freeze command and retry';
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_land_use_plan_version(uuid,uuid,uuid,uuid,integer,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.freeze_land_use_plan_version(uuid,uuid,uuid,uuid,integer,text,text,text) TO service_role;
