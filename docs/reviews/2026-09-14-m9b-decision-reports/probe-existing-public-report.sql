BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';
-- Synthetic native recovery fixture. Use installed functions and grants unchanged.

INSERT INTO auth.users(id,aud,role,email)
 SELECT id,'authenticated','authenticated',id::text||'@synthetic-decision.invalid'
 FROM unnest(ARRAY['78f9d0f8-0e4b-48aa-a006-221a20f5e6ef'::uuid,'d9ec4791-470c-4ce3-9972-c8a71c105b28'::uuid,'bfee723c-e834-4909-81da-96c2cf6eef41'::uuid]) id;
INSERT INTO workspaces(id,name,slug) VALUES
 ('9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','SYNTHETIC decision traceability','9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c'),
 ('4f7f94bc-7eeb-4b95-b16b-a52935ec7af7','SYNTHETIC foreign workspace','4f7f94bc-7eeb-4b95-b16b-a52935ec7af7');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES
 ('9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef','owner'),('9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','d9ec4791-470c-4ce3-9972-c8a71c105b28','viewer'),
 ('4f7f94bc-7eeb-4b95-b16b-a52935ec7af7','bfee723c-e834-4909-81da-96c2cf6eef41','owner');
INSERT INTO projects(id,workspace_id,name) VALUES
 ('7c047a05-a9dc-440f-b5b1-9d312369af6e','9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','SYNTHETIC linked project'),
 ('896673db-f43e-41a7-85dd-e0ffc18e75fe','4f7f94bc-7eeb-4b95-b16b-a52935ec7af7','SYNTHETIC foreign project'),
 ('2c56c864-68a6-470c-b4b4-c4de14eece14','9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','SYNTHETIC unlinked project');
INSERT INTO engagement_campaigns(id,workspace_id,project_id,title,created_by) VALUES
 ('d4788d7b-2e7f-465c-9529-798d4e9a720e','9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','7c047a05-a9dc-440f-b5b1-9d312369af6e','SYNTHETIC original question context','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef'),
 ('e91b7624-b9eb-4ba1-80fd-e8156556c25b','4f7f94bc-7eeb-4b95-b16b-a52935ec7af7','896673db-f43e-41a7-85dd-e0ffc18e75fe','SYNTHETIC foreign context','bfee723c-e834-4909-81da-96c2cf6eef41');

UPDATE engagement_campaigns SET status='active',allow_public_submissions=true WHERE id='d4788d7b-2e7f-465c-9529-798d4e9a720e';
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,metadata_json) VALUES
 ('81100000-0000-4000-8000-000000000001','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC public control','SYNTHETIC approved public words','approved','public','{}'),
 ('81100000-0000-4000-8000-000000000002','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC private-marked record','SYNTHETIC private report canary','approved','internal','{"private_note":true}');
SELECT set_config('request.jwt.claim.sub','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef',true);
SET LOCAL ROLE authenticated;
SELECT queue_engagement_report('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000003','public','{}');
RESET ROLE;
SELECT jsonb_build_object('scope',scope,'containsPublicControl',snapshot_text LIKE '%SYNTHETIC approved public words%','containsPrivateCanary',snapshot_text LIKE '%SYNTHETIC private report canary%','retainsPrivateMarker',snapshot_text LIKE '%private_note%') FROM engagement_report_jobs WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e' AND request_id='81100000-0000-4000-8000-000000000003';
ROLLBACK;
