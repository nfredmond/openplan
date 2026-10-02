-- Request-only custody. The hashes below are proposed synthetic identities,
-- not verified thematic output. The old executor must refuse them explicitly.
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.create_engagement_synthesis_thematic_request(uuid,uuid,text,text)','EXECUTE'),'Anonymous thematic creation allowed');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.read_engagement_synthesis_thematic_request(uuid,uuid)','EXECUTE'),'Anonymous thematic read allowed');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.create_engagement_synthesis_thematic_request(uuid,uuid,text,text)','EXECUTE'),'Service impersonated thematic requester');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.read_engagement_synthesis_thematic_request(uuid,uuid)','EXECUTE'),'Service impersonated thematic reader');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SET LOCAL ROLE authenticated;
SELECT create_engagement_synthesis_generation_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000020',
 (SELECT (b.value||s.value||c.value)::text FROM generation_probe b CROSS JOIN generation_probe s CROSS JOIN generation_probe c
 WHERE b.key='intent' AND s.key='foreignSource' AND c.key='foreignConfig'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_create();
SELECT pg_temp.gen_cancel();
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
CREATE TEMP TABLE thematic_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON thematic_probe TO authenticated;
GRANT SELECT ON thematic_probe TO service_role,anon;
INSERT INTO thematic_probe VALUES('binding',jsonb_build_object('schemaVersion',1,'parentRequestId','f0000000-0000-4000-8000-000000000001',
 'selectionSequence',0,'segmentResultsManifestSha256',repeat('a',64),'contextManifestSha256',repeat('b',64),
 'frameByteLimit',4096));
INSERT INTO thematic_probe SELECT 'otherSource',jsonb_build_object('sourceId',id,'sourceSha256',snapshot_sha256)
 FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000001';
INSERT INTO thematic_probe SELECT 'counts',jsonb_build_object('requests',(SELECT count(*) FROM engagement_synthesis_generation_requests),
 'thematics',(SELECT count(*) FROM engagement_synthesis_thematic_requests),'attempts',(SELECT count(*) FROM engagement_synthesis_generation_attempts));
CREATE FUNCTION pg_temp.thm_create(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000010',patch jsonb DEFAULT '{}',base_patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT create_engagement_synthesis_thematic_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request,
  (b.value||base_patch)::text,(c.value||patch)::text) FROM generation_probe b CROSS JOIN thematic_probe c WHERE b.key='intent' AND c.key='binding';
$$;
CREATE FUNCTION pg_temp.thm_read(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000010') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request);
$$;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
INSERT INTO thematic_probe VALUES('original',pg_temp.thm_create());
SELECT pg_temp.assert_true((SELECT value#>>'{request,actorId}'='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'
 AND value#>>'{thematic,parentRequestId}'='f0000000-0000-4000-8000-000000000001'
 AND (value#>>'{thematic,thematicText}')::jsonb=(SELECT value FROM thematic_probe WHERE key='binding')
 AND value#>>'{thematic,thematicSha256}'=encode(extensions.digest(value#>>'{thematic,thematicText}','sha256'),'hex')
 AND value->>'replayed'='false' FROM thematic_probe WHERE key='original'),'Thematic request lost binding or current authorship');
SELECT pg_temp.assert_true(pg_temp.thm_create()=(SELECT value||'{"replayed":true}' FROM thematic_probe WHERE key='original'),'Thematic request exact retry changed');
SELECT pg_temp.assert_true(pg_temp.thm_read()=(SELECT value-'replayed' FROM thematic_probe WHERE key='original'),'Thematic request read changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create(patch:='{"frameByteLimit":8192}')$q$,'PT409','Changed thematic bytes replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create(base_patch:='{"taskByteLimit":8192}')$q$,'PT409','Changed base bytes replayed');
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_thematic_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000010',(SELECT value::text FROM generation_probe WHERE key='intent'),' '||(SELECT value::text FROM thematic_probe WHERE key='binding'))$q$,'PT409','Whitespace changed exact thematic retry');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011','{"parentRequestId":"f0000000-0000-4000-8000-000000000011"}')$q$,'22023','Self parent accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011','{"parentRequestId":"f0000000-0000-4000-8000-000000000010"}')$q$,'PT409','Thematic parent treated as segment');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011','{"parentRequestId":"f0000000-0000-4000-8000-000000000099"}')$q$,'42501','Absent parent accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011','{"parentRequestId":"f0000000-0000-4000-8000-000000000020"}')$q$,'42501','Foreign parent accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000020')$q$,'42501','Foreign request identity exposed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011','{"selectionSequence":1}')$q$,'PT409','Future parent sequence accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000011',base_patch:=(SELECT value FROM thematic_probe WHERE key='otherSource'))$q$,'PT409','Different parent source accepted');
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"selectionSequence":-1}',
  '{"selectionSequence":9007199254740992}','{"selectionSequence":0.5}','{"selectionSequence":null}',
  '{"frameByteLimit":4095}','{"frameByteLimit":1048577}','{"frameByteLimit":4096.5}',
  '{"frameByteLimit":null}','{"segmentResultsManifestSha256":"wrong"}','{"contextManifestSha256":null}','{"contextManifestSha256":"wrong"}',
  '{"parentRequestId":false}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.thm_create(%L,%L)','f0000000-0000-4000-8000-000000000011',patch),'22023','Malformed thematic binding accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_thematic_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000011',(SELECT value::text FROM generation_probe WHERE key='intent'),repeat(' ',4097)||(SELECT value::text FROM thematic_probe WHERE key='binding'))$q$,'22023','Oversized thematic binding accepted');
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_thematic_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000011',(SELECT value::text FROM generation_probe WHERE key='intent'),replace((SELECT value::text FROM thematic_probe WHERE key='binding'),'"schemaVersion": 1','"schemaVersion": 2,"schemaVersion": 1'))$q$,'22023','Duplicate thematic keys accepted');
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000012');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000012')$q$,'PT409','Existing segment changed stage');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_read('f0000000-0000-4000-8000-000000000012')$q$,'42501','Segment exposed as thematic');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_thematic_requests','42501','Direct thematic table access allowed');
-- The parent remains cancelled and its actor remains unchanged.
SELECT pg_temp.assert_true(pg_temp.gen_read()#>>'{request,actorId}'='13466ed2-dcb7-4861-a528-68cc5579eea9'
 AND pg_temp.gen_read()->'cancellation'<>'null'::jsonb,'Thematic request changed parent custody');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000010')$q$,'0A000','Thematic request entered segment executor');
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000010','{}')$q$,'0A000','Thematic plan used segment recipe');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000012')$q$,'PT409','Ordinary segment preparation was blocked');
SELECT pg_temp.expect_error('SELECT pg_temp.thm_create()','42501','Service impersonated thematic requester');
SELECT pg_temp.expect_error('SELECT pg_temp.thm_read()','42501','Service impersonated thematic reader');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_thematic_requests SET thematic_text='{}' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Thematic binding mutation allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_thematic_requests WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Thematic binding deletion allowed');
-- Neither direction of dependent-stage nesting may borrow the old recipe.
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
CREATE FUNCTION pg_temp.themed_context(parent uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT create_engagement_synthesis_context_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000014',
 b.value::text,(c.value||jsonb_build_object('parentRequestId',parent,'contentManifestSha256',repeat('c',64),
 'targetRecordId','item:b0000000-0000-4000-8000-000000000301'))::text)
 FROM generation_probe b CROSS JOIN thematic_probe c WHERE b.key='intent' AND c.key='binding';
