CREATE FUNCTION public.synthetic_assessment_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_payload->>'p_planning_use'='Synthetic receipt failure' THEN RAISE EXCEPTION 'Synthetic assessment receipt failure'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER synthetic_assessment_receipt_failure BEFORE INSERT ON public.model_assessment_command_receipts
 FOR EACH ROW EXECUTE FUNCTION public.synthetic_assessment_receipt_failure();
DO $$
DECLARE
 run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); output uuid:=gen_random_uuid(); ws uuid;
 request uuid:=gen_random_uuid(); payload jsonb; changed jsonb; metadata jsonb; response jsonb; rejected boolean;
 field text; prefix text; before_count integer;
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,'aequilibrae','queued','Synthetic retained assessment',created_by
 FROM public.model_runs WHERE id=current_setting('openplan.proof_fixture')::uuid RETURNING workspace_id INTO ws;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic assessment','queued',1);
 INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash)
 VALUES(output,run,stage,'link_volumes','storage://run-artifacts/synthetic/output.csv',2,repeat('a',64));
 metadata:=jsonb_build_object('schema','openplan.model-validation-assessment.v1','comparison_basis_sha256',repeat('a',64),
  'rules_version',4,'scientific_outcome','inconclusive','planning_use','Synthetic only','partition','{}'::jsonb,'reasons','[]'::jsonb);
 payload:=jsonb_build_object('p_workspace_id',ws,'p_model_run_id',run,'p_stage_id',stage,'p_track','assignment',
  'p_model_output_artifact_id',output,'p_partition','{}'::jsonb,'p_planning_use','Synthetic only','p_scientific_outcome','inconclusive','p_reasons','[]'::jsonb);
 FOREACH prefix IN ARRAY ARRAY['p_validation_input','p_comparison_basis','p_assessment'] LOOP
  payload:=payload||jsonb_build_object(prefix||'_file_url','storage://run-artifacts/synthetic/'||prefix||'.json',
   prefix||'_size',2,prefix||'_sha256',repeat('a',64),prefix||'_metadata','{}'::jsonb);
 END LOOP;
 payload:=jsonb_set(payload,'{p_validation_input_metadata}',jsonb_build_object('schema','openplan.validation-input-bundle.v1','comparison_basis_sha256',repeat('a',64)));
 payload:=jsonb_set(payload,'{p_comparison_basis_metadata}',jsonb_build_object('schema','openplan.model-comparison-basis.v1'));
 payload:=jsonb_set(payload,'{p_assessment_metadata}',metadata);
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_assessment(gen_random_uuid(),payload||'{"unexpected":true}'::jsonb);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid retained assessment fields' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unexpected assessment fields accepted'; END IF;
 response:=public.record_legacy_model_assessment(request,payload);
 IF response->>'request_id' IS DISTINCT FROM request::text OR jsonb_array_length(response->'artifacts')<>3
  OR response->'assessment'->>'model_run_id' IS DISTINCT FROM run::text THEN RAISE EXCEPTION 'Assessment command receipt differs'; END IF;
 IF public.record_legacy_model_assessment(request,payload) IS DISTINCT FROM response
  OR (SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id=run)<>1
  OR (SELECT count(*) FROM public.model_run_artifacts WHERE run_id=run)<>4 THEN RAISE EXCEPTION 'Assessment exact retry duplicated or changed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_assessment(request,jsonb_set(payload,'{p_validation_input_file_url}','"storage://different"'));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Assessment request payload changed' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Changed assessment request accepted'; END IF;
 -- The final receipt write must roll back all three artifacts and assessment.
 changed:=jsonb_set(jsonb_set(payload,'{p_planning_use}','"Synthetic receipt failure"'),'{p_assessment_metadata,planning_use}','"Synthetic receipt failure"');
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_assessment(gen_random_uuid(),changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic assessment receipt failure' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Late receipt failure not exercised'; END IF;
 IF (SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id=run)<>1
  OR (SELECT count(*) FROM public.model_run_artifacts WHERE run_id=run)<>4
  OR (SELECT count(*) FROM public.model_assessment_command_receipts WHERE run_id=run)<>1 THEN
  RAISE EXCEPTION 'Late assessment failure left partial records'; END IF;
 FOREACH prefix IN ARRAY ARRAY['p_validation_input','p_comparison_basis','p_assessment'] LOOP
  changed:=jsonb_set(payload,ARRAY[prefix||'_size'],'"2"'); rejected:=false;
  BEGIN PERFORM public.record_legacy_model_assessment(gen_random_uuid(),changed);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid retained assessment artifact fields' THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Coerced assessment size accepted'; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['failed','cancelled'] LOOP
  UPDATE public.model_runs SET status=field WHERE id=run;
  rejected:=false;
  BEGIN PERFORM public.record_legacy_model_assessment(gen_random_uuid(),payload);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Stopped run cannot record new assessment' THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stopped assessment command accepted'; END IF;
  IF public.record_legacy_model_assessment(request,payload) IS DISTINCT FROM response THEN RAISE EXCEPTION 'Historical assessment receipt changed'; END IF;
 END LOOP;
 UPDATE public.model_runs SET status='queued' WHERE id=run;
 PERFORM public.claim_model_stage_attempt(gen_random_uuid(),stage,'synthetic-assessment-boundary');
 rejected:=false;
 BEGIN PERFORM public.record_legacy_model_assessment(gen_random_uuid(),payload);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Managed assessment requires attempt-bound ingestion' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Managed legacy assessment accepted'; END IF;
 IF has_table_privilege('service_role','public.model_assessment_command_receipts','INSERT')
  OR has_function_privilege('authenticated','public.record_legacy_model_assessment(uuid,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Assessment command privileges exposed'; END IF;
 RAISE NOTICE 'assessment-command: exact retry, rollback and lifecycle cases passed';
END;
$$;
