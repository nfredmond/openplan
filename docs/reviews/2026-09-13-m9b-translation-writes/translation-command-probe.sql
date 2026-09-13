GRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;
CREATE TEMP TABLE translation_command_results (result jsonb);
CREATE FUNCTION pg_temp.require_translation_refusal(
 c uuid,r uuid,op text,locale text,reason text,entries jsonb,expected_code text,label text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.write_engagement_translations(c,r,op,locale,reason,entries);
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected_code THEN RETURN; END IF;
  RAISE EXCEPTION 'Refusal % expected %, got %: %',label,expected_code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'Guard failed: %',label;
END $$;
DO $proof$
DECLARE
 workspace uuid:=gen_random_uuid(); campaign uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
 viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
 payload jsonb; corrected_payload jsonb; outcome jsonb; replay jsonb; original_id uuid; original_hash text;
 original_source text:=chr(160)||'SYNTHETIC original source'||chr(65279);
 failures integer:=0; machine_id uuid:=gen_random_uuid(); history_count bigint;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@translation-command.invalid'
 FROM unnest(ARRAY[actor,viewer,outsider]) id;
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC translation command',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer');
 INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by) VALUES(campaign,workspace,original_source,'SYNTHETIC summary',actor);
 payload:=jsonb_build_array(jsonb_build_object('entityType','campaign','entityId',campaign,'field','title',
  'expectedSource',jsonb_build_object('text',original_source,'sourceLocale',NULL,'available',true),
  'expectedTranslation',NULL,'text','SYNTHETIC original wording'));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.require_translation_refusal(campaign,NULL,'save','qaa',NULL,payload,'22023','missing request id');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'unknown','qaa',NULL,payload,'22023','unsupported operation');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','bad tag',NULL,payload,'22023','invalid language tag');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,'[]','22023','empty batch');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',repeat('x',2001),payload,'22023','oversized reason');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,payload||payload,'22023','duplicate address');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,
  jsonb_set(payload,'{0,unknown}','true'),'22023','unexpected entry field');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,
  jsonb_set(payload,'{0,text}',to_jsonb(chr(160))),'22023','blank translated wording');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,
  jsonb_set(payload,'{0,text}',to_jsonb(repeat('x',8001))),'22023','oversized translated wording');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,
  jsonb_set(payload,'{0,field}','"private_metadata"'),'22023','unsupported source field');
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,
  jsonb_set(jsonb_set(jsonb_set(payload,'{0,entityType}','"category"'),'{0,field}','"label"'),'{0,entityId}',to_jsonb(gen_random_uuid())),
  'PT409','missing or foreign source');
 outcome:=write_engagement_translations(campaign,request,'save','qaa',NULL,payload);
 original_id:=(outcome#>>'{entries,0,entry,id}')::uuid;
 IF outcome#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM 'SYNTHETIC original wording' OR outcome#>>'{entries,0,revision}' IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Positive creation failed';
 END IF;
 SELECT record_sha256 INTO STRICT original_hash FROM engagement_translation_history WHERE translation_id=original_id AND revision=1;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=original_id AND write_request_id=request)
 OR NOT EXISTS(SELECT 1 FROM engagement_translation_write_receipts r WHERE request_id=request AND r.payload#>>'{entries,0,expectedSource,text}'=original_source) THEN
  RAISE EXCEPTION 'Exact raw source/receipt custody failed';
 END IF;
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,payload,'PT409','existing address presented as absent');
 corrected_payload:=jsonb_set(jsonb_set(payload,'{0,expectedTranslation}',jsonb_build_object('id',original_id,'revision',1)),
  '{0,text}',to_jsonb('SYNTHETIC corrected wording'::text));
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa',NULL,corrected_payload,'22023','missing correction reason');
 outcome:=write_engagement_translations(campaign,gen_random_uuid(),'save','qaa','SYNTHETIC correction reason',corrected_payload);
 IF outcome#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM 'SYNTHETIC corrected wording' OR outcome#>>'{entries,0,revision}' IS DISTINCT FROM '2' THEN
  RAISE EXCEPTION 'Positive correction failed';
 END IF;
 -- An exact first-request retry returns its original result even after correction.
 replay:=write_engagement_translations(campaign,request,'save','qaa',NULL,payload);
 IF replay#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM 'SYNTHETIC original wording' OR replay->>'replayed' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Confirmed retry did not return the original result';
 END IF;
 BEGIN
  PERFORM write_engagement_translations(campaign,request,'save','qaa','different',payload);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN failures:=failures+1; END;
 BEGIN
  PERFORM write_engagement_translations(campaign,gen_random_uuid(),'save','qaa','stale editor',corrected_payload);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN failures:=failures+1; END;
 IF failures<>2 THEN RAISE EXCEPTION 'Request reuse or stale-version guard failed'; END IF;
 -- A changed source cannot silently relabel old words as current.
 UPDATE engagement_campaigns SET title='SYNTHETIC changed source' WHERE id=campaign;
 corrected_payload:=jsonb_set(corrected_payload,'{0,expectedTranslation,revision}','2'::jsonb);
 BEGIN
  PERFORM write_engagement_translations(campaign,gen_random_uuid(),'save','qaa','old source',corrected_payload);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN failures:=failures+1; END;
 IF failures<>3 THEN RAISE EXCEPTION 'Source-version guard failed'; END IF;
 UPDATE engagement_campaigns SET title=original_source WHERE id=campaign;
 -- Sorted title fails after a valid summary insert: the entire batch rolls back.
 BEGIN
  PERFORM write_engagement_translations(campaign,gen_random_uuid(),'save','qaa','batch',
   jsonb_build_array(jsonb_build_object('entityType','campaign','entityId',campaign,'field','summary',
    'expectedSource',jsonb_build_object('text','SYNTHETIC summary','sourceLocale',NULL,'available',true),
    'expectedTranslation',NULL,'text','SYNTHETIC should roll back'))||
   jsonb_set(corrected_payload,'{0,expectedTranslation,revision}','1'::jsonb));
 EXCEPTION WHEN SQLSTATE 'PT409' THEN failures:=failures+1; END;
 IF failures<>4 OR EXISTS(SELECT 1 FROM engagement_content_translations WHERE campaign_id=campaign AND field='summary') THEN
  RAISE EXCEPTION 'Whole-batch rollback failed';
 END IF;
 UPDATE engagement_campaigns SET title='SYNTHETIC original source' WHERE id=campaign;
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qaa','trimmed source',corrected_payload,'PT409','raw source changed despite same compatibility hash');
 UPDATE engagement_campaigns SET title=original_source WHERE id=campaign;
 corrected_payload:=(corrected_payload->0)-'text';
 outcome:=write_engagement_translations(campaign,gen_random_uuid(),'withdraw','qaa','SYNTHETIC withdrawal',jsonb_build_array(corrected_payload));
 IF outcome#>>'{entries,0,revision}' IS DISTINCT FROM '3' OR outcome#>>'{entries,0,removed}' IS DISTINCT FROM 'true'
 OR EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=original_id) THEN RAISE EXCEPTION 'Withdrawal failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=original_id AND revision=1 AND record_sha256=original_hash) THEN
  RAISE EXCEPTION 'Original history changed';
 END IF;
 outcome:=write_engagement_translations(campaign,gen_random_uuid(),'save','qaa',NULL,payload);
 IF (outcome#>>'{entries,0,entry,id}') IS NULL OR (outcome#>>'{entries,0,entry,id}')::uuid=original_id OR outcome#>>'{entries,0,revision}' IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Recreation reused a retained identity';
 END IF;
 -- A caller-supplied setting cannot attach a completed request to a later write.
 PERFORM set_config('openplan.translation_write_request',request::text,true);
 UPDATE engagement_content_translations SET translated_text='SYNTHETIC unrelated legacy write'
 WHERE campaign_id=campaign AND entity_type='campaign' AND entity_id=campaign AND locale='qaa';
 IF EXISTS(SELECT 1 FROM engagement_translation_history WHERE campaign_id=campaign
  AND record_json->>'translated_text'='SYNTHETIC unrelated legacy write' AND write_request_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Completed receipt context was forged';
 END IF;
 PERFORM set_config('openplan.translation_write_request','',true);
 PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'save','qad',NULL,payload,'42501','viewer fresh write');
 BEGIN
  PERFORM write_engagement_translations(campaign,request,'save','qaa',NULL,payload);
 EXCEPTION WHEN insufficient_privilege THEN failures:=failures+1; END;
 IF EXISTS(SELECT 1 FROM engagement_translation_write_receipts WHERE campaign_id=campaign) THEN RAISE EXCEPTION 'Viewer read receipt'; END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 BEGIN
  PERFORM write_engagement_translations(campaign,request,'save','qaa',NULL,payload);
 EXCEPTION WHEN insufficient_privilege THEN failures:=failures+1; END;
 IF EXISTS(SELECT 1 FROM engagement_translation_write_receipts WHERE campaign_id=campaign) THEN RAISE EXCEPTION 'Outsider read receipt'; END IF;
 IF failures<>6 THEN RAISE EXCEPTION 'Caller access was not rechecked before retry'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 BEGIN
  UPDATE engagement_translation_write_receipts SET result_json='{}' WHERE campaign_id=campaign;
 EXCEPTION WHEN insufficient_privilege THEN failures:=failures+1; END;
 RESET ROLE;
 BEGIN
  UPDATE engagement_translation_write_receipts SET result_json='{}' WHERE campaign_id=campaign AND request_id=request;
 EXCEPTION WHEN raise_exception THEN failures:=failures+1; END;
 IF failures<>8 THEN RAISE EXCEPTION 'Receipt immutability failed'; END IF;
 -- Legacy model fixture is deliberately synthetic, not an observed model call.
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,source_text_hash,created_by)
 VALUES(machine_id,workspace,campaign,'campaign',campaign,'title','qab','SYNTHETIC model wording','machine','SYNTHETIC model',translation_source_compatibility_hash(original_source),actor);
 SET LOCAL ROLE authenticated;
 payload:=jsonb_build_array(jsonb_build_object('entityType','campaign','entityId',campaign,'field','title',
  'expectedSource',jsonb_build_object('text',original_source,'sourceLocale',NULL,'available',true),
  'expectedTranslation',jsonb_build_object('id',machine_id,'revision',1)));
 UPDATE engagement_campaigns SET title='SYNTHETIC changed source' WHERE id=campaign;
 PERFORM pg_temp.require_translation_refusal(campaign,gen_random_uuid(),'accept','qab','old generated source',
  jsonb_set(payload,'{0,expectedSource,text}','"SYNTHETIC changed source"'),'PT409','stale machine source');
 UPDATE engagement_campaigns SET title=original_source WHERE id=campaign;
 outcome:=write_engagement_translations(campaign,gen_random_uuid(),'accept','qab','SYNTHETIC acceptance',payload);
 IF outcome#>>'{entries,0,entry,source}' IS DISTINCT FROM 'operator' OR NOT EXISTS(SELECT 1 FROM engagement_translation_history
  WHERE translation_id=machine_id AND revision=1 AND record_json->>'machine_model'='SYNTHETIC model') THEN
  RAISE EXCEPTION 'Acceptance lost the retained model origin';
 END IF;
 BEGIN
  PERFORM write_engagement_translations(campaign,gen_random_uuid(),'publish_generated','qab','SYNTHETIC pending generator',payload);
 EXCEPTION WHEN feature_not_supported THEN failures:=failures+1; END;
 IF failures<>9 THEN RAISE EXCEPTION 'Unfinished generation publication was not refused'; END IF;
 RESET ROLE;
 SELECT count(*) INTO history_count FROM engagement_translation_history WHERE campaign_id=campaign;
 INSERT INTO pg_temp.translation_command_results VALUES(jsonb_build_object('positiveCreateCorrectWithdrawRecreateAccept',true,
 'exactRetryAfterCorrection',true,'staleSourceAndVersionRefused',true,'wholeBatchRollback',true,'callerAndReceiptGuards',true,
 'originalHash',original_hash,'historyRows',history_count,'scope','Rollback SQL candidate only; generation/UI/direct-write retirement and concurrent acceptance unfinished'));
END $proof$;
SELECT result FROM pg_temp.translation_command_results;
