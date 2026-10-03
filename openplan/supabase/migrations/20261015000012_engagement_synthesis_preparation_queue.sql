-- Preparation has an explicit queue. Historical requests are not implicitly jobs.
-- These commands never authorize provider execution, charges or publication.
CREATE TABLE public.engagement_synthesis_preparation_jobs (
 request_id uuid PRIMARY KEY REFERENCES public.engagement_synthesis_generation_requests(id),
 stage text NOT NULL CHECK(stage IN ('segment','context','thematic')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','failed','cancelled','prepared')),
 attempts bigint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 9007199254740991),
 lease_token uuid UNIQUE,
 lease_until timestamptz,
 failure_code text CHECK(failure_code IN ('access_unavailable','input_unavailable','preparation_failed')),
 seal_sha256 text CHECK(seal_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='running')=(lease_until IS NOT NULL)),
 CHECK(status<>'running' OR lease_token IS NOT NULL),
 CHECK((status='failed')=(failure_code IS NOT NULL)),
 CHECK((status='prepared')=(seal_sha256 IS NOT NULL))
);
CREATE INDEX synthesis_preparation_pending ON public.engagement_synthesis_preparation_jobs(status,created_at,request_id);
-- A token is never rebound after lease expiry or reassignment. Lost claim replies
-- can be inspected without claiming another job or reviving an obsolete lease.
CREATE TABLE public.engagement_synthesis_preparation_attempts (
 token uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES public.engagement_synthesis_preparation_jobs(request_id),
 attempt bigint NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
 claimed_at timestamptz NOT NULL,
 initial_lease_until timestamptz NOT NULL,
 UNIQUE(request_id,attempt),
 CHECK(initial_lease_until>claimed_at)
);
ALTER TABLE public.engagement_synthesis_preparation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_synthesis_preparation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_preparation_jobs,public.engagement_synthesis_preparation_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_preparation_jobs,public.engagement_synthesis_preparation_attempts TO service_role;
CREATE TRIGGER synthesis_preparation_attempt_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_preparation_attempts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.synthesis_preparation_job_state(p_request uuid,p_worker boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('schemaVersion',1,'requestId',j.request_id,'campaignId',r.campaign_id,'workspaceId',r.workspace_id,
  'actorId',r.actor_id,'intentSha256',r.intent_sha256,'stage',j.stage,'status',j.status,'attempts',j.attempts,
  'leaseUntil',j.lease_until,'failureCode',j.failure_code,'sealSha256',j.seal_sha256,
  'cancelled',EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations c WHERE c.request_id=j.request_id),
  'createdAt',j.created_at,'updatedAt',j.updated_at)
  || CASE WHEN p_worker THEN jsonb_build_object('leaseToken',j.lease_token) ELSE '{}'::jsonb END
 FROM engagement_synthesis_preparation_jobs j JOIN engagement_synthesis_generation_requests r ON r.id=j.request_id
 WHERE j.request_id=p_request;
$$;
REVOKE ALL ON FUNCTION public.synthesis_preparation_job_state(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_preparation(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_requests WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace) THEN
  RAISE EXCEPTION 'Preparation request not accessible' USING ERRCODE='42501';
 END IF;
 RETURN synthesis_preparation_job_state(p_request);
END $$;

CREATE FUNCTION public.enqueue_engagement_synthesis_preparation(p_campaign uuid,p_request uuid,p_stage text,p_intent_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; saved public.engagement_synthesis_generation_requests; actual_stage text; existed boolean;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace;
 IF saved.id IS NULL OR saved.actor_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Original requester access required' USING ERRCODE='42501';
 END IF;
 actual_stage:=CASE WHEN EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=p_request) THEN 'thematic'
  WHEN EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=p_request) THEN 'context' ELSE 'segment' END;
 IF p_stage IS DISTINCT FROM actual_stage OR p_intent_sha256 IS DISTINCT FROM saved.intent_sha256 THEN
  RAISE EXCEPTION 'Preparation intent differs' USING ERRCODE='PT409';
 END IF;
 existed:=EXISTS(SELECT 1 FROM engagement_synthesis_preparation_jobs WHERE request_id=p_request);
 IF NOT existed THEN
  IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
   RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409';
  END IF;
  INSERT INTO engagement_synthesis_preparation_jobs(request_id,stage) VALUES(p_request,actual_stage);
 END IF;
 RETURN synthesis_preparation_job_state(p_request)||jsonb_build_object('replayed',existed);
END $$;

