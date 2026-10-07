-- Save an implementation report and its exact-retry receipt in one transaction.
-- A lost response must not create another report or read a later action status.
CREATE TABLE public.land_use_plan_implementation_report_commands (
  plan_id uuid NOT NULL,
  command_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_text text NOT NULL CHECK (octet_length(command_text) BETWEEN 2 AND 98304),
  command_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(command_text,'sha256'),'hex')) STORED,
  snapshot_text text NOT NULL,
  content_hash text GENERATED ALWAYS AS (encode(extensions.digest(snapshot_text,'sha256'),'hex')) STORED,
  report_id uuid NOT NULL REFERENCES public.reports(id),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (plan_id,command_id),
  FOREIGN KEY (plan_id,workspace_id) REFERENCES public.land_use_plans(id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id,workspace_id) REFERENCES public.land_use_plan_versions(id,workspace_id)
);
ALTER TABLE public.land_use_plan_implementation_report_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_use_plan_implementation_report_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.land_use_plan_implementation_report_commands TO service_role;
CREATE TRIGGER land_use_plan_implementation_report_commands_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_implementation_report_commands
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();

CREATE FUNCTION public.create_land_use_plan_implementation_report(
  p_plan_id uuid, p_workspace_id uuid, p_actor_id uuid, p_command_id uuid,
  p_command_text text, p_adopted_snapshot_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
DECLARE
  plan_row public.land_use_plans%ROWTYPE;
  adopted public.land_use_plan_versions%ROWTYPE;
  previous public.land_use_plan_implementation_report_commands%ROWTYPE;
  command jsonb; adopted_snapshot jsonb; actions jsonb; snapshot jsonb; snapshot_text text;
  start_date date; end_date date; report_title text; report_summary text; content_hash text; response jsonb;
  report_id uuid:=gen_random_uuid(); artifact_id uuid:=gen_random_uuid(); implementation_id uuid:=gen_random_uuid();
  generated_time timestamptz; command_hash text;
  trim_chars text:=E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF p_plan_id IS NULL OR p_workspace_id IS NULL OR p_actor_id IS NULL OR p_command_id IS NULL
    OR p_command_text IS NULL OR octet_length(p_command_text) NOT BETWEEN 2 AND 98304 THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid implementation report command';
  END IF;
  SELECT * INTO plan_row FROM public.land_use_plans
    WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='Plan not found in this workspace'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current report write permission required';
  END IF;
  SELECT * INTO previous FROM public.land_use_plan_implementation_report_commands
    WHERE plan_id=p_plan_id AND command_id=p_command_id;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor_id OR previous.workspace_id IS DISTINCT FROM p_workspace_id
      OR previous.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='This command ID belongs to another report request';
    END IF;
    RETURN previous.receipt||jsonb_build_object('replayed',true);
  END IF;
  IF p_adopted_snapshot_text IS NULL OR octet_length(p_adopted_snapshot_text) NOT BETWEEN 2 AND 64000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='The verified adopted snapshot is required';
  END IF;
  BEGIN
    command:=p_command_text::jsonb; adopted_snapshot:=p_adopted_snapshot_text::jsonb;
  EXCEPTION WHEN invalid_text_representation OR untranslatable_character THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid implementation report JSON';
  END;
  IF jsonb_typeof(command) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid implementation report command shape';
  END IF;
  IF (command->>'operation'='generate' AND command->>'commandId'=p_command_id::text
    AND command->>'versionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND jsonb_typeof(command->'expectedVersionHash')='string' AND command->>'expectedVersionHash' ~ '^[0-9a-f]{64}$'
    AND command->>'reportingPeriodStart' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND command->>'reportingPeriodEnd' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND jsonb_typeof(command->'title')='string' AND length(command->>'title') BETWEEN 1 AND 180
    AND btrim(command->>'title',trim_chars)=command->>'title'
    AND (command->'summary'='null'::jsonb OR (jsonb_typeof(command->'summary')='string' AND length(command->>'summary')<=20000))
    AND (SELECT count(*) FROM jsonb_object_keys(command))=8) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid implementation report command fields';
  END IF;
  BEGIN
    start_date:=(command->>'reportingPeriodStart')::date; end_date:=(command->>'reportingPeriodEnd')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid reporting dates';
  END;
  IF end_date<start_date THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Reporting dates are inverted'; END IF;
  report_title:=command->>'title'; report_summary:=command->>'summary';
  SELECT * INTO adopted FROM public.land_use_plan_versions
    WHERE id=(command->>'versionId')::uuid AND plan_id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR adopted.state<>'adopted' OR plan_row.current_adopted_version_id IS DISTINCT FROM adopted.id
    OR adopted.content_hash IS DISTINCT FROM command->>'expectedVersionHash' THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The adopted plan changed. Review it before generating a report';
  END IF;
  IF adopted.frozen_snapshot IS DISTINCT FROM adopted_snapshot
    OR encode(extensions.digest(p_adopted_snapshot_text,'sha256'),'hex') IS DISTINCT FROM adopted.content_hash
    OR adopted_snapshot#>>'{plan,id}' IS DISTINCT FROM p_plan_id::text
    OR adopted_snapshot#>>'{version,id}' IS DISTINCT FROM adopted.id::text
    OR adopted_snapshot#>>'{version,versionNumber}' IS DISTINCT FROM adopted.version_number::text THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The adopted source could not be verified';
  END IF;
  -- Every action write takes the same version lock before changing a row.
  -- Stable projection excludes private fields and preserves the saved status time.
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO actions FROM (
    SELECT id,title,description,responsible_party,due_on,status,project_id,program_id,evidence_document_id,updated_at
    FROM public.land_use_plan_implementation_actions WHERE version_id=adopted.id AND workspace_id=p_workspace_id
  ) a;
  snapshot:=jsonb_build_object('planId',p_plan_id,'adoptedVersionId',adopted.id,'adoptedVersionContentHash',adopted.content_hash,
    'reportingPeriodStart',start_date,'reportingPeriodEnd',end_date,'actions',actions);
  -- Retain these exact PostgreSQL jsonb-text bytes. Historical reports keep their
  -- original insertion-order JavaScript hash; neither encoding is silently rewritten.
  snapshot_text:=snapshot::text;
  content_hash:=encode(extensions.digest(snapshot_text,'sha256'),'hex');
  command_hash:=encode(extensions.digest(p_command_text,'sha256'),'hex'); generated_time:=clock_timestamp();
  INSERT INTO public.reports(id,workspace_id,project_id,land_use_plan_id,title,report_type,status,summary,created_by,generated_at,latest_artifact_kind)
    VALUES(report_id,p_workspace_id,NULL,p_plan_id,report_title,'land_use_plan_implementation_report','generated',
      coalesce(report_summary,format('Implementation status for %s through %s.',start_date,end_date)),p_actor_id,generated_time,'html');
  INSERT INTO public.report_artifacts(id,report_id,artifact_kind,generated_by,generated_at,metadata_json)
    VALUES(artifact_id,report_id,'html',p_actor_id,generated_time,jsonb_build_object('kind','land_use_plan_implementation_report',
      'landUsePlanId',p_plan_id,'contentHash',content_hash,'contentHashEncoding','postgresql-jsonb-text-sha256',
      'snapshot',snapshot,'summary',report_summary,'confidentialityExclusions',jsonb_build_array('land_use_plan_consultation_records','confidential_notes','sensitive_location_flags')));
  INSERT INTO public.land_use_plan_implementation_reports(id,workspace_id,plan_id,adopted_version_id,reporting_period_start,reporting_period_end,summary,action_status_snapshot,content_hash,report_id,generated_by,generated_at)
    VALUES(implementation_id,p_workspace_id,p_plan_id,adopted.id,start_date,end_date,report_summary,actions,content_hash,report_id,p_actor_id,generated_time);
  response:=jsonb_build_object('replayed',false,'actorId',p_actor_id,'workspaceId',p_workspace_id,'planId',p_plan_id,
    'commandId',p_command_id,'commandSha256',command_hash,'versionId',adopted.id,'adoptedVersionContentHash',adopted.content_hash,
    'reportId',report_id,'artifactId',artifact_id,'implementationReportId',implementation_id,'contentHash',content_hash,
    'reportingPeriodStart',start_date,'reportingPeriodEnd',end_date,'title',report_title,'summary',report_summary,
    'generatedAt',to_char(generated_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO public.land_use_plan_implementation_report_commands(plan_id,command_id,workspace_id,version_id,actor_id,command_text,snapshot_text,report_id,receipt)
    VALUES(p_plan_id,p_command_id,p_workspace_id,adopted.id,p_actor_id,p_command_text,snapshot_text,report_id,response);
  RETURN response;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='The plan is being changed. Keep this exact report request and retry';
END;
$$;
REVOKE ALL ON FUNCTION public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text) TO service_role;
