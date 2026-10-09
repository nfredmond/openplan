-- Prototype only. No application route or worker dispatch calls this command.
-- An operator may abandon execution without claiming that its processes stopped.
BEGIN;
CREATE TABLE public.model_run_recovery_receipts (
 request_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES public.model_runs(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_payload jsonb NOT NULL,
 response_payload jsonb NOT NULL,
 prior_run jsonb NOT NULL,
 prior_stages jsonb NOT NULL,
 prior_attempts jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_run_recovery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_run_recovery_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.refuse_model_recovery_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Model recovery receipt is immutable'; END;
$$;
REVOKE ALL ON FUNCTION public.refuse_model_recovery_receipt_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER refuse_model_recovery_receipt_mutation BEFORE UPDATE OR DELETE ON public.model_run_recovery_receipts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_recovery_receipt_mutation();

-- Callers lock the parent before using this private snapshot helper.
CREATE FUNCTION public.model_recovery_expected_state(p_run uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('run_id',r.id,'workspace_id',r.workspace_id,'status',r.status,'updated_at',r.updated_at,
  'attempt_managed',r.attempt_managed,'stages',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',s.id,'status',s.status,'updated_at',s.updated_at,'active_attempt_id',s.active_attempt_id,'attempt_managed',s.attempt_managed) ORDER BY s.id)
   FROM public.model_run_stages s WHERE s.run_id=r.id),'[]'::jsonb)) FROM public.model_runs r WHERE r.id=p_run;
$$;
REVOKE ALL ON FUNCTION public.model_recovery_expected_state(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.inspect_model_run_recovery(p_workspace_id uuid,p_run_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.model_runs%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run_id FOR SHARE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'Model recovery scope mismatch'; END IF;
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Model recovery requires an owner or administrator' USING ERRCODE='42501';
 END IF;
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR SHARE;
 RETURN jsonb_build_object('expected_state',public.model_recovery_expected_state(p_run_id),
  'process_termination_verified',false,'continuation_authorized',false,'model_resumed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_run_recovery(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_run_recovery(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.abandon_model_run_execution(
 p_request_id uuid,p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,p_expected_state jsonb,p_reason text,p_evidence jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.model_runs%ROWTYPE; saved public.model_run_recovery_receipts%ROWTYPE;
 request jsonb; response jsonb; stages jsonb; attempts jsonb;
BEGIN
 IF p_request_id IS NULL OR p_workspace_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
  OR p_expected_state IS NULL OR jsonb_typeof(p_expected_state)<>'object'
  OR p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>2000
  OR p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR octet_length(p_evidence::text)>65536 THEN
  RAISE EXCEPTION 'Invalid model recovery decision';
 END IF;
 request:=jsonb_build_object('workspace_id',p_workspace_id,'run_id',p_run_id,'actor_id',p_actor_id,
  'expected_state',p_expected_state,'reason',p_reason,'reported_evidence',p_evidence);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-run-recovery:'||p_request_id::text,0));
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
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
 IF p_expected_state IS DISTINCT FROM public.model_recovery_expected_state(p_run_id) THEN
  RAISE EXCEPTION 'Model recovery state changed';
 END IF;
 IF parent.status NOT IN('queued','running') THEN RAISE EXCEPTION 'Model recovery requires nonterminal work'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=p_run_id) THEN RAISE EXCEPTION 'Model recovery stage set missing'; END IF;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO stages FROM public.model_run_stages s WHERE run_id=p_run_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO attempts FROM public.model_stage_attempts a WHERE run_id=p_run_id;
 INSERT INTO public.model_stage_write_context(transaction_id,stage_id,attempt_id)
  SELECT txid_current(),id,NULL FROM public.model_run_stages WHERE run_id=p_run_id;
 UPDATE public.model_stage_attempts a SET revoked_at=coalesce(a.revoked_at,clock_timestamp()),
  revocation_reason=coalesce(a.revocation_reason,'Execution abandoned by recovery decision')
  FROM public.model_run_stages s WHERE s.run_id=p_run_id AND s.active_attempt_id=a.id;
 UPDATE public.model_run_stages SET attempt_managed=true,active_attempt_id=NULL,
  status=CASE WHEN status IN('queued','running') THEN 'cancelled' ELSE status END,
  completed_at=CASE WHEN status IN('queued','running') THEN clock_timestamp() ELSE completed_at END,
  error_message=CASE WHEN status IN('queued','running') THEN 'Execution abandoned after recovery review. Process termination is unconfirmed.' ELSE error_message END
  WHERE run_id=p_run_id;
 DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current() AND stage_id IN(SELECT id FROM public.model_run_stages WHERE run_id=p_run_id);
 INSERT INTO public.model_run_write_context VALUES(txid_current(),p_run_id);
 UPDATE public.model_runs SET attempt_managed=true,status='cancelled',completed_at=clock_timestamp(),
  error_message='Execution abandoned after recovery review. Process termination is unconfirmed.' WHERE id=p_run_id;
 DELETE FROM public.model_run_write_context WHERE transaction_id=txid_current() AND run_id=p_run_id;
 response:=jsonb_build_object('request_id',p_request_id,'workspace_id',p_workspace_id,'run_id',p_run_id,'actor_id',p_actor_id,
  'outcome','execution_abandoned','run_status','cancelled','process_termination_verified',false,
  'continuation_authorized',false,'model_resumed',false,'reported_evidence_verified',false);
 INSERT INTO public.model_run_recovery_receipts(request_id,run_id,workspace_id,actor_id,request_payload,response_payload,prior_run,prior_stages,prior_attempts)
  VALUES(p_request_id,p_run_id,p_workspace_id,p_actor_id,request,response,to_jsonb(parent),stages,attempts);
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.abandon_model_run_execution(uuid,uuid,uuid,uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_model_run_execution(uuid,uuid,uuid,uuid,jsonb,text,jsonb) TO service_role;
COMMIT;
