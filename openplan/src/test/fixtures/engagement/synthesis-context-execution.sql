-- Structural custody and permission probes. Synthetic task/capture strings do
-- not prove recipe compliance, source reconstruction or model usefulness.
RESET ROLE;
INSERT INTO context_frames SELECT 2,replace(replace(body,'"index":0','"index":2'),'SYNTHETIC retained context frame','SYNTHETIC third context frame') FROM context_frames WHERE index=0;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.cp_prepare('{"frameCount":3}');
SELECT pg_temp.cp_stage(0,3);
SELECT pg_temp.cp_seal();
SELECT pg_temp.assert_true(read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000010')=
 jsonb_build_object('schemaVersion',1,'requestId','f0000000-0000-4000-8000-000000000001','throughSequence',0,'afterTaskIndex',-1,'hasMore',false,'entries','[]'::jsonb),'Context parent snapshot lost its fixed scope');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000010',-2)$q$,'22023','Context parent cursor accepted invalid index');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000010',-1,129)$q$,'22023','Context parent cursor exceeded limit');

RESET ROLE;
CREATE TEMP TABLE context_execution_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON context_execution_probe TO authenticated,service_role;
INSERT INTO context_execution_probe SELECT 'intent',jsonb_build_object('schemaVersion',1,'headerSha256',header_sha256,
 'maxAttempts',3,'maxOutputTokens',128,'responseByteLimit',4096,'expiresAt',clock_timestamp()+interval '1 hour',
 'chargesAcknowledged',true,'retryTaskIndex',NULL,'retryOfAttemptId',NULL)
 FROM engagement_synthesis_generation_plans WHERE request_id='f0000000-0000-4000-8000-000000000010';
