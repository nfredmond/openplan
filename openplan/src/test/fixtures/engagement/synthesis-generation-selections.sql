-- Runs before cancellation in the execution fixture. Three attempts exist,
-- including an explicit retry; only the original task-zero result is retained.
RESET ROLE;
CREATE TEMP TABLE selection_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON selection_probe TO authenticated,service_role;
CREATE FUNCTION pg_temp.selection_read(through_sequence bigint DEFAULT NULL,after_task bigint DEFAULT -1,page_limit integer DEFAULT 128) RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_generation_selections('f0000000-0000-4000-8000-000000000001',through_sequence,after_task,page_limit);
$$;
CREATE FUNCTION pg_temp.execution_status(id uuid DEFAULT 'a2000000-0000-4000-8000-000000000002',worker uuid DEFAULT 'a3000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_generation_execution_status(id,worker);
$$;
-- A separate request is a harmless scope control. Clearing its choice before
-- the first claim must not block that claim or let it overwrite the clear.
SET LOCAL ROLE service_role;
SELECT pg_temp.plan_prepare('f0000000-0000-4000-8000-000000000002');
SELECT pg_temp.plan_stage(0,'f0000000-0000-4000-8000-000000000002');
SELECT pg_temp.plan_stage(1,'f0000000-0000-4000-8000-000000000002');
SELECT pg_temp.plan_seal('f0000000-0000-4000-8000-000000000002');
RESET ROLE;
INSERT INTO selection_probe SELECT 'otherIntent',jsonb_set((SELECT value FROM execution_probe WHERE key='intent'),'{headerSha256}',to_jsonb(header_sha256))
 FROM engagement_synthesis_generation_plans WHERE request_id='f0000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT authorize_engagement_synthesis_generation('f0000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000009',(SELECT value::text FROM selection_probe WHERE key='otherIntent'));
SELECT select_engagement_synthesis_generation_attempt('f0000000-0000-4000-8000-000000000002',0,'a4000000-0000-4000-8000-000000000009',NULL,NULL,'SYNTHETIC clear before first claim');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.execution_claim(0,'a2000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000009');
SELECT pg_temp.execution_claim(1,'a2000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000009');
INSERT INTO selection_probe VALUES('other',read_engagement_synthesis_generation_selections('f0000000-0000-4000-8000-000000000002'));
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=2 AND (value#>>'{entries,0,receiptText}')::jsonb->'attemptId'='null'::jsonb
 AND (value#>>'{entries,1,receiptText}')::jsonb->>'attemptId'='a2000000-0000-4000-8000-000000000010' FROM selection_probe WHERE key='other'),'Other request choice or pre-claim clear was lost');
INSERT INTO selection_probe VALUES('initial',pg_temp.selection_read());
SELECT pg_temp.assert_true((SELECT value->>'throughSequence'='2' AND jsonb_array_length(value->'entries')=2 AND value->>'hasMore'='false'
 AND (value#>>'{entries,0,receiptText}')::jsonb->>'attemptId'='a2000000-0000-4000-8000-000000000001'
 AND (value#>>'{entries,1,receiptText}')::jsonb->>'attemptId'='a2000000-0000-4000-8000-000000000002'
 AND (value#>>'{entries,0,receiptText}')::jsonb->>'origin'='authorization' FROM selection_probe WHERE key='initial'),'Initial selection or explicit retry policy differs');
SELECT pg_temp.assert_true((SELECT value#>>'{entries,0,receiptSha256}'=encode(extensions.digest(value#>>'{entries,0,receiptText}','sha256'),'hex') FROM selection_probe WHERE key='initial'),'Selection receipt checksum differs');
INSERT INTO selection_probe VALUES('page1',pg_temp.selection_read(page_limit:=1));
SELECT pg_temp.assert_true((SELECT value->>'hasMore'='true' AND jsonb_array_length(value->'entries')=1 AND (value#>>'{entries,0,receiptText}')::jsonb->>'taskIndex'='0' FROM selection_probe WHERE key='page1'),'First selection page differs');
SELECT pg_temp.assert_true(pg_temp.execution_status()->>'canContinue'='true','Active dispatch refused continuation');
SELECT pg_temp.assert_true(pg_temp.execution_status('a2000000-0000-4000-8000-000000000001')->>'canContinue'='false','Returned dispatch continued');
SELECT pg_temp.assert_true(pg_temp.execution_status('a2000000-0000-4000-8000-000000000003')->>'canContinue'='false','Undispatched claim continued');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_status(worker:='a3000000-0000-4000-8000-000000000002')$q$,'42501','Status ignored worker identity');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_read(through_sequence:=3)$q$,'22023','Future selection cursor accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_read(through_sequence:=-1)$q$,'22023','Negative selection cursor accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_read(after_task:=-2)$q$,'22023','Invalid selection task cursor accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_read(page_limit:=129)$q$,'22023','Oversized selection page accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_read(page_limit:=0)$q$,'22023','Empty selection page accepted');
RESET ROLE;
SAVEPOINT expired_dispatch_status;
ALTER TABLE engagement_synthesis_generation_dispatches DISABLE TRIGGER synthesis_generation_dispatch_immutable;
UPDATE engagement_synthesis_generation_dispatches SET expires_at='2000-01-01' WHERE attempt_id='a2000000-0000-4000-8000-000000000002';
ALTER TABLE engagement_synthesis_generation_dispatches ENABLE TRIGGER synthesis_generation_dispatch_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.execution_status()->>'canContinue'='false','Expired dispatch continued');
ROLLBACK TO SAVEPOINT expired_dispatch_status;
SAVEPOINT expired_grant_status;
ALTER TABLE engagement_synthesis_generation_authorizations DISABLE TRIGGER synthesis_generation_authorization_immutable;
UPDATE engagement_synthesis_generation_authorizations SET intent_text=jsonb_set(intent_text::jsonb,'{expiresAt}','"2000-01-01T00:00:00Z"')::text;
ALTER TABLE engagement_synthesis_generation_authorizations ENABLE TRIGGER synthesis_generation_authorization_immutable;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.execution_status()->>'canContinue'='false','Expired grant continued');
ROLLBACK TO SAVEPOINT expired_grant_status;
SAVEPOINT changed_status_key;
CREATE TEMP TABLE original_status_credential AS SELECT * FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
DELETE FROM workspace_provider_api_credentials WHERE revision_id='e0000000-0000-4000-8000-000000000002';
INSERT INTO workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
 SELECT revision_id,connection_id,workspace_id,'v2:SYNTHETIC replacement observed by status' FROM original_status_credential;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_status()','PT409','Changed credential continued');
ROLLBACK TO SAVEPOINT changed_status_key;
SAVEPOINT revoked_connection_status;
UPDATE workspace_provider_api_connections SET revoked_at=clock_timestamp() WHERE id='e0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_status()','PT409','Status ignored current connection');
ROLLBACK TO SAVEPOINT revoked_connection_status;
SET LOCAL ROLE service_role;
SELECT pg_temp.execution_dispatch('a2000000-0000-4000-8000-000000000003');
-- A new returned retry does not change the selected attempt.
SELECT pg_temp.execution_output('a2000000-0000-4000-8000-000000000003');
SELECT pg_temp.execution_output('a2000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_true(pg_temp.selection_read()=(SELECT value FROM selection_probe WHERE key='initial'),'Later returned output silently changed selection');
RESET ROLE;
CREATE FUNCTION pg_temp.selection_choose(id uuid DEFAULT 'a4000000-0000-4000-8000-000000000001',task bigint DEFAULT 0,
 previous uuid DEFAULT NULL,attempt uuid DEFAULT 'a2000000-0000-4000-8000-000000000003',reason text DEFAULT 'SYNTHETIC choose retained retry') RETURNS jsonb LANGUAGE sql AS $$
 SELECT select_engagement_synthesis_generation_attempt('f0000000-0000-4000-8000-000000000001',task,id,
  coalesce(previous,(SELECT ((value#>>'{entries,0,receiptText}')::jsonb->>'id')::uuid FROM selection_probe WHERE key='initial')),attempt,reason);
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.expect_error('SELECT pg_temp.selection_choose()','42501','Another actor changed result selection');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_choose(attempt:='a2000000-0000-4000-8000-000000000002')$q$,'PT409','Another task output selected');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_choose(reason:=' ')$q$,'22023','Blank selection reason accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_choose(reason:=repeat('a',4001))$q$,'22023','Oversized selection reason accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_choose(task:=99)$q$,'PT409','Unknown selection task accepted');
INSERT INTO selection_probe VALUES('chosen',pg_temp.selection_choose());
SELECT pg_temp.assert_true(pg_temp.selection_choose()=(SELECT value FROM selection_probe WHERE key='chosen'),'Selection retry changed original receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_choose(reason:='SYNTHETIC changed retry')$q$,'PT409','Changed selection replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.selection_choose(id:='a4000000-0000-4000-8000-000000000002')$q$,'PT409','Stale selection replaced current choice');
-- Clear a task explicitly. It remains in the synthesis plan and incomplete.
SELECT pg_temp.selection_choose('a4000000-0000-4000-8000-000000000002',1,
 (SELECT ((value#>>'{entries,1,receiptText}')::jsonb->>'id')::uuid FROM selection_probe WHERE key='initial'),NULL,'SYNTHETIC clear current choice');
-- An older returned result is a valid explicit choice; no new dispatch occurs.
SELECT pg_temp.selection_choose('a4000000-0000-4000-8000-000000000003',0,'a4000000-0000-4000-8000-000000000001',
 'a2000000-0000-4000-8000-000000000001','SYNTHETIC keep original result');
SELECT pg_temp.assert_true(pg_temp.selection_choose()=(SELECT value FROM selection_probe WHERE key='chosen'),'Old selection acknowledgement lost after a later choice');
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO selection_probe VALUES('current',pg_temp.selection_read());
SELECT pg_temp.assert_true((SELECT value->>'throughSequence'='5' AND jsonb_array_length(value->'entries')=2
 AND (value#>>'{entries,0,receiptText}')::jsonb->>'id'='a4000000-0000-4000-8000-000000000003'
 AND (value#>>'{entries,0,receiptText}')::jsonb->>'attemptId'='a2000000-0000-4000-8000-000000000001'
 AND (value#>>'{entries,1,receiptText}')::jsonb->'attemptId'='null'::jsonb FROM selection_probe WHERE key='current'),'Explicit current selections differ');
SELECT pg_temp.assert_true(read_engagement_synthesis_generation_selections('f0000000-0000-4000-8000-000000000002')=(SELECT value FROM selection_probe WHERE key='other'),'Another request changed selection sequence');
SELECT pg_temp.assert_true(pg_temp.selection_read(2)=(SELECT value FROM selection_probe WHERE key='initial'),'Later selections rewrote an anchored snapshot');
SELECT pg_temp.assert_true((pg_temp.selection_read(2,0,1)#>>'{entries,0,receiptText}')::jsonb->>'taskIndex'='1','Anchored second page lost its original choice');
SELECT pg_temp.assert_true(pg_temp.selection_read(0)->'entries'='[]'::jsonb,'Empty historical selection snapshot differs');
SELECT pg_temp.expect_error('SELECT pg_temp.selection_choose()','42501','Worker changed staff choice');
RESET ROLE;
SELECT pg_temp.expect_error('DELETE FROM engagement_synthesis_generation_selections','P0001','Selection history deletion allowed');
SELECT pg_temp.expect_error('UPDATE engagement_synthesis_generation_selections SET receipt_text=''{}''','P0001','Selection history update allowed');
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel();
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.execution_status()','PT409','Cancelled job continued');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.selection_choose('a4000000-0000-4000-8000-000000000004',0,'a4000000-0000-4000-8000-000000000003',
 'a2000000-0000-4000-8000-000000000001','SYNTHETIC retained choice after cancellation');
SELECT pg_temp.expect_error('SELECT pg_temp.selection_read()','42501','Authenticated selection inventory exposed');
SELECT pg_temp.expect_error('SELECT pg_temp.execution_status()','42501','Authenticated execution status exposed');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_generation_selections','42501','Private selection history exposed');
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.selection_read()','42501','Revoked requester selection read allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.execution_status()','42501','Revoked requester continued');
RESET ROLE;
SELECT 'synthesis-generation-selection-custody-verified';
