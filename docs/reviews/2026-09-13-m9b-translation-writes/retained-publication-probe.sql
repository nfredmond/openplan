CREATE FUNCTION pg_temp.publication_refusal(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Refusal % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'Guard failed: %',label;
END $$;
CREATE FUNCTION pg_temp.publish_call(entry jsonb,request_id uuid DEFAULT gen_random_uuid()) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT write_engagement_translations(%L,%L,%L,%L,%L,%L)',current_setting('openplan.publication_fixture')::jsonb->>'campaignId',request_id,
 'publish_generated','es','SYNTHETIC retained publication decision',jsonb_build_array(entry));
$$;
-- Direct SQL fixtures isolate guards using intentionally inconsistent private
-- records. They never represent worker execution or a new provider result.
CREATE FUNCTION pg_temp.publication_clone(kind text,baseline jsonb DEFAULT 'null'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb;
 r public.engagement_translation_generation_requests; j public.engagement_translation_generation_fields; o public.engagement_translation_generation_outputs;
 rid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid(); rsid uuid:=gen_random_uuid();
 address jsonb; packet text; binding text; ref jsonb; words text;
BEGIN
 SELECT * INTO STRICT j FROM engagement_translation_generation_fields WHERE id=(f->>'fieldId')::uuid;
 SELECT * INTO STRICT r FROM engagement_translation_generation_requests WHERE id=j.request_id;
 SELECT * INTO STRICT o FROM engagement_translation_generation_outputs WHERE field_id=j.id;
 address:=jsonb_set(j.address,'{expectedTranslation}',baseline);
 IF kind='source' THEN address:=jsonb_set(address,'{expectedSource,text}','"DIFFERENT synthetic source"'); END IF;
 packet:=replace(j.packet_canonical,j.id::text,fid::text);
 binding:=replace(replace(replace(replace(replace(o.binding_canonical,r.id::text,rid::text),j.id::text,fid::text),j.attempt_id::text,aid::text),j.reservation_id::text,rsid::text),j.packet_hash,encode(extensions.digest(packet,'sha256'),'hex'));
 IF kind='hash' THEN binding:=jsonb_set(binding::jsonb,'{outputHash}',to_jsonb(repeat('0',64)))::text; END IF;
 IF kind='model' THEN binding:=jsonb_set(binding::jsonb,'{model}','"SYNTHETIC different model"')::text; END IF;
 words:=o.output_json;
 IF kind='blank' THEN words:='" "';binding:=jsonb_set(binding::jsonb,'{outputHash}',to_jsonb(encode(extensions.digest(' ','sha256'),'hex')))::text; END IF;
 INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,locale,intent,credential,selected_key_ciphertext_hash)
 VALUES(rid,CASE WHEN kind='campaign' THEN gen_random_uuid() ELSE r.campaign_id END,
  CASE WHEN kind='workspace' THEN gen_random_uuid() ELSE r.workspace_id END,r.actor_id,CASE WHEN kind='locale' THEN 'fr' ELSE r.locale END,
  jsonb_build_object('requestId',rid,'actorId',r.actor_id,'campaignId',r.campaign_id,'locale',r.locale,'fields',jsonb_build_array(jsonb_build_object('id',fid,'address',address,'packetCanonical',packet))),r.credential,r.selected_key_ciphertext_hash);
 INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical,state,attempt_id,reservation_id,reserved_at,lease_expires_at,dispatch_authorized_at,finished_at)
 VALUES(fid,rid,1,address,packet,CASE WHEN kind='job_state' THEN 'cancelled' ELSE 'completed' END,aid,rsid,j.reserved_at,j.lease_expires_at,j.dispatch_authorized_at,j.finished_at);
 IF kind<>'missing_output' THEN
  INSERT INTO engagement_translation_generation_outputs(field_id,attempt_id,status,output_json,binding_canonical,provider_metadata_json,accepted_state)
  VALUES(fid,aid,CASE WHEN kind='output_status' THEN 'incomplete' ELSE 'completed' END,words,binding,o.provider_metadata_json,CASE WHEN kind='accepted_state' THEN 'cancelled' ELSE 'completed' END)
  RETURNING * INTO o;
 END IF;
 ref:=jsonb_build_object('requestId',rid,'fieldId',fid,'attemptId',aid,'deliveryDigest',o.delivery_digest);
 RETURN jsonb_set(j.address,'{expectedTranslation}',baseline)||jsonb_build_object('generation',ref);
