CREATE FUNCTION pg_temp.refuse_prepared_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('openplan.proof_artifact_receipt_failure',true)='yes' THEN
  RAISE EXCEPTION 'Synthetic prepared receipt failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proof_refuse_prepared_receipt BEFORE INSERT ON public.model_artifact_write_receipts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_prepared_receipt();

DO $$
DECLARE run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); attempt uuid;
 artifact uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); response jsonb;
 payload jsonb; saved jsonb; failed_request uuid:=gen_random_uuid(); failed_artifact uuid:=gen_random_uuid();
 bad jsonb; failure_seen boolean;
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,engine_key,'queued','Synthetic prepared artifact',created_by
 FROM public.model_runs WHERE id='__FIXTURE_RUN__';
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES(stage,run,'Synthetic registration','queued',1);
 EXECUTE 'SET LOCAL ROLE service_role';
 response:=public.claim_model_stage_attempt(gen_random_uuid(),stage,'synthetic-prepared-artifact');
 EXECUTE 'RESET ROLE';
 attempt:=(response->>'attempt_id')::uuid;
 payload:=jsonb_build_object('id',artifact,'artifact_type','synthetic','file_url','local://synthetic',
  'content_hash',repeat('a',64),'file_size_bytes',7,'metadata_json',jsonb_build_object('claim_tier','prototype'));
 EXECUTE 'SET LOCAL ROLE service_role';
 response:=public.write_model_attempt_artifact(request,attempt,payload);
 EXECUTE 'RESET ROLE';
 IF response->>'id'<>artifact::text OR response->>'attempt_id'<>attempt::text THEN
  RAISE EXCEPTION 'Prepared artifact identity was not preserved';
 END IF;
 saved:=(SELECT to_jsonb(a) FROM public.model_run_artifacts a WHERE id=artifact);
 IF public.write_model_attempt_artifact(request,attempt,payload) IS DISTINCT FROM response
 OR (SELECT to_jsonb(a) FROM public.model_run_artifacts a WHERE id=artifact) IS DISTINCT FROM saved THEN
  RAISE EXCEPTION 'Exact prepared artifact retry changed records';
 END IF;
 BEGIN
  PERFORM public.write_model_attempt_artifact(request,attempt,payload||jsonb_build_object('content_hash',repeat('b',64)));
  RAISE EXCEPTION 'Changed prepared request accepted' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Model artifact request identity reused with different payload' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_model_attempt_artifact(failed_request,attempt,payload);
  RAISE EXCEPTION 'Colliding artifact replaced' USING ERRCODE='ZX002';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.model_artifact_write_receipts WHERE request_id=failed_request)
 OR EXISTS(SELECT 1 FROM public.model_artifact_write_context WHERE artifact_id=artifact)
 OR (SELECT to_jsonb(a) FROM public.model_run_artifacts a WHERE id=artifact) IS DISTINCT FROM saved THEN
  RAISE EXCEPTION 'Collision changed retained artifact or receipt';
 END IF;
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,1,"not-a-uuid","AAAAAAAA-1111-4111-8111-111111111111"]'::jsonb) LOOP
  BEGIN
   PERFORM public.write_model_attempt_artifact(gen_random_uuid(),attempt,jsonb_set(payload,'{id}',bad));
   RAISE EXCEPTION 'Malformed prepared identity accepted' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'Invalid prepared artifact identity' THEN RAISE; END IF;
  END;
 END LOOP;
 response:=public.write_model_attempt_artifact(gen_random_uuid(),attempt,payload-'id');
 IF response->>'id' IS NULL OR response->>'id'=artifact::text THEN
  RAISE EXCEPTION 'Generated identity compatibility failed';
 END IF;
 PERFORM set_config('openplan.proof_artifact_receipt_failure','yes',true);
 BEGIN
  PERFORM public.write_model_attempt_artifact(failed_request,attempt,payload||jsonb_build_object('id',failed_artifact));
  RAISE EXCEPTION 'Synthetic receipt failure ignored' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Synthetic prepared receipt failure' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.model_run_artifacts WHERE id=failed_artifact)
 OR EXISTS(SELECT 1 FROM public.model_artifact_write_receipts WHERE request_id=failed_request) THEN
  RAISE EXCEPTION 'Prepared artifact escaped failed receipt transaction';
 END IF;
 PERFORM set_config('openplan.proof_artifact_receipt_failure','no',true);
 response:=public.write_model_attempt_artifact(failed_request,attempt,payload||jsonb_build_object('id',failed_artifact));
 IF response->>'id'<>failed_artifact::text THEN RAISE EXCEPTION 'Retry lost prepared identity'; END IF;
 PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'succeeded','Synthetic completion',NULL);
 BEGIN
  PERFORM public.write_model_attempt_artifact(gen_random_uuid(),attempt,payload||jsonb_build_object('id',gen_random_uuid()));
  RAISE EXCEPTION 'Terminal attempt published artifact' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Model artifact attempt no longer owns work' THEN RAISE; END IF;
 END;
 IF has_function_privilege('anon','public.write_model_attempt_artifact(uuid,uuid,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.write_model_attempt_artifact(uuid,uuid,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Client role can register managed artifact';
 END IF;
END $$;
