CREATE FUNCTION public.synthetic_publication_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_payload->'payload'->'claim'->>'status_reason'='Synthetic receipt failure' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER synthetic_publication_receipt_failure BEFORE INSERT ON public.model_evidence_publication_receipts
 FOR EACH ROW EXECUTE FUNCTION public.synthetic_publication_receipt_failure();
DO $$
DECLARE
 run uuid:=gen_random_uuid(); ws uuid; req uuid:=gen_random_uuid(); fail_req uuid:=gen_random_uuid();
 wrong_ws uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); text_key text; bad_value jsonb;
 before_state jsonb; after_state jsonb; payload jsonb; changed jsonb; response jsonb; rejected boolean;
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,'aequilibrae','queued','Synthetic atomic publication proof',created_by
 FROM public.model_runs WHERE id=current_setting('openplan.proof_fixture')::uuid;
 SELECT workspace_id INTO ws FROM public.model_runs WHERE id=run;
 IF ws IS NULL THEN RAISE EXCEPTION 'Fixture unavailable'; END IF;
 INSERT INTO public.modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason,reasons_json)
 VALUES(ws,run,'assignment','prototype_only','Prior synthetic claim','["Prior synthetic reason"]');
 INSERT INTO public.modeling_validation_results(workspace_id,model_run_id,track,metric_key,metric_label,status,detail)
 VALUES(ws,run,'assignment','prior','Prior synthetic metric','warn','Prior retained metric');
 before_state:=public.read_legacy_model_evidence(ws,run,'assignment');
 payload:=jsonb_build_object('claim',jsonb_build_object('workspace_id',ws,'model_run_id',run,'track','assignment',
  'claim_status','prototype_only','status_reason','Synthetic replacement','validation_summary_json','{}'::jsonb),
  'metrics',jsonb_build_array(jsonb_build_object('workspace_id',ws,'model_run_id',run,'track','assignment',
   'metric_key','replacement','metric_label','Synthetic replacement','threshold_comparator','manual','status','warn',
   'blocks_claim_grade',true,'detail','Synthetic unresolved metric','metadata_json','{}'::jsonb)));
 -- A late metric constraint failure must roll back the preceding deletion/upsert.
 changed:=jsonb_set(payload,'{metrics,0,status}','"invalid"'); rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(fail_req,ws,run,'assignment',before_state,changed);
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Invalid metric accepted'; END IF;
 IF public.read_legacy_model_evidence(ws,run,'assignment') IS DISTINCT FROM before_state
  OR EXISTS(SELECT 1 FROM public.model_evidence_publication_receipts WHERE request_id=fail_req)
  OR EXISTS(SELECT 1 FROM public.model_evidence_publication_context WHERE run_id=run) THEN
  RAISE EXCEPTION 'Failed publication did not roll back';
 END IF;
 FOREACH text_key IN ARRAY ARRAY['metric_key','metric_label','threshold_comparator','status','detail'] LOOP
  FOR bad_value IN SELECT value FROM jsonb_array_elements('[true,23,null,{},[]," "]'::jsonb) LOOP
   rejected:=false;
   BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',before_state,jsonb_set(payload,ARRAY['metrics','0',text_key],bad_value));
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid publication metric text' THEN RAISE; END IF; rejected:=true; END;
   IF NOT rejected THEN RAISE EXCEPTION 'Invalid metric text accepted: % %',text_key,bad_value; END IF;
  END LOOP;
 END LOOP;
 response:=public.publish_legacy_model_evidence(req,ws,run,'assignment',before_state,payload);
 after_state:=public.read_legacy_model_evidence(ws,run,'assignment');
 IF response->'evidence' IS DISTINCT FROM after_state OR after_state=before_state
  OR after_state->'metrics'->0->>'metric_key' IS DISTINCT FROM 'replacement' THEN RAISE EXCEPTION 'Replacement receipt differs'; END IF;
 IF after_state->'claims'->0->'reasons_json' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Replacement retained prior current reasons'; END IF;
 IF (SELECT prior_evidence FROM public.model_evidence_publication_receipts WHERE request_id=req) IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'Prior evidence not retained';
 END IF;
 IF public.publish_legacy_model_evidence(req,ws,run,'assignment',before_state,payload) IS DISTINCT FROM response
  OR public.read_legacy_model_evidence(ws,run,'assignment') IS DISTINCT FROM after_state THEN
  RAISE EXCEPTION 'Exact retry changed publication';
 END IF;
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(req,ws,run,'assignment',before_state,jsonb_set(payload,'{claim,status_reason}','"Changed request"'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication request payload changed' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Changed request accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',before_state,payload);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication evidence changed' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale evidence accepted'; END IF;
 rejected:=false;
 BEGIN UPDATE public.modeling_claim_decisions SET status_reason='Bypassed command' WHERE model_run_id=run;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Retained model evidence requires publication command' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct claim update accepted'; END IF;
 rejected:=false;
 BEGIN DELETE FROM public.modeling_validation_results WHERE model_run_id=run;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Retained model evidence requires publication command' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct metric deletion accepted'; END IF;
 IF has_table_privilege('service_role','public.model_evidence_publication_receipts','INSERT')
  OR has_table_privilege('authenticated','public.model_evidence_publication_receipts','SELECT')
  OR has_table_privilege('service_role','public.model_evidence_publication_context','INSERT')
  OR has_function_privilege('authenticated','public.publish_legacy_model_evidence(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Publication private privileges exposed';
 END IF;
 IF public.read_legacy_model_evidence(ws,run,'assignment') IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'Adverse cases changed evidence'; END IF;
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,NULL,after_state,payload);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid model evidence publication' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Null track accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',after_state,jsonb_set(payload,'{claim,claim_status}','"screening_grade"'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid or unsupported publication claim' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Claim promotion accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',after_state,jsonb_set(payload,'{metrics,0,workspace_id}',to_jsonb(wrong_ws::text)));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid publication metric scope or fields' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong metric scope accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',after_state,jsonb_set(payload,'{metrics}',(payload->'metrics')||(payload->'metrics')));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Duplicate or missing publication metric' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Duplicate metric accepted'; END IF;
 changed:=jsonb_set(jsonb_set(payload,'{claim,workspace_id}',to_jsonb(wrong_ws::text)),'{metrics,0,workspace_id}',to_jsonb(wrong_ws::text));
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),wrong_ws,run,'assignment',after_state,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication workspace mismatch' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong publication workspace accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.read_legacy_model_evidence(wrong_ws,run,'assignment');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model evidence scope mismatch' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong read workspace accepted'; END IF;
 changed:=jsonb_set(payload,'{claim,status_reason}','"Synthetic receipt failure"');
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(fail_req,ws,run,'assignment',after_state,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic receipt failure' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Receipt failure not exercised'; END IF;
 IF public.read_legacy_model_evidence(ws,run,'assignment') IS DISTINCT FROM after_state
  OR EXISTS(SELECT 1 FROM public.model_evidence_publication_receipts WHERE request_id=fail_req)
  OR EXISTS(SELECT 1 FROM public.model_evidence_publication_context WHERE run_id=run) THEN
  RAISE EXCEPTION 'Receipt failure left partial publication';
 END IF;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic managed boundary','queued',1);
 PERFORM public.claim_model_stage_attempt(gen_random_uuid(),stage,'synthetic-publication-boundary');
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',after_state,payload);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Managed publication requires instrument ingestion' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Managed legacy publication accepted'; END IF;
 RAISE NOTICE 'atomic-publication: rollback, retained history, exact retry, changed request, stale state, direct-write refusal and privileges passed';
END;
$$;