CREATE FUNCTION public.retry_engagement_synthesis_preparation(p_campaign uuid,p_request uuid,p_attempt bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; saved public.engagement_synthesis_preparation_jobs;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_requests WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace AND actor_id=auth.uid()) THEN
  RAISE EXCEPTION 'Original requester access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO saved FROM engagement_synthesis_preparation_jobs WHERE request_id=p_request FOR UPDATE;
 IF saved.request_id IS NULL OR p_attempt IS NULL OR p_attempt<0 OR p_attempt>saved.attempts THEN
  RAISE EXCEPTION 'Preparation attempt differs' USING ERRCODE='PT409';
 END IF;
 -- Replaying an earlier retry can inspect progress but cannot requeue a later failure.
 IF saved.status='failed' AND saved.attempts=p_attempt THEN
  IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
   RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409';
  END IF;
  UPDATE engagement_synthesis_preparation_jobs SET status='queued',failure_code=NULL,updated_at=clock_timestamp() WHERE request_id=p_request;
 END IF;
 RETURN synthesis_preparation_job_state(p_request);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_preparation(uuid,uuid),public.enqueue_engagement_synthesis_preparation(uuid,uuid,text,text),public.retry_engagement_synthesis_preparation(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_preparation(uuid,uuid),public.enqueue_engagement_synthesis_preparation(uuid,uuid,text,text),public.retry_engagement_synthesis_preparation(uuid,uuid,bigint) TO authenticated;

-- This stage-neutral worker fence protects queue bookkeeping. Actual preparation
-- still uses each stage's existing source/parent/permission verification commands.
CREATE FUNCTION public.lock_synthesis_preparation_worker_scope(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.engagement_synthesis_generation_requests;
BEGIN
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF saved.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=saved.workspace_id
  AND user_id=saved.actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Retained requester staff access required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=saved.campaign_id AND workspace_id=saved.workspace_id FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Retained request campaign differs' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||p_request::text,0)) THEN
  RAISE EXCEPTION 'Preparation request is busy' USING ERRCODE='PT503';
 END IF;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Preparation request is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_preparation_worker_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_engagement_synthesis_preparation(p_request uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.engagement_synthesis_preparation_jobs; attempt public.engagement_synthesis_preparation_attempts; at_time timestamptz;
BEGIN
 IF p_request IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'Claim identity required' USING ERRCODE='22023'; END IF;
 BEGIN
  PERFORM lock_synthesis_preparation_worker_scope(p_request);
 EXCEPTION WHEN insufficient_privilege THEN
  UPDATE engagement_synthesis_preparation_jobs SET status='failed',failure_code='access_unavailable',lease_until=NULL,updated_at=clock_timestamp()
   WHERE request_id=p_request AND (status='queued' OR (status='running' AND lease_until<=clock_timestamp()));
  RETURN NULL;
 END;
 SELECT * INTO job FROM engagement_synthesis_preparation_jobs WHERE request_id=p_request FOR UPDATE;
 IF job.request_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO attempt FROM engagement_synthesis_preparation_attempts WHERE token=p_token;
 IF attempt.token IS NOT NULL THEN
  IF attempt.request_id IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Claim token is already bound' USING ERRCODE='PT409'; END IF;
  RETURN synthesis_preparation_job_state(p_request,true)||jsonb_build_object('claim',to_jsonb(attempt),'active',
   job.status='running' AND job.lease_token=p_token AND job.lease_until>clock_timestamp()
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request));
 END IF;
 IF job.status<>'queued' AND NOT(job.status='running' AND job.lease_until<=clock_timestamp()) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
  UPDATE engagement_synthesis_preparation_jobs SET status='cancelled',lease_until=NULL,failure_code=NULL,updated_at=clock_timestamp() WHERE request_id=p_request;
  RETURN NULL;
 END IF;
 at_time:=clock_timestamp();
 INSERT INTO engagement_synthesis_preparation_attempts(token,request_id,attempt,claimed_at,initial_lease_until)
  VALUES(p_token,p_request,job.attempts+1,at_time,at_time+interval '2 minutes') RETURNING * INTO attempt;
 UPDATE engagement_synthesis_preparation_jobs SET status='running',attempts=attempt.attempt,lease_token=p_token,
  lease_until=attempt.initial_lease_until,failure_code=NULL,updated_at=at_time WHERE request_id=p_request;
 RETURN synthesis_preparation_job_state(p_request,true)||jsonb_build_object('claim',to_jsonb(attempt),'active',true);
END $$;

CREATE FUNCTION public.renew_engagement_synthesis_preparation(p_request uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM lock_synthesis_preparation_worker_scope(p_request);
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409'; END IF;
 UPDATE engagement_synthesis_preparation_jobs SET lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
  WHERE request_id=p_request AND status='running' AND lease_token=p_token AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Preparation lease is not active' USING ERRCODE='PT409'; END IF;
 RETURN synthesis_preparation_job_state(p_request,true);
END $$;

CREATE FUNCTION public.finish_engagement_synthesis_preparation(p_request uuid,p_token uuid,p_seal_sha256 text,p_failure_code text)
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
 IF job.status<>'running' OR job.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Preparation lease is not active' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN RAISE EXCEPTION 'Synthesis request was cancelled' USING ERRCODE='PT409'; END IF;
 IF p_seal_sha256 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request AND receipt_sha256=p_seal_sha256) THEN
  RAISE EXCEPTION 'Preparation seal differs' USING ERRCODE='PT409';
 END IF;
 UPDATE engagement_synthesis_preparation_jobs SET status=CASE WHEN p_seal_sha256 IS NULL THEN 'failed' ELSE 'prepared' END,
  seal_sha256=p_seal_sha256,failure_code=p_failure_code,lease_until=NULL,updated_at=clock_timestamp() WHERE request_id=p_request;
 RETURN synthesis_preparation_job_state(p_request,true);
END $$;
REVOKE ALL ON FUNCTION public.claim_engagement_synthesis_preparation(uuid,uuid),public.renew_engagement_synthesis_preparation(uuid,uuid),public.finish_engagement_synthesis_preparation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_engagement_synthesis_preparation(uuid,uuid),public.renew_engagement_synthesis_preparation(uuid,uuid),public.finish_engagement_synthesis_preparation(uuid,uuid,text,text) TO service_role;
