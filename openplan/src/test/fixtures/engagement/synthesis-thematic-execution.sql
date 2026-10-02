-- Two evidence frames followed by the distinct final proposal task. Structural
-- task/capture strings establish custody and authority, not semantic validity.
RESET ROLE;
SELECT pg_temp.seal_save();
SET LOCAL ROLE service_role;
SELECT pg_temp.tp_prepare(); SELECT pg_temp.tp_stage(); SELECT pg_temp.tp_seal();
RESET ROLE;
CREATE TEMP TABLE thematic_execution_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON thematic_execution_probe TO authenticated,service_role;
INSERT INTO thematic_execution_probe SELECT 'intent',jsonb_build_object('schemaVersion',1,'headerSha256',header_sha256,
 'maxAttempts',3,'maxOutputTokens',128,'responseByteLimit',4096,'expiresAt',clock_timestamp()+interval '1 hour',
 'chargesAcknowledged',true,'retryTaskIndex',NULL,'retryOfAttemptId',NULL)
 FROM engagement_synthesis_generation_plans WHERE request_id='f0000000-0000-4000-8000-000000000010';
CREATE FUNCTION pg_temp.te_grant(patch jsonb DEFAULT '{}',id uuid DEFAULT 'a1000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT authorize_engagement_synthesis_thematic('f0000000-0000-4000-8000-000000000010',id,(value||patch)::text) FROM thematic_execution_probe WHERE key='intent';
$$;
CREATE FUNCTION pg_temp.te_id(frame bigint) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('a2000000-0000-4000-8000-'||lpad((frame+1)::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.te_task(frame bigint) RETURNS text LANGUAGE sql AS $$
 SELECT '{"instructions":"SYNTHETIC structural task","frame":'||frame::text||',"original":"SYNTHETIC \u0000\ud800 é 😀"}';
$$;
CREATE FUNCTION pg_temp.te_claim(frame bigint DEFAULT 0,task_text text DEFAULT NULL,grant_id uuid DEFAULT 'a1000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT claim_engagement_synthesis_thematic_attempt(grant_id,frame,pg_temp.te_id(frame),'a3000000-0000-4000-8000-000000000001',coalesce(task_text,pg_temp.te_task(frame)),
  CASE WHEN frame>0 THEN pg_temp.te_id(frame-1) ELSE NULL END,
  CASE WHEN frame>0 THEN (SELECT id FROM engagement_synthesis_generation_selections WHERE request_id='f0000000-0000-4000-8000-000000000010' AND task_index=frame-1 ORDER BY sequence_no DESC LIMIT 1) ELSE NULL END,
  CASE WHEN frame>0 THEN coalesce((SELECT capture_sha256 FROM engagement_synthesis_generation_outputs WHERE attempt_id=pg_temp.te_id(frame-1)),repeat('a',64)) ELSE NULL END,
  CASE WHEN frame>0 THEN repeat('b',64) ELSE NULL END);
$$;
CREATE FUNCTION pg_temp.te_dispatch(frame bigint DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatch_engagement_synthesis_thematic_attempt(pg_temp.te_id(frame),'a3000000-0000-4000-8000-000000000001');
$$;
CREATE FUNCTION pg_temp.te_output(frame bigint DEFAULT 0,body text DEFAULT 'SYNTHETIC opaque original capture') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_generation_output(pg_temp.te_id(frame),'a3000000-0000-4000-8000-000000000001',
  replace(encode(convert_to(body,'UTF8'),'base64'),E'\n',''),encode(extensions.digest(body,'sha256'),'hex'));
$$;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"chargesAcknowledged":false}',
  '{"maxAttempts":0}','{"maxAttempts":4}','{"maxAttempts":1.5}','{"maxOutputTokens":0}','{"maxOutputTokens":65537}',
  '{"responseByteLimit":4095}','{"responseByteLimit":4194305}','{"expiresAt":"infinity"}',
  '{"retryTaskIndex":0}','{"retryOfAttemptId":"a2000000-0000-4000-8000-000000000099"}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.te_grant(%L)',patch),'22023','Malformed thematic authorization accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_grant('{"expiresAt":"2000-01-01T00:00:00Z"}')$q$,'PT409','Expired thematic authorization accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_grant('{"headerSha256":"0000000000000000000000000000000000000000000000000000000000000000"}')$q$,'PT409','Different thematic plan authorized');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error('SELECT pg_temp.te_grant()','42501','Other actor authorized thematic');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SAVEPOINT thematic_allowance;
SELECT pg_temp.te_grant('{"maxAttempts":1}');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.te_claim(); SELECT pg_temp.te_dispatch(); SELECT pg_temp.te_output();
SELECT pg_temp.expect_error('SELECT pg_temp.te_claim(1)','PT409','Complete predecessor bypassed thematic attempt allowance');
ROLLBACK TO SAVEPOINT thematic_allowance;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.te_grant();
 EXCEPTION WHEN SQLSTATE '22023' THEN RAISE EXCEPTION 'Full thematic inventory authorization refused'; END;
END $$;
INSERT INTO thematic_execution_probe VALUES('grant',pg_temp.te_grant());
SELECT pg_temp.assert_true(pg_temp.te_grant()=(SELECT value FROM thematic_execution_probe WHERE key='grant'),'Thematic grant retry changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_grant('{"maxAttempts":1}')$q$,'PT409','Changed thematic grant replayed');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_claim(0,'[]')$q$,'22023','Nonobject dynamic thematic task accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_claim(0,jsonb_build_object('text',repeat('x',4096))::text)$q$,'22023','Dynamic thematic task exceeded byte limit');
SELECT pg_temp.expect_error($q$SELECT claim_engagement_synthesis_thematic_attempt('a1000000-0000-4000-8000-000000000001',0,pg_temp.te_id(0),'a3000000-0000-4000-8000-000000000001',pg_temp.te_task(0),pg_temp.te_id(1),'a4000000-0000-4000-8000-000000000099',repeat('a',64),repeat('b',64))$q$,'22023','First thematic frame accepted a predecessor');
INSERT INTO thematic_execution_probe VALUES('claim0',pg_temp.te_claim());
SELECT pg_temp.assert_true(pg_temp.te_claim()=(SELECT value FROM thematic_execution_probe WHERE key='claim0'),'Thematic claim retry changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_claim(0,'{"changed":true}')$q$,'PT409','Changed thematic task replayed');
SELECT pg_temp.expect_error('SELECT pg_temp.te_claim(1)','PT409','Thematic frame claimed before original predecessor');
SELECT pg_temp.expect_error('SELECT pg_temp.te_output()','PT409','Thematic output retained without dispatch');
INSERT INTO thematic_execution_probe VALUES('dispatch0',pg_temp.te_dispatch());
SELECT pg_temp.assert_true((SELECT value->>'authorizedNow'='true' FROM thematic_execution_probe WHERE key='dispatch0'),'Thematic first dispatch did not authorize');
SELECT pg_temp.assert_true(pg_temp.te_dispatch()=(SELECT value||'{"authorizedNow":false}' FROM thematic_execution_probe WHERE key='dispatch0'),'Thematic dispatch retry renewed permission');
SELECT pg_temp.te_output();
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_output(0,'SYNTHETIC changed capture')$q$,'PT409','Thematic original capture replaced');
SELECT pg_temp.te_claim(1);
SELECT pg_temp.assert_true(pg_temp.te_claim(1)=pg_temp.te_claim(1),'Thematic predecessor claim retry differs');
DO $$ DECLARE changed_field text; statement text; BEGIN
 FOREACH changed_field IN ARRAY ARRAY['attempt','selection','capture','result'] LOOP
  statement:=format($q$SELECT claim_engagement_synthesis_thematic_attempt(a.authorization_id,a.task_index,a.id,a.worker_id,i.task_text,
   %s,%s,%s,%s) FROM engagement_synthesis_generation_attempts a JOIN engagement_synthesis_thematic_attempt_inputs i ON i.attempt_id=a.id WHERE a.id=pg_temp.te_id(1)$q$,
   CASE WHEN changed_field='attempt' THEN quote_literal('a2000000-0000-4000-8000-000000000099')||'::uuid' ELSE 'i.predecessor_attempt_id' END,
   CASE WHEN changed_field='selection' THEN quote_literal('a4000000-0000-4000-8000-000000000099')||'::uuid' ELSE 'i.predecessor_selection_id' END,
   CASE WHEN changed_field='capture' THEN quote_literal(repeat('0',64)) ELSE 'i.predecessor_capture_sha256' END,
   CASE WHEN changed_field='result' THEN quote_literal(repeat('0',64)) ELSE 'i.previous_result_sha256' END);
  PERFORM pg_temp.expect_error(statement,'PT409','Changed thematic predecessor claim replayed');
 END LOOP;
END $$;
SELECT pg_temp.te_dispatch(1);
SELECT pg_temp.te_output(1);
SELECT pg_temp.te_claim(2);
SAVEPOINT thematic_final_proposal;
SELECT pg_temp.assert_true(pg_temp.te_dispatch(2)->>'authorizedNow'='true','Final thematic proposal dispatch unavailable');
SELECT pg_temp.te_output(2,'SYNTHETIC final proposal original');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_synthesis_generation_outputs o JOIN engagement_synthesis_generation_attempts a ON a.id=o.attempt_id WHERE a.request_id='f0000000-0000-4000-8000-000000000010'),'Final thematic proposal capture missing');
SELECT pg_temp.expect_error('SELECT pg_temp.te_claim(3)','PT409','Task outside thematic inventory claimed');
ROLLBACK TO SAVEPOINT thematic_final_proposal;
-- Explicit retries retain one exact predecessor and do not silently select it.
SAVEPOINT thematic_retry;
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_grant(jsonb_build_object('maxAttempts',1,'retryTaskIndex',2,'retryOfAttemptId',pg_temp.te_id(2)),'a1000000-0000-4000-8000-000000000020')$q$,'PT409','Active thematic attempt retried');
SELECT pg_temp.te_grant(jsonb_build_object('maxAttempts',1,'retryTaskIndex',0,'retryOfAttemptId',pg_temp.te_id(0)),'a1000000-0000-4000-8000-000000000020');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT claim_engagement_synthesis_thematic_attempt('a1000000-0000-4000-8000-000000000020',0,'a2000000-0000-4000-8000-000000000020','a3000000-0000-4000-8000-000000000001',pg_temp.te_task(0),NULL,NULL,NULL,NULL);
SELECT pg_temp.assert_true((SELECT previous_attempt_id=pg_temp.te_id(0) FROM engagement_synthesis_generation_attempts WHERE id='a2000000-0000-4000-8000-000000000020'),'Thematic retry lost exact predecessor');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_synthesis_generation_selections WHERE request_id='f0000000-0000-4000-8000-000000000010' AND task_index=0),'Thematic retry silently selected itself');
SELECT dispatch_engagement_synthesis_thematic_attempt('a2000000-0000-4000-8000-000000000020','a3000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true(read_engagement_synthesis_thematic_execution_status('a2000000-0000-4000-8000-000000000020','a3000000-0000-4000-8000-000000000001')->>'canContinue'='true','Fresh thematic status unavailable');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_grant(jsonb_build_object('maxAttempts',1,'retryTaskIndex',0,'retryOfAttemptId',pg_temp.te_id(0)),'a1000000-0000-4000-8000-000000000021')$q$,'PT409','Thematic retry predecessor reused');
ROLLBACK TO SAVEPOINT thematic_retry;
-- Dynamic task hashes differ from the static safe-reference task hashes.
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_synthesis_thematic_attempt_inputs i JOIN engagement_synthesis_generation_attempts a ON a.id=i.attempt_id
 JOIN engagement_synthesis_generation_plan_tasks t ON t.request_id=a.request_id AND t.task_index=a.task_index
 WHERE a.request_id='f0000000-0000-4000-8000-000000000010' AND i.task_text=pg_temp.te_task(a.task_index)
 AND i.task_sha256=encode(extensions.digest(i.task_text,'sha256'),'hex') AND i.task_bytes=octet_length(i.task_text)
 AND a.binding_text::jsonb->>'taskSha256'=i.task_sha256 AND i.task_sha256<>t.task_sha256
 AND a.binding_text::jsonb->>'planSha256'=repeat('e',64)),'Thematic task original or dynamic binding differs');
