-- The selection fixture ends with the original requester demoted to viewer.
-- A different current staff member can inspect history without continuing work.
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES('9f000000-0000-4000-8000-000000000090','history-custodian@synthetic.invalid');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','9f000000-0000-4000-8000-000000000090','owner');
-- A foreign request has a larger sequence even in a fresh isolated database.
UPDATE workspace_members SET role='member' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE predecessor uuid:='a4000000-0000-4000-8000-000000000009'; next_id uuid; BEGIN
 FOR counter IN 1..7 LOOP
  next_id:=gen_random_uuid();
  PERFORM select_engagement_synthesis_generation_attempt('f0000000-0000-4000-8000-000000000002',0,next_id,predecessor,NULL,'SYNTHETIC unrelated history control');
  predecessor:=next_id;
 END LOOP;
END $$;
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='member' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
CREATE FUNCTION pg_temp.history_read(through_sequence bigint DEFAULT NULL,after_task bigint DEFAULT -1,page_limit integer DEFAULT 128,
 campaign uuid DEFAULT '10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request uuid DEFAULT 'f0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_generation_selection_history(campaign,request,through_sequence,after_task,page_limit);
$$;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.history_read()->>'throughSequence'='6','Current history sequence differs');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.history_read()->'entries')=2,'Current staff history differs');
SELECT pg_temp.assert_true((pg_temp.history_read()#>>'{entries,0,receiptText}')::jsonb->>'id'='a4000000-0000-4000-8000-000000000004','Latest history choice differs');
SELECT pg_temp.assert_true(pg_temp.history_read(2)=(SELECT value FROM selection_probe WHERE key='initial'),'Historical choices changed');
SELECT pg_temp.assert_true(pg_temp.history_read(5)=(SELECT value FROM selection_probe WHERE key='current'),'Historical choices changed');
SELECT pg_temp.assert_true(pg_temp.history_read(0)->'entries'='[]'::jsonb,'Empty history sequence changed');
SELECT pg_temp.assert_true(pg_temp.history_read(2,-1,1)->>'hasMore'='true','History pagination lost has-more');
SELECT pg_temp.assert_true((pg_temp.history_read(2,0,1)#>>'{entries,0,receiptText}')::jsonb->>'taskIndex'='1','History task cursor changed');
SELECT pg_temp.assert_true((pg_temp.history_read(2)#>>'{entries,0,receiptText}')::jsonb->>'actorId'='13466ed2-dcb7-4861-a528-68cc5579eea9','History replaced original authorship');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(7)','22023','Future history sequence accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(-1)','22023','Negative history sequence accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(after_task:=-2)','22023','Invalid history task cursor accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(after_task:=NULL)','22023','Null history task cursor accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(page_limit:=129)','22023','Oversized history page accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(page_limit:=0)','22023','Empty history page accepted');
SELECT pg_temp.expect_error('SELECT pg_temp.history_read(page_limit:=NULL)','22023','Null history page accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.history_read(request:='f0000000-0000-4000-8000-000000000099')$q$,'42501','Absent history request exposed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.execution_grant('a1000000-0000-4000-8000-000000000090')$q$,'42501','Historical reader authorized original requester work');
SELECT pg_temp.expect_error('SELECT pg_temp.selection_choose()','42501','Historical reader changed original choices');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_generation_outputs','42501','Historical reader gained direct output table access');
RESET ROLE;
INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES
 ('10c5cdd7-16c6-4b91-b9c0-d2f67598a549','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','SYNTHETIC other permitted campaign','7a50d4fb-35b7-41f4-9bce-8a4e7d157569');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.history_read(campaign:='10c5cdd7-16c6-4b91-b9c0-d2f67598a549')$q$,'42501','History ignored campaign scope');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error('SELECT pg_temp.history_read()','42501','Revoked original requester read history');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.history_read()','42501','Outsider read history');
SELECT pg_temp.expect_error($q$SELECT pg_temp.history_read(campaign:='250f0f62-7225-48b3-a2f7-5a134d3b9f78')$q$,'42501','History ignored workspace scope');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.expect_error('SELECT pg_temp.history_read()','42501','Missing identity read history');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.history_read()','42501','Anonymous history function exposed');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.history_read()','42501','Service impersonated authenticated history reader');
SELECT pg_temp.expect_error('SELECT pg_temp.execution_status()','42501','Historical read renewed revoked execution');
RESET ROLE;
-- Cancellation does not erase history or require the former requester to return.
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel();
RESET ROLE;
DELETE FROM workspace_members WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.history_read(2)=(SELECT value FROM selection_probe WHERE key='initial'),'Cancellation or departed requester erased history');
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.history_read()','42501','Current reader access loss ignored');
RESET ROLE;
SELECT 'synthesis-generation-history-verified';
