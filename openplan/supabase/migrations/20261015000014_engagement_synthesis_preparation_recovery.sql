-- Complete retained preparation outcomes after an interruption without renewing
-- execution authority. Keep the current token, staff scope and cancellation checks.
CREATE OR REPLACE FUNCTION public.finish_engagement_synthesis_preparation(p_request uuid,p_token uuid,p_seal_sha256 text,p_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.engagement_synthesis_preparation_jobs;
BEGIN
 PERFORM lock_synthesis_preparation_worker_scope(p_request);
 SELECT * INTO job FROM engagement_synthesis_preparation_jobs WHERE request_id=p_request FOR UPDATE;
 IF job.request_id IS NULL OR p_token IS NULL OR job.lease_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'Preparation lease differs' USING ERRCODE='PT409'; END IF;
 IF (p_seal_sha256 IS NULL)=(p_failure_code IS NULL) OR (p_failure_code IS NOT NULL AND p_failure_code NOT IN ('input_unavailable','preparation_failed')) THEN
  RAISE EXCEPTION 'Invalid preparation outcome' USING ERRCODE='22023';
 END IF;
 -- Exact outcome acknowledgement recovery is allowed after cancellation or expiry.
 IF job.status IN ('prepared','failed') THEN
  IF job.seal_sha256 IS DISTINCT FROM p_seal_sha256 OR job.failure_code IS DISTINCT FROM p_failure_code THEN RAISE EXCEPTION 'Preparation outcome differs' USING ERRCODE='PT409'; END IF;
  RETURN synthesis_preparation_job_state(p_request,true);
 END IF;
 -- Expiry permits another claim, but does not invalidate this retained outcome.
 -- The locked current token check above fences out every superseded attempt.
 IF job.status<>'running' THEN RAISE EXCEPTION 'Preparation lease is not active' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409'; END IF;
 IF p_seal_sha256 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request AND receipt_sha256=p_seal_sha256) THEN
  RAISE EXCEPTION 'Preparation seal differs' USING ERRCODE='PT409';
 END IF;
 UPDATE engagement_synthesis_preparation_jobs SET status=CASE WHEN p_seal_sha256 IS NULL THEN 'failed' ELSE 'prepared' END,
  seal_sha256=p_seal_sha256,failure_code=p_failure_code,lease_until=NULL,updated_at=clock_timestamp() WHERE request_id=p_request;
 RETURN synthesis_preparation_job_state(p_request,true);
END $$;
REVOKE ALL ON FUNCTION public.finish_engagement_synthesis_preparation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finish_engagement_synthesis_preparation(uuid,uuid,text,text) TO service_role;