END $$;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@publication.synthetic.invalid'
 FROM unnest(ARRAY[(f->>'publisher')::uuid,(f->>'viewer')::uuid,(f->>'outsider')::uuid]) id;
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES((f->>'workspaceId')::uuid,(f->>'publisher')::uuid,'owner'),((f->>'workspaceId')::uuid,(f->>'viewer')::uuid,'viewer');
 -- Prove publication uses retained output after key removal and generation actor
 -- membership loss. A different current owner performs the publication.
 DELETE FROM workspace_integration_keys WHERE workspace_id=(f->>'workspaceId')::uuid AND provider='anthropic';
 DELETE FROM workspace_members WHERE workspace_id=(f->>'workspaceId')::uuid AND user_id=(f->>'actorId')::uuid;
END $$;
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.retained_translation_publication(uuid,uuid,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Private publication helper exposed for execution'; END IF;
 IF has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Publication migration prematurely enabled command'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('openplan.publication_fixture')::jsonb->>'publisher',true) IS NOT NULL;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; e jsonb:=f->'entry'; bad jsonb;
BEGIN
 FOREACH bad IN ARRAY ARRAY[e-'generation',e||'{"text":"FORGED words"}'::jsonb,
 jsonb_set(e,'{generation,model}','"FORGED model"'),jsonb_set(e,'{generation,deliveryDigest}','"invalid"'),jsonb_set(e,'{generation,attemptId}','null'::jsonb)] LOOP
  PERFORM pg_temp.publication_refusal(pg_temp.publish_call(bad),'22023','malformed reference or supplied text');
 END LOOP;
 PERFORM pg_temp.publication_refusal(format('SELECT write_engagement_translations(%L,%L,%L,%L,%L,%L)',f->>'campaignId',gen_random_uuid(),'publish_generated','es',chr(160)||chr(65279),jsonb_build_array(e)),'22023','blank publication reason');
 PERFORM pg_temp.publication_refusal(format('SELECT retained_translation_publication(%L,%L,%L,%L)',f->>'campaignId',f->>'workspaceId','es',e),'42501','direct private publication helper');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(e,'{generation,requestId}',to_jsonb(gen_random_uuid()))),'PT409','wrong request identity');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(e,'{generation,attemptId}',to_jsonb(gen_random_uuid()))),'PT409','wrong attempt identity');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(e,'{generation,fieldId}',to_jsonb(gen_random_uuid()))),'PT409','missing field identity');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(e,'{generation,deliveryDigest}',to_jsonb(repeat('0',64)))),'PT409','wrong delivery identity');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(e,'{expectedSource,text}','"Changed caller source"')),'PT409','current source mismatch');
END $$;
RESET ROLE;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; e jsonb; kind text; before_count bigint;
BEGIN
 FOREACH kind IN ARRAY ARRAY['campaign','workspace','locale','source','job_state','output_status','accepted_state','missing_output','hash','model','blank'] LOOP
  e:=pg_temp.publication_clone(kind);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.publication_refusal(pg_temp.publish_call(e),'PT409',kind||' retained output');
  RESET ROLE;
 END LOOP;
 SELECT count(*) INTO before_count FROM engagement_translation_write_receipts WHERE campaign_id=(f->>'campaignId')::uuid;
 IF before_count<>0 OR EXISTS(SELECT 1 FROM engagement_content_translations WHERE campaign_id=(f->>'campaignId')::uuid) THEN RAISE EXCEPTION 'Refused publication left writes'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; e jsonb:=f->'entry'; second jsonb; statement text; result jsonb; person text;
