DO $$
DECLARE
 run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); output uuid:=gen_random_uuid(); ws uuid;
 prior jsonb; payload jsonb; assessment jsonb; receipt jsonb; response jsonb;
 changed jsonb; rejected boolean; field text;
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,'aequilibrae','queued','Synthetic bound publication proof',created_by
 FROM public.model_runs WHERE id=current_setting('openplan.proof_fixture')::uuid RETURNING workspace_id INTO ws;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES(stage,run,'Synthetic assessment','running',1);
 INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash)
 VALUES(output,run,stage,'link_volumes','storage://run-artifacts/synthetic/output.csv',2,repeat('a',64));
 assessment:=jsonb_build_object('schema','openplan.model-validation-assessment.v1','rules_version',4,
  'scientific_outcome','inconclusive','planning_use','Synthetic only','partition','{}'::jsonb,
  'reasons','[]'::jsonb,'coverage','{}'::jsonb,'metrics','{}'::jsonb,'comparability_findings','[]'::jsonb,
  'exact_inputs','{}'::jsonb,'legacy_point_count_diagnostic','{}'::jsonb);
 SELECT to_jsonb(a) INTO receipt FROM public.record_modeling_validation_assessment(
  ws,run,stage,'assignment',output,
  'storage://run-artifacts/synthetic/input.json',2,repeat('a',64),
  jsonb_build_object('schema','openplan.validation-input-bundle.v1','comparison_basis_sha256',repeat('a',64)),
  'storage://run-artifacts/synthetic/basis.json',2,repeat('a',64),jsonb_build_object('schema','openplan.model-comparison-basis.v1'),
  'storage://run-artifacts/synthetic/assessment.json',2,repeat('a',64),assessment||jsonb_build_object('comparison_basis_sha256',repeat('a',64)),
  '{}'::jsonb,'Synthetic only','inconclusive','[]'::jsonb
 ) a;
 assessment:=assessment||jsonb_build_object('validation_evidence_write','recorded','validation_custody_receipt',receipt);
 prior:=public.read_legacy_model_evidence(ws,run,'assignment');
 payload:=jsonb_build_object('claim',jsonb_build_object('workspace_id',ws,'model_run_id',run,'track','assignment',
  'claim_status','prototype_only','status_reason','Synthetic bound evidence',
  'validation_summary_json',jsonb_build_object('validation_rules_version',4,'model_validation_assessment',assessment)),'metrics','[]'::jsonb);
 changed:=jsonb_set(payload,'{claim,validation_summary_json,model_validation_assessment,validation_evidence_write}','"pending"');
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',prior,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication assessment acknowledgement missing' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unconfirmed assessment publication accepted'; END IF;
 changed:=jsonb_set(payload,'{claim,track}','"behavioral_demand"');
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'behavioral_demand',prior,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication assessment receipt or scope mismatch' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Other-track assessment publication accepted'; END IF;
 FOREACH field IN ARRAY ARRAY['id','workspace_id','model_run_id','track','scientific_outcome'] LOOP
  changed:=jsonb_set(payload,ARRAY['claim','validation_summary_json','model_validation_assessment','validation_custody_receipt',field],'"unrelated"');
  rejected:=false;
  BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',prior,changed);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication assessment receipt or scope mismatch' THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unbound publication receipt accepted'; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['schema','rules_version','scientific_outcome','planning_use','partition','reasons','coverage','metrics','comparability_findings','exact_inputs','legacy_point_count_diagnostic'] LOOP
  changed:=jsonb_set(payload,ARRAY['claim','validation_summary_json','model_validation_assessment',field],'"unrelated"');
  rejected:=false;
  BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',prior,changed);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication assessment metadata mismatch' THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unbound publication metadata accepted'; END IF;
 END LOOP;
 changed:=payload #- ARRAY['claim','validation_summary_json','model_validation_assessment','validation_custody_receipt'];
 rejected:=false;
 BEGIN PERFORM public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',prior,changed);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Publication assessment acknowledgement missing' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Missing publication receipt accepted'; END IF;
 IF public.read_legacy_model_evidence(ws,run,'assignment') IS DISTINCT FROM prior
  OR EXISTS(SELECT 1 FROM public.model_evidence_publication_receipts WHERE run_id=run) THEN
  RAISE EXCEPTION 'Refused assessment publication changed evidence';
 END IF;
 response:=public.publish_legacy_model_evidence(gen_random_uuid(),ws,run,'assignment',prior,payload);
 IF response->'evidence'->'claims'->0->'validation_summary_json'->'model_validation_assessment'->'validation_custody_receipt' IS DISTINCT FROM receipt THEN
  RAISE EXCEPTION 'Bound assessment receipt not retained';
 END IF;
 RAISE NOTICE 'atomic-publication: stored assessment reference and metadata verified';
END;
$$;
