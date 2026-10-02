-- Synthetic custody bytes and digests. Native replay and provider semantics are
-- covered separately; these transactions exercise ownership and exact storage.
RESET ROLE;
CREATE TEMP TABLE thematic_input_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON thematic_input_probe TO service_role;
GRANT SELECT ON thematic_input_probe TO authenticated;
CREATE FUNCTION pg_temp.input_proof(target text DEFAULT 'item:b0000000-0000-4000-8000-000000000301') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_input',
  'requestId',r.id,'campaignId',r.campaign_id,'workspaceId',r.workspace_id,'actorId',r.actor_id,
  'intentSha256',r.intent_sha256,'thematicSha256',t.thematic_sha256,'sourceId',s.id,'sourceSha256',s.snapshot_sha256,
  'targetRecordId',c.target_record_id,'choiceSha256',c.choice_sha256,'contextRequestId',c.context_request_id,
  'contextRequestSha256',ctx.context_sha256,'historyManifestSha256',c.choice_text::jsonb->>'historyManifestSha256',
  'finalCaptureSha256',c.choice_text::jsonb->>'finalCaptureSha256','finalResultSha256',c.choice_text::jsonb->>'finalResultSha256',
  'outputSha256',encode(extensions.digest($raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$,'sha256'),'hex'))
 FROM engagement_synthesis_generation_requests r JOIN engagement_synthesis_thematic_requests t ON t.request_id=r.id
 JOIN engagement_synthesis_sources s ON s.id=r.source_id JOIN engagement_synthesis_thematic_choices c ON c.request_id=r.id
 JOIN engagement_synthesis_context_requests ctx ON ctx.request_id=c.context_request_id
 WHERE r.id='f0000000-0000-4000-8000-000000000010' AND c.target_record_id=target;
$$;
INSERT INTO thematic_input_probe VALUES('proof',pg_temp.input_proof());
INSERT INTO thematic_input_probe VALUES('surveyProof',pg_temp.input_proof((SELECT value->>'targetRecordId' FROM thematic_choice_probe WHERE key='survey')));
CREATE FUNCTION pg_temp.input_save(patch jsonb DEFAULT '{}', output text DEFAULT $raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$) RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010',
 'item:b0000000-0000-4000-8000-000000000301',(value||patch)::text,output) FROM thematic_input_probe WHERE key='proof';
$$;
CREATE FUNCTION pg_temp.input_read() RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301');
$$;
CREATE FUNCTION pg_temp.input_history(campaign uuid DEFAULT '10c5cdd7-16c6-4b91-b9c0-d2f67598a54f') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_input_history(campaign,'f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301');
$$;
DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_engagement_synthesis_thematic_input(uuid,text)',
 'public.retain_engagement_synthesis_thematic_input(uuid,text,text,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,signature,'EXECUTE'),'Client input command allowed');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role',signature,'EXECUTE'),'Service input command unavailable');
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['public.synthesis_thematic_input_record(uuid,text)','public.lock_synthesis_thematic_input_scope(uuid)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,signature,'EXECUTE'),'Private input helper exposed');
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.read_engagement_synthesis_thematic_input_history(uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.read_engagement_synthesis_thematic_input_history(uuid,uuid,text)','EXECUTE'),'History impersonation allowed');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name,'public.engagement_synthesis_thematic_inputs','INSERT,UPDATE,DELETE'),'Direct input mutation allowed');
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='engagement_synthesis_thematic_inputs'::regclass),'Input RLS disabled');
END $$;
-- Deliberately inconsistent history isolates the campaign join. The nested
-- rollback restores both the row and immutable trigger before ordinary writes.
DO $$ BEGIN
 BEGIN
  ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable;
  UPDATE engagement_synthesis_generation_requests SET campaign_id='250f0f62-7225-48b3-a2f7-5a134d3b9f78'
   WHERE id='f0000000-0000-4000-8000-000000000010';
  PERFORM pg_temp.expect_error('SELECT pg_temp.input_read()','42501','Foreign input campaign accepted');
  RAISE EXCEPTION 'Restore synthetic input scope' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.input_read() IS NULL,'Absent input became retained');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000099','item:b0000000-0000-4000-8000-000000000301')$q$,'42501','Absent input request exposed');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000012','item:b0000000-0000-4000-8000-000000000301')$q$,'0A000','Segment input scope accepted');
