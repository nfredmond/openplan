-- Generic historical selection reads must also support contextual execution.
-- The execution fixture leaves the original requester demoted and cancelled.
-- Structural SQL evidence does not establish TypeScript replay or model quality.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.ctx_read()#>>'{request,actorId}'='7a50d4fb-35b7-41f4-9bce-8a4e7d157569',
 'Context historical read replaced original requester');
SELECT pg_temp.assert_true(pg_temp.ctx_read()->'cancellation' IS NOT NULL AND pg_temp.ctx_read()->'cancellation'<>'null'::jsonb,
 'Context historical read lost cancellation');
CREATE FUNCTION pg_temp.context_history(through_sequence bigint DEFAULT NULL,after_task bigint DEFAULT -1,page_limit integer DEFAULT 128,
 campaign uuid DEFAULT '10c5cdd7-16c6-4b91-b9c0-d2f67598a54f') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_generation_selection_history(campaign,'f0000000-0000-4000-8000-000000000010',through_sequence,after_task,page_limit);
$$;
SELECT pg_temp.assert_true(pg_temp.context_history()->>'throughSequence'='4','Context history sequence differs');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.context_history()->'entries')=3,'Context history lost selected frames');
SELECT pg_temp.assert_true((pg_temp.context_history()#>>'{entries,0,receiptText}')::jsonb->>'id'='a4000000-0000-4000-8000-000000000001',
 'Context history lost latest choice');
SELECT pg_temp.assert_true((pg_temp.context_history()#>>'{entries,0,receiptText}')::jsonb->>'reason'=repeat('😀',4000),
 'Context history changed Unicode reason');
SELECT pg_temp.assert_true((pg_temp.context_history(3)#>>'{entries,0,receiptText}')=(SELECT value#>>'{entries,0,receiptText}' FROM context_execution_probe WHERE key='selection0'),
 'Context historical selection changed');
SELECT pg_temp.assert_true(pg_temp.context_history(3,-1,1)->>'hasMore'='true','Context history page lost continuation');
SELECT pg_temp.assert_true((pg_temp.context_history(3,0,1)#>>'{entries,0,receiptText}')::jsonb->>'taskIndex'='1',
 'Context history task cursor changed');
SELECT pg_temp.assert_true(pg_temp.context_history(0)->'entries'='[]'::jsonb,'Context empty history changed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.context_history(campaign:='250f0f62-7225-48b3-a2f7-5a134d3b9f78')$q$,'42501','Context history ignored campaign');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_context_attempt_inputs','42501','Context history granted private task access');
SELECT pg_temp.expect_error('SELECT pg_temp.ce_grant()','42501','Context history renewed original execution');
RESET ROLE;
DELETE FROM workspace_members WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.context_history()->'entries')=3,'Departed context requester erased history');
SELECT pg_temp.assert_true(pg_temp.ctx_read()#>>'{request,actorId}'='7a50d4fb-35b7-41f4-9bce-8a4e7d157569','Departed context requester blocked current staff');
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES('9f000000-0000-4000-8000-000000000091','context-history-owner@synthetic.invalid');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','9f000000-0000-4000-8000-000000000091','owner');
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.context_history()','42501','Revoked context reader kept history access');
SELECT pg_temp.expect_error('SELECT pg_temp.ctx_read()','42501','Revoked context reader kept request access');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.context_history()','42501','Outsider read context history');
RESET ROLE; SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.context_history()','42501','Anonymous context history exposed');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.context_history()','42501','Service impersonated context history reader');
RESET ROLE;
SELECT 'synthesis-context-history-verified';
