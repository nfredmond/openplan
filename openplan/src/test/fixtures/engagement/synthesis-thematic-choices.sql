-- Native choice custody uses proposed digests. HTTP tests separately reconstruct
-- actual retained output. Every fixture and injected historical mismatch rolls back.
RESET ROLE;
CREATE TEMP TABLE thematic_choice_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON thematic_choice_probe TO authenticated;
GRANT SELECT ON thematic_choice_probe TO anon,service_role;
INSERT INTO thematic_choice_probe VALUES('choice',jsonb_build_object('schemaVersion',1,
 'targetRecordId','item:b0000000-0000-4000-8000-000000000301','contextRequestId','f0000000-0000-4000-8000-000000000014',
 'selectionSequence',0,'historyManifestSha256',repeat('c',64),'finalCaptureSha256',repeat('d',64),'finalResultSha256',repeat('e',64)));
CREATE FUNCTION pg_temp.choice_save(patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_thematic_choice('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000010',
 (value||patch)::text) FROM thematic_choice_probe WHERE key='choice';
$$;
CREATE FUNCTION pg_temp.choice_read(target text DEFAULT 'item:b0000000-0000-4000-8000-000000000301') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_choice('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000010',target);
$$;
-- Seed inconsistent historical rows to isolate joined-scope checks. Normal
-- callers cannot write either private table or use this temporary helper.
CREATE FUNCTION pg_temp.choice_context(number integer, binding_patch jsonb DEFAULT '{}', row_patch jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE identity uuid:=('f1000000-0000-4000-8000-'||lpad(number::text,12,'0'))::uuid;
BEGIN
 INSERT INTO engagement_synthesis_generation_requests(id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text)
 SELECT identity,coalesce((row_patch->>'campaign')::uuid,campaign_id),coalesce((row_patch->>'workspace')::uuid,workspace_id),actor_id,
 coalesce((row_patch->>'source')::uuid,source_id),configuration_revision_id,intent_text FROM engagement_synthesis_generation_requests
 WHERE id='f0000000-0000-4000-8000-000000000001';
 INSERT INTO engagement_synthesis_context_requests(request_id,parent_request_id,context_text)
 SELECT identity,coalesce((binding_patch->>'parentRequestId')::uuid,parent_request_id),(context_text::jsonb||binding_patch)::text
 FROM engagement_synthesis_context_requests WHERE request_id='f0000000-0000-4000-8000-000000000014';
 RETURN identity;
END $$;
SELECT pg_temp.choice_context(1,'{}','{"campaign":"250f0f62-7225-48b3-a2f7-5a134d3b9f78"}');
SELECT pg_temp.choice_context(2,'{}','{"workspace":"7791bbb4-6c7c-435e-9d1d-d2146334a944"}');
SELECT pg_temp.choice_context(3,'{}','{"source":"d0000000-0000-4000-8000-000000000001"}');
SELECT pg_temp.choice_context(4,'{"parentRequestId":"f0000000-0000-4000-8000-000000000012"}');
SELECT pg_temp.choice_context(5,'{"selectionSequence":1}');
SELECT pg_temp.choice_context(6,jsonb_build_object('segmentResultsManifestSha256',repeat('0',64)));
SELECT pg_temp.choice_context(7,jsonb_build_object('contextManifestSha256',repeat('0',64)));
SELECT pg_temp.choice_context(8,'{"targetRecordId":"item:b0000000-0000-4000-8000-000000000300"}');
SELECT pg_temp.choice_context(9,'{"targetRecordId":"item:b0000000-0000-4000-8000-000000999999"}');
SELECT pg_temp.choice_context(10,jsonb_build_object('targetRecordId','answer:'||(SELECT snapshot_text::jsonb#>>'{answers,0,id}' FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000002')));
INSERT INTO thematic_choice_probe SELECT 'survey',jsonb_build_object('contextRequestId',request_id,'targetRecordId',context_text::jsonb->>'targetRecordId')
 FROM engagement_synthesis_context_requests WHERE request_id='f1000000-0000-4000-8000-000000000010';
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.retain_engagement_synthesis_thematic_choice(uuid,uuid,text)','EXECUTE'),'Anonymous choice write allowed');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.retain_engagement_synthesis_thematic_choice(uuid,uuid,text)','EXECUTE'),'Service impersonated choice author');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.read_engagement_synthesis_thematic_choice(uuid,uuid,text)','EXECUTE'),'Anonymous choice read allowed');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.read_engagement_synthesis_thematic_choice(uuid,uuid,text)','EXECUTE'),'Service impersonated choice reader');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.choice_read() IS NULL,'Absent choice became a saved result');
SELECT pg_temp.expect_error($q$SELECT pg_temp.choice_save('{"contextRequestId":"f1000000-0000-4000-8000-000000000099"}')$q$,'42501','Absent context accepted');
DO $$ DECLARE n integer; BEGIN
 FOR n IN 1..3 LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.choice_save(%L)',jsonb_build_object('contextRequestId','f1000000-0000-4000-8000-'||lpad(n::text,12,'0'))),'42501','Foreign context identity accepted');
 END LOOP;
 FOR n IN 4..8 LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.choice_save(%L)',jsonb_build_object('contextRequestId','f1000000-0000-4000-8000-'||lpad(n::text,12,'0'))),'PT409','Changed context binding accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.choice_save('{"selectionSequence":1}')$q$,'PT409','Future context selection accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.choice_save('{"contextRequestId":"f1000000-0000-4000-8000-000000000009","targetRecordId":"item:b0000000-0000-4000-8000-000000999999"}')$q$,'PT409','Unknown retained contribution accepted');
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"selectionSequence":-1}',
 '{"selectionSequence":9007199254740992}','{"selectionSequence":0.5}','{"selectionSequence":null}',
 '{"targetRecordId":"unknown:1"}','{"contextRequestId":null}','{"historyManifestSha256":"wrong"}',
 '{"finalCaptureSha256":"wrong"}','{"finalResultSha256":"wrong"}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.choice_save(%L)',patch),'22023','Malformed choice accepted');
 END LOOP;
