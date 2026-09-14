
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


INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,metadata_json,parent_item_id) VALUES
 ('81100000-0000-4000-8000-000000000004','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC private visibility','SYNTHETIC hidden visibility','approved','public','{"visibility":" PRIVATE "}',NULL),
 ('81100000-0000-4000-8000-000000000005','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC internal flag','SYNTHETIC hidden internal flag','approved','public','{"internal_note":" TrUe "}',NULL),
 ('81100000-0000-4000-8000-000000000006','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC harmless metadata','SYNTHETIC harmless words','approved','public','{"private_note":false,"internal_note":"false","visibility":"public"}',NULL),
 ('81100000-0000-4000-8000-000000000007','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC hidden reply','SYNTHETIC reply to private parent','approved','public','{}','81100000-0000-4000-8000-000000000002'),
 ('81100000-0000-4000-8000-000000000008','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC pending','SYNTHETIC unreviewed','pending','public','{}',NULL);
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,metadata_json) VALUES
 ('81100000-0000-4000-8000-000000000009','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC Unicode flag','SYNTHETIC hidden Unicode flag','approved','public',jsonb_build_object('private_note',chr(160)||'TRUE'||chr(65279)));
INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids) VALUES
 ('81100000-0000-4000-8000-000000000010','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC public explanation','SYNTHETIC public input','SYNTHETIC intentionally public explanation','published',ARRAY['81100000-0000-4000-8000-000000000001'::uuid]),
 ('81100000-0000-4000-8000-000000000011','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC private-source explanation','SYNTHETIC internal input','SYNTHETIC private-linked explanation','published',ARRAY['81100000-0000-4000-8000-000000000002'::uuid]);
SELECT set_config('request.jwt.claim.sub','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef',true);
SET LOCAL ROLE authenticated;
SELECT queue_engagement_report('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000020','public','{}');
SELECT queue_engagement_report('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000021','internal','{}');
RESET ROLE;
SELECT jsonb_object_agg(scope,snapshot_text::jsonb) FROM engagement_report_jobs WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e';
