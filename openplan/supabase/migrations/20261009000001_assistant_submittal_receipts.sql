-- Extend the existing receipt identity check in one atomic ALTER statement.
-- Existing HOLD receipts and historical rows keep their original meaning.
ALTER TABLE public.assistant_action_executions
  DROP CONSTRAINT assistant_durable_receipt_identity,
  ADD CONSTRAINT assistant_durable_receipt_identity CHECK (
    result_receipt IS NULL OR (
      workspace_id IS NOT NULL AND user_id IS NOT NULL AND approval_id IS NOT NULL
      AND outcome='succeeded' AND execution_source='planner_agent_quick_link' AND actor_kind='planner_agent'
      AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND input_hash IS NOT NULL
      AND result_receipt->>'schemaVersion'='1'
      AND ((action_kind='record_stage_gate_hold' AND jsonb_typeof(result_receipt->'decision')='object')
        OR (action_kind='create_project_record' AND result_receipt->>'recordType'='submittal'
          AND jsonb_typeof(result_receipt->'record')='object'))
    ) IS TRUE
  );

-- The approval, rather than a potentially moved project, supplies original scope.
-- This is read-only and does not renew, consume or execute the approved request.
CREATE FUNCTION public.read_assistant_action_receipt(
  p_approval_id uuid,p_user_id uuid,p_input_hash text,p_action_kind text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE consent public.assistant_action_approvals; receipt jsonb;
BEGIN
  SELECT * INTO consent FROM public.assistant_action_approvals
    WHERE id=p_approval_id AND user_id=p_user_id AND input_hash=p_input_hash AND action_kind=p_action_kind;
  IF NOT FOUND OR consent.workspace_id IS NULL OR p_action_kind NOT IN ('record_stage_gate_hold','create_project_record') THEN
    RAISE EXCEPTION 'Planner Agent approval evidence does not match this request' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=consent.workspace_id AND user_id=p_user_id
    AND lower(trim(coalesce(role,''))) IN ('owner','admin','member','viewer')) THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
  END IF;
  SELECT result_receipt INTO receipt FROM public.assistant_action_executions
    WHERE approval_id=consent.id AND user_id=p_user_id AND workspace_id=consent.workspace_id
      AND input_hash=p_input_hash AND action_kind=p_action_kind AND result_receipt IS NOT NULL;
  RETURN jsonb_build_object('workspaceId',consent.workspace_id,'receipt',receipt);