END $$;
INSERT INTO thematic_choice_probe VALUES('original',pg_temp.choice_save());
SELECT pg_temp.assert_true((SELECT value->>'replayed'='false' AND value->>'createdBy'='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'
 AND (value->>'choiceText')::jsonb=(SELECT value FROM thematic_choice_probe WHERE key='choice')
 AND value->>'choiceSha256'=encode(extensions.digest(value->>'choiceText','sha256'),'hex') FROM thematic_choice_probe WHERE key='original'),'Original choice bytes or author changed');
SELECT pg_temp.assert_true(pg_temp.choice_read()=(SELECT value-'replayed' FROM thematic_choice_probe WHERE key='original'),'Choice read changed');
SELECT pg_temp.assert_true(pg_temp.choice_save()=(SELECT value||'{"replayed":true}' FROM thematic_choice_probe WHERE key='original'),'Exact choice retry changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.choice_save(jsonb_build_object('historyManifestSha256',repeat('0',64)))$q$,'PT409','Changed choice replayed');
SELECT pg_temp.choice_save((SELECT value FROM thematic_choice_probe WHERE key='survey'));
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_thematic_choices','42501','Direct choice read allowed');
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
SELECT pg_temp.assert_true(pg_temp.choice_save()=(SELECT value||'{"replayed":true}' FROM thematic_choice_probe WHERE key='original'),'Cancellation lost exact choice retry');
SELECT pg_temp.expect_error($q$SELECT pg_temp.choice_save('{"contextRequestId":"f1000000-0000-4000-8000-000000000008","targetRecordId":"item:b0000000-0000-4000-8000-000000000300"}')$q$,'PT409','Cancelled request accepted new choice');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_thematic_choices SET choice_text='{}' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Choice update allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_thematic_choices WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Choice delete allowed');
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.choice_read()','42501','Revoked staff read choice');
SELECT pg_temp.expect_error('SELECT pg_temp.choice_save()','42501','Revoked author replayed choice');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.assert_true(pg_temp.choice_read()=(SELECT value-'replayed' FROM thematic_choice_probe WHERE key='original'),'Current staff lost cancelled choice history');
SELECT pg_temp.expect_error('SELECT pg_temp.choice_save()','42501','Other staff replayed choice write');
RESET ROLE;
SELECT 'synthesis-thematic-choices-verified';
