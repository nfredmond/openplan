-- Additive model attempt command foundation. Existing rows remain unmanaged.
-- Workers and launch routes do not call these commands yet. Do not enroll runs
-- until the complete attempt-aware worker and consumer path is available.
-- Source proof: docs/reviews/2026-10-08-model-custody-metadata/prototype/README.md

-- claim.sql
CREATE TABLE public.model_stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.model_run_stages(id),
  run_id uuid NOT NULL REFERENCES public.model_runs(id),
  worker_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE(stage_id, id)
);
CREATE TABLE public.model_stage_claim_receipts (
  request_id uuid PRIMARY KEY,
  request_payload jsonb NOT NULL,
  response_payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_run_stages ADD COLUMN active_attempt_id uuid;
ALTER TABLE public.model_run_stages ADD COLUMN attempt_managed boolean NOT NULL DEFAULT false;
ALTER TABLE public.model_run_stages ADD CONSTRAINT model_stage_active_attempt_identity
  FOREIGN KEY(id, active_attempt_id) REFERENCES public.model_stage_attempts(stage_id, id);
ALTER TABLE public.model_stage_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_stage_claim_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_attempts, public.model_stage_claim_receipts FROM PUBLIC, anon, authenticated, service_role;

-- Only command functions can create this short-lived authorization row.
CREATE TABLE public.model_stage_write_context (
  transaction_id bigint NOT NULL,
  stage_id uuid NOT NULL,
  attempt_id uuid,
  PRIMARY KEY(transaction_id, stage_id)
);
ALTER TABLE public.model_stage_write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_write_context FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.guard_model_stage_attempt_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.attempt_managed OR NEW.attempt_managed THEN
    IF NOT NEW.attempt_managed OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NOT EXISTS (
      SELECT 1 FROM public.model_stage_write_context c
      WHERE c.transaction_id = txid_current() AND c.stage_id = OLD.id
        AND c.attempt_id IS NOT DISTINCT FROM NEW.active_attempt_id
    ) THEN RAISE EXCEPTION 'Managed model stage requires an attempt command'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_stage_attempt_write() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_model_stage_attempt_write BEFORE UPDATE ON public.model_run_stages
  FOR EACH ROW EXECUTE FUNCTION public.guard_model_stage_attempt_write();

-- Parent state belongs to the same command transaction as stage state.
ALTER TABLE public.model_runs ADD COLUMN attempt_managed boolean NOT NULL DEFAULT false;
CREATE TABLE public.model_run_write_context (
  transaction_id bigint NOT NULL,
  run_id uuid NOT NULL,
  PRIMARY KEY(transaction_id, run_id)
);
ALTER TABLE public.model_run_write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_run_write_context FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.guard_model_run_attempt_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.attempt_managed THEN
      RAISE EXCEPTION 'Managed model run deletion requires an explicit retention command';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.attempt_managed OR OLD.attempt_managed THEN
    IF NOT NEW.attempt_managed OR NEW.id IS DISTINCT FROM OLD.id OR NOT EXISTS (
      SELECT 1 FROM public.model_run_write_context c
      WHERE c.transaction_id = txid_current() AND c.run_id = OLD.id
    ) THEN RAISE EXCEPTION 'Managed model run requires an attempt command'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_run_attempt_write() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_model_run_attempt_write BEFORE UPDATE OR DELETE ON public.model_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_model_run_attempt_write();

-- Serialize changes to the required stage set with lifecycle commands.
CREATE FUNCTION public.guard_model_stage_set() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_run uuid;
  v_new_run uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_run := OLD.run_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_run := NEW.run_id; END IF;
  PERFORM id FROM public.model_runs WHERE id IN (v_old_run,v_new_run) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.model_runs WHERE id IN (v_old_run,v_new_run) AND attempt_managed) THEN
    IF TG_OP IN ('INSERT','DELETE') THEN
      RAISE EXCEPTION 'Managed model stage set is fixed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.sort_order IS DISTINCT FROM OLD.sort_order OR NEW.stage_name IS DISTINCT FROM OLD.stage_name THEN
      RAISE EXCEPTION 'Managed model stage set is fixed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c
        WHERE c.transaction_id=txid_current() AND c.stage_id=OLD.id
          AND c.attempt_id IS NOT DISTINCT FROM NEW.active_attempt_id) THEN
      RAISE EXCEPTION 'Managed model stage set requires an attempt command';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_stage_set() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_stage_set BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_stages
  FOR EACH ROW EXECUTE FUNCTION public.guard_model_stage_set();

