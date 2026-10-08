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