DO $$ DECLARE proof_key text; proof_value jsonb; BEGIN
 FOR proof_key,proof_value IN SELECT * FROM jsonb_each((SELECT value FROM thematic_input_probe WHERE key='proof')) LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.input_save(%L)',jsonb_build_object(proof_key,NULL)),'PT409','Changed input proof accepted: '||proof_key);
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{"extra":true}')$q$,'PT409','Extra input proof field accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{}','changed')$q$,'PT409','Changed original output accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{}','')$q$,'22023','Empty output accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{}',NULL)$q$,'22023','Null output accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{}',repeat('a',4194305))$q$,'22023','Oversized output accepted');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301',NULL,'a')$q$,'22023','Null proof accepted');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301','{"x":1,"x":2}','a')$q$,'22023','Duplicate proof keys accepted');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301',repeat(' ',8193)||'{}','a')$q$,'22023','Oversized proof accepted');
INSERT INTO thematic_input_probe VALUES('original',pg_temp.input_save());
SELECT pg_temp.assert_true((SELECT value->>'replayed'='false' AND (value->>'proofText')::jsonb=(SELECT value FROM thematic_input_probe WHERE key='proof')
 AND value->>'proofSha256'=encode(extensions.digest(value->>'proofText','sha256'),'hex')
 AND value->>'outputSha256'=encode(extensions.digest(value->>'outputText','sha256'),'hex')
 AND value->>'outputText'=$raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$
 AND value->>'createdAt' IS NOT NULL FROM thematic_input_probe WHERE key='original'),'Retained input bytes differ');
SELECT pg_temp.assert_true(pg_temp.input_read()=(SELECT value-'replayed' FROM thematic_input_probe WHERE key='original'),'Read input bytes differ');
SELECT pg_temp.assert_true(pg_temp.input_save()=(SELECT value||'{"replayed":true}' FROM thematic_input_probe WHERE key='original'),'Exact input retry differs');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{"outputSha256":"changed"}')$q$,'PT409','Changed input proof retry accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_save('{}','changed')$q$,'PT409','Changed input output retry accepted');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301',' '||(SELECT value::text FROM thematic_input_probe WHERE key='proof'),$raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$)$q$,'PT409','Whitespace changed exact input retry');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_thematic_inputs SET output_text='changed' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Input update allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_thematic_inputs WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Input delete allowed');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.input_history()=(SELECT value-'replayed' FROM thematic_input_probe WHERE key='original'),'Staff input history differs');
SELECT pg_temp.expect_error($q$SELECT pg_temp.input_history('250f0f62-7225-48b3-a2f7-5a134d3b9f78')$q$,'42501','Foreign campaign input history allowed');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_thematic_inputs','42501','Direct staff input read allowed');
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.input_save()=(SELECT value||'{"replayed":true}' FROM thematic_input_probe WHERE key='original'),'Cancelled input lost exact retry');
SELECT pg_temp.assert_true(pg_temp.input_read()=(SELECT value-'replayed' FROM thematic_input_probe WHERE key='original'),'Cancelled input lost read recovery');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_thematic_input('f0000000-0000-4000-8000-000000000010',value->>'targetRecordId',value::text,$raw${"notes":["SYNTHETIC \ud800", "\u0000", "中文"]}$raw$) FROM thematic_input_probe WHERE key='surveyProof'$q$,'PT409','Cancelled request retained fresh input');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.input_read()','42501','Revoked requester read input');
SELECT pg_temp.expect_error('SELECT pg_temp.input_save()','42501','Revoked requester replayed input');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.input_history()','42501','Revoked staff inspected input');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.assert_true(pg_temp.input_history()=(SELECT value-'replayed' FROM thematic_input_probe WHERE key='original'),'Current staff lost departed input author history');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.input_history()','42501','Foreign staff inspected input');
RESET ROLE;
SELECT 'synthesis-thematic-input-custody-verified';