-- Enrollment occurs through a claim, never through client-supplied insert flags.
CREATE FUNCTION public.guard_model_attempt_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.attempt_managed THEN
    RAISE EXCEPTION 'New model rows must start without attempt management';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_attempt_enrollment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_attempt_enrollment BEFORE INSERT ON public.model_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_model_attempt_enrollment();
CREATE TRIGGER guard_model_attempt_enrollment BEFORE INSERT ON public.model_run_stages
  FOR EACH ROW EXECUTE FUNCTION public.guard_model_attempt_enrollment();

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
    UPDATE public.model_run_stages SET active_attempt_id = v_attempt, attempt_managed = true, status = 'running',
      started_at = clock_timestamp(), completed_at = NULL, error_message = NULL
      WHERE id = p_stage_id;
    DELETE FROM public.model_stage_write_context WHERE transaction_id = txid_current() AND stage_id = p_stage_id;
    INSERT INTO public.model_run_write_context VALUES (txid_current(), v_run.id);
    UPDATE public.model_runs SET status = 'running', attempt_managed = true WHERE id = v_run.id;
    DELETE FROM public.model_run_write_context WHERE transaction_id = txid_current() AND run_id = v_run.id;
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

-- write.sql
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
  IF p_status='failed' THEN
    PERFORM id FROM public.model_run_stages WHERE run_id=v_run.id ORDER BY id FOR UPDATE;
    INSERT INTO public.model_stage_write_context(transaction_id,stage_id,attempt_id)
      SELECT txid_current(),id,NULL FROM public.model_run_stages WHERE run_id=v_run.id;
    UPDATE public.model_stage_attempts a SET revoked_at=clock_timestamp(),
      revocation_reason=coalesce(p_error,'Model stage failed')
      FROM public.model_run_stages s WHERE s.run_id=v_run.id AND s.active_attempt_id=a.id;
    UPDATE public.model_run_stages SET attempt_managed=true,active_attempt_id=NULL,
      status=CASE WHEN status IN ('queued','running') THEN 'failed' ELSE status END,
      error_message=CASE WHEN status IN ('queued','running') THEN 'Stopped because another required stage failed' ELSE error_message END,
      completed_at=CASE WHEN status IN ('queued','running') THEN clock_timestamp() ELSE completed_at END
      WHERE run_id=v_run.id;
    DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current()
      AND stage_id IN (SELECT id FROM public.model_run_stages WHERE run_id=v_run.id);
    INSERT INTO public.model_run_write_context VALUES(txid_current(),v_run.id);
    UPDATE public.model_runs SET status='failed',error_message=p_error,completed_at=clock_timestamp()
      WHERE id=v_run.id RETURNING * INTO v_run;
    DELETE FROM public.model_run_write_context WHERE transaction_id=txid_current() AND run_id=v_run.id;
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

-- reap.sql
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

-- relaunch.sql
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

