CREATE FUNCTION public.synthetic_artifact_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_payload->'payload'->>'file_url'='local://synthetic-failure' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER synthetic_artifact_receipt_failure BEFORE INSERT ON public.model_legacy_artifact_receipts FOR EACH ROW EXECUTE FUNCTION public.synthetic_artifact_receipt_failure();
DO $$
DECLARE
 run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); artifact uuid:=gen_random_uuid(); ws uuid;
 payload jsonb; response jsonb; changed jsonb; rejected boolean; legacy uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,'aequilibrae','queued','Synthetic artifact command',created_by FROM public.model_runs WHERE id=current_setting('openplan.proof_fixture')::uuid RETURNING workspace_id INTO ws;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic artifact command','queued',1);
 payload:=jsonb_build_object('id',artifact,'run_id',run,'stage_id',stage,'artifact_type','link_volumes','file_url','local://synthetic','file_size_bytes',2,'content_hash',repeat('a',64),'metadata_json','{}'::jsonb);
 response:=public.record_legacy_model_artifact(ws,payload);
 IF response->>'id' IS DISTINCT FROM artifact::text OR public.record_legacy_model_artifact(ws,payload) IS DISTINCT FROM response OR (SELECT count(*) FROM public.model_run_artifacts WHERE run_id=run)<>1 THEN RAISE EXCEPTION 'Artifact retry changed or duplicated'; END IF;
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(ws,jsonb_set(payload,'{file_url}','"local://changed"'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Legacy artifact request changed' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Changed artifact request accepted'; END IF;
 changed:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{file_url}','"local://synthetic-failure"'); rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(ws,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic receipt failure' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected OR (SELECT count(*) FROM public.model_run_artifacts WHERE run_id=run)<>1 THEN RAISE EXCEPTION 'Artifact receipt failure left partial write'; END IF;
 INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json)
 VALUES(legacy,run,stage,'link_volumes','local://synthetic',2,repeat('a',64),'{}');
 changed:=jsonb_set(payload,'{id}',to_jsonb(legacy));rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(ws,jsonb_set(changed,'{file_size_bytes}','3'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Existing legacy artifact differs' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Mismatched legacy artifact adopted'; END IF;
 IF public.record_legacy_model_artifact(ws,changed) IS DISTINCT FROM (SELECT to_jsonb(a) FROM public.model_run_artifacts a WHERE id=legacy) THEN RAISE EXCEPTION 'Existing artifact identity changed'; END IF;
 UPDATE public.model_runs SET status='failed' WHERE id=run;rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(ws,jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Stopped run cannot register new artifact' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stopped artifact accepted'; END IF;
 IF public.record_legacy_model_artifact(ws,payload) IS DISTINCT FROM response THEN RAISE EXCEPTION 'Historical artifact retry changed'; END IF;
 UPDATE public.model_runs SET status='queued' WHERE id=run;rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(gen_random_uuid(),jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Legacy artifact workspace mismatch' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong workspace accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(ws,jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{stage_id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Legacy artifact stage mismatch' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong stage accepted'; END IF;
 PERFORM public.claim_model_stage_attempt(gen_random_uuid(),stage,'synthetic-artifact');rejected:=false;
 BEGIN PERFORM public.record_legacy_model_artifact(ws,jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Managed artifact requires attempt-bound command' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Managed artifact accepted'; END IF;
 IF has_function_privilege('authenticated','public.record_legacy_model_artifact(uuid,jsonb)','EXECUTE') OR has_table_privilege('service_role','public.model_legacy_artifact_receipts','INSERT') THEN RAISE EXCEPTION 'Artifact command privileges exposed'; END IF;
 RAISE NOTICE 'legacy-artifact-command: recovery cases passed';
END;
$$;
