-- Native custody probes use small structural packets. The TypeScript join test
-- separately checks complete semantic task bytes from the real saved source.
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_create();
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002');
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000004');
RESET ROLE;
CREATE TEMP TABLE plan_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON plan_probe TO authenticated,anon,service_role;
CREATE FUNCTION pg_temp.plan_task(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT jsonb_build_object('schemaVersion',1,'instructions','SYNTHETIC structural custody probe',
  'input',jsonb_build_object('number',n,'text','SYNTHETIC full Unicode é and literal quote "',
   'source',jsonb_build_object('requestId',source_id,'campaignId',campaign_id,'workspaceId',workspace_id,'sha256',intent_text::jsonb->>'sourceSha256')))::text
 FROM engagement_synthesis_generation_requests WHERE id='f0000000-0000-4000-8000-000000000001';
$$;
CREATE FUNCTION pg_temp.plan_seed(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS text LANGUAGE sql AS $$
 SELECT encode(extensions.digest('synthesis-plan-v1:'||request::text||':'||intent_sha256||':bc91bcf4ca0a31468a8a9c7aa4b383855382f7888eeb70ed7bb143ff2f8a473b:'||repeat('a',64),'sha256'),'hex')
 FROM engagement_synthesis_generation_requests WHERE id=request;
$$;
CREATE FUNCTION pg_temp.plan_header(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS text LANGUAGE plpgsql AS $$
DECLARE tail text:=pg_temp.plan_seed(request); n integer; task text; bytes integer:=0;
BEGIN
 FOR n IN 0..1 LOOP
  task:=pg_temp.plan_task(n); bytes:=bytes+octet_length(task);
  tail:=encode(extensions.digest(tail||':'||n::text||':'||encode(extensions.digest(task,'sha256'),'hex')||':'||octet_length(task)::text,'sha256'),'hex');
 END LOOP;
 RETURN (SELECT jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_segment_plan','requestId',request,
  'intentSha256',intent_sha256,'recipeId','openplan.engagement.synthesis.segment.v1',
  'recipeSha256','bc91bcf4ca0a31468a8a9c7aa4b383855382f7888eeb70ed7bb143ff2f8a473b','taskManifestSha256',repeat('a',64),
  'taskCount',2,'taskBytes',bytes,'contributionCount',303,'tailSha256',tail)::text FROM engagement_synthesis_generation_requests WHERE id=request);
END $$;
CREATE FUNCTION pg_temp.plan_prepare(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001',patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT prepare_engagement_synthesis_generation_plan(request,(pg_temp.plan_header(request)::jsonb||patch)::text);
$$;
CREATE FUNCTION pg_temp.plan_read(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_generation_plan(request);
$$;
CREATE FUNCTION pg_temp.plan_stage(start bigint DEFAULT 0,request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001',task text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT stage_engagement_synthesis_generation_tasks(request,start,
  CASE WHEN start=0 THEN pg_temp.plan_seed(request) ELSE (SELECT chain_sha256 FROM engagement_synthesis_generation_plan_tasks WHERE request_id=request AND task_index=start-1) END,
  jsonb_build_array(coalesce(task,pg_temp.plan_task(start::integer)))::text);
$$;
CREATE FUNCTION pg_temp.plan_seal(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT seal_engagement_synthesis_generation_plan(request,(SELECT header_sha256 FROM engagement_synthesis_generation_plans WHERE request_id=request));
$$;
-- Clear the staff JWT claim. Service authority must use the retained requester.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.plan_read()','PT409','Missing plan appeared available');
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"purpose":"different"}',
  '{"requestId":"f0000000-0000-4000-8000-000000000009"}','{"intentSha256":"wrong"}',
  '{"recipeId":"future"}','{"recipeSha256":"wrong"}','{"taskManifestSha256":"wrong"}',
  '{"taskCount":null}','{"taskCount":-1}','{"taskCount":0.5}','{"taskBytes":"2"}','{"contributionCount":9007199254740992}','{"tailSha256":"wrong"}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.plan_prepare(patch:=%L)',patch),'22023','Malformed plan header accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001',' '||repeat(' ',4096)||pg_temp.plan_header())$q$,'22023','Oversized plan header accepted');
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001',replace(pg_temp.plan_header(),'"schemaVersion": 1','"schemaVersion": 2,"schemaVersion": 1'))$q$,'22023','Duplicate plan header key accepted');
-- Each seal guard gets a distinct fixture where the other completion values match.
SAVEPOINT incomplete_count;
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000003',jsonb_build_object('taskBytes',0,'tailSha256',pg_temp.plan_seed('f0000000-0000-4000-8000-000000000003')));
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_seal('f0000000-0000-4000-8000-000000000003')$q$,'PT409','Seal ignored expected task count');
ROLLBACK TO SAVEPOINT incomplete_count;
SAVEPOINT incomplete_bytes;
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000003',jsonb_build_object('taskBytes',(pg_temp.plan_header()::jsonb->>'taskBytes')::integer+1));
SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.plan_stage(1,'f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_seal('f0000000-0000-4000-8000-000000000003')$q$,'PT409','Seal ignored expected byte total');
ROLLBACK TO SAVEPOINT incomplete_bytes;
SAVEPOINT incomplete_chain;
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000003',jsonb_build_object('tailSha256',repeat('b',64)));
SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.plan_stage(1,'f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_seal('f0000000-0000-4000-8000-000000000003')$q$,'PT409','Seal ignored expected chain');
ROLLBACK TO SAVEPOINT incomplete_chain;
SAVEPOINT exceeded_bytes;
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000003',jsonb_build_object('taskBytes',0));
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000003')$q$,'PT409','Staging exceeded declared byte total');
ROLLBACK TO SAVEPOINT exceeded_bytes;
INSERT INTO plan_probe VALUES('prepared',pg_temp.plan_prepare());
SELECT pg_temp.assert_true((SELECT value->>'nextIndex'='0' AND value->>'taskBytes'='0' AND value->>'tailSha256'=pg_temp.plan_seed() AND value->'seal'='null'::jsonb AND value->>'cancelled'='false'
 AND value->>'headerText'=pg_temp.plan_header() AND value->>'headerSha256'=encode(extensions.digest(pg_temp.plan_header(),'sha256'),'hex') FROM plan_probe WHERE key='prepared'),'Prepared plan lost identity or seed');
SELECT pg_temp.assert_true(pg_temp.plan_prepare()=(SELECT value FROM plan_probe WHERE key='prepared'),'Plan preparation retry differs');
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001',' '||pg_temp.plan_header())$q$,'PT409','Changed plan header bytes replayed');
SELECT pg_temp.expect_error('SELECT pg_temp.plan_seal()','PT409','Incomplete plan sealed');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',1,pg_temp.plan_seed(),jsonb_build_array(pg_temp.plan_task(1))::text)$q$,'PT409','Out of sequence task accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,repeat('b',64),jsonb_build_array(pg_temp.plan_task(0))::text)$q$,'PT409','Wrong prefix accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,pg_temp.plan_seed(),'[]')$q$,'22023','Empty task batch accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,pg_temp.plan_seed(),'[{}]')$q$,'22023','Nontext task accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,pg_temp.plan_seed(),' '||repeat(' ',4194304)||jsonb_build_array(pg_temp.plan_task(0))::text)$q$,'22023','Oversized staging packet accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,pg_temp.plan_seed(),(SELECT jsonb_agg(pg_temp.plan_task(0))::text FROM generate_series(1,129)))$q$,'22023','Oversized task count accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_stage(task:=' '||repeat(' ',4096)||pg_temp.plan_task(0))$q$,'22023','Oversized task accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_stage(task:='{"schemaVersion":2,"schemaVersion":1}')$q$,'22023','Duplicate task key accepted');
DO $$ DECLARE path text[]; BEGIN
 FOREACH path SLICE 1 IN ARRAY ARRAY[ARRAY['input','source','requestId'],ARRAY['input','source','campaignId'],ARRAY['input','source','workspaceId'],ARRAY['input','source','sha256']] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.plan_stage(task:=%L)',jsonb_set(pg_temp.plan_task(0)::jsonb,path,'"different"')::text),'PT409','Foreign task source accepted');
 END LOOP;