$$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.themed_context('f0000000-0000-4000-8000-000000000010')$q$,'PT409','Thematic parent entered context creation');
SELECT pg_temp.themed_context('f0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error($q$SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000015','{"parentRequestId":"f0000000-0000-4000-8000-000000000014"}')$q$,'PT409','Context parent entered thematic creation');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000010')$q$,'0A000','Thematic request entered context executor');
RESET ROLE;

-- Current staff can read but cannot retry someone else's write.
UPDATE workspace_members SET role='member' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.thm_read()=(SELECT value-'replayed' FROM thematic_probe WHERE key='original'),'Current staff lost thematic history');
SELECT pg_temp.expect_error('SELECT pg_temp.thm_create()','42501','Other staff replayed thematic write');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000010')$q$,'42501','Foreign campaign read thematic');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
INSERT INTO thematic_probe VALUES('cancelled',pg_temp.thm_read());
RESET ROLE;
UPDATE workspace_provider_api_connections SET revoked_at=clock_timestamp() WHERE id='e0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.thm_create()=(SELECT value||'{"replayed":true}' FROM thematic_probe WHERE key='cancelled'),'Cancelled thematic lost exact retry');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.thm_read()','42501','Revoked reader kept thematic access');
SELECT pg_temp.expect_error('SELECT pg_temp.thm_create()','42501','Revoked requester replayed thematic');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.thm_create()','42501','Anonymous thematic creation allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.thm_read()','42501','Anonymous thematic read allowed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=(SELECT (value->>'requests')::bigint+3 FROM thematic_probe WHERE key='counts') FROM engagement_synthesis_generation_requests),'Thematic refusal or retry added requests');
SELECT pg_temp.assert_true((SELECT count(*)=(SELECT (value->>'thematics')::bigint+1 FROM thematic_probe WHERE key='counts') FROM engagement_synthesis_thematic_requests),'Thematic refusal or retry added bindings');
SELECT pg_temp.assert_true((SELECT count(*)=(SELECT (value->>'attempts')::bigint FROM thematic_probe WHERE key='counts') FROM engagement_synthesis_generation_attempts),'Thematic request created provider attempts');
SELECT 'synthesis-thematic-requests-verified';