BEGIN
 -- The first entry would succeed; the second retains a wrong digest. Both must
 -- roll back, including the receipt and the first translation/history insert.
 second:=jsonb_set(jsonb_set(e,'{field}','"summary"'),'{generation,deliveryDigest}',to_jsonb(repeat('0',64)));
 statement:=format('SELECT write_engagement_translations(%L,%L,%L,%L,%L,%L)',f->>'campaignId',gen_random_uuid(),'publish_generated','es','SYNTHETIC atomic batch',jsonb_build_array(e,second));
 PERFORM pg_temp.publication_refusal(statement,'PT409','atomic publication batch');
 FOREACH person IN ARRAY ARRAY['actorId','viewer','outsider'] LOOP
  PERFORM set_config('request.jwt.claim.sub',f->>person,true);
  PERFORM pg_temp.publication_refusal(pg_temp.publish_call(e),'42501',person||' cannot publish');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',f->>'publisher',true);
 BEGIN EXECUTE pg_temp.publish_call(e,(f->>'writeRequest')::uuid) INTO result;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Retained publication must succeed without current key or generating membership: % %',SQLSTATE,SQLERRM; END;
 IF result->>'operation'<>'publish_generated' OR result->>'replayed'<>'false' OR jsonb_array_length(result->'entries')<>1
 OR result#>>'{entries,0,entry,source}'<>'machine' OR result#>>'{entries,0,entry,machine_model}' IS DISTINCT FROM f->>'model'
 OR result#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM f->>'words' OR result#>>'{entries,0,entry,created_by}' IS DISTINCT FROM f->>'publisher'
 OR result#>>'{entries,0,generation,actorId}' IS DISTINCT FROM f->>'actorId'
 OR result#>'{entries,0,generation}' IS DISTINCT FROM (e->'generation')||jsonb_build_object('actorId',f->>'actorId','outputHash',f->>'outputHash')
 OR result#>>'{entries,0,revision}'<>'1' THEN RAISE EXCEPTION 'Retained publication lost words authorship or reference'; END IF;
 PERFORM set_config('openplan.publication_result',result::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; r jsonb:=current_setting('openplan.publication_result')::jsonb;
 original_digest text; original_metadata text;
BEGIN
 IF (SELECT count(*) FROM engagement_content_translations WHERE campaign_id=(f->>'campaignId')::uuid)<>1
 OR (SELECT count(*) FROM engagement_translation_write_receipts WHERE campaign_id=(f->>'campaignId')::uuid)<>1
 OR (SELECT count(*) FROM engagement_translation_history WHERE campaign_id=(f->>'campaignId')::uuid)<>1 THEN RAISE EXCEPTION 'Atomic publication or history count differs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=(r#>>'{entries,0,entry,id}')::uuid AND actor_id=(f->>'publisher')::uuid AND write_request_id=(f->>'writeRequest')::uuid) THEN RAISE EXCEPTION 'Publication history lost receipt link'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_write_receipts WHERE campaign_id=(f->>'campaignId')::uuid AND request_id=(f->>'writeRequest')::uuid AND actor_id=(f->>'publisher')::uuid
  AND payload#>'{entries,0,generation}'=f#>'{entry,generation}' AND result_json=r) THEN RAISE EXCEPTION 'Publication receipt lost exact generation reference'; END IF;
 SELECT delivery_digest,provider_metadata_json INTO original_digest,original_metadata FROM engagement_translation_generation_outputs WHERE field_id=(f->>'fieldId')::uuid;
 IF original_digest IS DISTINCT FROM f->>'digest' OR original_metadata IS DISTINCT FROM f->>'providerMetadata' THEN RAISE EXCEPTION 'Publication altered retained output'; END IF;
 UPDATE engagement_campaigns SET title='SYNTHETIC later source' WHERE id=(f->>'campaignId')::uuid;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; r jsonb;
BEGIN
 EXECUTE pg_temp.publish_call(f->'entry',(f->>'writeRequest')::uuid) INTO r;
 IF r IS DISTINCT FROM current_setting('openplan.publication_result')::jsonb||'{"replayed":true}'::jsonb THEN RAISE EXCEPTION 'Lost acknowledgement retry changed receipt'; END IF;
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(f->'entry'),'PT409','new publication after source changed');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(f->'entry','{generation,deliveryDigest}',to_jsonb(repeat('0',64))),(f->>'writeRequest')::uuid),'PT409','changed publication retry');
END $$;
RESET ROLE;
UPDATE engagement_campaigns SET title=current_setting('openplan.publication_fixture')::jsonb#>>'{entry,expectedSource,text}' WHERE id=(current_setting('openplan.publication_fixture')::jsonb->>'campaignId')::uuid;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; r jsonb:=current_setting('openplan.publication_result')::jsonb;
 baseline jsonb:=jsonb_build_object('id',r#>>'{entries,0,entry,id}','revision',1); e jsonb; second jsonb;
BEGIN
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(f->'entry'),'PT409','changed saved version');
 PERFORM pg_temp.publication_refusal(pg_temp.publish_call(jsonb_set(f->'entry','{expectedTranslation}',baseline)),'PT409','rebased old generation');
 RESET ROLE;
 e:=pg_temp.publication_clone('valid',baseline);
 SET LOCAL ROLE authenticated;
 EXECUTE pg_temp.publish_call(e,(f->>'secondWrite')::uuid) INTO second;
 IF second#>>'{entries,0,revision}'<>'2' OR second#>>'{entries,0,entry,id}' IS DISTINCT FROM baseline->>'id'
 OR second#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM f->>'words' THEN RAISE EXCEPTION 'Identical new generation lost revision'; END IF;
 PERFORM set_config('openplan.publication_second',second::text,true);
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=(baseline->>'id')::uuid AND revision=2 AND write_request_id=(f->>'secondWrite')::uuid)
 THEN RAISE EXCEPTION 'Identical new generation lost history link'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f jsonb:=current_setting('openplan.publication_fixture')::jsonb; second jsonb:=current_setting('openplan.publication_second')::jsonb;
 e jsonb; accepted jsonb; withdrawn jsonb; replay jsonb;
