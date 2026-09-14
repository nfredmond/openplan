-- Installed-fixture counterpart of the retained candidate probe.
-- Private explanations start as drafts; private-parent input is explicitly staff-authored.

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
 ('81100000-0000-4000-8000-000000000007','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC hidden reply','SYNTHETIC reply to private parent','approved','internal','{}','81100000-0000-4000-8000-000000000002'),
 ('81100000-0000-4000-8000-000000000008','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC pending','SYNTHETIC unreviewed','pending','public','{}',NULL);
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,metadata_json) VALUES
 ('81100000-0000-4000-8000-000000000009','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC Unicode flag','SYNTHETIC hidden Unicode flag','approved','public',jsonb_build_object('private_note',chr(160)||'TRUE'||chr(65279)));
INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids) VALUES
 ('81100000-0000-4000-8000-000000000010','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC public explanation','SYNTHETIC public input','SYNTHETIC intentionally public explanation','published',ARRAY['81100000-0000-4000-8000-000000000001'::uuid]),
 ('81100000-0000-4000-8000-000000000011','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC private-source explanation','SYNTHETIC internal input','SYNTHETIC private-linked explanation','draft',ARRAY['81100000-0000-4000-8000-000000000002'::uuid]);
SELECT set_config('request.jwt.claim.sub','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef',true);
SET LOCAL ROLE authenticated;
SELECT queue_engagement_report('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000020','public','{}');
SELECT queue_engagement_report('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000021','internal','{}');
RESET ROLE;
SELECT jsonb_object_agg(scope,snapshot_text::jsonb) FROM engagement_report_jobs WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e';

-- A denied command must fail for the expected reason. Unexpected success is
-- rolled back as well, so one mutant cannot contaminate a later assertion.
CREATE FUNCTION pg_temp.privacy_denied(command text, expected_code text, expected_message text)
RETURNS boolean LANGUAGE plpgsql AS $test$
BEGIN
 EXECUTE command;
 RAISE EXCEPTION 'Unexpected success' USING ERRCODE='P9999';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=expected_code AND SQLERRM=expected_message;