END $$;
REVOKE ALL ON FUNCTION public.read_assistant_action_receipt(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_assistant_action_receipt(uuid,uuid,text,text) TO service_role;

-- Only the registered submittal payload is executable here. Manual record types,
-- assignments and other fields on the wider HTTP endpoint are not accepted.
CREATE FUNCTION public.record_assistant_project_submittal(
  p_approval_id uuid,p_user_id uuid,p_workspace_id uuid,p_action_canonical text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  consent public.assistant_action_approvals;
  saved public.project_submittals;
  action jsonb:=p_action_canonical::jsonb;
  action_hash text:=encode(extensions.digest(convert_to(p_action_canonical,'UTF8'),'sha256'),'hex');
  receipt jsonb;
  context jsonb;
  member_role text;
  v_project_id uuid;
BEGIN
  SELECT * INTO consent FROM public.assistant_action_approvals WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR consent.user_id IS DISTINCT FROM p_user_id OR consent.workspace_id IS NULL
    OR consent.workspace_id IS DISTINCT FROM p_workspace_id
    OR consent.action_kind<>'create_project_record' OR consent.input_hash IS DISTINCT FROM action_hash THEN
    RAISE EXCEPTION 'Planner Agent approval evidence does not match this request' USING ERRCODE='42501';
  END IF;
  SELECT role INTO member_role FROM public.workspace_members
    WHERE workspace_id=consent.workspace_id AND user_id=p_user_id FOR SHARE;
  IF NOT FOUND OR lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin','member','viewer') THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
  END IF;
  receipt:=(public.read_assistant_action_receipt(consent.id,p_user_id,action_hash,'create_project_record'))->'receipt';
  IF receipt IS NOT NULL AND receipt<>'null'::jsonb THEN
    RETURN jsonb_build_object('workspaceId',consent.workspace_id,'receipt',receipt,'replayed',true);
  END IF;
  IF lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'Workspace write access denied' USING ERRCODE='42501';
  END IF;
  IF consent.consumed_at IS NOT NULL OR consent.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Planner Agent approval evidence is invalid or expired' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(action)<>'object' OR action->>'kind' IS DISTINCT FROM 'create_project_record'
    OR action->>'recordType' IS DISTINCT FROM 'submittal'
    OR jsonb_typeof(action->'title') IS DISTINCT FROM 'string'
    OR length(trim(coalesce(action->>'title',''))) NOT BETWEEN 1 AND 160
    OR (action ? 'notes' AND (jsonb_typeof(action->'notes') IS DISTINCT FROM 'string' OR length(action->>'notes')>4000))
    OR (action ? 'submittalType' AND jsonb_typeof(action->'submittalType') IS DISTINCT FROM 'string')
    OR (action ? 'status' AND jsonb_typeof(action->'status') IS DISTINCT FROM 'string')
    OR coalesce(action->>'submittalType','other') NOT IN ('authorization_packet','invoice_backup','environmental_package','hearing_record','ps_e','reimbursement','progress_report','other')
    OR coalesce(action->>'status','draft') NOT IN ('draft','internal_review','submitted','accepted','revise_and_resubmit')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(action) key WHERE key NOT IN ('kind','projectId','recordType','title','submittalType','status','notes')) THEN
    RAISE EXCEPTION 'Invalid approved project submittal action' USING ERRCODE='22023';
  END IF;
  v_project_id:=(action->>'projectId')::uuid;
  context:=consent.execution_context;
  IF context IS NULL OR context->>'version' IS DISTINCT FROM '1'
    OR context->'project'->>'id' IS DISTINCT FROM v_project_id::text
    OR context->'project'->>'workspaceId' IS DISTINCT FROM consent.workspace_id::text
    OR context->'action' IS DISTINCT FROM action THEN
    RAISE EXCEPTION 'Original submittal context is unavailable; review and approve again' USING ERRCODE='PT409';
  END IF;
  -- Ownership cannot change during the write; a display-name change is harmless.
  PERFORM 1 FROM public.projects WHERE id=v_project_id AND workspace_id=consent.workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project is not in the approved workspace' USING ERRCODE='42501'; END IF;
  INSERT INTO public.project_submittals(project_id,title,submittal_type,status,notes,created_by)
  VALUES(v_project_id,action->>'title',coalesce(action->>'submittalType','other'),coalesce(action->>'status','draft'),
    nullif(action->>'notes',''),p_user_id) RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'Submittal insert returned no record'; END IF;
  receipt:=jsonb_build_object('schemaVersion',1,'recordType','submittal','record',to_jsonb(saved));
  INSERT INTO public.assistant_action_executions(workspace_id,user_id,action_kind,audit_event,approval,regrounding,outcome,input_summary,
    approval_id,input_hash,execution_source,actor_kind,actor_agent_id,approved_by_user_id,approved_at,result_receipt)
  VALUES(consent.workspace_id,p_user_id,'create_project_record','planner_agent.create_project_record','approval_required','refresh_preview','succeeded',
    jsonb_build_object('projectId',v_project_id,'recordType','submittal','title',saved.title,'recordId',saved.id),
    consent.id,action_hash,'planner_agent_quick_link','planner_agent','openplan.planner_agent',consent.user_id,consent.created_at,receipt);
  IF NOT FOUND THEN RAISE EXCEPTION 'Submittal audit returned no receipt'; END IF;
  UPDATE public.assistant_action_approvals SET consumed_at=clock_timestamp() WHERE id=consent.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submittal approval could not be consumed'; END IF;
  RETURN jsonb_build_object('workspaceId',consent.workspace_id,'receipt',receipt,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.record_assistant_project_submittal(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_assistant_project_submittal(uuid,uuid,uuid,text) TO service_role;
