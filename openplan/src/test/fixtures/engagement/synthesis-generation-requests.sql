-- Runs after the retained-source fixture in the same rolled-back transaction.
-- Configuration save uses the real native command, with a no-key synthetic local endpoint.
SELECT save_workspace_provider_api_revision('13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002',NULL,
 '{"label":"SYNTHETIC local API","protocol":"openai_chat_completions","endpoint":"http://localhost:9999/v1/","modelIds":["synthetic"],"structuredOutput":true,"authMode":"none","timeoutSeconds":10}',NULL);
SELECT save_workspace_provider_api_revision('14a71429-1cb2-49b5-8711-c696a2f394c3','7791bbb4-6c7c-435e-9d1d-d2146334a944',
 'e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000004',NULL,
 '{"label":"SYNTHETIC other API","protocol":"openai_chat_completions","endpoint":"http://localhost:9998/v1/","modelIds":["synthetic"],"structuredOutput":true,"authMode":"none","timeoutSeconds":10}',NULL);
CREATE TEMP TABLE generation_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON generation_probe TO authenticated;
-- Let permission probes reach the native function instead of failing on this helper table.
GRANT SELECT ON generation_probe TO anon,service_role;
INSERT INTO generation_probe SELECT 'intent',jsonb_build_object('schemaVersion',1,'sourceId',s.id,'sourceSha256',s.snapshot_sha256,
 'connectionId',r.connection_id,'configurationRevisionId',r.id,'configurationHash',r.configuration_hash,'modelId','synthetic','taskByteLimit',4096)
 FROM engagement_synthesis_sources s CROSS JOIN workspace_provider_api_revisions r
 WHERE s.id='d0000000-0000-4000-8000-000000000002' AND r.id='e0000000-0000-4000-8000-000000000002';
INSERT INTO generation_probe SELECT 'foreignSource',jsonb_build_object('sourceId',id,'sourceSha256',snapshot_sha256)
 FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000900';
INSERT INTO generation_probe SELECT 'foreignConfig',jsonb_build_object('connectionId',connection_id,'configurationRevisionId',id,'configurationHash',configuration_hash)
 FROM workspace_provider_api_revisions WHERE id='e0000000-0000-4000-8000-000000000004';
CREATE FUNCTION pg_temp.gen_create(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001',patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT create_engagement_synthesis_generation_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request,(value||patch)::text) FROM generation_probe WHERE key='intent';
$$;
CREATE FUNCTION pg_temp.gen_read(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_generation_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request);
$$;
CREATE FUNCTION pg_temp.gen_cancel(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001',cancellation uuid DEFAULT 'f0000000-0000-4000-8000-000000000101',reason text DEFAULT 'SYNTHETIC cancel') RETURNS jsonb LANGUAGE sql AS $$
 SELECT cancel_engagement_synthesis_generation_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request,cancellation,reason);
$$;
SET LOCAL ROLE authenticated;
INSERT INTO generation_probe VALUES('original',pg_temp.gen_create());
SELECT pg_temp.assert_true((SELECT value->>'replayed'='false' AND value->'cancellation'='null'::jsonb
 AND value#>>'{request,actorId}'='13466ed2-dcb7-4861-a528-68cc5579eea9'
 AND (value#>>'{request,intentText}')::jsonb=(SELECT value FROM generation_probe WHERE key='intent')
 AND value#>>'{request,intentSha256}'=encode(extensions.digest(value#>>'{request,intentText}','sha256'),'hex')
 FROM generation_probe WHERE key='original'),'Original synthesis request lost exact intent or attribution');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT source_id='d0000000-0000-4000-8000-000000000002'::uuid FROM engagement_synthesis_generation_requests
 WHERE id='f0000000-0000-4000-8000-000000000001'),'Request retained the wrong source reference');
