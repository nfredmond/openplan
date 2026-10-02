-- Whole-source custody fixture. Context/result hashes remain synthetic claims;
-- this proves exact storage, membership and scope, never model execution.
RESET ROLE;
CREATE TEMP TABLE thematic_seal_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON thematic_seal_probe TO service_role;
GRANT SELECT ON thematic_seal_probe TO authenticated;
CREATE FUNCTION pg_temp.seal_manifest() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE request engagement_synthesis_generation_requests; source engagement_synthesis_sources; thematic engagement_synthesis_thematic_requests;
 entry engagement_synthesis_thematic_inputs; seed text; tail text; bytes bigint:=0; n bigint:=0;
BEGIN
 SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id='f0000000-0000-4000-8000-000000000010';
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=request.source_id;
 SELECT * INTO thematic FROM engagement_synthesis_thematic_requests WHERE request_id=request.id;
 seed:=encode(extensions.digest(concat_ws(':','synthesis-thematic-inputs-v1',request.id,request.campaign_id,request.workspace_id,
  request.actor_id,request.intent_sha256,thematic.thematic_sha256,source.id,source.snapshot_sha256),'sha256'),'hex');
 tail:=seed;
 FOR entry IN SELECT * FROM engagement_synthesis_thematic_inputs WHERE request_id=request.id ORDER BY target_record_id COLLATE "C" LOOP
  tail:=encode(extensions.digest(concat_ws(':',tail,entry.target_record_id,entry.proof_sha256,entry.output_sha256,octet_length(entry.output_text)),'sha256'),'hex');
  n:=n+1;bytes:=bytes+octet_length(entry.output_text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_input_manifest','requestId',request.id,
  'campaignId',request.campaign_id,'workspaceId',request.workspace_id,'actorId',request.actor_id,'intentSha256',request.intent_sha256,
  'thematicSha256',thematic.thematic_sha256,'sourceId',source.id,'sourceSha256',source.snapshot_sha256,
  'inputCount',n,'outputBytes',bytes,'seedSha256',seed,'tailSha256',tail);