CREATE FUNCTION pg_temp.ce_grant(patch jsonb DEFAULT '{}',id uuid DEFAULT 'a1000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT authorize_engagement_synthesis_context('f0000000-0000-4000-8000-000000000010',id,(value||patch)::text) FROM context_execution_probe WHERE key='intent';
$$;
CREATE FUNCTION pg_temp.ce_id(frame bigint) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('a2000000-0000-4000-8000-'||lpad((frame+1)::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.ce_task(frame bigint) RETURNS text LANGUAGE sql AS $$
 SELECT '{"instructions":"SYNTHETIC structural task","frame":'||frame::text||',"original":"SYNTHETIC \u0000\ud800 é 😀"}';
$$;
CREATE FUNCTION pg_temp.ce_claim(frame bigint DEFAULT 0,task_text text DEFAULT NULL,grant_id uuid DEFAULT 'a1000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT claim_engagement_synthesis_context_attempt(grant_id,frame,pg_temp.ce_id(frame),'a3000000-0000-4000-8000-000000000001',coalesce(task_text,pg_temp.ce_task(frame)),
  CASE WHEN frame>0 THEN pg_temp.ce_id(frame-1) ELSE NULL END,
  CASE WHEN frame>0 THEN (SELECT id FROM engagement_synthesis_generation_selections WHERE request_id='f0000000-0000-4000-8000-000000000010' AND task_index=frame-1 ORDER BY sequence_no DESC LIMIT 1) ELSE NULL END,
  CASE WHEN frame>0 THEN coalesce((SELECT capture_sha256 FROM engagement_synthesis_generation_outputs WHERE attempt_id=pg_temp.ce_id(frame-1)),repeat('a',64)) ELSE NULL END,
  CASE WHEN frame>0 THEN repeat('b',64) ELSE NULL END);
$$;
CREATE FUNCTION pg_temp.ce_dispatch(frame bigint DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatch_engagement_synthesis_context_attempt(pg_temp.ce_id(frame),'a3000000-0000-4000-8000-000000000001');
$$;
CREATE FUNCTION pg_temp.ce_output(frame bigint DEFAULT 0,body text DEFAULT 'SYNTHETIC opaque original capture') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_generation_output(pg_temp.ce_id(frame),'a3000000-0000-4000-8000-000000000001',
  replace(encode(convert_to(body,'UTF8'),'base64'),E'\n',''),encode(extensions.digest(body,'sha256'),'hex'));
$$;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"extra":true}','{"chargesAcknowledged":false}',
  '{"maxAttempts":0}','{"maxAttempts":4}','{"maxAttempts":1.5}','{"maxOutputTokens":0}','{"maxOutputTokens":65537}',
  '{"responseByteLimit":4095}','{"responseByteLimit":4194305}','{"expiresAt":"infinity"}',
  '{"retryTaskIndex":0}','{"retryOfAttemptId":"a2000000-0000-4000-8000-000000000099"}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.ce_grant(%L)',patch),'22023','Malformed context authorization accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_grant('{"expiresAt":"2000-01-01T00:00:00Z"}')$q$,'PT409','Expired context authorization accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_grant('{"headerSha256":"0000000000000000000000000000000000000000000000000000000000000000"}')$q$,'PT409','Different context plan authorized');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error('SELECT pg_temp.ce_grant()','42501','Other actor authorized context');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SAVEPOINT context_allowance;
SELECT pg_temp.ce_grant('{"maxAttempts":1}');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.ce_claim(); SELECT pg_temp.ce_dispatch(); SELECT pg_temp.ce_output();
SELECT pg_temp.expect_error('SELECT pg_temp.ce_claim(1)','PT409','Complete predecessor bypassed context attempt allowance');
ROLLBACK TO SAVEPOINT context_allowance;
INSERT INTO context_execution_probe VALUES('grant',pg_temp.ce_grant());
SELECT pg_temp.assert_true(pg_temp.ce_grant()=(SELECT value FROM context_execution_probe WHERE key='grant'),'Context grant retry changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_grant('{"maxAttempts":1}')$q$,'PT409','Changed context grant replayed');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_claim(0,'[]')$q$,'22023','Nonobject dynamic context task accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_claim(0,jsonb_build_object('text',repeat('x',4096))::text)$q$,'22023','Dynamic context task exceeded byte limit');
SELECT pg_temp.expect_error($q$SELECT claim_engagement_synthesis_context_attempt('a1000000-0000-4000-8000-000000000001',0,pg_temp.ce_id(0),'a3000000-0000-4000-8000-000000000001',pg_temp.ce_task(0),pg_temp.ce_id(1),'a4000000-0000-4000-8000-000000000099',repeat('a',64),repeat('b',64))$q$,'22023','First context frame accepted a predecessor');
INSERT INTO context_execution_probe VALUES('claim0',pg_temp.ce_claim());
SELECT pg_temp.assert_true(pg_temp.ce_claim()=(SELECT value FROM context_execution_probe WHERE key='claim0'),'Context claim retry changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_claim(0,'{"changed":true}')$q$,'PT409','Changed context task replayed');
SELECT pg_temp.expect_error('SELECT pg_temp.ce_claim(1)','PT409','Context frame claimed before original predecessor');
SELECT pg_temp.expect_error('SELECT pg_temp.ce_output()','PT409','Context output retained without dispatch');
INSERT INTO context_execution_probe VALUES('dispatch0',pg_temp.ce_dispatch());
SELECT pg_temp.assert_true((SELECT value->>'authorizedNow'='true' FROM context_execution_probe WHERE key='dispatch0'),'Context first dispatch did not authorize');
SELECT pg_temp.assert_true(pg_temp.ce_dispatch()=(SELECT value||'{"authorizedNow":false}' FROM context_execution_probe WHERE key='dispatch0'),'Context dispatch retry renewed permission');
SELECT pg_temp.ce_output();
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_output(0,'SYNTHETIC changed capture')$q$,'PT409','Context original capture replaced');
SELECT pg_temp.ce_claim(1);
SELECT pg_temp.assert_true(pg_temp.ce_claim(1)=pg_temp.ce_claim(1),'Context predecessor claim retry differs');
DO $$ DECLARE changed_field text; statement text; BEGIN
 FOREACH changed_field IN ARRAY ARRAY['attempt','selection','capture','result'] LOOP
  statement:=format($q$SELECT claim_engagement_synthesis_context_attempt(a.authorization_id,a.task_index,a.id,a.worker_id,i.task_text,
   %s,%s,%s,%s) FROM engagement_synthesis_generation_attempts a JOIN engagement_synthesis_context_attempt_inputs i ON i.attempt_id=a.id WHERE a.id=pg_temp.ce_id(1)$q$,
   CASE WHEN changed_field='attempt' THEN quote_literal('a2000000-0000-4000-8000-000000000099')||'::uuid' ELSE 'i.predecessor_attempt_id' END,
   CASE WHEN changed_field='selection' THEN quote_literal('a4000000-0000-4000-8000-000000000099')||'::uuid' ELSE 'i.predecessor_selection_id' END,
   CASE WHEN changed_field='capture' THEN quote_literal(repeat('0',64)) ELSE 'i.predecessor_capture_sha256' END,
   CASE WHEN changed_field='result' THEN quote_literal(repeat('0',64)) ELSE 'i.previous_result_sha256' END);
  PERFORM pg_temp.expect_error(statement,'PT409','Changed context predecessor claim replayed');
 END LOOP;
END $$;
SELECT pg_temp.ce_dispatch(1);
SELECT pg_temp.ce_output(1);
SELECT pg_temp.ce_claim(2);
-- Both original task hashes differ from the static safe-reference task hashes.
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_synthesis_context_attempt_inputs i JOIN engagement_synthesis_generation_attempts a ON a.id=i.attempt_id
 JOIN engagement_synthesis_generation_plan_tasks t ON t.request_id=a.request_id AND t.task_index=a.task_index
 WHERE a.request_id='f0000000-0000-4000-8000-000000000010' AND i.task_text=pg_temp.ce_task(a.task_index)
 AND i.task_sha256=encode(extensions.digest(i.task_text,'sha256'),'hex') AND i.task_bytes=octet_length(i.task_text)
 AND a.binding_text::jsonb->>'taskSha256'=i.task_sha256 AND i.task_sha256<>t.task_sha256
 AND a.binding_text::jsonb->>'planSha256'=repeat('e',64)),'Context task original or dynamic binding differs');
