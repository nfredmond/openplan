-- Runs after source custody and the request fixture's setup, in a rollback.
CREATE TEMP TABLE preparation_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON preparation_probe TO authenticated,service_role;
CREATE FUNCTION pg_temp.prep_enqueue(stage text DEFAULT 'segment',sha text DEFAULT NULL,request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT enqueue_engagement_synthesis_preparation('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request,stage,
  coalesce(sha,pg_temp.gen_read(request)#>>'{request,intentSha256}'));
$$;
CREATE FUNCTION pg_temp.prep_read(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_preparation('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request);
$$;
CREATE FUNCTION pg_temp.prep_retry(attempt bigint,request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retry_engagement_synthesis_preparation('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request,attempt);
$$;
CREATE FUNCTION pg_temp.prep_claim(token uuid DEFAULT 'a0000000-0000-4000-8000-000000000001',request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT claim_engagement_synthesis_preparation(request,token);
$$;
CREATE FUNCTION pg_temp.prep_finish(token uuid DEFAULT 'a0000000-0000-4000-8000-000000000001',sha text DEFAULT NULL,failure text DEFAULT 'preparation_failed') RETURNS jsonb LANGUAGE sql AS $$
 SELECT finish_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000001',token,sha,failure);
$$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_create();
SELECT pg_temp.assert_true(pg_temp.prep_read() IS NULL,'Historical request was implicitly queued');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_enqueue('thematic')$q$,'PT409','Wrong stage was queued');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_enqueue(sha:=repeat('0',64))$q$,'PT409','Wrong intent hash was queued');
INSERT INTO preparation_probe VALUES('queued',pg_temp.prep_enqueue());
SELECT pg_temp.assert_true((SELECT value->>'status'='queued' AND value->>'attempts'='0' AND value->>'replayed'='false'
 AND value->>'actorId'='13466ed2-dcb7-4861-a528-68cc5579eea9' AND NOT value ? 'leaseToken' FROM preparation_probe WHERE key='queued'),'Queued state lost custody');
SELECT pg_temp.assert_true(pg_temp.prep_enqueue()=(SELECT value||'{"replayed":true}' FROM preparation_probe WHERE key='queued'),'Enqueue replay changed job');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_claim()','42501','Staff claimed service job');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_preparation_jobs','42501','Staff read queue table');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_preparation_attempts','42501','Staff read attempt tokens');
SELECT pg_temp.expect_error($q$SELECT synthesis_preparation_job_state('f0000000-0000-4000-8000-000000000001',true)$q$,'42501','Staff invoked private state helper');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.assert_true(pg_temp.prep_read() IS NOT NULL,'Current staff could not inspect preparation');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_enqueue()','42501','Other staff enqueued original request');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_retry(0)','42501','Other staff retried original request');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.prep_read()','42501','Foreign workspace read preparation');
SELECT create_engagement_synthesis_generation_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000900',
 (SELECT (b.value||s.value||c.value)::text FROM generation_probe b CROSS JOIN generation_probe s CROSS JOIN generation_probe c WHERE b.key='intent' AND s.key='foreignSource' AND c.key='foreignConfig'));
SELECT enqueue_engagement_synthesis_preparation('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000900','segment',
 read_engagement_synthesis_generation_request('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f0000000-0000-4000-8000-000000000900')#>>'{request,intentSha256}');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_read('f0000000-0000-4000-8000-000000000900')$q$,'42501','Authorized campaign leaked another campaign request');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.prep_read()','42501','Anonymous read preparation');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.prep_enqueue()','42501','Service impersonated staff enqueue');
SELECT pg_temp.expect_error('UPDATE engagement_synthesis_preparation_jobs SET attempts=9','42501','Service changed queue directly');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_claim(NULL)','22023','Null claim token was accepted');
INSERT INTO preparation_probe VALUES('claim1',pg_temp.prep_claim());
SELECT pg_temp.assert_true((SELECT value->>'active'='true' AND value->>'attempts'='1' AND value->>'status'='running'
 AND value#>>'{claim,token}'='a0000000-0000-4000-8000-000000000001' AND value#>>'{claim,request_id}'=value->>'requestId'
 AND value->>'leaseToken'=value#>>'{claim,token}' FROM preparation_probe WHERE key='claim1'),'Claim lost identity');
SELECT pg_temp.assert_true(pg_temp.prep_claim()=(SELECT value FROM preparation_probe WHERE key='claim1'),'Claim replay created another attempt');
SELECT pg_temp.assert_true(pg_temp.prep_claim('a0000000-0000-4000-8000-000000000002') IS NULL,'Active lease was stolen');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish(sha:=repeat('0',64),failure:=NULL)$q$,'PT409','Missing seal was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish(sha:=repeat('0',64))$q$,'22023','Conflicting outcome was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish(failure:='raw private exception')$q$,'22023','Arbitrary failure text was saved');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish('a0000000-0000-4000-8000-000000000009')$q$,'PT409','Foreign token finished attempt');
SELECT pg_temp.expect_error($q$SELECT renew_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000009')$q$,'PT409','Foreign token renewed attempt');
SELECT pg_temp.assert_true(renew_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001')->>'status'='running','Lease did not renew');
RESET ROLE;
UPDATE engagement_synthesis_preparation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id='f0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.prep_claim()->>'active'='false','Expired claim replay reopened authority');
SELECT pg_temp.expect_error($q$SELECT renew_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001')$q$,'PT409','Expired lease renewed');
-- An outcome durably retained before an interruption can finish after expiry.
-- Keep this branch separate so the following probes still challenge reclaiming.
SAVEPOINT retained_failure_after_expiry;
INSERT INTO preparation_probe VALUES('expiredFailure',pg_temp.prep_finish());
SELECT pg_temp.assert_true((SELECT value->>'status'='failed' AND value->>'failureCode'='preparation_failed' FROM preparation_probe WHERE key='expiredFailure'),'Expired retained failure did not finish');
SELECT pg_temp.assert_true(pg_temp.prep_finish()=(SELECT value FROM preparation_probe WHERE key='expiredFailure'),'Expired retained failure replay changed');
ROLLBACK TO SAVEPOINT retained_failure_after_expiry;
SELECT pg_temp.assert_true(pg_temp.prep_claim('a0000000-0000-4000-8000-000000000002')->>'attempts'='2','Expired job did not resume');
SELECT pg_temp.assert_true(pg_temp.prep_claim()->>'active'='false','Old token replaced current lease');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_finish()','PT409','Obsolete worker finished current attempt');
INSERT INTO preparation_probe VALUES('failure2',pg_temp.prep_finish('a0000000-0000-4000-8000-000000000002'));
SELECT pg_temp.assert_true(pg_temp.prep_finish('a0000000-0000-4000-8000-000000000002')=(SELECT value FROM preparation_probe WHERE key='failure2'),'Failure replay changed receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish('a0000000-0000-4000-8000-000000000002',failure:='input_unavailable')$q$,'PT409','Changed outcome replayed');
RESET ROLE;
SET LOCAL ROLE authenticated;
SAVEPOINT cancelled_failed_retry;
SELECT pg_temp.gen_cancel();
SELECT pg_temp.expect_error('SELECT pg_temp.prep_retry(2)','PT409','Cancelled failed job was retried');
ROLLBACK TO SAVEPOINT cancelled_failed_retry;
SELECT pg_temp.expect_error('SELECT pg_temp.prep_retry(NULL)','PT409','Null retry bound accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_retry(-1)','PT409','Negative retry bound accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_retry(3)','PT409','Future retry bound accepted');
SELECT pg_temp.assert_true(pg_temp.prep_retry(1)->>'status'='failed','Old retry requeued later failure');
SELECT pg_temp.assert_true(pg_temp.prep_retry(2)->>'status'='queued','Original requester could not retry');
SELECT pg_temp.assert_true(pg_temp.prep_retry(2)->>'status'='queued','Exact retry failed');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish('a0000000-0000-4000-8000-000000000002')$q$,'PT409','Queued job accepted an old completion');
SELECT pg_temp.assert_true(pg_temp.prep_claim('a0000000-0000-4000-8000-000000000003')->>'attempts'='3','Retry did not create next attempt');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel();
SELECT pg_temp.assert_true(pg_temp.prep_read()->>'cancelled'='true','Status hid cancellation');
SELECT pg_temp.assert_true(pg_temp.prep_enqueue()->>'replayed'='true','Cancelled enqueue could not recover');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.prep_claim('a0000000-0000-4000-8000-000000000003')->>'active'='false','Cancelled claim stayed active');
SELECT pg_temp.expect_error($q$SELECT renew_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003')$q$,'PT409','Cancelled lease renewed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_finish('a0000000-0000-4000-8000-000000000003')$q$,'PT409','Cancelled worker finished');
RESET ROLE;
UPDATE engagement_synthesis_preparation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id='f0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.prep_claim('a0000000-0000-4000-8000-000000000004') IS NULL,'Cancelled work was reclaimed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='cancelled' AND attempts=3 FROM engagement_synthesis_preparation_jobs WHERE request_id='f0000000-0000-4000-8000-000000000001'),'Cancelled queue state differs');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_preparation_attempts SET attempt=99 WHERE token='a0000000-0000-4000-8000-000000000001'$q$,'P0001','Claim history was mutable');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_authorizations WHERE request_id='f0000000-0000-4000-8000-000000000001'),'Preparation granted provider authority');
-- The structural plan helpers use the real prepare/stage/seal functions.
SET LOCAL ROLE authenticated;
SELECT pg_temp.prep_enqueue(request:='f0000000-0000-4000-8000-000000000003');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.prep_claim('a0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000003');
SELECT pg_temp.plan_stage(1,'f0000000-0000-4000-8000-000000000003');
INSERT INTO preparation_probe VALUES('seal3',pg_temp.plan_seal('f0000000-0000-4000-8000-000000000003'));
RESET ROLE;
UPDATE engagement_synthesis_preparation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id='f0000000-0000-4000-8000-000000000003';
SET LOCAL ROLE service_role;
INSERT INTO preparation_probe SELECT 'prepared3',finish_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000010',value#>>'{seal,receiptSha256}',NULL) FROM preparation_probe WHERE key='seal3';
SELECT pg_temp.assert_true((SELECT value->>'status'='prepared' AND value->'leaseUntil'='null'::jsonb AND value->>'sealSha256'=(SELECT value#>>'{seal,receiptSha256}' FROM preparation_probe WHERE key='seal3') FROM preparation_probe WHERE key='prepared3'),'Prepared state lost exact seal');
SELECT pg_temp.assert_true((SELECT finish_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000010',value#>>'{seal,receiptSha256}',NULL)=(SELECT value FROM preparation_probe WHERE key='prepared3') FROM preparation_probe WHERE key='seal3'),'Prepared outcome replay changed');
SELECT pg_temp.expect_error($q$SELECT finish_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000010',repeat('0',64),NULL)$q$,'PT409','Different completed seal replayed');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.prep_retry(1,'f0000000-0000-4000-8000-000000000003')->>'status'='prepared','Retry reopened prepared work');
SELECT pg_temp.prep_enqueue(request:='f0000000-0000-4000-8000-000000000002');
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000104');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_enqueue(request:='f0000000-0000-4000-8000-000000000004')$q$,'PT409','Cancelled request was newly queued');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.prep_read()','42501','Revoked staff read preparation');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.prep_claim('a0000000-0000-4000-8000-000000000020','f0000000-0000-4000-8000-000000000002') IS NULL,'Revoked requester started preparation');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='failed' AND failure_code='access_unavailable' AND attempts=0 FROM engagement_synthesis_preparation_jobs WHERE request_id='f0000000-0000-4000-8000-000000000002'),'Inaccessible request still blocks queue');
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.prep_retry(0,'f0000000-0000-4000-8000-000000000002')->>'status'='queued','Restored requester cannot retry unclaimed failure');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_claim('a0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002')$q$,'PT409','Token rebound to another request');
SELECT pg_temp.prep_claim('a0000000-0000-4000-8000-000000000021','f0000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_error($q$SELECT finish_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000021',(SELECT value#>>'{seal,receiptSha256}' FROM preparation_probe WHERE key='seal3'),NULL)$q$,'PT409','Other request seal was accepted');
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT renew_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000021')$q$,'42501','Revoked requester renewed lease');
SELECT pg_temp.expect_error($q$SELECT finish_engagement_synthesis_preparation('f0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000021',NULL,'preparation_failed')$q$,'42501','Revoked requester changed outcome');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
-- Bind real context/thematic requests, without claiming their inputs are prepared.
SET LOCAL ROLE authenticated;
SELECT create_engagement_synthesis_thematic_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000010',(SELECT value::text FROM generation_probe WHERE key='intent'),
 jsonb_build_object('schemaVersion',1,'parentRequestId','f0000000-0000-4000-8000-000000000001','selectionSequence',0,'segmentResultsManifestSha256',repeat('a',64),'contextManifestSha256',repeat('b',64),'frameByteLimit',4096)::text);
SELECT create_engagement_synthesis_context_request('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','f0000000-0000-4000-8000-000000000011',(SELECT value::text FROM generation_probe WHERE key='intent'),
 jsonb_build_object('schemaVersion',1,'parentRequestId','f0000000-0000-4000-8000-000000000001','selectionSequence',0,'segmentResultsManifestSha256',repeat('a',64),'contextManifestSha256',repeat('b',64),'contentManifestSha256',repeat('c',64),'frameByteLimit',4096,'targetRecordId','item:b0000000-0000-4000-8000-000000000301')::text);
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_enqueue(request:='f0000000-0000-4000-8000-000000000010')$q$,'PT409','Thematic request queued as segment');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_enqueue(request:='f0000000-0000-4000-8000-000000000011')$q$,'PT409','Context request queued as segment');
SELECT pg_temp.assert_true(pg_temp.prep_enqueue('thematic',request:='f0000000-0000-4000-8000-000000000010')->>'stage'='thematic','Thematic stage lost');
SELECT pg_temp.assert_true(pg_temp.prep_enqueue('context',request:='f0000000-0000-4000-8000-000000000011')->>'stage'='context','Context stage lost');
RESET ROLE;
SELECT 'synthesis-preparation-queue-verified';
