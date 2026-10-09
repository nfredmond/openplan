CREATE FUNCTION public.synthetic_kpi_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_payload->'payload'->>'kpi_name'='synthetic-failure' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER synthetic_kpi_receipt_failure BEFORE INSERT ON public.model_legacy_kpi_receipts FOR EACH ROW EXECUTE FUNCTION public.synthetic_kpi_receipt_failure();
DO $$
DECLARE
 run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); kpi uuid:=gen_random_uuid(); ws uuid;
 invalid_case record; payload jsonb; response jsonb; changed jsonb; rejected boolean; legacy uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,'aequilibrae','queued','Synthetic kpi command',created_by FROM public.model_runs WHERE id=current_setting('openplan.proof_fixture')::uuid RETURNING workspace_id INTO ws;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic kpi command','queued',1);
 payload:=jsonb_build_object('id',kpi,'run_id',run,'stage_id',stage,'kpi_name','daily_vmt','kpi_label','Daily VMT','kpi_category','assignment','value',12.5,'unit','vehicle-miles/day','geometry_ref',NULL,'breakdown_json','{}'::jsonb);
 -- Exercise values that the underlying column types could otherwise accept.
 FOR invalid_case IN SELECT * FROM (VALUES
  (payload || '{"unexpected":true}'::jsonb, 'Invalid legacy KPI fields', 'Extra kpi field accepted'),
  (jsonb_set(payload,'{id}','"AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"'), 'Invalid legacy KPI identity', 'Noncanonical kpi identity accepted'),
  (jsonb_set(payload,'{kpi_label}','"   "'), 'Invalid legacy KPI text', 'Blank KPI label accepted'),
  (jsonb_set(payload,'{breakdown_json}','[]'), 'Invalid legacy KPI values', 'Nonobject KPI breakdown accepted'),
  (jsonb_set(payload,'{value}','"12.5"'), 'Invalid legacy KPI values', 'String KPI number accepted'),
  (jsonb_set(payload,'{value}','9007199254740993'), 'Legacy KPI number cannot be retained exactly', 'Rounded KPI number accepted')
 ) AS c(body,expected_error,accepted_error) LOOP
  rejected:=false;
  BEGIN PERFORM public.record_legacy_model_kpi(ws,invalid_case.body);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>invalid_case.expected_error THEN RAISE; END IF;
   rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION '%',invalid_case.accepted_error; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.model_run_kpis WHERE run_id=run)
  OR EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=run)
  THEN RAISE EXCEPTION 'Invalid kpi input left a write'; END IF;
 response:=public.record_legacy_model_kpi(ws,payload);
 IF response->>'id' IS DISTINCT FROM kpi::text OR public.record_legacy_model_kpi(ws,payload) IS DISTINCT FROM response OR (SELECT count(*) FROM public.model_run_kpis WHERE run_id=run)<>1 THEN RAISE EXCEPTION 'KPI retry changed or duplicated'; END IF;
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,jsonb_set(payload,'{unit}','"changed unit"'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Legacy KPI request changed' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Changed kpi request accepted'; END IF;
 changed:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{kpi_name}','"synthetic-failure"'); rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic receipt failure' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected OR (SELECT count(*) FROM public.model_run_kpis WHERE run_id=run)<>1 THEN RAISE EXCEPTION 'KPI receipt failure left partial write'; END IF;
 INSERT INTO public.model_run_kpis(id,run_id,kpi_name,kpi_label,kpi_category,value,unit,geometry_ref,breakdown_json)
 VALUES(legacy,run,'daily_vmt','Daily VMT','assignment',12.5,'vehicle-miles/day',NULL,'{}');
 changed:=jsonb_set(payload,'{id}',to_jsonb(legacy));rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,jsonb_set(changed,'{value}','13'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Existing legacy KPI requires stage reconciliation' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Mismatched legacy KPI adopted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Existing legacy KPI requires stage reconciliation' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stage-less existing KPI adopted'; END IF;
 changed:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{value}','null');
 IF public.record_legacy_model_kpi(ws,changed)->'value' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unavailable KPI became zero'; END IF;
 UPDATE public.model_runs SET status='failed' WHERE id=run;rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Stopped run cannot register new KPI' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stopped KPI accepted'; END IF;
 IF public.record_legacy_model_kpi(ws,payload) IS DISTINCT FROM response THEN RAISE EXCEPTION 'Historical kpi retry changed'; END IF;
 UPDATE public.model_runs SET status='queued' WHERE id=run;rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(gen_random_uuid(),jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Legacy KPI workspace mismatch' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong workspace accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{stage_id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Legacy KPI stage mismatch' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong stage accepted'; END IF;
 PERFORM public.claim_model_stage_attempt(gen_random_uuid(),stage,'synthetic-kpi');rejected:=false;
 BEGIN PERFORM public.record_legacy_model_kpi(ws,jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Managed KPI requires attempt-bound command' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Managed KPI accepted'; END IF;
 IF has_function_privilege('authenticated','public.record_legacy_model_kpi(uuid,jsonb)','EXECUTE') OR has_table_privilege('service_role','public.model_legacy_kpi_receipts','INSERT') THEN RAISE EXCEPTION 'KPI command privileges exposed'; END IF;
 RAISE NOTICE 'legacy-kpi-command: recovery cases passed';
END;
$$;
