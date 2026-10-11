BEGIN;

-- A route binds the actor to its authenticated session before this service-only
-- lookup. Workspace members may inspect progress after an uncertain admission
-- reply without learning original source arguments or worker tokens.
CREATE FUNCTION public.read_gtfs_submission_status(p_workspace uuid,p_request uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version_id uuid;
BEGIN
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS status read access is unavailable' USING ERRCODE='42501';
 END IF;
 SELECT s.version_id INTO version_id FROM openplan_gtfs.submissions s
 WHERE s.request_id=p_request AND s.workspace_id=p_workspace;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.read_gtfs_ingest_status(p_workspace,version_id,p_actor);
END $$;
REVOKE ALL ON FUNCTION public.read_gtfs_submission_status(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_gtfs_submission_status(uuid,uuid,uuid) TO service_role;

COMMIT;
