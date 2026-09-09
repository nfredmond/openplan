-- Durable execution binds the human request and commits its result with the job atomically.
CREATE TABLE public.contract_calculation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL, command jsonb NOT NULL, source_hash text,
 kind text NOT NULL CHECK(kind IN ('forecast','response','closeout','accounting_import')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, result jsonb, failure_detail text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(engagement_id,request_id)
);
ALTER TABLE public.contract_calculation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_calculation_jobs FROM PUBLIC,anon,authenticated,service_role;
-- Original payroll files and calculation payloads are available only inside service functions.
CREATE FUNCTION public.contract_calculation_job_visible(p_engagement uuid,p_actor uuid,p_kind text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(public.contract_actor_role(p_engagement,p_actor) IN ('owner','admin','finance') OR (p_kind IN ('forecast','response') AND public.contract_actor_role(p_engagement,p_actor)='pm'),false)
$$;
REVOKE ALL ON FUNCTION public.contract_calculation_job_visible(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contract_calculation_job_visible(uuid,uuid,text) TO authenticated,service_role;
CREATE POLICY scoped_job_read ON public.contract_calculation_jobs FOR SELECT TO authenticated USING(public.contract_calculation_job_visible(engagement_id,auth.uid(),kind));
GRANT SELECT(id,engagement_id,workspace_id,actor_id,request_id,kind,status,attempts,created_at,updated_at,failure_detail) ON public.contract_calculation_jobs TO authenticated;
CREATE FUNCTION public.enqueue_contract_calculation(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; j public.contract_calculation_jobs; k text:=p_command->>'kind'; expected_hash text; req uuid:=(p_command->>'requestId')::uuid;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF e.id IS NULL OR NOT public.contract_calculation_job_visible(e.id,p_actor_id,k) THEN RAISE EXCEPTION 'Calculation access denied' USING ERRCODE='42501'; END IF;
 IF k IS NULL OR k NOT IN ('forecast','response','closeout','accounting_import') OR req IS NULL OR p_command ? '_request' THEN RAISE EXCEPTION 'Invalid calculation request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 SELECT * INTO j FROM public.contract_calculation_jobs WHERE engagement_id=e.id AND request_id=req FOR UPDATE;
 IF j.id IS NOT NULL THEN
  IF j.actor_id<>p_actor_id OR j.command<>p_command THEN RAISE EXCEPTION 'Calculation retry changed the original request' USING ERRCODE='PT409'; END IF;
 ELSE
  IF k IN ('forecast','response') THEN expected_hash:=public.contract_delivery_hash(e.workspace_id); END IF;
  IF k='closeout' THEN expected_hash:=public.contract_closeout_hash(e.id); END IF;
  IF k IN ('forecast','closeout') AND p_command->>'expectedInputHash' IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'Inputs changed since browser review' USING ERRCODE='PT409'; END IF;
  IF k='response' AND NOT EXISTS(SELECT 1 FROM public.contract_forecasts WHERE id=(p_command->>'forecastId')::uuid AND engagement_id=e.id AND input_hash=expected_hash) THEN RAISE EXCEPTION 'Response forecast is stale' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.contract_calculation_jobs(engagement_id,workspace_id,actor_id,request_id,kind,command,source_hash) VALUES(e.id,e.workspace_id,p_actor_id,req,k,p_command,expected_hash) RETURNING * INTO j;
 END IF;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status);
END $$;
CREATE FUNCTION public.read_contract_calculations(p_engagement_id uuid,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF public.contract_actor_role(p_engagement_id,p_actor_id) NOT IN ('owner','admin','pm','finance') OR public.contract_actor_role(p_engagement_id,p_actor_id) IS NULL THEN RAISE EXCEPTION 'Calculation access denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'status',status,'attempts',attempts,'created_at',created_at,'updated_at',updated_at,'failure_detail',failure_detail) ORDER BY created_at DESC) FROM public.contract_calculation_jobs WHERE engagement_id=p_engagement_id AND public.contract_calculation_job_visible(engagement_id,p_actor_id,kind)),'[]');
END $$;
CREATE FUNCTION public.claim_contract_calculation(p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.contract_calculation_jobs;
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'Lease identity is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.contract_calculation_jobs WHERE status='queued' OR (status='running' AND lease_until<=clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.contract_calculation_jobs SET status='running',attempts=attempts+1,lease_token=p_token,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp(),failure_detail=NULL WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;
CREATE FUNCTION public.renew_contract_calculation(p_job uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.contract_calculation_jobs SET lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE id=p_job AND status='running' AND lease_token=p_token AND lease_until>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.finish_contract_calculation(p_job uuid,p_token uuid,p_normalized jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.contract_calculation_jobs; saved_result jsonb; current_hash text;
BEGIN
 SELECT * INTO j FROM public.contract_calculation_jobs WHERE id=p_job;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.workspace_id::text,451));
 SELECT * INTO j FROM public.contract_calculation_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.status<>'running' OR p_token IS NULL OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Calculation lease expired' USING ERRCODE='PT409'; END IF;
 IF NOT public.contract_calculation_job_visible(j.engagement_id,j.actor_id,j.kind) THEN RAISE EXCEPTION 'Calculation requester access revoked' USING ERRCODE='42501'; END IF;
 IF p_normalized->'_request' IS DISTINCT FROM j.command THEN RAISE EXCEPTION 'Calculated request differs from the reviewed request' USING ERRCODE='PT409'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.workspace_id::text,451));
 IF j.kind IN ('forecast','response') THEN current_hash:=public.contract_delivery_hash(j.workspace_id); END IF;
 IF j.kind='closeout' THEN current_hash:=public.contract_closeout_hash(j.engagement_id); END IF;
 IF j.source_hash IS DISTINCT FROM current_hash OR (j.source_hash IS NOT NULL AND p_normalized->>'_inputHash' IS DISTINCT FROM j.source_hash) THEN RAISE EXCEPTION 'Queued inputs changed; a new review is required' USING ERRCODE='PT409'; END IF;
 saved_result:=public.record_contract_command(j.engagement_id,j.actor_id,CASE WHEN j.kind='accounting_import' THEN p_normalized-'_request' ELSE p_normalized END);
 UPDATE public.contract_calculation_jobs SET status='succeeded',result=saved_result,lease_until=NULL,updated_at=clock_timestamp() WHERE id=j.id;
 RETURN saved_result;
END $$;
CREATE FUNCTION public.fail_contract_calculation(p_job uuid,p_token uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.contract_calculation_jobs SET status='failed',lease_until=NULL,updated_at=clock_timestamp(),failure_detail='Calculation did not complete. Retry the original request after checking access and source versions; changed inputs require a new review.' WHERE id=p_job AND status='running' AND lease_token=p_token AND lease_until>clock_timestamp();
END $$;
CREATE FUNCTION public.retry_contract_calculation(p_job uuid,p_engagement_id uuid,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.contract_calculation_jobs;
BEGIN
 SELECT * INTO j FROM public.contract_calculation_jobs WHERE id=p_job AND engagement_id=p_engagement_id FOR UPDATE;
 IF j.id IS NULL OR j.actor_id<>p_actor_id OR NOT public.contract_calculation_job_visible(j.engagement_id,p_actor_id,j.kind) THEN RAISE EXCEPTION 'Only the authorized requester can retry this calculation' USING ERRCODE='42501'; END IF;
 IF j.status='failed' THEN UPDATE public.contract_calculation_jobs SET status='queued',lease_token=NULL,lease_until=NULL,failure_detail=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j; END IF;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status);
END $$;
REVOKE ALL ON FUNCTION public.enqueue_contract_calculation(uuid,uuid,jsonb),public.read_contract_calculations(uuid,uuid),public.claim_contract_calculation(uuid),public.renew_contract_calculation(uuid,uuid),public.finish_contract_calculation(uuid,uuid,jsonb),public.fail_contract_calculation(uuid,uuid),public.retry_contract_calculation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_contract_calculation(uuid,uuid,jsonb),public.read_contract_calculations(uuid,uuid),public.claim_contract_calculation(uuid),public.renew_contract_calculation(uuid,uuid),public.finish_contract_calculation(uuid,uuid,jsonb),public.fail_contract_calculation(uuid,uuid),public.retry_contract_calculation(uuid,uuid,uuid) TO service_role;