END $$;
CREATE FUNCTION pg_temp.seal_save(patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT seal_engagement_synthesis_thematic_inputs('f0000000-0000-4000-8000-000000000010',(pg_temp.seal_manifest()||patch)::text);
$$;
CREATE FUNCTION pg_temp.seal_page(after_target text DEFAULT NULL,page_limit integer DEFAULT 128) RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_input_inventory('f0000000-0000-4000-8000-000000000010',after_target,page_limit);
$$;
CREATE FUNCTION pg_temp.seal_history() RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_input_seal_history('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000010');
$$;
CREATE FUNCTION pg_temp.seal_broken(command text,label text,probe text DEFAULT 'SELECT pg_temp.seal_save()',expected_code text DEFAULT 'PT409') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  IF position('seal_source_patch' IN command)>0 THEN
   ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable;
  END IF;
  EXECUTE command; PERFORM pg_temp.expect_error(probe,expected_code,label);
  RAISE EXCEPTION 'Restore synthetic seal fixture' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
END $$;
-- Corrupt only source membership while preserving the source metadata binding.
-- This isolates native membership from the separate source checksum comparison.
CREATE FUNCTION pg_temp.seal_source_patch(patch jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE engagement_synthesis_sources SET snapshot_text=(snapshot_text::jsonb||patch)::text WHERE id='d0000000-0000-4000-8000-000000000002';
 ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable;
 UPDATE engagement_synthesis_generation_requests SET intent_text=jsonb_set(intent_text::jsonb,'{sourceSha256}',
  to_jsonb((SELECT snapshot_sha256 FROM engagement_synthesis_sources WHERE id=source_id)))::text WHERE id='f0000000-0000-4000-8000-000000000010';
END $$;
DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_engagement_synthesis_thematic_input_inventory(uuid,text,integer)',
 'public.seal_engagement_synthesis_thematic_inputs(uuid,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,signature,'EXECUTE'),'Client seal command allowed');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role',signature,'EXECUTE'),'Service seal command unavailable');
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['public.synthesis_thematic_input_seal_record(uuid)','public.synthesis_thematic_input_inventory_identity(uuid)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,signature,'EXECUTE'),'Private seal helper exposed');
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.read_engagement_synthesis_thematic_input_seal_history(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.read_engagement_synthesis_thematic_input_seal_history(uuid,uuid)','EXECUTE'),'Seal history impersonation allowed');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name,'engagement_synthesis_thematic_input_seals','INSERT,UPDATE,DELETE'),'Direct seal mutation allowed');
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='engagement_synthesis_thematic_input_seals'::regclass),'Seal RLS disabled');
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.seal_page()->'seal'='null'::jsonb,'Absent seal became complete');
SELECT pg_temp.expect_error('SELECT pg_temp.seal_save()','PT409','Incomplete source sealed');
SELECT pg_temp.expect_error('SELECT pg_temp.seal_page(NULL,0)','22023','Zero page limit accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.seal_page(NULL,129)','22023','Oversized page limit accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.seal_page(NULL,NULL)','22023','Null page limit accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.seal_page('invalid')$q$,'22023','Invalid target cursor accepted');
RESET ROLE;
-- Scope corruption is isolated from source contents by rolled-back metadata edits.
SELECT pg_temp.seal_broken($q$ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable; UPDATE engagement_synthesis_sources SET campaign_id='250f0f62-7225-48b3-a2f7-5a134d3b9f78' WHERE id='d0000000-0000-4000-8000-000000000002'$q$,'Foreign inventory source campaign accepted','SELECT pg_temp.seal_page()');
SELECT pg_temp.seal_broken($q$ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable; UPDATE engagement_synthesis_sources SET workspace_id='7791bbb4-6c7c-435e-9d1d-d2146334a944' WHERE id='d0000000-0000-4000-8000-000000000002'$q$,'Foreign inventory source workspace accepted','SELECT pg_temp.seal_page()');
SELECT pg_temp.seal_broken($q$ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET intent_text=jsonb_set(intent_text::jsonb,'{sourceId}','"d0000000-0000-4000-8000-000000000001"')::text WHERE id='f0000000-0000-4000-8000-000000000010'$q$,'Substituted inventory source ID accepted','SELECT pg_temp.seal_page()');
SELECT pg_temp.seal_broken($q$ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET intent_text=jsonb_set(intent_text::jsonb,'{sourceSha256}',to_jsonb(repeat('0',64)))::text WHERE id='f0000000-0000-4000-8000-000000000010'$q$,'Substituted inventory source hash accepted','SELECT pg_temp.seal_page()');
-- A separately authorized request has the same contribution. It must never
-- fill a missing input in this request's membership check or inventory page.
SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011');
SELECT retain_engagement_synthesis_thematic_choice('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000011',
 (SELECT choice_text FROM engagement_synthesis_thematic_choices WHERE request_id='f0000000-0000-4000-8000-000000000010' AND target_record_id='item:b0000000-0000-4000-8000-000000000301'));
SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000011','item:b0000000-0000-4000-8000-000000000301',
 (pg_temp.input_proof()||'{"requestId":"f0000000-0000-4000-8000-000000000011"}')::text,$raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$);
-- Complete every actual source member without truncating the >300-record set.
DO $$ DECLARE target text; context_id uuid; n integer:=1000; proof jsonb;
BEGIN
 FOR target IN SELECT 'item:'||(value->>'id') FROM engagement_synthesis_sources s,jsonb_array_elements(s.snapshot_text::jsonb->'items')
  WHERE s.id='d0000000-0000-4000-8000-000000000002'
 UNION ALL SELECT 'answer:'||(value->>'id') FROM engagement_synthesis_sources s,jsonb_array_elements(s.snapshot_text::jsonb->'answers')
  WHERE s.id='d0000000-0000-4000-8000-000000000002' LOOP
  n:=n+1;
  IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_choices WHERE request_id='f0000000-0000-4000-8000-000000000010' AND target_record_id=target) THEN
   context_id:=pg_temp.choice_context(n,jsonb_build_object('targetRecordId',target));
   PERFORM pg_temp.choice_save(jsonb_build_object('contextRequestId',context_id,'targetRecordId',target));
  END IF;
  proof:=pg_temp.input_proof(target);
  PERFORM retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010',target,proof::text,
   $raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$);
 END LOOP;