-- kpi.sql
ALTER TABLE public.model_run_kpis ADD COLUMN attempt_id uuid REFERENCES public.model_stage_attempts(id);
CREATE TABLE public.model_kpi_write_context (
 transaction_id bigint NOT NULL, kpi_id uuid NOT NULL, attempt_id uuid NOT NULL,
 PRIMARY KEY(transaction_id,kpi_id)
);
CREATE TABLE public.model_kpi_write_receipts (
 request_id uuid PRIMARY KEY, request_payload jsonb NOT NULL, response_payload jsonb NOT NULL
);
ALTER TABLE public.model_kpi_write_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_kpi_write_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_kpi_write_context,public.model_kpi_write_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.guard_model_attempt_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run uuid; v_old_run uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN v_old_run := OLD.run_id; END IF;
 IF TG_OP <> 'DELETE' THEN v_run := NEW.run_id; END IF;
 PERFORM id FROM public.model_runs WHERE id IN (v_run,v_old_run) ORDER BY id FOR UPDATE;
 IF TG_OP <> 'INSERT' AND (OLD.attempt_id IS NOT NULL OR
     EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN
  RAISE EXCEPTION 'Attempt KPI records are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.attempt_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_run AND attempt_managed) THEN
  IF TG_OP <> 'INSERT' OR NOT EXISTS(SELECT 1 FROM public.model_kpi_write_context c
      WHERE c.transaction_id=txid_current() AND c.kpi_id=NEW.id AND c.attempt_id=NEW.attempt_id) THEN
   RAISE EXCEPTION 'Managed model KPI requires an attempt command';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_attempt_kpi() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_attempt_kpi BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_kpis
 FOR EACH ROW EXECUTE FUNCTION public.guard_model_attempt_kpi();
CREATE FUNCTION public.write_model_attempt_kpi(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request jsonb; v_receipt public.model_kpi_write_receipts%ROWTYPE;
 v_attempt public.model_stage_attempts%ROWTYPE; v_run public.model_runs%ROWTYPE;
 v_stage public.model_run_stages%ROWTYPE; v_kpi public.model_run_kpis%ROWTYPE;
 v_response jsonb; v_id uuid := gen_random_uuid();
BEGIN
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
     OR NOT p_payload ? 'value' OR jsonb_typeof(p_payload->'value') NOT IN ('number','null')
     OR jsonb_typeof(p_payload->'kpi_name') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_payload->'kpi_label') IS DISTINCT FROM 'string'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('kpi_name','kpi_label','kpi_category','value','unit','geometry_ref','breakdown_json')) THEN
  RAISE EXCEPTION 'Invalid attempt KPI payload';
 END IF;
 v_request := jsonb_build_object('attempt_id',p_attempt_id,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-kpi-write:'||p_request_id::text,0));
 SELECT * INTO v_receipt FROM public.model_kpi_write_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_payload IS DISTINCT FROM v_request THEN
   RAISE EXCEPTION 'Model KPI request identity reused with different payload';
  END IF;
  RETURN v_receipt.response_payload;
 END IF;
 SELECT * INTO v_attempt FROM public.model_stage_attempts WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model KPI attempt not found'; END IF;
 SELECT * INTO v_run FROM public.model_runs WHERE id=v_attempt.run_id FOR UPDATE;
 SELECT * INTO v_stage FROM public.model_run_stages WHERE id=v_attempt.stage_id FOR UPDATE;
 IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'
     OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Model KPI attempt no longer owns work';
 END IF;
 INSERT INTO public.model_kpi_write_context VALUES(txid_current(),v_id,p_attempt_id);
 INSERT INTO public.model_run_kpis(id,run_id,attempt_id,kpi_name,kpi_label,kpi_category,value,unit,geometry_ref,breakdown_json)
 VALUES(v_id,v_run.id,p_attempt_id,p_payload->>'kpi_name',p_payload->>'kpi_label',
   coalesce(p_payload->>'kpi_category','accessibility'),(p_payload->>'value')::double precision,
   coalesce(p_payload->>'unit',''),p_payload->>'geometry_ref',coalesce(p_payload->'breakdown_json','{}'::jsonb))
 RETURNING * INTO v_kpi;
 DELETE FROM public.model_kpi_write_context WHERE transaction_id=txid_current() AND kpi_id=v_id;
 v_response := to_jsonb(v_kpi);
 INSERT INTO public.model_kpi_write_receipts VALUES(p_request_id,v_request,v_response);
 RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.write_model_attempt_kpi(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_model_attempt_kpi(uuid,uuid,jsonb) TO service_role;

-- artifact.sql
ALTER TABLE public.model_run_artifacts ADD COLUMN attempt_id uuid REFERENCES public.model_stage_attempts(id);
CREATE TABLE public.model_artifact_write_context (
 transaction_id bigint NOT NULL, artifact_id uuid NOT NULL, attempt_id uuid NOT NULL,
 PRIMARY KEY(transaction_id,artifact_id)
);
CREATE TABLE public.model_artifact_write_receipts (
 request_id uuid PRIMARY KEY, request_payload jsonb NOT NULL, response_payload jsonb NOT NULL
);
ALTER TABLE public.model_artifact_write_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_artifact_write_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_artifact_write_context,public.model_artifact_write_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.guard_model_attempt_artifact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run uuid; v_old_run uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN v_old_run := OLD.run_id; END IF;
 IF TG_OP <> 'DELETE' THEN v_run := NEW.run_id; END IF;
 PERFORM id FROM public.model_runs WHERE id IN (v_run,v_old_run) ORDER BY id FOR UPDATE;
 IF TG_OP <> 'INSERT' AND (OLD.attempt_id IS NOT NULL OR
     EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN
  RAISE EXCEPTION 'Attempt artifact records are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.attempt_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_run AND attempt_managed) THEN
  IF TG_OP <> 'INSERT' OR NOT EXISTS(SELECT 1 FROM public.model_artifact_write_context c
      WHERE c.transaction_id=txid_current() AND c.artifact_id=NEW.id AND c.attempt_id=NEW.attempt_id) THEN
   RAISE EXCEPTION 'Managed model artifact requires an attempt command';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_attempt_artifact() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_attempt_artifact BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_artifacts
 FOR EACH ROW EXECUTE FUNCTION public.guard_model_attempt_artifact();
CREATE FUNCTION public.write_model_attempt_artifact(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request jsonb; v_receipt public.model_artifact_write_receipts%ROWTYPE;
 v_attempt public.model_stage_attempts%ROWTYPE; v_run public.model_runs%ROWTYPE;
 v_stage public.model_run_stages%ROWTYPE; v_artifact public.model_run_artifacts%ROWTYPE;
 v_response jsonb; v_id uuid := gen_random_uuid();
BEGIN
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
     OR jsonb_typeof(p_payload->'artifact_type') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_payload->'file_url') IS DISTINCT FROM 'string'
     OR coalesce(p_payload->>'content_hash','') !~ '^[0-9a-f]{64}$'
     OR coalesce(p_payload->>'file_size_bytes','') !~ '^[0-9]+$'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('artifact_type','file_url','file_size_bytes','content_hash','metadata_json')) THEN
  RAISE EXCEPTION 'Invalid attempt artifact payload';
 END IF;
 v_request := jsonb_build_object('attempt_id',p_attempt_id,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-artifact-write:'||p_request_id::text,0));
 SELECT * INTO v_receipt FROM public.model_artifact_write_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_payload IS DISTINCT FROM v_request THEN
   RAISE EXCEPTION 'Model artifact request identity reused with different payload';
  END IF;
  RETURN v_receipt.response_payload;
 END IF;
 SELECT * INTO v_attempt FROM public.model_stage_attempts WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model artifact attempt not found'; END IF;
 SELECT * INTO v_run FROM public.model_runs WHERE id=v_attempt.run_id FOR UPDATE;
 SELECT * INTO v_stage FROM public.model_run_stages WHERE id=v_attempt.stage_id FOR UPDATE;
 IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'
     OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Model artifact attempt no longer owns work';
 END IF;
 INSERT INTO public.model_artifact_write_context VALUES(txid_current(),v_id,p_attempt_id);
 INSERT INTO public.model_run_artifacts(id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json)
 VALUES(v_id,v_run.id,v_stage.id,p_attempt_id,p_payload->>'artifact_type',p_payload->>'file_url',
   (p_payload->>'file_size_bytes')::bigint,p_payload->>'content_hash',coalesce(p_payload->'metadata_json','{}'::jsonb))
 RETURNING * INTO v_artifact;
 DELETE FROM public.model_artifact_write_context WHERE transaction_id=txid_current() AND artifact_id=v_id;
 v_response := to_jsonb(v_artifact);
 INSERT INTO public.model_artifact_write_receipts VALUES(p_request_id,v_request,v_response);
 RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.write_model_attempt_artifact(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_model_attempt_artifact(uuid,uuid,jsonb) TO service_role;

-- read-outputs.sql
-- Service-only prototype reader. The application must authorize the workspace
-- before invoking it. Ownership classification does not establish claim validity.
CREATE FUNCTION public.read_model_attempt_outputs(p_run_id uuid,p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.model_runs%ROWTYPE; v_outputs jsonb;
BEGIN
 SELECT * INTO v_run FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model output read scope mismatch'; END IF;
 WITH outputs AS (
  SELECT 'artifact'::text AS kind,id,run_id,stage_id,attempt_id,to_jsonb(t) AS record
    FROM public.model_run_artifacts t WHERE run_id=p_run_id
  UNION ALL
  SELECT 'kpi',id,run_id,NULL::uuid,attempt_id,to_jsonb(t)
    FROM public.model_run_kpis t WHERE run_id=p_run_id
 ), classified AS (
  SELECT o.kind,o.id,o.record,
   CASE
    WHEN o.attempt_id IS NULL THEN 'legacy_unknown'
    WHEN a.id IS NULL OR s.id IS NULL OR (o.kind='artifact' AND o.stage_id IS DISTINCT FROM a.stage_id) THEN 'invalid_binding'
    WHEN a.revoked_at IS NOT NULL OR s.active_attempt_id IS DISTINCT FROM a.id OR s.status NOT IN ('running','succeeded') OR v_run.status NOT IN ('running','succeeded') THEN 'retained_inactive'
    WHEN s.status='succeeded' THEN 'current_completed'
    ELSE 'current_in_progress'
   END AS ownership_state
  FROM outputs o
  LEFT JOIN public.model_stage_attempts a ON a.id=o.attempt_id AND a.run_id=o.run_id
  LEFT JOIN public.model_run_stages s ON s.id=a.stage_id AND s.run_id=o.run_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'ownership_state',ownership_state,'record',record) ORDER BY kind,id),'[]'::jsonb)
 INTO v_outputs FROM classified;
 RETURN jsonb_build_object('run_id',v_run.id,'run_status',v_run.status,'outputs',v_outputs);
END;
$$;
REVOKE ALL ON FUNCTION public.read_model_attempt_outputs(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_model_attempt_outputs(uuid,uuid) TO service_role;

-- claim-projection-guard.sql
-- Refuse legacy projections until an attempt-bound scientific ingestion command
-- exists. This is not an implementation of that command or a claim promotion.
CREATE FUNCTION public.guard_managed_model_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_run uuid; new_run uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN old_run := OLD.model_run_id; END IF;
 IF TG_OP <> 'DELETE' THEN new_run := NEW.model_run_id; END IF;
 PERFORM id FROM public.model_runs WHERE id IN (old_run,new_run) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.model_runs WHERE id IN (old_run,new_run) AND attempt_managed) THEN
  RAISE EXCEPTION 'Managed model scientific projection requires attempt-bound ingestion';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_managed_model_projection() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_managed_model_projection BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_claim_decisions
 FOR EACH ROW EXECUTE FUNCTION public.guard_managed_model_projection();
CREATE TRIGGER guard_managed_model_projection BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_validation_results
 FOR EACH ROW EXECUTE FUNCTION public.guard_managed_model_projection();

-- instrument-custody.sql
CREATE TABLE public.model_attempt_instrument_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  input_bundle_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  match_audit_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  comparison_basis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  assessment_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  diagnosis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  input_bundle_sha256 text NOT NULL CHECK (input_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  match_audit_sha256 text NOT NULL CHECK (match_audit_sha256 ~ '^[0-9a-f]{64}$'),
  comparison_basis_sha256 text NOT NULL CHECK (comparison_basis_sha256 ~ '^[0-9a-f]{64}$'),
  assessment_sha256 text NOT NULL CHECK (assessment_sha256 ~ '^[0-9a-f]{64}$'),
  diagnosis_sha256 text NOT NULL CHECK (diagnosis_sha256 ~ '^[0-9a-f]{64}$'),
  scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive'),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempt_id uuid NOT NULL REFERENCES public.model_stage_attempts(id),
  stage_id uuid NOT NULL REFERENCES public.model_run_stages(id),
  demand_method text NOT NULL CHECK (demand_method IN ('aequilibrae','activitysim')),
  model_output_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id),
  model_output_sha256 text NOT NULL CHECK (model_output_sha256 ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.model_attempt_instrument_custody ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_attempt_instrument_custody FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_model_attempt_instrument BEFORE INSERT ON public.model_attempt_instrument_custody
 FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_validation_instrument_v2_custody();
CREATE TRIGGER refuse_model_attempt_instrument_mutation BEFORE UPDATE OR DELETE ON public.model_attempt_instrument_custody
 FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_validation_instrument_v2_mutation();
CREATE TABLE public.model_attempt_instrument_receipts (
 request_id uuid PRIMARY KEY,request_payload jsonb NOT NULL,response_payload jsonb NOT NULL
);
ALTER TABLE public.model_attempt_instrument_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_attempt_instrument_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_model_attempt_instrument(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request jsonb; v_receipt public.model_attempt_instrument_receipts%ROWTYPE;
 v_attempt public.model_stage_attempts%ROWTYPE; v_run public.model_runs%ROWTYPE;
 v_stage public.model_run_stages%ROWTYPE; v_artifact public.model_run_artifacts%ROWTYPE;
 v_pair record; v_result public.model_attempt_instrument_custody%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR coalesce(p_payload->>'demand_method','') NOT IN ('aequilibrae','activitysim')
    OR p_payload->>'scientific_outcome' IS DISTINCT FROM 'inconclusive'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('demand_method','scientific_outcome','model_output_artifact_id','model_output_sha256','input_bundle_artifact_id','input_bundle_sha256','match_audit_artifact_id','match_audit_sha256','comparison_basis_artifact_id','comparison_basis_sha256','assessment_artifact_id','assessment_sha256','diagnosis_artifact_id','diagnosis_sha256')) THEN
  RAISE EXCEPTION 'Invalid attempt instrument payload';
 END IF;
 v_request := jsonb_build_object('attempt_id',p_attempt_id,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-instrument:'||p_request_id::text,0));
 SELECT * INTO v_receipt FROM public.model_attempt_instrument_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_payload IS DISTINCT FROM v_request THEN RAISE EXCEPTION 'Instrument request identity reused with different payload'; END IF;
  RETURN v_receipt.response_payload;
 END IF;
 SELECT * INTO v_attempt FROM public.model_stage_attempts WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instrument attempt not found'; END IF;
 SELECT * INTO v_run FROM public.model_runs WHERE id=v_attempt.run_id FOR UPDATE;
 SELECT * INTO v_stage FROM public.model_run_stages WHERE id=v_attempt.stage_id FOR UPDATE;
 IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'
    OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Instrument attempt no longer owns work';
 END IF;
 FOR v_pair IN SELECT * FROM (VALUES
  ('model_output'),
  ('input_bundle'),
  ('match_audit'),
  ('comparison_basis'),
  ('assessment'),
  ('diagnosis')
 ) AS refs(prefix) LOOP
  SELECT * INTO v_artifact FROM public.model_run_artifacts WHERE id=(p_payload->>(v_pair.prefix||'_artifact_id'))::uuid;
  IF v_artifact.id IS NULL OR v_artifact.run_id IS DISTINCT FROM v_run.id
     OR v_artifact.stage_id IS DISTINCT FROM v_stage.id OR v_artifact.attempt_id IS DISTINCT FROM p_attempt_id
     OR v_artifact.content_hash IS DISTINCT FROM p_payload->>(v_pair.prefix||'_sha256') THEN
   RAISE EXCEPTION 'Instrument artifact attempt, run, stage or hash mismatch';
  END IF;
  IF v_pair.prefix IN ('model_output','assessment') AND v_artifact.metadata_json->>'demand_method' IS DISTINCT FROM p_payload->>'demand_method' THEN
   RAISE EXCEPTION 'Instrument demand method does not match output and assessment';
  END IF;
 END LOOP;
 INSERT INTO public.model_attempt_instrument_custody(workspace_id,model_run_id,stage_id,attempt_id,demand_method,model_output_artifact_id,model_output_sha256,input_bundle_artifact_id,match_audit_artifact_id,comparison_basis_artifact_id,assessment_artifact_id,diagnosis_artifact_id,input_bundle_sha256,match_audit_sha256,comparison_basis_sha256,assessment_sha256,diagnosis_sha256,scientific_outcome)
 VALUES(v_run.workspace_id,v_run.id,v_stage.id,p_attempt_id,p_payload->>'demand_method',(p_payload->>'model_output_artifact_id')::uuid,p_payload->>'model_output_sha256',(p_payload->>'input_bundle_artifact_id')::uuid,(p_payload->>'match_audit_artifact_id')::uuid,(p_payload->>'comparison_basis_artifact_id')::uuid,(p_payload->>'assessment_artifact_id')::uuid,(p_payload->>'diagnosis_artifact_id')::uuid,p_payload->>'input_bundle_sha256',p_payload->>'match_audit_sha256',p_payload->>'comparison_basis_sha256',p_payload->>'assessment_sha256',p_payload->>'diagnosis_sha256',p_payload->>'scientific_outcome') RETURNING * INTO v_result;
 INSERT INTO public.model_attempt_instrument_receipts VALUES(p_request_id,v_request,to_jsonb(v_result));
 RETURN to_jsonb(v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.record_model_attempt_instrument(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_model_attempt_instrument(uuid,uuid,jsonb) TO service_role;

CREATE INDEX model_stage_attempts_run_idx ON public.model_stage_attempts(run_id);
CREATE INDEX model_run_artifacts_attempt_idx ON public.model_run_artifacts(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX model_run_kpis_attempt_idx ON public.model_run_kpis(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX model_attempt_instrument_run_method_idx ON public.model_attempt_instrument_custody(model_run_id,demand_method);
CREATE INDEX model_attempt_instrument_attempt_idx ON public.model_attempt_instrument_custody(attempt_id);
CREATE INDEX model_attempt_instrument_output_idx ON public.model_attempt_instrument_custody(model_output_artifact_id);
CREATE INDEX model_attempt_instrument_stage_idx ON public.model_attempt_instrument_custody(stage_id);
CREATE INDEX model_attempt_instrument_workspace_idx ON public.model_attempt_instrument_custody(workspace_id);
CREATE INDEX model_run_stages_active_attempt_identity_idx ON public.model_run_stages(id,active_attempt_id) WHERE active_attempt_id IS NOT NULL;
