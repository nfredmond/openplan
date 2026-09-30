-- Structural execution custody; no provider is contacted by this fixture.
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.plan_prepare();
SELECT pg_temp.plan_stage(0);
SELECT pg_temp.plan_stage(1);
SELECT pg_temp.plan_seal();
RESET ROLE;
CREATE TEMP TABLE execution_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON execution_probe TO authenticated,service_role;
INSERT INTO execution_probe SELECT 'intent',jsonb_build_object('schemaVersion',1,'headerSha256',header_sha256,'maxAttempts',2,
 'maxOutputTokens',4096,'responseByteLimit',8192,'expiresAt',to_char(clock_timestamp()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'chargesAcknowledged',true,'retryTaskIndex',NULL,'retryOfAttemptId',NULL) FROM engagement_synthesis_generation_plans WHERE request_id='f0000000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.execution_grant(id uuid DEFAULT 'a1000000-0000-4000-8000-000000000001',patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT authorize_engagement_synthesis_generation('f0000000-0000-4000-8000-000000000001',id,(value||patch)::text) FROM execution_probe WHERE key='intent';
$$;
CREATE FUNCTION pg_temp.execution_claim(task bigint DEFAULT 0,id uuid DEFAULT 'a2000000-0000-4000-8000-000000000001',grant_id uuid DEFAULT 'a1000000-0000-4000-8000-000000000001',worker uuid DEFAULT 'a3000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT claim_engagement_synthesis_generation_attempt(grant_id,task,id,worker);
$$;
CREATE FUNCTION pg_temp.execution_dispatch(id uuid DEFAULT 'a2000000-0000-4000-8000-000000000001',worker uuid DEFAULT 'a3000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatch_engagement_synthesis_generation_attempt(id,worker);
$$;
CREATE FUNCTION pg_temp.execution_capture(id uuid DEFAULT 'a2000000-0000-4000-8000-000000000001') RETURNS text LANGUAGE sql AS $$
 SELECT jsonb_build_object('schemaVersion',1,'binding',binding_text::jsonb,'startedAt','2026-09-30T01:00:00Z','finishedAt','2026-09-30T01:01:00Z',
 'outcome','returned','outputText','SYNTHETIC invalid business output preserved é','providerReceiptText','SYNTHETIC exact original receipt',
 'finishReason','length','responseId',NULL,'inputTokens',NULL,'outputTokens',NULL,'failureCode',NULL)::text
 FROM engagement_synthesis_generation_attempts WHERE id=execution_capture.id;
$$;
CREATE FUNCTION pg_temp.execution_output(id uuid DEFAULT 'a2000000-0000-4000-8000-000000000001',capture text DEFAULT NULL,worker uuid DEFAULT 'a3000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_generation_output(id,worker,replace(encode(convert_to(coalesce(capture,pg_temp.execution_capture(id)),'UTF8'),'base64'),E'\n',''),encode(extensions.digest(coalesce(capture,pg_temp.execution_capture(id)),'sha256'),'hex'));
$$;
-- Preparation and empty selections never authorize model calls.
SAVEPOINT absent_seal;
ALTER TABLE engagement_synthesis_generation_plan_seals DISABLE TRIGGER synthesis_generation_plan_seal_immutable;
DELETE FROM engagement_synthesis_generation_plan_seals WHERE request_id='f0000000-0000-4000-8000-000000000001';
ALTER TABLE engagement_synthesis_generation_plan_seals ENABLE TRIGGER synthesis_generation_plan_seal_immutable;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_grant()','PT409','Unsealed plan authorized');
ROLLBACK TO SAVEPOINT absent_seal;
SAVEPOINT empty_selection;
ALTER TABLE engagement_synthesis_generation_plans DISABLE TRIGGER synthesis_generation_plan_immutable;
UPDATE engagement_synthesis_generation_plans SET header_text=jsonb_set(header_text::jsonb,'{contributionCount}','0')::text WHERE request_id='f0000000-0000-4000-8000-000000000001';
ALTER TABLE engagement_synthesis_generation_plans ENABLE TRIGGER synthesis_generation_plan_immutable;
UPDATE execution_probe SET value=jsonb_set(value,'{headerSha256}',to_jsonb((SELECT header_sha256 FROM engagement_synthesis_generation_plans WHERE request_id='f0000000-0000-4000-8000-000000000001'))) WHERE key='intent';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_grant()','PT409','Empty selection authorized');
ROLLBACK TO SAVEPOINT empty_selection;
SET LOCAL ROLE authenticated;
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"chargesAcknowledged":false}','{"maxAttempts":0}',
 '{"maxAttempts":3}','{"maxAttempts":1.5}','{"maxOutputTokens":65537}','{"responseByteLimit":4194305}','{"responseByteLimit":4095}',
 '{"expiresAt":"infinity"}','{"retryTaskIndex":0}','{"retryOfAttemptId":"a2000000-0000-4000-8000-000000000001"}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.execution_grant(patch:=%L)',patch),'22023','Malformed execution grant accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_grant(patch:='{"headerSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}')$q$,'PT409','Wrong plan authorized');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_grant(patch:='{"expiresAt":"2000-01-01T00:00:00Z"}')$q$,'PT409','Expired grant created');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.expect_error('SELECT pg_temp.execution_grant()','42501','Different actor granted execution');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
-- The budget probe has a valid unattempted second task, so removing the budget
-- guard cannot hide behind a missing-task or duplicate-task refusal.
SAVEPOINT one_attempt_budget;
SELECT pg_temp.execution_grant(patch:='{"maxAttempts":1}');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.execution_claim();
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(1,'a2000000-0000-4000-8000-000000000002')$q$,'PT409','Valid task exceeded grant allowance');
ROLLBACK TO SAVEPOINT one_attempt_budget;
INSERT INTO execution_probe VALUES('grant',pg_temp.execution_grant());
SELECT pg_temp.assert_true(pg_temp.execution_grant()=(SELECT value FROM execution_probe WHERE key='grant'),'Grant exact retry changed receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_grant(patch:='{"maxAttempts":1}')$q$,'PT409','Changed grant replayed');
RESET ROLE;
SAVEPOINT expired_grant;
ALTER TABLE engagement_synthesis_generation_authorizations DISABLE TRIGGER synthesis_generation_authorization_immutable;
UPDATE engagement_synthesis_generation_authorizations SET intent_text=jsonb_set(intent_text::jsonb,'{expiresAt}','"2000-01-01T00:00:00Z"')::text;
ALTER TABLE engagement_synthesis_generation_authorizations ENABLE TRIGGER synthesis_generation_authorization_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_claim()','PT409','Expired authorization claimed');
ROLLBACK TO SAVEPOINT expired_grant;
SAVEPOINT changed_claim_key;
-- Credential updates are already immutable. Exercise a service-level replacement
-- after deletion instead; the entire probe rolls back, without weakening that guard.
CREATE TEMP TABLE original_credential AS SELECT * FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
DELETE FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
INSERT INTO workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
 SELECT revision_id,connection_id,workspace_id,'v2:SYNTHETIC rotated key' FROM original_credential;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_claim()','PT409','Changed credential claimed');
ROLLBACK TO SAVEPOINT changed_claim_key;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO execution_probe VALUES('claim',pg_temp.execution_claim());
SELECT pg_temp.assert_true(pg_temp.execution_claim()=(SELECT value FROM execution_probe WHERE key='claim'),'Claim retry changed identity or lease');
SELECT pg_temp.assert_true((SELECT value->>'taskIndex'='0' AND (value->>'bindingText')::jsonb->>'provider'='api_connection'
 AND (value->>'bindingText')::jsonb->>'taskSha256'=(SELECT task_sha256 FROM engagement_synthesis_generation_plan_tasks WHERE request_id='f0000000-0000-4000-8000-000000000001' AND task_index=0) FROM execution_probe WHERE key='claim'),'Claim lost sealed task binding');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(task:=1)$q$,'PT409','Changed claim replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(worker:='a3000000-0000-4000-8000-000000000002')$q$,'PT409','Changed worker claim replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(id:='a2000000-0000-4000-8000-000000000009')$q$,'PT409','Initial grant retried an attempted task');
SELECT pg_temp.expect_error('SELECT pg_temp.execution_output()','PT409','Output retained before dispatch');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch(worker:='a3000000-0000-4000-8000-000000000002')$q$,'42501','Wrong worker dispatched');
INSERT INTO execution_probe VALUES('dispatch',pg_temp.execution_dispatch());
SELECT pg_temp.assert_true((SELECT value->>'authorizedNow'='true' AND value->>'receiptSha256'=encode(extensions.digest(value->>'receiptText','sha256'),'hex') FROM execution_probe WHERE key='dispatch'),'First dispatch was not authorized or lost receipt');
SELECT pg_temp.assert_true(pg_temp.execution_dispatch()=(SELECT value||'{"authorizedNow":false}' FROM execution_probe WHERE key='dispatch'),'Dispatch acknowledgement replay authorized another call');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(task:=9,id:='a2000000-0000-4000-8000-000000000009')$q$,'PT409','Foreign task claimed');
SELECT pg_temp.execution_claim(1,'a2000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(task:=9,id:='a2000000-0000-4000-8000-000000000009')$q$,'PT409','Exhausted grant claimed');
RESET ROLE;
-- Expired claims refuse new dispatch, while exact old claim acknowledgements survive.
SAVEPOINT expired_claim;
ALTER TABLE engagement_synthesis_generation_attempts DISABLE TRIGGER synthesis_generation_attempt_immutable;
UPDATE engagement_synthesis_generation_attempts SET claim_expires_at='2000-01-01' WHERE id='a2000000-0000-4000-8000-000000000002';
ALTER TABLE engagement_synthesis_generation_attempts ENABLE TRIGGER synthesis_generation_attempt_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Expired claim dispatched');
ROLLBACK TO SAVEPOINT expired_claim;
SAVEPOINT revoked_connection;
UPDATE workspace_provider_api_connections SET revoked_at=clock_timestamp() WHERE id='e0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Revoked connection dispatched');
ROLLBACK TO SAVEPOINT revoked_connection;
SAVEPOINT changed_dispatch_key;
-- Credential updates are already immutable. Exercise a service-level replacement
-- after deletion instead; the entire probe rolls back, without weakening that guard.
CREATE TEMP TABLE original_credential AS SELECT * FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
DELETE FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
INSERT INTO workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
 SELECT revision_id,connection_id,workspace_id,'v2:SYNTHETIC rotated key' FROM original_credential;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Changed credential dispatched');