END $$;
SELECT pg_temp.assert_true((pg_temp.seal_manifest()->>'inputCount')::int>300,'Complete source fixture was clipped');
DO $$ DECLARE page jsonb; cursor text:=NULL; seen integer:=0; previous text:=NULL; entry jsonb; expected jsonb; BEGIN
 LOOP
  page:=pg_temp.seal_page(cursor,128);
  PERFORM pg_temp.assert_true(page->>'requestId'='f0000000-0000-4000-8000-000000000010' AND page->'afterTargetRecordId' IS NOT DISTINCT FROM coalesce(to_jsonb(cursor),'null'::jsonb),'Inventory cursor or scope differs');
  PERFORM pg_temp.assert_true(jsonb_array_length(page->'entries') BETWEEN 1 AND 128,'Inventory page bound differs');
  FOR entry IN SELECT value FROM jsonb_array_elements(page->'entries') LOOP
   PERFORM pg_temp.assert_true(previous IS NULL OR entry->>'targetRecordId' COLLATE "C">previous COLLATE "C",'Inventory ordering differs');
   SELECT jsonb_build_object('targetRecordId',target_record_id,'proofText',proof_text,'proofSha256',proof_sha256,
    'outputSha256',output_sha256,'outputBytes',octet_length(output_text)) INTO expected FROM engagement_synthesis_thematic_inputs
    WHERE request_id='f0000000-0000-4000-8000-000000000010' AND target_record_id=entry->>'targetRecordId';
   PERFORM pg_temp.assert_true(entry=expected,'Inventory metadata differs');
   seen:=seen+1;previous:=entry->>'targetRecordId';
  END LOOP;
  cursor:=previous;
  EXIT WHEN page->>'hasMore'='false';
 END LOOP;
 PERFORM pg_temp.assert_true(seen=(pg_temp.seal_manifest()->>'inputCount')::int,'Inventory silently omitted its tail');
 PERFORM pg_temp.assert_true(pg_temp.seal_page(cursor,1)->'entries'='[]'::jsonb,'Inventory tail is not exhausted');
