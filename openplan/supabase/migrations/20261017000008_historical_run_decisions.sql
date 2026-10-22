-- Explicit owner/administrator decisions for model runs enrolled as historical.
-- A decision appends a receipt only. It never changes the run, its stages or its
-- outputs, never lifts the historical write fence, never resumes execution and
-- never validates results. "Closed" means a planner starts a new run instead.
BEGIN;

CREATE FUNCTION public.record_historical_model_run_decision(
 p_request_id uuid,p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,p_expected_state jsonb,p_outcome text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.model_runs%ROWTYPE; saved public.model_run_recovery_receipts%ROWTYPE;
 request jsonb; response jsonb; stages jsonb; attempts jsonb; provenance text;
BEGIN
 IF p_request_id IS NULL OR p_workspace_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
  OR p_expected_state IS NULL OR jsonb_typeof(p_expected_state)<>'object'
  OR p_outcome IS NULL OR p_outcome NOT IN('kept_as_record','closed_for_fresh_run')
  OR p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>2000 THEN
  RAISE EXCEPTION 'Invalid historical model run decision';
 END IF;
 request:=jsonb_build_object('workspace_id',p_workspace_id,'run_id',p_run_id,'actor_id',p_actor_id,
  'expected_state',p_expected_state,'outcome',p_outcome,'reason',p_reason);
 -- Shares the receipt key space with abandonment, so one request identity names one decision.
 PERFORM pg_advisory_xact_lock(hashtextextended('model-run-recovery:'||p_request_id::text,0));
 -- A row lock serializes decisions on one run without firing update guards.
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'Model recovery scope mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Model recovery requires an owner or administrator' USING ERRCODE='42501';
 END IF;
 SELECT * INTO saved FROM public.model_run_recovery_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Model recovery request identity reused with different payload'; END IF;
  RETURN saved.response_payload;
 END IF;
 SELECT e.provenance INTO provenance FROM public.model_execution_custody_enrollment e WHERE e.run_id=p_run_id;
 IF provenance IS DISTINCT FROM 'historical_unassessed' OR parent.engine_key NOT IN('aequilibrae','behavioral_demand') THEN
  RAISE EXCEPTION 'Historical model run decision requires historical enrollment';
 END IF;
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR SHARE;
 IF p_expected_state IS DISTINCT FROM public.model_recovery_expected_state(p_run_id) THEN
  RAISE EXCEPTION 'Model recovery state changed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.model_run_recovery_receipts WHERE run_id=p_run_id
   AND response_payload->>'outcome' IN('kept_as_record','closed_for_fresh_run')) THEN
  RAISE EXCEPTION 'Historical model run decision already recorded';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) INTO stages FROM public.model_run_stages s WHERE run_id=p_run_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO attempts FROM public.model_stage_attempts a WHERE run_id=p_run_id;
 response:=jsonb_build_object('request_id',p_request_id,'workspace_id',p_workspace_id,'run_id',p_run_id,'actor_id',p_actor_id,
  'outcome',p_outcome,'run_status',parent.status,'request_payload',request,'run_record_changed',false,
  'process_termination_verified',false,'continuation_authorized',false,'model_resumed',false);
 INSERT INTO public.model_run_recovery_receipts(request_id,run_id,workspace_id,actor_id,request_payload,response_payload,prior_run,prior_stages,prior_attempts)
  VALUES(p_request_id,p_run_id,p_workspace_id,p_actor_id,request,response,to_jsonb(parent),stages,attempts);
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.record_historical_model_run_decision(uuid,uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_historical_model_run_decision(uuid,uuid,uuid,uuid,jsonb,text,text) TO service_role;

-- Read recovery enrollment and the latest historical decision without treating
-- either as current ownership. Abandonment receipts are not historical decisions.
CREATE OR REPLACE FUNCTION public.inspect_model_recovery_status(p_workspace uuid, p_run uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
   'workspace_id', r.workspace_id,
   'run_id', r.id,
   'provenance', e.provenance,
   'enrolled_at', e.observed_at,
   'observed_starts', (SELECT count(*) FROM public.model_stage_execution_starts s WHERE s.run_id=r.id),
   'last_start_observed_at', (SELECT max(s.observed_at) FROM public.model_stage_execution_starts s WHERE s.run_id=r.id),
   'historical_decision', (SELECT jsonb_build_object('request_id', d.request_id, 'outcome', d.response_payload->>'outcome',
       'actor_id', d.actor_id, 'reason', d.request_payload->>'reason', 'recorded_at', d.recorded_at)
     FROM public.model_run_recovery_receipts d
     WHERE d.run_id=r.id AND d.workspace_id=r.workspace_id
       AND d.response_payload->>'outcome' IN('kept_as_record','closed_for_fresh_run')
     ORDER BY d.recorded_at DESC, d.request_id DESC LIMIT 1)
 )
 FROM public.model_runs r
 JOIN public.model_execution_custody_enrollment e ON e.run_id=r.id
 WHERE r.id=p_run AND r.workspace_id=p_workspace;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_recovery_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_recovery_status(uuid,uuid) TO service_role;

COMMIT;
