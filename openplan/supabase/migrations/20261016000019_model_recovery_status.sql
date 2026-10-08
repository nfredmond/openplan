-- Read recovery enrollment without treating a saved status as current ownership.
CREATE FUNCTION public.inspect_model_recovery_status(p_workspace uuid, p_run uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
   'workspace_id', r.workspace_id,
   'run_id', r.id,
   'provenance', e.provenance,
   'enrolled_at', e.observed_at,
   'observed_starts', (SELECT count(*) FROM public.model_stage_execution_starts s WHERE s.run_id=r.id),
   'last_start_observed_at', (SELECT max(s.observed_at) FROM public.model_stage_execution_starts s WHERE s.run_id=r.id)
 )
 FROM public.model_runs r
 JOIN public.model_execution_custody_enrollment e ON e.run_id=r.id
 WHERE r.id=p_run AND r.workspace_id=p_workspace;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_recovery_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_recovery_status(uuid,uuid) TO service_role;