END $test$;
-- Synthetic, transaction-local fixture is supplied before the candidate.
UPDATE engagement_campaigns SET share_token='SYNTHETIC-public-copy-privacy-probe' WHERE id='d4788d7b-2e7f-465c-9529-798d4e9a720e';
CREATE TEMP TABLE privacy_assertions(name text PRIMARY KEY, ok boolean NOT NULL);
INSERT INTO privacy_assertions VALUES
 ('view-record-selection', (SELECT array_agg(id ORDER BY id) FROM engagement_public_items WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e') = ARRAY['81100000-0000-4000-8000-000000000001'::uuid,'81100000-0000-4000-8000-000000000006'::uuid]),
 ('view-private-columns', NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='engagement_public_items' AND column_name IN ('metadata_json','moderation_notes','created_by','request_id','request_sha256','review_reason'))),
 ('view-service-read',has_table_privilege('service_role','engagement_public_items','SELECT')),
 ('view-no-direct-writes',NOT has_table_privilege('service_role','engagement_public_items','INSERT,UPDATE,DELETE')),
 ('view-no-anonymous-read',NOT has_table_privilege('anon','engagement_public_items','SELECT')),
 ('view-no-authenticated-read',NOT has_table_privilege('authenticated','engagement_public_items','SELECT'));
GRANT INSERT ON privacy_assertions TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO privacy_assertions VALUES ('service-view-live',(SELECT count(*)=2 FROM engagement_public_items WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e'));
RESET ROLE;
INSERT INTO privacy_assertions VALUES
 ('report-public-selection',(SELECT jsonb_array_length(snapshot_text::jsonb->'items')=2 AND jsonb_array_length(snapshot_text::jsonb->'responses')=1 FROM engagement_report_jobs WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e' AND scope='public')),
 ('report-internal-retention',(SELECT jsonb_array_length(snapshot_text::jsonb->'items')=8 AND jsonb_array_length(snapshot_text::jsonb->'responses')=1 FROM engagement_report_jobs WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e' AND scope='internal'));
SELECT set_config('request.jwt.claim.sub','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef',true);
DO $$
DECLARE token text; source jsonb; before_value jsonb; after_value jsonb; denied boolean; prior_history integer; receipt_count integer;
BEGIN
 SELECT share_token INTO token FROM engagement_campaigns WHERE id='d4788d7b-2e7f-465c-9529-798d4e9a720e';
 source:=read_public_translation_source(token,'81100000-0000-4000-8000-000000000001');
 INSERT INTO privacy_assertions VALUES ('translation-public-control',source->>'body'='SYNTHETIC approved public words');
 denied:=pg_temp.privacy_denied($command$SELECT read_public_translation_source('SYNTHETIC-public-copy-privacy-probe','81100000-0000-4000-8000-000000000002');$command$,'42501','Public translation is unavailable');
 INSERT INTO privacy_assertions VALUES ('translation-private-denial',denied);
 denied:=pg_temp.privacy_denied($command$SELECT read_public_translation_source('SYNTHETIC-public-copy-privacy-probe','81100000-0000-4000-8000-000000000007');$command$,'42501','Public translation is unavailable');
 INSERT INTO privacy_assertions VALUES ('translation-parent-denial',denied);
 source:=read_engagement_response_snapshot('d4788d7b-2e7f-465c-9529-798d4e9a720e',true);
 INSERT INTO privacy_assertions VALUES ('published-response-selection',(source->>'count')::int=1 AND source->'entries'->0->>'id'='81100000-0000-4000-8000-000000000010');
 source:=read_engagement_response_snapshot('d4788d7b-2e7f-465c-9529-798d4e9a720e',false);
 INSERT INTO privacy_assertions VALUES ('staff-response-retention',(source->>'count')::int=2);
 denied:=pg_temp.privacy_denied($command$INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids)
 VALUES('81100000-0000-4000-8000-000000000031','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC denied','SYNTHETIC input','SYNTHETIC response','published',ARRAY['81100000-0000-4000-8000-000000000002'::uuid]);$command$,'P0001','Review and publish linked contributions before publishing the staff response');
 INSERT INTO privacy_assertions VALUES ('private-response-publication-denial',denied);
 denied:=pg_temp.privacy_denied($command$INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids)
 VALUES('81100000-0000-4000-8000-000000000032','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC denied parent','SYNTHETIC input','SYNTHETIC response','published',ARRAY['81100000-0000-4000-8000-000000000007'::uuid]);$command$,'P0001','Review and publish linked contributions before publishing the staff response');
 INSERT INTO privacy_assertions VALUES ('parent-response-publication-denial',denied);
 INSERT INTO engagement_item_votes(item_id,campaign_id,voter_fingerprint) VALUES ('81100000-0000-4000-8000-000000000001','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC-public-control');
 INSERT INTO privacy_assertions VALUES ('public-vote-control',(SELECT votes_count=1 FROM engagement_items WHERE id='81100000-0000-4000-8000-000000000001'));
 denied:=pg_temp.privacy_denied($command$INSERT INTO engagement_item_votes(item_id,campaign_id,voter_fingerprint) VALUES ('81100000-0000-4000-8000-000000000002','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC-private-vote');$command$,'PT409','Feedback item is unavailable');
 INSERT INTO privacy_assertions VALUES ('private-vote-denial',denied);
 denied:=pg_temp.privacy_denied($command$INSERT INTO engagement_item_votes(item_id,campaign_id,voter_fingerprint) VALUES ('81100000-0000-4000-8000-000000000007','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC-private-parent-vote');$command$,'PT409','Feedback item is unavailable');
 INSERT INTO privacy_assertions VALUES ('parent-vote-denial',denied);
 denied:=pg_temp.privacy_denied($command$INSERT INTO engagement_items(campaign_id,parent_item_id,body,source_type,status) VALUES ('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000002','SYNTHETIC private parent reply','public','pending');$command$,'PT409','Reply target is unavailable');
 INSERT INTO privacy_assertions VALUES ('private-reply-denial',denied);
 INSERT INTO engagement_items(campaign_id,parent_item_id,body,source_type,status) VALUES ('d4788d7b-2e7f-465c-9529-798d4e9a720e','81100000-0000-4000-8000-000000000001','SYNTHETIC public parent reply','public','pending');
 INSERT INTO privacy_assertions VALUES ('public-reply-control',EXISTS(SELECT 1 FROM engagement_items WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e' AND body='SYNTHETIC public parent reply' AND status='pending'));
 SELECT metadata_json INTO before_value FROM engagement_items WHERE id='81100000-0000-4000-8000-000000000002';
 PERFORM engagement_cache_item_translation('81100000-0000-4000-8000-000000000002','es','SYNTHETIC hidden translation');
 SELECT metadata_json INTO after_value FROM engagement_items WHERE id='81100000-0000-4000-8000-000000000002';
 INSERT INTO privacy_assertions VALUES ('private-old-cache-denial',before_value=after_value);
 denied:=NOT engagement_cache_reviewed_translation('81100000-0000-4000-8000-000000000002','es','SYNTHETIC hidden translation','SYNTHETIC private-marked record','SYNTHETIC private report canary','synthetic');
 INSERT INTO privacy_assertions VALUES ('private-reviewed-cache-denial',denied);
 denied:=NOT engagement_cache_reviewed_translation('81100000-0000-4000-8000-000000000007','es','SYNTHETIC hidden translation','SYNTHETIC hidden reply','SYNTHETIC reply to private parent','synthetic');
 INSERT INTO privacy_assertions VALUES ('parent-reviewed-cache-denial',denied);
 denied:=pg_temp.privacy_denied($command$UPDATE engagement_items SET review_reason='SYNTHETIC attempted privacy review',metadata_json='{"private_note":true}' WHERE id='81100000-0000-4000-8000-000000000001';$command$,'PT409','Contribution changed or review version missing');
 INSERT INTO privacy_assertions VALUES ('privacy-review-version-required',denied);
 denied:=pg_temp.privacy_denied($command$UPDATE engagement_items SET metadata_json='{"private_note":true}',review_expected_updated_at=updated_at WHERE id='81100000-0000-4000-8000-000000000001';$command$,'P0001','A fresh human review reason is required');
 INSERT INTO privacy_assertions VALUES ('privacy-review-reason-required',denied);
 -- Unrelated cache metadata must remain writable without inventing a review.
 PERFORM engagement_cache_item_translation('81100000-0000-4000-8000-000000000001','es','SYNTHETIC public translation');
 SELECT metadata_json INTO before_value FROM engagement_items WHERE id='81100000-0000-4000-8000-000000000001';
 INSERT INTO privacy_assertions VALUES ('public-cache-control',before_value#>>'{ai_translations,es}'='SYNTHETIC public translation');
 UPDATE engagement_items SET moderation_notes='SYNTHETIC privacy review' WHERE id='81100000-0000-4000-8000-000000000001';
 SELECT count(*) INTO prior_history FROM engagement_item_history WHERE item_id='81100000-0000-4000-8000-000000000001';
 UPDATE engagement_items SET metadata_json=metadata_json||'{"private_note":true}',review_expected_updated_at=updated_at,review_reason='SYNTHETIC privacy review'
 WHERE id='81100000-0000-4000-8000-000000000001';
 INSERT INTO privacy_assertions VALUES ('privacy-hides-current-copy',NOT EXISTS(SELECT 1 FROM engagement_public_items WHERE id='81100000-0000-4000-8000-000000000001'));
 INSERT INTO privacy_assertions VALUES ('privacy-withdraws-response',(SELECT status='draft' FROM engagement_closeloop_entries WHERE id='81100000-0000-4000-8000-000000000010'));
 INSERT INTO privacy_assertions VALUES ('privacy-clears-cache',(SELECT NOT(metadata_json?'ai_translations') FROM engagement_items WHERE id='81100000-0000-4000-8000-000000000001'));
 INSERT INTO privacy_assertions VALUES ('privacy-history-retained',(SELECT count(*)=prior_history+1 FROM engagement_item_history WHERE item_id='81100000-0000-4000-8000-000000000001') AND EXISTS(SELECT 1 FROM engagement_item_history WHERE item_id='81100000-0000-4000-8000-000000000001' AND record_json->'metadata_json'->>'private_note'='true' AND reason='SYNTHETIC privacy review'));
 SELECT count(*) INTO receipt_count FROM engagement_response_write_receipts WHERE response_id='81100000-0000-4000-8000-000000000010' AND operation='source_withdrawal' AND payload_json->'sourceAfter'->'metadata_json'->>'private_note'='true';
 INSERT INTO privacy_assertions VALUES ('privacy-withdrawal-receipt',receipt_count=1);
END $$;
SELECT jsonb_object_agg(name,ok ORDER BY name) FROM privacy_assertions;

DO $$ DECLARE failed text; BEGIN
 SELECT string_agg(name,', ' ORDER BY name) INTO failed FROM privacy_assertions WHERE NOT ok;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'Public privacy assertions failed: %',failed; END IF;
END $$;
SELECT 'public-copy-privacy-verified';