ROLLBACK TO SAVEPOINT changed_dispatch_key;
SAVEPOINT changed_revision;
SELECT save_workspace_provider_api_revision('13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000002',
 (SELECT (configuration||'{"label":"SYNTHETIC revision advance"}')::text FROM workspace_provider_api_revisions WHERE id='e0000000-0000-4000-8000-000000000002'),
 (SELECT credential_ciphertext FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002'));
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Changed revision dispatched');
ROLLBACK TO SAVEPOINT changed_revision;
SAVEPOINT expired_dispatch_grant;
ALTER TABLE engagement_synthesis_generation_authorizations DISABLE TRIGGER synthesis_generation_authorization_immutable;
UPDATE engagement_synthesis_generation_authorizations SET intent_text=jsonb_set(intent_text::jsonb,'{expiresAt}','"2000-01-01T00:00:00Z"')::text;
ALTER TABLE engagement_synthesis_generation_authorizations ENABLE TRIGGER synthesis_generation_authorization_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Expired grant dispatched');
ROLLBACK TO SAVEPOINT expired_dispatch_grant;
SAVEPOINT missing_credential;
DELETE FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Missing credential dispatched');
ROLLBACK TO SAVEPOINT changed_dispatch_key;
-- Credential updates are already immutable. Exercise a service-level replacement
-- after deletion instead; the entire probe rolls back, without weakening that guard.
CREATE TEMP TABLE original_credential AS SELECT * FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
DELETE FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
INSERT INTO workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
 SELECT revision_id,connection_id,workspace_id,'v2:SYNTHETIC rotated key' FROM original_credential;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Changed credential dispatched');
ROLLBACK TO SAVEPOINT changed_dispatch_key;
SAVEPOINT changed_revision;
SELECT save_workspace_provider_api_revision('13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000002',
 (SELECT (configuration||'{"label":"SYNTHETIC revision advance"}')::text FROM workspace_provider_api_revisions WHERE id='e0000000-0000-4000-8000-000000000002'),
 (SELECT credential_ciphertext FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002'));
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Changed revision dispatched');
ROLLBACK TO SAVEPOINT changed_revision;
SAVEPOINT expired_dispatch_grant;
ALTER TABLE engagement_synthesis_generation_authorizations DISABLE TRIGGER synthesis_generation_authorization_immutable;
UPDATE engagement_synthesis_generation_authorizations SET intent_text=jsonb_set(intent_text::jsonb,'{expiresAt}','"2000-01-01T00:00:00Z"')::text;
ALTER TABLE engagement_synthesis_generation_authorizations ENABLE TRIGGER synthesis_generation_authorization_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002')$q$,'PT409','Expired grant dispatched');
ROLLBACK TO SAVEPOINT expired_dispatch_grant;
SAVEPOINT missing_credential;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_grant('a1000000-0000-4000-8000-000000000002','{"maxAttempts":1,"retryTaskIndex":0,"retryOfAttemptId":"a2000000-0000-4000-8000-000000000001"}')$q$,'PT409','Active attempt retried');
RESET ROLE;
SET LOCAL ROLE service_role;
-- Exact wire bytes include JSON escapes which PostgreSQL JSON cannot decode.
SAVEPOINT original_unicode;
SELECT pg_temp.assert_true(pg_temp.execution_output(capture:=replace(pg_temp.execution_capture(),'"SYNTHETIC invalid business output preserved é"',$raw$"\ud800\u0000\uDC00"$raw$))->>'captureText'
 =replace(pg_temp.execution_capture(),'"SYNTHETIC invalid business output preserved é"',$raw$"\ud800\u0000\uDC00"$raw$),'Original unusual Unicode capture lost');
ROLLBACK TO SAVEPOINT original_unicode;
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_generation_output('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','e30=',repeat('b',64))$q$,'22023','Wrong capture checksum accepted');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_generation_output('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','e31=',encode(extensions.digest('{}','sha256'),'hex'))$q$,'22023','Noncanonical base64 accepted');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_generation_output('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','!',repeat('a',64))$q$,'22023','Malformed base64 accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_output(worker:='a3000000-0000-4000-8000-000000000002')$q$,'42501','Wrong worker retained output');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_output(capture:=repeat(' ',131073)||pg_temp.execution_capture())$q$,'22023','Oversized capture retained');
INSERT INTO execution_probe VALUES('output',pg_temp.execution_output());
SELECT pg_temp.assert_true((SELECT value->>'captureText'=pg_temp.execution_capture() AND value->>'captureSha256'=encode(extensions.digest(pg_temp.execution_capture(),'sha256'),'hex') FROM execution_probe WHERE key='output'),'Output lost original bytes or checksum');
SELECT pg_temp.assert_true(pg_temp.execution_output()=(SELECT value FROM execution_probe WHERE key='output'),'Output retry changed original');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_output(capture:=' '||pg_temp.execution_capture())$q$,'PT409','Changed output replayed');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.execution_grant('a1000000-0000-4000-8000-000000000002','{"maxAttempts":1,"retryTaskIndex":0,"retryOfAttemptId":"a2000000-0000-4000-8000-000000000001"}');
-- A second initial grant cannot clear the task's attempt history.
SELECT pg_temp.execution_grant('a1000000-0000-4000-8000-000000000003');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(0,'a2000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000003')$q$,'PT409','New initial grant erased attempt history');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_claim(1,'a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002')$q$,'PT409','Retry grant changed task');
SELECT pg_temp.execution_claim(0,'a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_true((SELECT previous_attempt_id='a2000000-0000-4000-8000-000000000001' FROM engagement_synthesis_generation_attempts WHERE id='a2000000-0000-4000-8000-000000000003'),'Retry lost predecessor');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_grant('a1000000-0000-4000-8000-000000000004','{"maxAttempts":1,"retryTaskIndex":0,"retryOfAttemptId":"a2000000-0000-4000-8000-000000000001"}')$q$,'PT409','Old predecessor authorized again');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000002');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel();
SELECT pg_temp.assert_true(pg_temp.execution_grant()=(SELECT value FROM execution_probe WHERE key='grant'),'Cancelled grant retry changed receipt');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000003')$q$,'PT409','Cancelled job dispatched');
SELECT pg_temp.assert_true(pg_temp.execution_dispatch()=(SELECT value||'{"authorizedNow":false}' FROM execution_probe WHERE key='dispatch'),'Cancelled replay authorized another call');
RESET ROLE;
-- Original returned bytes remain deliverable after authority loss. This is not
-- permission to start another call or adopt an output.
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.execution_output()=(SELECT value FROM execution_probe WHERE key='output'),'Late output retry lost after access revocation');
SELECT pg_temp.assert_true(pg_temp.execution_output('a2000000-0000-4000-8000-000000000002')->>'captureText'=pg_temp.execution_capture('a2000000-0000-4000-8000-000000000002'),'First late output lost after cancellation and access revocation');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000003')$q$,'42501','Revoked staff dispatched');
RESET ROLE;
-- Private storage, command privileges and immutability are independent guards.
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['authorizations','attempts','dispatches','outputs'] LOOP
  PERFORM pg_temp.expect_error('DELETE FROM engagement_synthesis_generation_'||table_name,'P0001','Execution history deletion allowed: '||table_name);
  PERFORM pg_temp.expect_error('UPDATE engagement_synthesis_generation_'||table_name||' SET created_at=clock_timestamp()','P0001','Execution history update allowed: '||table_name);
 END LOOP;
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_grant()','42501','Service granted human execution');
SELECT pg_temp.expect_error($q$SELECT assert_synthesis_generation_execution_current('f0000000-0000-4000-8000-000000000001')$q$,'42501','Private execution authority helper exposed');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_claim()','42501','Authenticated claim command exposed');
SELECT pg_temp.expect_error('SELECT pg_temp.execution_dispatch()','42501','Authenticated dispatch command exposed');
SELECT pg_temp.expect_error($q$SELECT retain_engagement_synthesis_generation_output('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','e30=',repeat('a',64))$q$,'42501','Authenticated output command exposed');
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['authorizations','attempts','dispatches','outputs'] LOOP
  PERFORM pg_temp.expect_error('SELECT * FROM engagement_synthesis_generation_'||table_name,'42501','Private execution table exposed: '||table_name);
 END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT authorize_engagement_synthesis_generation('f0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','{}')$q$,'42501','Anonymous execution authorization exposed');
RESET ROLE;
SELECT 'synthesis-generation-execution-custody-verified';
