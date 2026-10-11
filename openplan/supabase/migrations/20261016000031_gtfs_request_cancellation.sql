BEGIN;

-- A request can be cancelled before its version exists. Keep this reservation
-- independent of feed deletion and serialize it with admission's request lock.
CREATE TABLE openplan_gtfs.request_cancellations (
 request_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 command_id uuid NOT NULL UNIQUE,
 payload_hash text NOT NULL,
 response jsonb NOT NULL
);
ALTER TABLE openplan_gtfs.request_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE openplan_gtfs.request_cancellations FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the original admission implementation and its receipt semantics.
-- Runtime clients cannot invoke it directly after it moves into private custody.
ALTER FUNCTION public.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) SET SCHEMA openplan_gtfs;
REVOKE ALL ON FUNCTION openplan_gtfs.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admit_gtfs_ingest(p_request uuid,p_workspace uuid,p_actor uuid,p_feed uuid,p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_request IS NULL OR p_workspace IS NULL OR p_actor IS NULL THEN
  RAISE EXCEPTION 'GTFS admission requires complete identity' USING ERRCODE='22023'; END IF;
 IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS workspace write access is unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-admission:'||p_request::text,0));
 IF EXISTS(SELECT 1 FROM openplan_gtfs.request_cancellations WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'GTFS request is cancelled' USING ERRCODE='55000'; END IF;
 RETURN openplan_gtfs.admit_gtfs_ingest(p_request,p_workspace,p_actor,p_feed,p_source);
END $$;
REVOKE ALL ON FUNCTION public.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.cancel_gtfs_submission(p_workspace uuid,p_request uuid,p_actor uuid,p_command uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved openplan_gtfs.request_cancellations%ROWTYPE; submission openplan_gtfs.submissions%ROWTYPE;
 execution openplan_gtfs.executions%ROWTYPE; hash text; result jsonb; terminal jsonb; at_time timestamptz;
BEGIN
 IF p_workspace IS NULL OR p_request IS NULL OR p_actor IS NULL OR p_command IS NULL OR p_reason IS NULL
  OR length(btrim(p_reason))=0 OR length(p_reason)>2000 THEN
  RAISE EXCEPTION 'GTFS request cancellation requires complete identity and reason' USING ERRCODE='22023'; END IF;
 IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS request cancellation write access is unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-admission:'||p_request::text,0));
 -- A command lock also protects the unique receipt when two request identities
 -- try to reuse the same human command concurrently.
 PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-request-cancel:'||p_command::text,0));
 hash:=encode(extensions.digest(jsonb_build_object('workspace',p_workspace,'request',p_request,'actor',p_actor,'reason',p_reason)::text,'sha256'),'hex');
 SELECT * INTO saved FROM openplan_gtfs.request_cancellations WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'GTFS request cancellation command changed' USING ERRCODE='22023'; END IF;
  RETURN saved.response;
 END IF;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.request_cancellations WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'GTFS request cancellation already has its command identity' USING ERRCODE='55000'; END IF;
 SELECT * INTO submission FROM openplan_gtfs.submissions WHERE request_id=p_request;
 IF FOUND THEN
  IF submission.workspace_id IS DISTINCT FROM p_workspace THEN RAISE EXCEPTION 'GTFS cancellation request is unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO execution FROM openplan_gtfs.executions WHERE version_id=submission.version_id;
  IF FOUND THEN
   IF execution.state IN ('ready','failed') THEN RAISE EXCEPTION 'GTFS request processing is already terminal' USING ERRCODE='55000'; END IF;
   IF execution.state<>'cancelled' THEN
    terminal:=public.cancel_gtfs_ingest(p_workspace,submission.version_id,p_command,p_actor,p_reason);
   END IF;
  END IF;
 END IF;
 at_time:=clock_timestamp();
 result:=jsonb_build_object('command',p_command,'requestId',p_request,'workspaceId',p_workspace,'state','cancelled',
  'versionId',submission.version_id,'cancelledAt',at_time,'versionCancellation',terminal);
 INSERT INTO openplan_gtfs.request_cancellations(request_id,workspace_id,actor_id,command_id,payload_hash,response)
 VALUES(p_request,p_workspace,p_actor,p_command,hash,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cancel_gtfs_submission(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_gtfs_submission(uuid,uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.read_gtfs_submission_cancellation(p_workspace uuid,p_request uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GTFS cancellation read access is unavailable' USING ERRCODE='42501'; END IF;
 SELECT response INTO result FROM openplan_gtfs.request_cancellations WHERE request_id=p_request AND workspace_id=p_workspace;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_gtfs_submission_cancellation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_gtfs_submission_cancellation(uuid,uuid,uuid) TO service_role;

COMMIT;