-- Valid undispatched final task isolates live authority checks from duplicate
-- dispatch and exhausted-allowance backstops. Each change rolls back.
RESET ROLE;
SAVEPOINT thematic_actor_revoked;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.te_dispatch(2)','42501','Current thematic requester role bypassed');
ROLLBACK TO SAVEPOINT thematic_actor_revoked;
SAVEPOINT thematic_connection_revoked;
UPDATE workspace_provider_api_connections SET revoked_at=clock_timestamp() WHERE id='e0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.te_dispatch(2)','PT409','Revoked thematic provider dispatched');
ROLLBACK TO SAVEPOINT thematic_connection_revoked;
SAVEPOINT thematic_cancelled;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.te_dispatch(2)','PT409','Cancelled thematic provider dispatched');
ROLLBACK TO SAVEPOINT thematic_cancelled;
SET LOCAL ROLE service_role;
-- Changing frame zero's selection invalidates final proposal dispatch even though
-- frame one's selection and original capture have not changed.
INSERT INTO thematic_execution_probe VALUES('selection0',read_engagement_synthesis_thematic_selections('f0000000-0000-4000-8000-000000000010',NULL,-1,1));
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT select_engagement_synthesis_thematic_attempt('f0000000-0000-4000-8000-000000000010',0,'a4000000-0000-4000-8000-000000000001',
 (SELECT ((value#>>'{entries,0,receiptText}')::jsonb->>'id')::uuid FROM thematic_execution_probe WHERE key='selection0'),pg_temp.te_id(0),'SYNTHETIC new staff choice');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.te_dispatch(2)','PT409','Changed thematic ancestor permitted dispatch');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_execution_status(pg_temp.te_id(1),'a3000000-0000-4000-8000-000000000001')$q$,'PT409','Changed thematic ancestor kept execution alive');
-- Original captures still recover after a changed selection and cancellation.
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
SELECT pg_temp.assert_true(pg_temp.te_grant()=(SELECT value FROM thematic_execution_probe WHERE key='grant'),'Cancelled thematic lost original authorization receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.te_grant('{}','a1000000-0000-4000-8000-000000000099')$q$,'PT409','Cancelled thematic created fresh authorization');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.te_output(1);
SELECT pg_temp.assert_true(pg_temp.te_dispatch()=(SELECT value||'{"authorizedNow":false}' FROM thematic_execution_probe WHERE key='dispatch0'),'Old thematic dispatch receipt renewed authority after access loss');
SELECT pg_temp.expect_error('SELECT pg_temp.te_dispatch(2)','42501','Revoked thematic actor dispatched');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_thematic_attempt_inputs SET task_text='{}' WHERE attempt_id=pg_temp.te_id(0)$q$,'P0001','Thematic task original changed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_thematic_attempt_inputs WHERE attempt_id=pg_temp.te_id(0)$q$,'P0001','Thematic task original deleted');
-- Catalog checks expose excess privileges independently of other refusals.
DO $$ DECLARE command text; role_name text; BEGIN
 FOREACH command IN ARRAY ARRAY['public.lock_synthesis_thematic_execution_scope(uuid)','public.assert_synthesis_thematic_execution_current(uuid)','public.assert_synthesis_thematic_predecessors_current(uuid)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,command,'EXECUTE'),'Private thematic authority helper exposed');
  END LOOP;
 END LOOP;
 FOREACH command IN ARRAY ARRAY['public.claim_engagement_synthesis_thematic_attempt(uuid,bigint,uuid,uuid,text,uuid,uuid,text,text)',
  'public.dispatch_engagement_synthesis_thematic_attempt(uuid,uuid)','public.read_engagement_synthesis_thematic_execution_status(uuid,uuid)',
  'public.read_engagement_synthesis_thematic_selections(uuid,bigint,bigint,integer)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,command,'EXECUTE'),'Thematic worker authority exposed');
  END LOOP;
 END LOOP;
 FOREACH command IN ARRAY ARRAY['public.authorize_engagement_synthesis_thematic(uuid,uuid,text)',
  'public.select_engagement_synthesis_thematic_attempt(uuid,bigint,uuid,uuid,uuid,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,command,'EXECUTE'),'Thematic staff authority exposed');
  END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_thematic_attempt_inputs','42501','Private thematic task table exposed');
RESET ROLE;
SELECT 'synthesis-thematic-execution-verified';
