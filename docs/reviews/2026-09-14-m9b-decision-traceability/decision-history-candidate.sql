-- One private snapshot supplies eligible choices and complete retained chains,
-- including links whose current response, decision or relationship is gone.
CREATE FUNCTION public.read_engagement_decision_links(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  workspace uuid;
  decisions jsonb;
  entries jsonb;
  states jsonb = '[]'::jsonb;
  leaf public.engagement_response_decision_links%ROWTYPE;
  snapshot jsonb;
BEGIN
  SELECT workspace_id INTO workspace FROM public.engagement_campaigns WHERE id = p_campaign;
  IF auth.uid() IS NULL OR workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = workspace
      AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('projectName', p.name, 'record', to_jsonb(d))
    ORDER BY p.name, p.id, d.created_at, d.id), '[]'::jsonb) INTO decisions
  FROM public.project_decisions d JOIN public.projects p ON p.id = d.project_id
  JOIN public.engagement_campaign_projects cp ON cp.project_id = p.id
  WHERE cp.campaign_id = p_campaign AND cp.workspace_id = workspace AND p.workspace_id = workspace;
  SELECT COALESCE(jsonb_agg(to_jsonb(l) || jsonb_build_object('payload_text', l.payload_json::text)
    ORDER BY l.created_at, l.id), '[]'::jsonb) INTO entries
  FROM public.engagement_response_decision_links l
  WHERE l.campaign_id = p_campaign AND l.workspace_id = workspace;

  FOR leaf IN SELECT l.* FROM public.engagement_response_decision_links l
    WHERE l.campaign_id = p_campaign AND l.workspace_id = workspace
      AND NOT EXISTS (SELECT 1 FROM public.engagement_response_decision_links child WHERE child.predecessor_id = l.id)
    ORDER BY l.created_at, l.id
  LOOP
    BEGIN
      snapshot = public.read_engagement_response_decision_context(p_campaign, leaf.response_id, leaf.decision_id);
      states = states || jsonb_build_array(jsonb_build_object('linkId', leaf.id,
        'sourceState', CASE WHEN snapshot->>'contextSha256' = leaf.context_sha256 THEN 'unchanged' ELSE 'changed' END,
        'currentContextSha256', snapshot->>'contextSha256', 'unavailableReason', NULL));
    EXCEPTION
      WHEN SQLSTATE 'P0002' OR SQLSTATE 'PT409' THEN
        states = states || jsonb_build_array(jsonb_build_object('linkId', leaf.id,
          'sourceState', 'unavailable', 'currentContextSha256', NULL,
          'unavailableReason', CASE WHEN SQLSTATE = 'PT409' THEN 'history_conflict' ELSE 'source_unavailable' END));
    END;
  END LOOP;
  RETURN jsonb_build_object('schema', 1, 'campaignId', p_campaign, 'workspaceId', workspace,
    'decisions', decisions, 'decisionCount', jsonb_array_length(decisions),
    'entries', entries, 'entryCount', jsonb_array_length(entries),
    'current', states, 'currentCount', jsonb_array_length(states));
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_decision_links(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_decision_links(uuid) TO authenticated;
