-- Transaction-only prototype. Not an application migration or deployable fence.
-- The runner must BEGIN before loading this file and ROLLBACK afterward.
CREATE TABLE public.model_stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.model_run_stages(id),
  run_id uuid NOT NULL REFERENCES public.model_runs(id),
  worker_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(stage_id, id)
);
CREATE TABLE public.model_stage_claim_receipts (
  request_id uuid PRIMARY KEY,
  request_payload jsonb NOT NULL,
  response_payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_run_stages ADD COLUMN active_attempt_id uuid;
ALTER TABLE public.model_run_stages ADD CONSTRAINT model_stage_active_attempt_identity
  FOREIGN KEY(id, active_attempt_id) REFERENCES public.model_stage_attempts(stage_id, id);
ALTER TABLE public.model_stage_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_stage_claim_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_attempts, public.model_stage_claim_receipts FROM PUBLIC, anon, authenticated, service_role;

-- Only command functions can create this short-lived authorization row.
CREATE TABLE public.model_stage_write_context (
  transaction_id bigint NOT NULL,
  stage_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  PRIMARY KEY(transaction_id, stage_id)
);
ALTER TABLE public.model_stage_write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_write_context FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.guard_model_stage_attempt_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.active_attempt_id IS NOT NULL OR NEW.active_attempt_id IS NOT NULL THEN
    IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NOT EXISTS (
      SELECT 1 FROM public.model_stage_write_context c
      WHERE c.transaction_id = txid_current() AND c.stage_id = OLD.id
        AND c.attempt_id = NEW.active_attempt_id
    ) THEN RAISE EXCEPTION 'Managed model stage requires an attempt command'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_stage_attempt_write() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_model_stage_attempt_write BEFORE UPDATE ON public.model_run_stages
  FOR EACH ROW EXECUTE FUNCTION public.guard_model_stage_attempt_write();

CREATE FUNCTION public.claim_model_stage_attempt(p_request_id uuid, p_stage_id uuid, p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request jsonb;
  v_receipt public.model_stage_claim_receipts%ROWTYPE;
  v_stage public.model_run_stages%ROWTYPE;
  v_run public.model_runs%ROWTYPE;
  v_run_id uuid;
  v_attempt uuid;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR p_stage_id IS NULL OR p_worker_id IS NULL
      OR length(btrim(p_worker_id)) = 0 OR length(p_worker_id) > 200 THEN
    RAISE EXCEPTION 'Invalid model stage claim request';
  END IF;
  v_request := jsonb_build_object('stage_id', p_stage_id, 'worker_id', p_worker_id);
  -- Serialize a retried request before taking lifecycle locks. Hash collisions
  -- merely serialize unrelated requests; the UUID primary key binds identity.
  PERFORM pg_advisory_xact_lock(hashtextextended('model-stage-claim:' || p_request_id::text, 0));
  SELECT * INTO v_receipt FROM public.model_stage_claim_receipts WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_payload IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Model stage claim request identity reused with different payload';
    END IF;
    RETURN v_receipt.response_payload;
  END IF;
  SELECT run_id INTO v_run_id FROM public.model_run_stages WHERE id = p_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Model stage not found'; END IF;
  -- All future lifecycle commands must take parent then stage locks.
  SELECT * INTO v_run FROM public.model_runs WHERE id = v_run_id FOR UPDATE;
  SELECT * INTO v_stage FROM public.model_run_stages WHERE id = p_stage_id FOR UPDATE;
  IF NOT FOUND OR v_stage.run_id IS DISTINCT FROM v_run.id THEN
    RAISE EXCEPTION 'Model stage parent changed';
  END IF;
  IF v_run.status NOT IN ('queued', 'running') OR v_stage.status <> 'queued'
      OR v_stage.active_attempt_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.model_run_stages s WHERE s.run_id = v_run.id
                 AND s.sort_order < v_stage.sort_order AND s.status <> 'succeeded') THEN
    v_response := jsonb_build_object('outcome', 'not_claimed', 'request_id', p_request_id,
      'stage_id', p_stage_id, 'run_id', v_run.id, 'attempt_id', NULL);
  ELSE
    INSERT INTO public.model_stage_attempts(stage_id, run_id, worker_id)
      VALUES (p_stage_id, v_run.id, p_worker_id) RETURNING id INTO v_attempt;
    INSERT INTO public.model_stage_write_context VALUES (txid_current(), p_stage_id, v_attempt);
    UPDATE public.model_run_stages SET active_attempt_id = v_attempt, status = 'running',
      started_at = clock_timestamp(), completed_at = NULL, error_message = NULL
      WHERE id = p_stage_id;
    DELETE FROM public.model_stage_write_context WHERE transaction_id = txid_current() AND stage_id = p_stage_id;
    UPDATE public.model_runs SET status = 'running' WHERE id = v_run.id;
    v_response := jsonb_build_object('outcome', 'claimed', 'request_id', p_request_id,
      'stage_id', p_stage_id, 'run_id', v_run.id, 'attempt_id', v_attempt);
  END IF;
  INSERT INTO public.model_stage_claim_receipts(request_id, request_payload, response_payload)
    VALUES (p_request_id, v_request, v_response);
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_model_stage_attempt(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_model_stage_attempt(uuid,uuid,text) TO service_role;