END $$;
-- Every manifest field must bind the database's own membership and bytes.
DO $$ DECLARE key text; BEGIN
 FOR key IN SELECT jsonb_object_keys(pg_temp.seal_manifest()) LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.seal_save(%L)',jsonb_build_object(key,NULL)),'PT409','Changed seal manifest accepted: '||key);
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.seal_save('{"extra":true}')$q$,'PT409','Extra manifest field accepted');
SELECT pg_temp.expect_error($q$SELECT seal_engagement_synthesis_thematic_inputs('f0000000-0000-4000-8000-000000000010',NULL)$q$,'22023','Null manifest accepted');
SELECT pg_temp.expect_error($q$SELECT seal_engagement_synthesis_thematic_inputs('f0000000-0000-4000-8000-000000000010','{"x":1,"x":2}')$q$,'22023','Duplicate manifest keys accepted');
SELECT pg_temp.expect_error($q$SELECT seal_engagement_synthesis_thematic_inputs('f0000000-0000-4000-8000-000000000010',repeat(' ',8193)||pg_temp.seal_manifest()::text)$q$,'22023','Oversized manifest accepted');
SELECT pg_temp.seal_broken($q$SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110')$q$,'Cancelled source sealed');
SELECT pg_temp.seal_broken($q$ALTER TABLE engagement_synthesis_thematic_inputs DISABLE TRIGGER synthesis_thematic_input_immutable; DELETE FROM engagement_synthesis_thematic_inputs WHERE request_id='f0000000-0000-4000-8000-000000000010' AND target_record_id='item:b0000000-0000-4000-8000-000000000301'$q$,'Missing last input sealed');
SELECT pg_temp.seal_broken($q$SELECT pg_temp.seal_source_patch(jsonb_build_object('items',(SELECT snapshot_text::jsonb->'items'||jsonb_build_array(snapshot_text::jsonb#>'{items,0}') FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000002')))$q$,'Duplicate source membership sealed');
SELECT pg_temp.seal_broken($q$SELECT pg_temp.seal_source_patch('{"items":[],"answers":[]}')$q$,'Empty source sealed');
SELECT pg_temp.seal_broken($q$SELECT pg_temp.seal_source_patch('{"items":null}')$q$,'Unknown item source sealed');
SELECT pg_temp.seal_broken($q$SELECT pg_temp.seal_source_patch(jsonb_build_object('items',(SELECT jsonb_set(snapshot_text::jsonb->'items','{0,id}','"b0000000-0000-4000-8000-000000999999"') FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000002')))$q$,'Same-count substituted source sealed');
-- All expected records remain but the source excludes one, isolating extra rows.
SELECT pg_temp.seal_broken($q$SELECT pg_temp.seal_source_patch(jsonb_build_object('items',(SELECT (snapshot_text::jsonb->'items')-0 FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000002')))$q$,'Extra retained contribution sealed');
SET LOCAL ROLE service_role;
INSERT INTO thematic_seal_probe VALUES('original',pg_temp.seal_save());
SELECT pg_temp.assert_true((SELECT (value->>'manifestText')::jsonb=pg_temp.seal_manifest()
 AND value->>'manifestSha256'=encode(extensions.digest(value->>'manifestText','sha256'),'hex')
 AND value->>'receiptSha256'=encode(extensions.digest(value->>'receiptText','sha256'),'hex')
 AND (value->>'receiptText')::jsonb->>'manifestSha256'=value->>'manifestSha256' FROM thematic_seal_probe WHERE key='original'),'Seal bytes or digests differ');
SELECT pg_temp.assert_true(pg_temp.seal_save()=(SELECT value FROM thematic_seal_probe WHERE key='original'),'Exact seal retry differs');
SELECT pg_temp.assert_true(pg_temp.seal_page()->'seal'=(SELECT value FROM thematic_seal_probe WHERE key='original'),'Inventory lost the retained seal');
SELECT pg_temp.expect_error($q$SELECT pg_temp.seal_save('{"tailSha256":"changed"}')$q$,'PT409','Changed seal retry accepted');
SELECT pg_temp.expect_error($q$SELECT seal_engagement_synthesis_thematic_inputs('f0000000-0000-4000-8000-000000000010',' '||pg_temp.seal_manifest()::text)$q$,'PT409','Whitespace changed exact seal retry');
RESET ROLE;
SELECT pg_temp.seal_broken($q$ALTER TABLE engagement_synthesis_thematic_inputs DISABLE TRIGGER synthesis_thematic_input_immutable; DELETE FROM engagement_synthesis_thematic_inputs WHERE request_id='f0000000-0000-4000-8000-000000000010' AND target_record_id='item:b0000000-0000-4000-8000-000000000301'$q$,'Fresh input entered sealed request','SELECT pg_temp.input_save()');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_thematic_input_seals SET manifest_text='{}' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Seal update allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_thematic_input_seals WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Seal delete allowed');
-- Emit synthetic inputs for an independent TypeScript/native chain comparison.
SELECT 'SEAL-COMPATIBILITY:'||jsonb_build_object('scope',jsonb_build_object('campaignId',r.campaign_id,'workspaceId',r.workspace_id,'requestId',r.id),
 'request',synthesis_thematic_input_inventory_identity(r.id)->'thematic',
 'source',jsonb_build_object('requestId',s.id,'campaignId',s.campaign_id,'workspaceId',s.workspace_id,'snapshotText',s.snapshot_text,'snapshotSha256',s.snapshot_sha256,'createdAt',s.created_at),
 'entries',(SELECT jsonb_agg(jsonb_build_object('targetRecordId',target_record_id,'proofText',proof_text,'proofSha256',proof_sha256,'outputSha256',output_sha256,'outputBytes',octet_length(output_text))) FROM engagement_synthesis_thematic_inputs WHERE request_id=r.id),
 'manifest',pg_temp.seal_manifest())::text FROM engagement_synthesis_generation_requests r JOIN engagement_synthesis_sources s ON s.id=r.source_id WHERE r.id='f0000000-0000-4000-8000-000000000010';
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.seal_save()=(SELECT value FROM thematic_seal_probe WHERE key='original'),'Cancelled request lost exact seal retry');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.seal_history()=(SELECT value FROM thematic_seal_probe WHERE key='original'),'Staff lost seal history');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.seal_page()','42501','Revoked requester read inventory');
SELECT pg_temp.expect_error('SELECT pg_temp.seal_save()','42501','Revoked requester recovered seal');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.seal_history()','42501','Revoked staff read seal history');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.assert_true(pg_temp.seal_history()=(SELECT value FROM thematic_seal_probe WHERE key='original'),'Current staff lost departed seal author history');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.seal_history()','42501','Foreign staff read seal history');
RESET ROLE;
SELECT 'synthesis-thematic-input-seal-verified';
