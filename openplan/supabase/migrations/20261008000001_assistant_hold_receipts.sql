-- New HOLD executions retain their decision and approval in one transaction.
-- Historical audit rows remain statements of their original, separate writes.
ALTER TABLE public.assistant_action_approvals ADD COLUMN execution_context jsonb;
ALTER TABLE public.assistant_action_executions ADD COLUMN result_receipt jsonb;
ALTER TABLE public.assistant_action_executions ADD CONSTRAINT assistant_durable_receipt_identity CHECK (
  result_receipt IS NULL OR (
    workspace_id IS NOT NULL AND user_id IS NOT NULL AND approval_id IS NOT NULL
    AND action_kind = 'record_stage_gate_hold' AND outcome = 'succeeded'
    AND execution_source = 'planner_agent_quick_link' AND actor_kind = 'planner_agent'
    AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
    AND input_hash IS NOT NULL AND result_receipt->>'schemaVersion' = '1'
    AND jsonb_typeof(result_receipt->'decision') = 'object'
  ) IS TRUE
);
CREATE UNIQUE INDEX assistant_action_durable_approval ON public.assistant_action_executions(approval_id)
  WHERE result_receipt IS NOT NULL;

-- This reads old work under current access. Expiry and changed gate bindings
-- govern new effects, not whether an authorized caller may recover a receipt.
CREATE FUNCTION public.read_assistant_hold_receipt(p_approval_id uuid, p_user_id uuid, p_workspace_id uuid, p_input_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE receipt jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND lower(trim(role)) IN ('owner','admin','member','viewer')) THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
  END IF;
  SELECT result_receipt INTO receipt FROM public.assistant_action_executions
    WHERE approval_id=p_approval_id AND user_id=p_user_id AND workspace_id=p_workspace_id
      AND input_hash=p_input_hash AND action_kind='record_stage_gate_hold' AND result_receipt IS NOT NULL;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.read_assistant_hold_receipt(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_assistant_hold_receipt(uuid,uuid,uuid,text) TO service_role;

-- The canonical action text is hashed here, then parsed for the actual write.
-- It cannot authorize one rationale and insert a different caller-supplied one.
CREATE FUNCTION public.record_assistant_stage_gate_hold(
  p_approval_id uuid, p_user_id uuid, p_workspace_id uuid,
  p_action_canonical text, p_binding jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  consent public.assistant_action_approvals;
  saved public.stage_gate_decisions;
  workspace_row public.workspaces;
  action jsonb := p_action_canonical::jsonb;
  action_hash text := encode(extensions.digest(convert_to(p_action_canonical,'UTF8'),'sha256'),'hex');
  receipt jsonb;
  workspace_snapshot jsonb;
  prior_id uuid;
  member_role text;
  v_project_id uuid;
  cited_id uuid;
  cited_table text;
  context jsonb;
BEGIN
  -- Approval, membership, workspace, then project is the consistent lock order.
  SELECT * INTO consent FROM public.assistant_action_approvals WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR consent.user_id IS DISTINCT FROM p_user_id OR consent.workspace_id IS DISTINCT FROM p_workspace_id
    OR consent.action_kind <> 'record_stage_gate_hold' OR consent.input_hash IS DISTINCT FROM action_hash THEN
    RAISE EXCEPTION 'Planner Agent approval evidence does not match this request' USING ERRCODE='42501';
  END IF;
  SELECT role INTO member_role FROM public.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR SHARE;
  IF NOT FOUND OR lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin','member','viewer') THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
  END IF;
  receipt := public.read_assistant_hold_receipt(p_approval_id,p_user_id,p_workspace_id,action_hash);
  IF receipt IS NOT NULL THEN RETURN jsonb_build_object('receipt',receipt,'replayed',true); END IF;
  IF lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'Workspace write access denied' USING ERRCODE='42501';
  END IF;
  IF consent.consumed_at IS NOT NULL OR consent.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Planner Agent approval evidence is invalid or expired' USING ERRCODE='42501';
  END IF;
  context := consent.execution_context;
  IF context IS NULL OR context->>'version' IS DISTINCT FROM '1' OR context->'binding' IS DISTINCT FROM p_binding THEN
    RAISE EXCEPTION 'Stage-gate context changed; review and approve the current action' USING ERRCODE='PT409';
  END IF;
  IF jsonb_typeof(action) <> 'object' OR action->>'kind' IS DISTINCT FROM 'record_stage_gate_hold'
    OR action->>'workspaceId' IS DISTINCT FROM p_workspace_id::text
    OR action->>'gateId' IS DISTINCT FROM p_binding->>'gateId'
    OR length(trim(coalesce(action->>'rationale',''))) NOT BETWEEN 1 AND 4000
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(action) key WHERE key NOT IN ('kind','workspaceId','projectId','gateId','rationale','missingArtifacts','runId','modelRunId','countyRunId')) THEN
    RAISE EXCEPTION 'Invalid approved stage-gate HOLD action' USING ERRCODE='22023';
  END IF;
  v_project_id := (action->>'projectId')::uuid;
  SELECT * INTO workspace_row FROM public.workspaces WHERE id=p_workspace_id FOR SHARE;
  workspace_snapshot := jsonb_build_object(
    'id',workspace_row.id,'stage_gate_template_id',workspace_row.stage_gate_template_id,
    'stage_gate_template_selection',workspace_row.stage_gate_template_selection,
    'home_geography_source',workspace_row.home_geography_source,'home_geography_kind',workspace_row.home_geography_kind,
    'home_geography_ref',workspace_row.home_geography_ref,'home_country_code',workspace_row.home_country_code,
    'home_subdivision_code',workspace_row.home_subdivision_code);
  IF workspace_snapshot IS DISTINCT FROM context->'workspace' THEN
    RAISE EXCEPTION 'Workspace stage-gate binding changed; review and approve again' USING ERRCODE='PT409';
  END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project is not in this workspace' USING ERRCODE='42501'; END IF;
  SELECT id INTO prior_id FROM public.stage_gate_decisions
    WHERE workspace_id=p_workspace_id AND stage_gate_decisions.project_id=v_project_id
      AND gate_id=action->>'gateId' AND template_id=p_binding->>'templateId'
    ORDER BY decided_at DESC,id DESC LIMIT 1;
  IF to_jsonb(prior_id) IS DISTINCT FROM nullif(context->'priorDecisionId','null'::jsonb) THEN
    RAISE EXCEPTION 'Stage-gate decision changed; review and approve again' USING ERRCODE='PT409';
  END IF;
  IF jsonb_typeof(coalesce(action->'missingArtifacts','[]'::jsonb)) <> 'array'
    OR jsonb_array_length(coalesce(action->'missingArtifacts','[]'::jsonb)) > 50 THEN
    RAISE EXCEPTION 'Invalid missing artifacts' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(action->'missingArtifacts','[]'::jsonb)) item
    WHERE jsonb_typeof(item)<>'string' OR length(trim(item #>> '{}')) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'Invalid missing artifact value' USING ERRCODE='22023';
  END IF;
  -- Hold cited rows stable while their workspace and FK constraints are checked.
  FOR cited_table,cited_id IN SELECT * FROM (VALUES ('runs',(action->>'runId')::uuid),('model_runs',(action->>'modelRunId')::uuid),('county_runs',(action->>'countyRunId')::uuid)) refs(table_name,id) WHERE id IS NOT NULL LOOP
    EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND workspace_id=$2 FOR SHARE',cited_table) INTO cited_id USING cited_id,p_workspace_id;
    IF cited_id IS NULL THEN RAISE EXCEPTION 'Cited run is not in this workspace' USING ERRCODE='42501'; END IF;
  END LOOP;
  INSERT INTO public.stage_gate_decisions(workspace_id,project_id,gate_id,template_id,decision,rationale,missing_artifacts,run_id,model_run_id,county_run_id,metadata,decided_by)
  VALUES(p_workspace_id,v_project_id,action->>'gateId',p_binding->>'templateId','HOLD',action->>'rationale',coalesce(action->'missingArtifacts','[]'::jsonb),
    (action->>'runId')::uuid,(action->>'modelRunId')::uuid,(action->>'countyRunId')::uuid,
    jsonb_build_object('source','api.stage_gates.decisions','templateVersion',p_binding->>'templateVersion','gateName',p_binding->>'gateName',
      'gateSequence',p_binding->'gateSequence','templateSelection',p_binding->>'templateSelection','authorship',
      jsonb_build_object('actorKind','planner_agent','agentId','openplan.planner_agent','approvedByUserId',consent.user_id,
        'approvedAt',consent.created_at,'approvalId',consent.id,'inputHash',action_hash)),p_user_id) RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'Stage-gate insert returned no decision'; END IF;
  receipt := jsonb_build_object('schemaVersion',1,'decision',to_jsonb(saved));
  INSERT INTO public.assistant_action_executions(workspace_id,user_id,action_kind,audit_event,approval,regrounding,outcome,input_summary,
    approval_id,input_hash,execution_source,actor_kind,actor_agent_id,approved_by_user_id,approved_at,result_receipt)
  VALUES(p_workspace_id,p_user_id,'record_stage_gate_hold','planner_agent.record_stage_gate_hold','approval_required','refresh_preview','succeeded',
    jsonb_build_object('projectId',v_project_id,'gateId',saved.gate_id,'decision','HOLD','decisionId',saved.id),
    consent.id,action_hash,'planner_agent_quick_link','planner_agent','openplan.planner_agent',consent.user_id,consent.created_at,receipt);
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage-gate audit returned no receipt'; END IF;
  UPDATE public.assistant_action_approvals SET consumed_at=clock_timestamp() WHERE id=consent.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage-gate approval could not be consumed'; END IF;
  RETURN jsonb_build_object('receipt',receipt,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.record_assistant_stage_gate_hold(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_assistant_stage_gate_hold(uuid,uuid,uuid,text,jsonb) TO service_role;
