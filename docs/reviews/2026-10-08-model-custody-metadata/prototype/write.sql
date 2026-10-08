-- Load after claim.sql inside the same rollback-only transaction.
CREATE TABLE public.model_stage_write_receipts (
  request_id uuid PRIMARY KEY,
  request_payload jsonb NOT NULL,
  response_payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_stage_write_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_write_receipts FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.write_model_stage_attempt(
  p_request_id uuid, p_attempt_id uuid, p_status text, p_log_tail text, p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request jsonb;
  v_receipt public.model_stage_write_receipts%ROWTYPE;
  v_attempt public.model_stage_attempts%ROWTYPE;
  v_stage public.model_run_stages%ROWTYPE;
  v_run public.model_runs%ROWTYPE;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR p_attempt_id IS NULL OR p_status IS NULL
      OR p_status NOT IN ('running','succeeded','failed')
      OR length(p_log_tail) > 20000 OR length(p_error) > 2000
      OR (p_status <> 'failed' AND p_error IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid model stage write request';
  END IF;
  v_request := jsonb_build_object('attempt_id',p_attempt_id,'status',p_status,'log_tail',p_log_tail,'error',p_error);
  PERFORM pg_advisory_xact_lock(hashtextextended('model-stage-write:' || p_request_id::text,0));
  SELECT * INTO v_receipt FROM public.model_stage_write_receipts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_receipt.request_payload IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Model stage write request identity reused with different payload';
    END IF;
    RETURN v_receipt.response_payload;
  END IF;
  SELECT * INTO v_attempt FROM public.model_stage_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Model stage attempt not found'; END IF;
  SELECT * INTO v_run FROM public.model_runs WHERE id=v_attempt.run_id FOR UPDATE;
  SELECT * INTO v_stage FROM public.model_run_stages WHERE id=v_attempt.stage_id FOR UPDATE;
  IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.run_id IS DISTINCT FROM v_run.id
      OR v_stage.status <> 'running' OR v_run.status NOT IN ('queued','running') THEN
    RAISE EXCEPTION 'Model stage attempt no longer owns work';
  END IF;
  INSERT INTO public.model_stage_write_context VALUES(txid_current(),v_stage.id,p_attempt_id);
  UPDATE public.model_run_stages SET status=p_status, log_tail=p_log_tail, error_message=p_error,
    completed_at=CASE WHEN p_status='running' THEN NULL ELSE clock_timestamp() END
    WHERE id=v_stage.id RETURNING * INTO v_stage;
  DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current() AND stage_id=v_stage.id;
  -- The parent lock serializes lifecycle commands. Lock the retained stage set
  -- before deciding whether this successful stage completes the run.
  IF p_status='succeeded' THEN
    PERFORM id FROM public.model_run_stages WHERE run_id=v_run.id ORDER BY id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.model_run_stages WHERE run_id=v_run.id AND status <> 'succeeded') THEN
      INSERT INTO public.model_run_write_context VALUES(txid_current(),v_run.id);
      UPDATE public.model_runs SET status='succeeded',completed_at=clock_timestamp(),error_message=NULL
        WHERE id=v_run.id RETURNING * INTO v_run;
      DELETE FROM public.model_run_write_context WHERE transaction_id=txid_current() AND run_id=v_run.id;
    END IF;
  END IF;
  v_response := jsonb_build_object('stage_id',v_stage.id,'attempt_id',p_attempt_id,
    'status',v_stage.status,'completed_at',v_stage.completed_at,'request_id',p_request_id,
    'run_status',v_run.status,'run_completed_at',v_run.completed_at);
  INSERT INTO public.model_stage_write_receipts(request_id,request_payload,response_payload)
    VALUES(p_request_id,v_request,v_response);
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.write_model_stage_attempt(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_model_stage_attempt(uuid,uuid,text,text,text) TO service_role;
