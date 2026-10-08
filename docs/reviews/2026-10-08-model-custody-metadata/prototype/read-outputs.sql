-- Service-only prototype reader. The application must authorize the workspace
-- before invoking it. Ownership classification does not establish claim validity.
CREATE FUNCTION public.read_model_attempt_outputs(p_run_id uuid,p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.model_runs%ROWTYPE; v_outputs jsonb;
BEGIN
 SELECT * INTO v_run FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model output read scope mismatch'; END IF;
 WITH outputs AS (
  SELECT 'artifact'::text AS kind,id,run_id,stage_id,attempt_id,to_jsonb(t) AS record
    FROM public.model_run_artifacts t WHERE run_id=p_run_id
  UNION ALL
  SELECT 'kpi',id,run_id,NULL::uuid,attempt_id,to_jsonb(t)
    FROM public.model_run_kpis t WHERE run_id=p_run_id
 ), classified AS (
  SELECT o.kind,o.id,o.record,
   CASE
    WHEN o.attempt_id IS NULL THEN 'legacy_unknown'
    WHEN a.id IS NULL OR s.id IS NULL OR (o.kind='artifact' AND o.stage_id IS DISTINCT FROM a.stage_id) THEN 'invalid_binding'
    WHEN a.revoked_at IS NOT NULL OR s.active_attempt_id IS DISTINCT FROM a.id OR s.status NOT IN ('running','succeeded') OR v_run.status NOT IN ('running','succeeded') THEN 'retained_inactive'
    WHEN s.status='succeeded' THEN 'current_completed'
    ELSE 'current_in_progress'
   END AS ownership_state
  FROM outputs o
  LEFT JOIN public.model_stage_attempts a ON a.id=o.attempt_id AND a.run_id=o.run_id
  LEFT JOIN public.model_run_stages s ON s.id=a.stage_id AND s.run_id=o.run_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'ownership_state',ownership_state,'record',record) ORDER BY kind,id),'[]'::jsonb)
 INTO v_outputs FROM classified;
 RETURN jsonb_build_object('run_id',v_run.id,'run_status',v_run.status,'outputs',v_outputs);
END;
$$;
REVOKE ALL ON FUNCTION public.read_model_attempt_outputs(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_model_attempt_outputs(uuid,uuid) TO service_role;