SELECT pg_temp.assert_true((SELECT configuration_revision_id='e0000000-0000-4000-8000-000000000002'::uuid FROM engagement_synthesis_generation_requests
 WHERE id='f0000000-0000-4000-8000-000000000001'),'Request retained the wrong API revision reference');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.gen_read()=(SELECT value-'replayed' FROM generation_probe WHERE key='original'),'Saved synthesis request read differs');
SELECT pg_temp.assert_true(pg_temp.gen_create()=(SELECT value||'{"replayed":true}' FROM generation_probe WHERE key='original'),'Exact request retry differs');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create(patch:='{"taskByteLimit":8192}')$q$,'PT409','Changed request intent replayed');
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_generation_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000001',' '||(SELECT value::text FROM generation_probe WHERE key='intent'))$q$,'PT409','Changed original intent bytes replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002','{"sourceSha256":"0000000000000000000000000000000000000000000000000000000000000000"}')$q$,'PT409','Wrong retained source hash accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002',(SELECT value FROM generation_probe WHERE key='foreignSource'))$q$,'PT409','Foreign retained source accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002',(SELECT value FROM generation_probe WHERE key='foreignConfig'))$q$,'PT409','Foreign API connection accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002','{"configurationHash":"0000000000000000000000000000000000000000000000000000000000000000"}')$q$,'PT409','Wrong API configuration hash accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002','{"modelId":"unconfigured"}')$q$,'PT409','Unconfigured model accepted');
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"sourceSha256":null}','{"modelId":""}',
  '{"taskByteLimit":null}','{"taskByteLimit":4095}','{"taskByteLimit":1048577}','{"taskByteLimit":4096.5}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.gen_create(%L,%L)','f0000000-0000-4000-8000-000000000002',patch),'22023','Malformed request intent accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_generation_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000002',replace((SELECT value::text FROM generation_probe WHERE key='intent'),'"schemaVersion": 1','"schemaVersion": 2,"schemaVersion": 1'))$q$,'22023','Duplicate intent key accepted');
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_generation_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000002',repeat(' ',4097)||(SELECT value::text FROM generation_probe WHERE key='intent'))$q$,'22023','Oversized request intent accepted');
SELECT pg_temp.expect_error($q$SELECT * FROM engagement_synthesis_generation_requests$q$,'42501','Direct private request read allowed');
SELECT pg_temp.expect_error($q$SELECT * FROM engagement_synthesis_generation_cancellations$q$,'42501','Direct private cancellation read allowed');
SELECT pg_temp.expect_error($q$SELECT lock_synthesis_generation_request_scope('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000001')$q$,'42501','Private lock helper exposed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_cancel(reason:='   ')$q$,'22023','Blank cancellation reason accepted');
INSERT INTO generation_probe VALUES('cancelled',pg_temp.gen_cancel());
SELECT pg_temp.assert_true((SELECT (value#>>'{cancellation,receiptText}')::jsonb->>'requestExisted'='true'
 AND value#>>'{cancellation,receiptSha256}'=encode(extensions.digest(value#>>'{cancellation,receiptText}','sha256'),'hex')
 AND value->'request'=(SELECT value->'request' FROM generation_probe WHERE key='original') FROM generation_probe WHERE key='cancelled'),'Cancellation lost original request or receipt');
SELECT pg_temp.assert_true(pg_temp.gen_cancel()=(SELECT value||'{"replayed":true}' FROM generation_probe WHERE key='cancelled'),'Cancellation retry changed original receipt');
SELECT pg_temp.assert_true(pg_temp.gen_create()=(SELECT value||'{"replayed":true}' FROM generation_probe WHERE key='cancelled'),'Cancelled request retry lost original receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_cancel(reason:='changed reason')$q$,'PT409','Changed cancellation reason replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_cancel(cancellation:='f0000000-0000-4000-8000-000000000102')$q$,'PT409','Second cancellation replaced original');
INSERT INTO generation_probe VALUES('absent',pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000103'));
SELECT pg_temp.assert_true((SELECT value->'request'='null'::jsonb AND (value#>>'{cancellation,receiptText}')::jsonb->>'requestExisted'='false' FROM generation_probe WHERE key='absent'),'Absent request cancellation was not retained');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000003')$q$,'PT409','Late creation bypassed cancellation');
SELECT pg_temp.assert_true(pg_temp.gen_read('f0000000-0000-4000-8000-000000000003')=(SELECT value-'replayed' FROM generation_probe WHERE key='absent'),'Absent request cancellation cannot be recovered');
-- Same-workspace staff can inspect retained records, but cannot impersonate the requester.
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.assert_true(pg_temp.gen_read()=(SELECT value-'replayed' FROM generation_probe WHERE key='cancelled'),'Authorized staff cannot inspect retained request');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_create()','42501','Another actor replayed original request');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000003')$q$,'42501','Another actor probed absent cancellation');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','42501','Another actor replayed original cancellation');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000004');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000104')$q$,'42501','Another actor cancelled original request');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.gen_read()','42501','Outsider read private request');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_create()','42501','Outsider replayed private request');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','42501','Outsider cancelled private request');
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_generation_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000003','{}')$q$,'42501','Foreign campaign probed absent cancellation');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000001')$q$,'42501','Read ignored requested campaign');
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.gen_read()','42501','Revoked staff read private request');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_create()','42501','Revoked staff replayed private request');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','42501','Revoked staff replayed cancellation');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.gen_read()','42501','Anonymous private read allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_create()','42501','Anonymous request creation allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','42501','Anonymous cancellation allowed');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.gen_create()','42501','Service impersonated staff request');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','42501','Service impersonated cancellation');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_generation_requests SET actor_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'$q$,'42501','Service changed immutable request');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_generation_requests SET intent_text='{}' WHERE id='f0000000-0000-4000-8000-000000000001'$q$,'P0001','Original request mutation allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_generation_requests WHERE id='f0000000-0000-4000-8000-000000000001'$q$,'P0001','Original request deletion allowed');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_generation_cancellations SET receipt_text='{}' WHERE request_id='f0000000-0000-4000-8000-000000000001'$q$,'P0001','Original cancellation mutation allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_generation_cancellations WHERE request_id='f0000000-0000-4000-8000-000000000001'$q$,'P0001','Original cancellation deletion allowed');
-- The original actor can belong to both workspaces without moving the cancellation.
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('7791bbb4-6c7c-435e-9d1d-d2146334a944','13466ed2-dcb7-4861-a528-68cc5579eea9','member');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT create_engagement_synthesis_generation_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000003','{}')$q$,'42501','Original actor moved absent cancellation across scope');
RESET ROLE;
-- Changing or revoking configuration must not prevent retrieval of an acknowledged request.
SELECT save_workspace_provider_api_revision('13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000002',
 '{"label":"SYNTHETIC changed API","protocol":"openai_chat_completions","endpoint":"http://localhost:9997/v1/","modelIds":["changed"],"structuredOutput":true,"authMode":"none","timeoutSeconds":10}',NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.gen_create()=(SELECT value||'{"replayed":true}' FROM generation_probe WHERE key='cancelled'),'Changed configuration lost original retry');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002')$q$,'PT409','Stale configuration accepted');
RESET ROLE;
SELECT revoke_workspace_provider_api_connection('13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000005');
INSERT INTO generation_probe SELECT 'currentConfig',jsonb_build_object('configurationRevisionId',id,'configurationHash',configuration_hash,'modelId','changed')
 FROM workspace_provider_api_revisions WHERE id='e0000000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.gen_create()=(SELECT value||'{"replayed":true}' FROM generation_probe WHERE key='cancelled'),'Revoked configuration lost original retry');
SELECT pg_temp.expect_error($q$SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002',(SELECT value FROM generation_probe WHERE key='currentConfig'))$q$,'PT409','Revoked configuration accepted');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_synthesis_generation_requests),'Refusals or retries added requests');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_synthesis_generation_cancellations),'Refusals or retries added cancellations');
SELECT 'synthesis-generation-requests-verified';
