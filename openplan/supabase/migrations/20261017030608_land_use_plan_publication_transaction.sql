-- Concurrent publication calls retain one report, artifact and version pointer.
-- Existing packets are verified in place. This migration does not repair history.
CREATE FUNCTION public.publish_land_use_plan_version(
  p_workspace_id uuid, p_plan_id uuid, p_actor_id uuid, p_version_id uuid,
  p_version_content_hash text, p_title text, p_snapshot_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
DECLARE
  plan_row public.land_use_plans%ROWTYPE;
  adopted public.land_use_plan_versions%ROWTYPE;
  decision public.land_use_plan_decisions%ROWTYPE;
  report_row public.reports%ROWTYPE;
  artifact public.report_artifacts%ROWTYPE;
  supplied_snapshot jsonb;
  manifest_decision jsonb;
  artifact_count integer;
  trim_chars text:=E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  changed integer;
  already_published boolean;
  new_report_id uuid;
  new_artifact_id uuid;
  generated_time timestamptz;
BEGIN
  IF p_workspace_id IS NULL OR p_plan_id IS NULL OR p_actor_id IS NULL OR p_version_id IS NULL
    OR p_version_content_hash IS NULL OR p_version_content_hash !~ '^[0-9a-f]{64}$'
    OR p_title IS NULL OR length(p_title) NOT BETWEEN 1 AND 180 OR btrim(p_title)=''
    OR p_snapshot_text IS NULL OR octet_length(p_snapshot_text) NOT BETWEEN 2 AND 64000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid publication request';
  END IF;
  SELECT * INTO plan_row FROM public.land_use_plans
    WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='Plan not found in this workspace'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current publication write permission required';
  END IF;
  SELECT * INTO adopted FROM public.land_use_plan_versions
    WHERE id=p_version_id AND plan_id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR adopted.state<>'adopted' OR plan_row.current_adopted_version_id IS DISTINCT FROM adopted.id
    OR adopted.content_hash IS DISTINCT FROM p_version_content_hash THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The current adopted version changed';
  END IF;
  BEGIN
    supplied_snapshot:=p_snapshot_text::jsonb;
  EXCEPTION WHEN invalid_text_representation OR untranslatable_character THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid frozen publication JSON';
  END;
  -- Keep the established JavaScript canonical bytes, rather than hashing jsonb text.
  IF adopted.frozen_snapshot IS DISTINCT FROM supplied_snapshot
    OR encode(extensions.digest(p_snapshot_text,'sha256'),'hex') IS DISTINCT FROM adopted.content_hash
    OR supplied_snapshot#>>'{plan,id}' IS DISTINCT FROM p_plan_id::text
    OR supplied_snapshot#>>'{version,id}' IS DISTINCT FROM adopted.id::text
    OR supplied_snapshot#>>'{version,versionNumber}' IS DISTINCT FROM adopted.version_number::text THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The adopted publication source could not be verified';
  END IF;
  SELECT * INTO decision FROM public.land_use_plan_decisions
    WHERE workspace_id=p_workspace_id AND plan_id=p_plan_id AND version_id=adopted.id
      AND version_content_hash=p_version_content_hash AND decision_kind IN ('adoption','amendment')
    ORDER BY decided_on DESC,created_at DESC,id DESC LIMIT 1;
  IF NOT FOUND OR decision.review_release_id IS NULL OR decision.adoption_manifest_hash IS NULL
    OR jsonb_typeof(decision.adoption_manifest) IS DISTINCT FROM 'object'
    OR encode(extensions.digest(convert_to(decision.adoption_manifest::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM decision.adoption_manifest_hash
    OR decision.adoption_manifest->>'planId' IS DISTINCT FROM p_plan_id::text
    OR decision.adoption_manifest->>'versionId' IS DISTINCT FROM adopted.id::text
    OR decision.adoption_manifest->>'versionContentHash' IS DISTINCT FROM p_version_content_hash
    OR decision.adoption_manifest->>'reviewReleaseId' IS DISTINCT FROM decision.review_release_id::text THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The retained adoption manifest could not be verified';
  END IF;
  -- A retained hash does not establish the decision shape required by the readers.
  manifest_decision:=decision.adoption_manifest->'decision';
  IF jsonb_typeof(manifest_decision) IS DISTINCT FROM 'object'
    OR (manifest_decision ?& ARRAY['kind','body','instrumentType','instrumentIdentifier','vote','decidedOn','effectiveOn']) IS NOT TRUE
    OR jsonb_typeof(manifest_decision->'kind') IS DISTINCT FROM 'string'
    OR jsonb_typeof(manifest_decision->'body') IS DISTINCT FROM 'string'
    OR jsonb_typeof(manifest_decision->'instrumentType') IS DISTINCT FROM 'string'
    OR jsonb_typeof(manifest_decision->'instrumentIdentifier') IS DISTINCT FROM 'string'
    OR jsonb_typeof(manifest_decision->'decidedOn') IS DISTINCT FROM 'string'
    OR coalesce(jsonb_typeof(manifest_decision->'vote') IN ('string','null'),false) IS NOT TRUE
    OR coalesce(jsonb_typeof(manifest_decision->'effectiveOn') IN ('string','null'),false) IS NOT TRUE
    OR btrim(decision.decision_body,trim_chars)=''
    OR btrim(decision.instrument_type,trim_chars)=''
    OR btrim(decision.instrument_identifier,trim_chars)=''
    OR decision.decided_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    OR (decision.effective_on IS NOT NULL AND decision.effective_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
    OR (manifest_decision @> jsonb_build_object(
      'kind',decision.decision_kind,'body',decision.decision_body,
      'instrumentType',decision.instrument_type,'instrumentIdentifier',decision.instrument_identifier,
      'vote',decision.vote,'decidedOn',to_char(decision.decided_on,'YYYY-MM-DD'),
      'effectiveOn',to_char(decision.effective_on,'YYYY-MM-DD'))) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The retained adoption decision is unreadable or inconsistent';
  END IF;

  already_published:=adopted.published_report_id IS NOT NULL;
  IF already_published THEN
    SELECT * INTO report_row FROM public.reports WHERE id=adopted.published_report_id FOR SHARE NOWAIT;
    IF NOT FOUND OR report_row.workspace_id IS DISTINCT FROM p_workspace_id
      OR report_row.land_use_plan_id IS DISTINCT FROM p_plan_id OR report_row.project_id IS NOT NULL
      OR report_row.report_type IS DISTINCT FROM 'land_use_plan_packet' OR report_row.status IS DISTINCT FROM 'generated' THEN
      RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The saved publication pointer is inconsistent';
    END IF;
    -- Readers select the latest artifact of any kind. One total artifact removes
    -- both cross-kind selection and generated_at tie ambiguity without rewriting history.
    SELECT count(*) INTO artifact_count FROM public.report_artifacts WHERE report_id=report_row.id;
    IF artifact_count<>1 THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The saved publication artifact is missing or ambiguous'; END IF;
    SELECT * INTO artifact FROM public.report_artifacts
      WHERE report_id=report_row.id FOR SHARE NOWAIT;
    IF NOT FOUND OR artifact.artifact_kind IS DISTINCT FROM 'html'
      OR artifact.metadata_json->>'kind'='land_use_plan_implementation_report'
      OR artifact.metadata_json->>'landUsePlanId' IS DISTINCT FROM p_plan_id::text
      OR artifact.metadata_json->>'versionId' IS DISTINCT FROM adopted.id::text
      OR artifact.metadata_json->>'contentHash' IS DISTINCT FROM p_version_content_hash
      OR artifact.metadata_json->'frozenSnapshot' IS DISTINCT FROM adopted.frozen_snapshot
      OR artifact.metadata_json->'adoptionManifest' IS DISTINCT FROM decision.adoption_manifest
      OR artifact.metadata_json->>'adoptionManifestHash' IS DISTINCT FROM decision.adoption_manifest_hash
      OR artifact.metadata_json->>'reviewReleaseId' IS DISTINCT FROM decision.review_release_id::text THEN
      RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The saved publication artifact does not match this version';
    END IF;
  ELSE
    new_report_id:=gen_random_uuid(); new_artifact_id:=gen_random_uuid(); generated_time:=clock_timestamp();
    INSERT INTO public.reports(id,workspace_id,project_id,land_use_plan_id,title,report_type,status,summary,created_by,generated_at,latest_artifact_url,latest_artifact_kind)
      VALUES(new_report_id,p_workspace_id,NULL,p_plan_id,p_title,'land_use_plan_packet','generated',
        format('Frozen adopted plan packet. Content hash %s.',p_version_content_hash),p_actor_id,generated_time,
        '/reports/'||new_report_id::text,'html') RETURNING * INTO report_row;
    INSERT INTO public.report_artifacts(id,report_id,artifact_kind,generated_by,generated_at,metadata_json)
      VALUES(new_artifact_id,new_report_id,'html',p_actor_id,generated_time,jsonb_build_object(
        'landUsePlanId',p_plan_id,'versionId',adopted.id,'contentHash',p_version_content_hash,
        'frozenSnapshot',adopted.frozen_snapshot,'adoptionManifest',decision.adoption_manifest,
        'adoptionManifestHash',decision.adoption_manifest_hash,'reviewReleaseId',decision.review_release_id,
        'confidentialityExclusions',jsonb_build_array('land_use_plan_consultation_records','confidential_notes','sensitive_location_flags')))
      RETURNING * INTO artifact;
    UPDATE public.land_use_plan_versions SET published_report_id=new_report_id
      WHERE id=adopted.id AND workspace_id=p_workspace_id AND state='adopted' AND published_report_id IS NULL;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Publication changed before it could be saved'; END IF;
  END IF;
  RETURN jsonb_build_object('workspaceId',p_workspace_id,'planId',p_plan_id,'versionId',adopted.id,
    'contentHash',p_version_content_hash,'reportId',report_row.id,'artifactId',artifact.id,
    'title',report_row.title,'alreadyPublished',already_published);
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The plan is being changed. Retry this version to confirm its publication';
END;
$$;
REVOKE ALL ON FUNCTION public.publish_land_use_plan_version(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_land_use_plan_version(uuid,uuid,uuid,uuid,text,text,text) TO service_role;