END $$;
INSERT INTO plan_probe VALUES('one',pg_temp.plan_stage());
SELECT pg_temp.assert_true((SELECT value->>'nextIndex'='1' AND (value->>'taskBytes')::integer=octet_length(pg_temp.plan_task(0)) AND value->'seal'='null'::jsonb FROM plan_probe WHERE key='one'),'First task cursor differs');
SELECT pg_temp.assert_true(pg_temp.plan_stage()=(SELECT value FROM plan_probe WHERE key='one'),'Lost batch acknowledgement changed bytes');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_stage(task:=' '||pg_temp.plan_task(0))$q$,'PT409','Changed task retry accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,pg_temp.plan_seed(),jsonb_build_array(pg_temp.plan_task(0),pg_temp.plan_task(1))::text)$q$,'PT409','Overlapping retry appended new work');
SELECT pg_temp.expect_error('SELECT pg_temp.plan_seal()','PT409','Partial plan sealed');
SELECT pg_temp.plan_stage(1);
SELECT pg_temp.expect_error($q$SELECT seal_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001',repeat('b',64))$q$,'PT409','Wrong plan identity sealed');
INSERT INTO plan_probe VALUES('sealed',pg_temp.plan_seal());
SELECT pg_temp.assert_true((SELECT value->>'nextIndex'='2' AND value->>'tailSha256'=pg_temp.plan_header()::jsonb->>'tailSha256'
 AND (value#>>'{seal,receiptText}')::jsonb->>'headerSha256'=value->>'headerSha256'
 AND value#>>'{seal,receiptSha256}'=encode(extensions.digest(value#>>'{seal,receiptText}','sha256'),'hex') FROM plan_probe WHERE key='sealed'),'Seal lost plan identity or checksum');
SELECT pg_temp.assert_true(pg_temp.plan_seal()=(SELECT value FROM plan_probe WHERE key='sealed'),'Seal retry changed original receipt');
SELECT pg_temp.assert_true(pg_temp.plan_stage()=(SELECT value FROM plan_probe WHERE key='sealed'),'Old batch retry lost sealed state');
SELECT pg_temp.expect_error('SELECT pg_temp.plan_stage(2)','PT409','Task appended beyond expected inventory');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel();
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000102');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.plan_seal()=(SELECT value||'{"cancelled":true}' FROM plan_probe WHERE key='sealed'),'Cancelled seal retry lost original receipt');
SELECT pg_temp.assert_true(pg_temp.plan_prepare()=(SELECT value||'{"cancelled":true}' FROM plan_probe WHERE key='sealed'),'Cancelled plan retry lost original header');
SELECT pg_temp.assert_true(pg_temp.plan_stage()=(SELECT value||'{"cancelled":true}' FROM plan_probe WHERE key='sealed'),'Cancelled batch retry lost original bytes');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000002')$q$,'PT409','Cancelled request prepared');
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000004');
SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000004');
SELECT pg_temp.plan_stage(1,'f0000000-0000-4000-8000-000000000004');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000103');
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000104');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000003')$q$,'PT409','Cancelled plan staged new work');
SELECT pg_temp.expect_error($q$SELECT pg_temp.plan_seal('f0000000-0000-4000-8000-000000000004')$q$,'PT409','Cancelled complete plan sealed');
-- A changed campaign association must not move retained work into another workspace.
RESET ROLE;
SAVEPOINT changed_campaign;
ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable;
UPDATE engagement_synthesis_generation_requests SET campaign_id='250f0f62-7225-48b3-a2f7-5a134d3b9f78' WHERE id='f0000000-0000-4000-8000-000000000001';
ALTER TABLE engagement_synthesis_generation_requests ENABLE TRIGGER synthesis_generation_request_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.plan_read()','42501','Worker ignored changed campaign scope');
ROLLBACK TO SAVEPOINT changed_campaign;
-- The worker cannot impersonate a different current staff user after the requester loses access.
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.plan_read()','42501','Worker ignored revoked requester');
SELECT pg_temp.expect_error('SELECT pg_temp.plan_prepare()','42501','Worker replayed revoked requester plan');
SELECT pg_temp.expect_error('SELECT pg_temp.plan_stage()','42501','Worker replayed revoked requester batch');
SELECT pg_temp.expect_error('SELECT pg_temp.plan_seal()','42501','Worker replayed revoked requester seal');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_generation_plans SET header_text='{}'$q$,'P0001','Retained plan mutation allowed');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_generation_plan_tasks SET task_text='{}'$q$,'P0001','Retained task mutation allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_generation_plan_seals$q$,'P0001','Retained seal deletion allowed');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_generation_plan_tasks SET task_text='{}'$q$,'42501','Service direct task writes allowed');
SELECT pg_temp.expect_error($q$SELECT lock_synthesis_generation_plan_scope('f0000000-0000-4000-8000-000000000001')$q$,'42501','Worker private lock helper exposed');
RESET ROLE;
SET LOCAL ROLE authenticated;
-- Helpers read service-only records, so permission probes call the real functions directly.
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001')$q$,'42501','Authenticated plan reader exposed');
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001','{}')$q$,'42501','Authenticated plan writer exposed');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_generation_tasks('f0000000-0000-4000-8000-000000000001',0,repeat('a',64),'[]')$q$,'42501','Authenticated task writer exposed');
SELECT pg_temp.expect_error($q$SELECT seal_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001',repeat('a',64))$q$,'42501','Authenticated seal writer exposed');
SELECT pg_temp.expect_error($q$SELECT * FROM engagement_synthesis_generation_plans$q$,'42501','Private plan table exposed');
SELECT pg_temp.expect_error($q$SELECT * FROM engagement_synthesis_generation_plan_tasks$q$,'42501','Private task table exposed');
SELECT pg_temp.expect_error($q$SELECT * FROM engagement_synthesis_generation_plan_seals$q$,'42501','Private seal table exposed');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000001')$q$,'42501','Anonymous plan reader exposed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_synthesis_generation_plans),'Unexpected retained plan count');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM engagement_synthesis_generation_plan_tasks),'Unexpected retained task count');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_synthesis_generation_plan_seals),'Unexpected retained seal count');
SELECT 'synthesis-generation-plan-custody-verified';
