-- Retain exact legacy KPI requests and receipts without authorizing stage replay.
CREATE TABLE public.model_legacy_kpi_receipts (
 kpi_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES public.model_runs(id),
 request_payload jsonb NOT NULL,
 response_payload jsonb NOT NULL
);
CREATE INDEX model_legacy_kpi_receipts_run_idx ON public.model_legacy_kpi_receipts(run_id);
ALTER TABLE public.model_legacy_kpi_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_legacy_kpi_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_legacy_model_kpi(p_workspace uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 fields text[]:=ARRAY['id','run_id','stage_id','kpi_name','kpi_label','kpi_category','value','unit','geometry_ref','breakdown_json'];
 key text; identity uuid; run uuid; stage uuid; request jsonb; response jsonb; measured double precision;
 saved public.model_legacy_kpi_receipts%ROWTYPE;
 parent public.model_runs%ROWTYPE; kpi public.model_run_kpis%ROWTYPE;
BEGIN
 IF p_workspace IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR NOT(p_payload ?& fields) OR (p_payload-fields)<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid legacy KPI fields'; END IF;
 FOREACH key IN ARRAY ARRAY['id','run_id','stage_id'] LOOP
  IF jsonb_typeof(p_payload->key) IS DISTINCT FROM 'string' OR p_payload->>key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid legacy KPI identity'; END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['kpi_name','kpi_label','kpi_category'] LOOP
  IF jsonb_typeof(p_payload->key) IS DISTINCT FROM 'string' OR btrim(p_payload->>key)='' THEN RAISE EXCEPTION 'Invalid legacy KPI text'; END IF;
 END LOOP;
 IF p_payload->>'kpi_category' NOT IN ('accessibility','assignment','safety','equity','general')
  OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'geometry_ref') NOT IN ('string','null')
  OR jsonb_typeof(p_payload->'breakdown_json') NOT IN ('object','null')
  OR jsonb_typeof(p_payload->'value') NOT IN ('number','null') THEN RAISE EXCEPTION 'Invalid legacy KPI values'; END IF;
 measured:=(p_payload->>'value')::double precision;
 IF measured IS NOT NULL AND (measured IN ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision)
  OR to_jsonb(measured) IS DISTINCT FROM p_payload->'value') THEN RAISE EXCEPTION 'Legacy KPI number cannot be retained exactly'; END IF;
 identity:=(p_payload->>'id')::uuid; run:=(p_payload->>'run_id')::uuid; stage:=(p_payload->>'stage_id')::uuid;
 request:=jsonb_build_object('workspace_id',p_workspace,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('legacy-kpi:'||identity::text,0));
 SELECT * INTO saved FROM public.model_legacy_kpi_receipts WHERE kpi_id=identity;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Legacy KPI request changed'; END IF;
  RETURN saved.response_payload;
 END IF;
 SELECT * INTO parent FROM public.model_runs WHERE id=run FOR UPDATE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace THEN RAISE EXCEPTION 'Legacy KPI workspace mismatch'; END IF;
 IF parent.attempt_managed THEN RAISE EXCEPTION 'Managed KPI requires attempt-bound command'; END IF;
 IF parent.status IN('failed','cancelled') THEN RAISE EXCEPTION 'Stopped run cannot register new KPI'; END IF;
 PERFORM 1 FROM public.model_run_stages WHERE id=stage AND run_id=run AND NOT attempt_managed FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legacy KPI stage mismatch'; END IF;
 SELECT * INTO kpi FROM public.model_run_kpis WHERE id=identity FOR UPDATE;
 IF FOUND THEN
  RAISE EXCEPTION 'Existing legacy KPI requires stage reconciliation';
 ELSE
  INSERT INTO public.model_run_kpis(id,run_id,kpi_name,kpi_label,kpi_category,value,unit,geometry_ref,breakdown_json)
  VALUES(identity,run,p_payload->>'kpi_name',p_payload->>'kpi_label',p_payload->>'kpi_category',measured,p_payload->>'unit',p_payload->>'geometry_ref',p_payload->'breakdown_json') RETURNING * INTO kpi;
 END IF;
 response:=to_jsonb(kpi);
 INSERT INTO public.model_legacy_kpi_receipts(kpi_id,run_id,request_payload,response_payload) VALUES(identity,run,request,response);
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.record_legacy_model_kpi(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_legacy_model_kpi(uuid,jsonb) TO service_role;