BEGIN
 e:=jsonb_set((f->'entry')-'generation','{expectedTranslation}',jsonb_build_object('id',second#>>'{entries,0,entry,id}','revision',2));
 accepted:=write_engagement_translations((f->>'campaignId')::uuid,gen_random_uuid(),'accept','es','SYNTHETIC acceptance after retained publication',jsonb_build_array(e));
 IF accepted#>>'{entries,0,revision}'<>'3' OR accepted#>>'{entries,0,entry,source}'<>'operator' THEN RAISE EXCEPTION 'Published wording acceptance lost revision'; END IF;
 e:=jsonb_set(e,'{expectedTranslation,revision}','3'::jsonb);
 withdrawn:=write_engagement_translations((f->>'campaignId')::uuid,gen_random_uuid(),'withdraw','es','SYNTHETIC withdrawal after acceptance',jsonb_build_array(e));
 IF withdrawn#>>'{entries,0,revision}'<>'4' OR withdrawn#>>'{entries,0,removed}'<>'true' THEN RAISE EXCEPTION 'Published wording withdrawal lost revision'; END IF;
 EXECUTE pg_temp.publish_call(f->'entry',(f->>'writeRequest')::uuid) INTO replay;
 IF replay IS DISTINCT FROM current_setting('openplan.publication_result')::jsonb||'{"replayed":true}'::jsonb THEN RAISE EXCEPTION 'Historical publication retry lost its receipt'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM engagement_content_translations WHERE campaign_id=(current_setting('openplan.publication_fixture')::jsonb->>'campaignId')::uuid) THEN
  RAISE EXCEPTION 'Historical publication retry resurrected withdrawn wording'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.publication_refusal(pg_temp.publish_call(current_setting('openplan.publication_fixture')::jsonb->'entry'),'42501','anonymous publication');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('openplan.publication_fixture')::jsonb->>'publisher',true) IS NOT NULL;
SELECT 'PUBLICATION_HISTORY:'||read_engagement_translation_history((current_setting('openplan.publication_fixture')::jsonb->>'campaignId')::uuid)::text;
SELECT 'PUBLICATION_SECOND_GENERATION:'||read_translation_generation_request((current_setting('openplan.publication_fixture')::jsonb->>'campaignId')::uuid,(current_setting('openplan.publication_second')::jsonb#>>'{entries,0,generation,requestId}')::uuid)::text;
SELECT 'PUBLICATION_GENERATION:'||read_translation_generation_request((current_setting('openplan.publication_fixture')::jsonb->>'campaignId')::uuid,(current_setting('openplan.publication_fixture')::jsonb#>>'{entry,generation,requestId}')::uuid)::text;
RESET ROLE;
SELECT 'PUBLICATION_RESULT:'||current_setting('openplan.publication_result');
SELECT 'PUBLICATION_PROBE_PASSED';
