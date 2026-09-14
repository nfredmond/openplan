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
 ('report-internal-retention',(SELECT jsonb_array_length(snapshot_text::jsonb->'items')=8 AND jsonb_array_length(snapshot_text::jsonb->'responses')=2 FROM engagement_report_jobs WHERE campaign_id='d4788d7b-2e7f-465c-9529-798d4e9a720e' AND scope='internal'));
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