-- Valid undispatched frame two isolates live authority checks from duplicate
-- dispatch and exhausted-allowance backstops. Each change rolls back.
RESET ROLE;
SAVEPOINT context_actor_revoked;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.ce_dispatch(2)','42501','Current context requester role bypassed');
ROLLBACK TO SAVEPOINT context_actor_revoked;
SAVEPOINT context_connection_revoked;
UPDATE workspace_provider_api_connections SET revoked_at=clock_timestamp() WHERE id='e0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.ce_dispatch(2)','PT409','Revoked context provider dispatched');
ROLLBACK TO SAVEPOINT context_connection_revoked;
SAVEPOINT context_cancelled;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.ce_dispatch(2)','PT409','Cancelled context provider dispatched');
ROLLBACK TO SAVEPOINT context_cancelled;
SET LOCAL ROLE service_role;
-- Changing frame zero's selection invalidates frame two's dispatch even though
-- frame one's selection and original capture have not changed.
INSERT INTO context_execution_probe VALUES('selection0',read_engagement_synthesis_context_selections('f0000000-0000-4000-8000-000000000010',NULL,-1,1));
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT select_engagement_synthesis_context_attempt('f0000000-0000-4000-8000-000000000010',0,'a4000000-0000-4000-8000-000000000001',
 (SELECT ((value#>>'{entries,0,receiptText}')::jsonb->>'id')::uuid FROM context_execution_probe WHERE key='selection0'),pg_temp.ce_id(0),'SYNTHETIC new staff choice');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.ce_dispatch(2)','PT409','Changed context ancestor permitted dispatch');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_execution_status(pg_temp.ce_id(1),'a3000000-0000-4000-8000-000000000001')$q$,'PT409','Changed context ancestor kept execution alive');
-- Original captures still recover after a changed selection and cancellation.
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
SELECT pg_temp.assert_true(pg_temp.ce_grant()=(SELECT value FROM context_execution_probe WHERE key='grant'),'Cancelled context lost original authorization receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.ce_grant('{}','a1000000-0000-4000-8000-000000000099')$q$,'PT409','Cancelled context created fresh authorization');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.ce_output(1);
SELECT pg_temp.assert_true(pg_temp.ce_dispatch()=(SELECT value||'{"authorizedNow":false}' FROM context_execution_probe WHERE key='dispatch0'),'Old context dispatch receipt renewed authority after access loss');
SELECT pg_temp.expect_error('SELECT pg_temp.ce_dispatch(2)','42501','Revoked context actor dispatched');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_context_attempt_inputs SET task_text='{}' WHERE attempt_id=pg_temp.ce_id(0)$q$,'P0001','Context task original changed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_context_attempt_inputs WHERE attempt_id=pg_temp.ce_id(0)$q$,'P0001','Context task original deleted');
-- Catalog checks expose excess privileges independently of other refusals.
DO $$ DECLARE command text; role_name text; BEGIN
 FOREACH command IN ARRAY ARRAY['public.assert_synthesis_context_execution_current(uuid)','public.assert_synthesis_context_predecessors_current(uuid)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,command,'EXECUTE'),'Private context authority helper exposed');
  END LOOP;
 END LOOP;
 FOREACH command IN ARRAY ARRAY['public.claim_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,text,uuid,uuid,text,text)',
  'public.dispatch_engagement_synthesis_context_attempt(uuid,uuid)','public.read_engagement_synthesis_context_execution_status(uuid,uuid)',
  'public.read_engagement_synthesis_context_selections(uuid,bigint,bigint,integer)','public.read_engagement_synthesis_context_parent_selections(uuid,bigint,integer)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,command,'EXECUTE'),'Context worker authority exposed');
  END LOOP;
 END LOOP;
 FOREACH command IN ARRAY ARRAY['public.authorize_engagement_synthesis_context(uuid,uuid,text)',
  'public.select_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,uuid,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,command,'EXECUTE'),'Context staff authority exposed');
  END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_context_attempt_inputs','42501','Private context task table exposed');
RESET ROLE;
SELECT 'synthesis-context-execution-verified';
