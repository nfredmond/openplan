-- Retain scoped blocked-stage decisions without inventing execution.
-- Additive command support; normal worker dispatch is not activated here.
BEGIN;
CREATE TABLE public.model_stage_skip_receipts (
 request_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES public.model_runs(id),
 stage_id uuid NOT NULL REFERENCES public.model_run_stages(id),
 blocker_id uuid NOT NULL REFERENCES public.model_run_stages(id),
 request_payload jsonb NOT NULL,
 response_payload jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_stage_skip_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_skip_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.skip_blocked_model_stage(
 p_request_id uuid, p_workspace_id uuid, p_run_id uuid, p_stage_id uuid,
 p_blocker_id uuid, p_blocker_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 request jsonb; receipt public.model_stage_skip_receipts%ROWTYPE;
 parent public.model_runs%ROWTYPE; target public.model_run_stages%ROWTYPE;
 blocker public.model_run_stages%ROWTYPE; response jsonb; reason text;
BEGIN
 IF p_request_id IS NULL OR p_workspace_id IS NULL OR p_run_id IS NULL
 OR p_stage_id IS NULL OR p_blocker_id IS NULL OR p_blocker_status IS NULL
 OR p_blocker_status NOT IN ('failed','cancelled','skipped') THEN
  RAISE EXCEPTION 'Invalid blocked stage request';
 END IF;
 request:=jsonb_build_object('workspace_id',p_workspace_id,'run_id',p_run_id,
  'stage_id',p_stage_id,'blocker_id',p_blocker_id,'blocker_status',p_blocker_status);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-stage-skip:'||p_request_id::text,0));
 SELECT * INTO receipt FROM public.model_stage_skip_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.request_payload IS DISTINCT FROM request THEN
   RAISE EXCEPTION 'Blocked stage request identity reused with different payload';
  END IF;
  RETURN receipt.response_payload;
 END IF;
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Blocked stage scope mismatch'; END IF;
 -- Match the lifecycle lock order, including protection of the prerequisite.
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
 SELECT * INTO target FROM public.model_run_stages WHERE id=p_stage_id AND run_id=p_run_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Blocked stage scope mismatch'; END IF;
 SELECT * INTO blocker FROM public.model_run_stages WHERE id=p_blocker_id AND run_id=p_run_id;
 IF NOT FOUND OR blocker.sort_order>=target.sort_order THEN
  RAISE EXCEPTION 'Blocked stage predecessor mismatch';
 END IF;
 response:=jsonb_build_object('request_id',p_request_id,'workspace_id',p_workspace_id,
  'run_id',p_run_id,'stage_id',p_stage_id,'blocker_id',p_blocker_id,
  'observed_blocker_status',blocker.status,'outcome','not_skipped',
  'status',target.status,'completed_at',target.completed_at);
 IF target.status='queued' AND target.active_attempt_id IS NULL
 AND blocker.status=p_blocker_status AND parent.status<>'succeeded' THEN
  reason:=left(format('Blocked by prior stage %s (%s)',blocker.stage_name,blocker.status),2000);
  INSERT INTO public.model_stage_write_context VALUES(txid_current(),target.id,NULL);
  UPDATE public.model_run_stages SET status='skipped',error_message=reason,
   log_tail=reason,completed_at=clock_timestamp() WHERE id=target.id RETURNING * INTO target;
  DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current() AND stage_id=target.id;
  response:=response||jsonb_build_object('outcome','skipped','status',target.status,'completed_at',target.completed_at);
 END IF;
 INSERT INTO public.model_stage_skip_receipts(request_id,run_id,stage_id,blocker_id,request_payload,response_payload)
 VALUES(p_request_id,p_run_id,p_stage_id,p_blocker_id,request,response);
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.skip_blocked_model_stage(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.skip_blocked_model_stage(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

-- A decision receipt is immutable even when no stage was skipped.
CREATE FUNCTION public.refuse_model_stage_skip_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Model stage skip receipt is immutable' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_model_stage_skip_receipt_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER refuse_model_stage_skip_receipt_mutation
 BEFORE UPDATE OR DELETE ON public.model_stage_skip_receipts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_stage_skip_receipt_mutation();
CREATE INDEX model_stage_skip_receipts_run_idx ON public.model_stage_skip_receipts(run_id);
CREATE INDEX model_stage_skip_receipts_stage_idx ON public.model_stage_skip_receipts(stage_id);
CREATE INDEX model_stage_skip_receipts_blocker_idx ON public.model_stage_skip_receipts(blocker_id);

-- A successful skip changes the required stage history. A no-op receipt alone
-- is not execution and must not prevent a genuinely unstarted run progressing.
CREATE OR REPLACE FUNCTION public.model_run_has_retained_commands(p_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_assessment_command_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_stage_skip_receipts WHERE run_id=p_run AND response_payload->>'outcome'='skipped');
$$;
REVOKE ALL ON FUNCTION public.model_run_has_retained_commands(uuid) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
