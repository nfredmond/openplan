-- Prototype only: output-bearing runs require attempt-aware output readers first.
CREATE TABLE public.model_run_relaunch_receipts (
  request_id uuid PRIMARY KEY,
  request_payload jsonb NOT NULL,
  response_payload jsonb NOT NULL,
  prior_run jsonb NOT NULL,
  prior_stages jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_run_relaunch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_run_relaunch_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.relaunch_model_run_attempts(
  p_request_id uuid, p_run_id uuid, p_workspace_id uuid,
  p_expected_updated_at timestamptz, p_input_snapshot jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_run public.model_runs%ROWTYPE;
  v_receipt public.model_run_relaunch_receipts%ROWTYPE;
  v_request jsonb;
  v_response jsonb;
  v_prior_run jsonb;
  v_prior_stages jsonb;
BEGIN
  IF p_request_id IS NULL OR p_run_id IS NULL OR p_workspace_id IS NULL
      OR p_expected_updated_at IS NULL OR p_input_snapshot IS NULL
      OR jsonb_typeof(p_input_snapshot)<>'object' THEN
    RAISE EXCEPTION 'Invalid model relaunch request';
  END IF;
  v_request := jsonb_build_object('run_id',p_run_id,'workspace_id',p_workspace_id,
    'expected_updated_at',p_expected_updated_at,'input_snapshot',p_input_snapshot);
  PERFORM pg_advisory_xact_lock(hashtextextended('model-run-relaunch:'||p_request_id::text,0));
  SELECT * INTO v_receipt FROM public.model_run_relaunch_receipts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_receipt.request_payload IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Model relaunch request identity reused with different payload';
    END IF;
    RETURN v_receipt.response_payload;
  END IF;
  SELECT * INTO v_run FROM public.model_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'Model relaunch scope mismatch';
  END IF;
  IF v_run.status NOT IN ('failed','cancelled') OR v_run.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Model relaunch state changed';
  END IF;
  PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=p_run_id) THEN
    RAISE EXCEPTION 'Model relaunch requires an existing stage set';
  END IF;
  IF EXISTS(SELECT 1 FROM public.model_run_artifacts WHERE run_id=p_run_id)
      OR EXISTS(SELECT 1 FROM public.model_run_kpis WHERE run_id=p_run_id)
      OR EXISTS(SELECT 1 FROM public.modeling_claim_decisions WHERE model_run_id=p_run_id)
      OR EXISTS(SELECT 1 FROM public.modeling_validation_results WHERE model_run_id=p_run_id) THEN
    RAISE EXCEPTION 'Model relaunch requires attempt-aware output retention';
  END IF;
  v_prior_run := to_jsonb(v_run);
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.id) INTO v_prior_stages
    FROM public.model_run_stages s WHERE s.run_id=p_run_id;
  INSERT INTO public.model_stage_write_context(transaction_id,stage_id,attempt_id)
    SELECT txid_current(),id,NULL FROM public.model_run_stages WHERE run_id=p_run_id;
  UPDATE public.model_stage_attempts a SET revoked_at=coalesce(a.revoked_at,clock_timestamp()),
    revocation_reason=coalesce(a.revocation_reason,'Model run relaunched')
    FROM public.model_run_stages s WHERE s.run_id=p_run_id AND s.active_attempt_id=a.id;
  UPDATE public.model_run_stages SET attempt_managed=true,active_attempt_id=NULL,status='queued',
    error_message=NULL,log_tail=NULL,started_at=NULL,completed_at=NULL WHERE run_id=p_run_id;
  DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current()
    AND stage_id IN(SELECT id FROM public.model_run_stages WHERE run_id=p_run_id);
  INSERT INTO public.model_run_write_context VALUES(txid_current(),p_run_id);
  UPDATE public.model_runs SET attempt_managed=true,status='queued',input_snapshot_json=p_input_snapshot,
    result_summary_json='{}'::jsonb,source_analysis_run_id=NULL,started_at=NULL,completed_at=NULL,error_message=NULL,
    failure_count=failure_count+CASE WHEN v_run.status='failed' THEN 1 ELSE 0 END,
    last_failure_message=CASE WHEN v_run.status='failed' THEN v_run.error_message ELSE last_failure_message END
    WHERE id=p_run_id RETURNING * INTO v_run;
  DELETE FROM public.model_run_write_context WHERE transaction_id=txid_current() AND run_id=p_run_id;
  v_response := jsonb_build_object('request_id',p_request_id,'run_id',p_run_id,'status',v_run.status);
  INSERT INTO public.model_run_relaunch_receipts VALUES(p_request_id,v_request,v_response,v_prior_run,v_prior_stages,clock_timestamp());
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.relaunch_model_run_attempts(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.relaunch_model_run_attempts(uuid,uuid,uuid,timestamptz,jsonb) TO service_role;
