-- Operator-seeded structural history exercises the native snapshot reader.
-- These opaque synthetic receipts do not prove original provider interpretation.
RESET ROLE;
INSERT INTO engagement_synthesis_generation_plans(request_id,header_text)
 VALUES('f0000000-0000-4000-8000-000000000001','{"synthetic":"parent selection reader"}');
INSERT INTO engagement_synthesis_generation_plan_tasks(request_id,task_index,task_text,cumulative_bytes,chain_sha256)
 SELECT 'f0000000-0000-4000-8000-000000000001',n,'{}',2*(n+1),repeat('a',64) FROM generate_series(0,1) n;
INSERT INTO engagement_synthesis_generation_selections(id,request_id,task_index,attempt_id,previous_selection_id,sequence_no,actor_id,origin,receipt_text)
 SELECT ('b4000000-0000-4000-8000-'||lpad((n+1)::text,12,'0'))::uuid,'f0000000-0000-4000-8000-000000000001',n,NULL,NULL,n+1,
 '13466ed2-dcb7-4861-a528-68cc5579eea9','staff',jsonb_build_object('syntheticReceipt',n+1)::text FROM generate_series(0,1) n;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ctx_create('f0000000-0000-4000-8000-000000000011','{"selectionSequence":2}');
RESET ROLE;
-- A subsequent choice cannot replace the old choice in this child snapshot.
INSERT INTO engagement_synthesis_generation_selections(id,request_id,task_index,attempt_id,previous_selection_id,sequence_no,actor_id,origin,receipt_text)
 VALUES('b4000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000001',0,NULL,
 'b4000000-0000-4000-8000-000000000001',3,'13466ed2-dcb7-4861-a528-68cc5579eea9','staff','{"syntheticReceipt":3}');
DELETE FROM workspace_members WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
CREATE TEMP TABLE context_parent_pages(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON context_parent_pages TO service_role;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO context_parent_pages VALUES('first',read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',-1,1));
INSERT INTO context_parent_pages VALUES('second',read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',0,1));
SELECT pg_temp.assert_true((SELECT value->>'requestId'='f0000000-0000-4000-8000-000000000001' AND value->>'throughSequence'='2'
 AND value->>'afterTaskIndex'='-1' AND value->>'hasMore'='true' AND jsonb_array_length(value->'entries')=1
 AND (value#>>'{entries,0,receiptText}')::jsonb='{"syntheticReceipt":1}'::jsonb
 AND value#>>'{entries,0,receiptSha256}'=encode(extensions.digest(value#>>'{entries,0,receiptText}','sha256'),'hex')
 FROM context_parent_pages WHERE key='first'),'Context parent first page lost fixed history');
SELECT pg_temp.assert_true((SELECT value->>'throughSequence'='2' AND value->>'afterTaskIndex'='0' AND value->>'hasMore'='false'
 AND jsonb_array_length(value->'entries')=1 AND (value#>>'{entries,0,receiptText}')::jsonb='{"syntheticReceipt":2}'::jsonb
 FROM context_parent_pages WHERE key='second'),'Context parent second page differs');
SELECT pg_temp.assert_true(read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',1,1)->'entries'='[]'::jsonb,
 'Context parent cursor replayed old tasks');
SELECT pg_temp.assert_true(read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000010')->'entries'='[]'::jsonb,
 'Zero context parent snapshot drifted to latest');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000001')$q$,'42501','Segment request entered child reader');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000099')$q$,'42501','Missing child exposed parent snapshot');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',-2)$q$,'22023','Context parent cursor accepted invalid index');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',NULL)$q$,'22023','Context parent cursor accepted missing index');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',-1,129)$q$,'22023','Context parent cursor exceeded limit');
RESET ROLE;
-- Corruption probes isolate each scope check from the immutable-write guard.
DO $$ DECLARE column_name text; replacement uuid; BEGIN
 FOR column_name,replacement IN SELECT * FROM (VALUES
  ('campaign_id','250f0f62-7225-48b3-a2f7-5a134d3b9f78'::uuid),
  ('workspace_id','7791bbb4-6c7c-435e-9d1d-d2146334a944'::uuid),
  ('source_id','d0000000-0000-4000-8000-000000000900'::uuid)) changes LOOP
  BEGIN
   ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable;
   EXECUTE format('UPDATE engagement_synthesis_generation_requests SET %I=%L WHERE id=%L',column_name,replacement,'f0000000-0000-4000-8000-000000000001');
   PERFORM pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011')$q$,'42501','Context parent scope corruption accepted');
   RAISE EXCEPTION 'Restore parent scope' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
 END LOOP;
END $$;
-- Transfer ownership before revoking the child actor, so the workspace owner
-- floor cannot mask the reader's own current-authority check.
INSERT INTO workspace_members(workspace_id,user_id,role)
 VALUES('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','13466ed2-dcb7-4861-a528-68cc5579eea9','owner');
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_parent_selections('f0000000-0000-4000-8000-000000000011',0,1)$q$,'42501','Departed child requester still read parent');
RESET ROLE;
SELECT 'synthesis-context-parent-selections-verified';
