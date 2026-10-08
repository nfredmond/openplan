-- Replaces the existing function only within the prototype rollback transaction.
CREATE OR REPLACE FUNCTION public.reap_model_run_if_stale(
  p_run_id uuid, p_stale_before timestamptz, p_message text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run public.model_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL OR p_stale_before IS NULL OR p_message IS NULL OR length(p_message)>2000 THEN
    RAISE EXCEPTION 'Invalid model reaper request';
  END IF;
  SELECT * INTO v_run FROM public.model_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status NOT IN ('queued','running') OR v_run.updated_at>p_stale_before THEN
    RETURN false;
  END IF;
  PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.model_run_stages WHERE run_id=p_run_id AND updated_at>p_stale_before) THEN
    RETURN false;
  END IF;
  INSERT INTO public.model_stage_write_context(transaction_id,stage_id,attempt_id)
    SELECT txid_current(),id,NULL FROM public.model_run_stages WHERE run_id=p_run_id;
  UPDATE public.model_stage_attempts a SET revoked_at=clock_timestamp(),revocation_reason=p_message
    FROM public.model_run_stages s WHERE s.run_id=p_run_id AND s.active_attempt_id=a.id;
  UPDATE public.model_run_stages SET attempt_managed=(attempt_managed OR v_run.attempt_managed),active_attempt_id=NULL,
    status=CASE WHEN status IN ('queued','running') THEN 'failed' ELSE status END,
    error_message=CASE WHEN status IN ('queued','running') THEN p_message ELSE error_message END,
    completed_at=CASE WHEN status IN ('queued','running') THEN clock_timestamp() ELSE completed_at END
    WHERE run_id=p_run_id AND (v_run.attempt_managed OR status IN ('queued','running'));
  DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current()
    AND stage_id IN (SELECT id FROM public.model_run_stages WHERE run_id=p_run_id);
  INSERT INTO public.model_run_write_context VALUES (txid_current(), p_run_id);
  UPDATE public.model_runs SET attempt_managed=v_run.attempt_managed,status='failed',error_message=p_message,completed_at=clock_timestamp() WHERE id=p_run_id;
  DELETE FROM public.model_run_write_context WHERE transaction_id=txid_current() AND run_id=p_run_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.reap_model_run_if_stale(uuid,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reap_model_run_if_stale(uuid,timestamptz,text) TO service_role;
