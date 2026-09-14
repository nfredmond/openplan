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
INSERT INTO project_decisions(id,project_id,title,rationale,status) VALUES
 ('dd3917ff-564b-44d1-a478-81dba6022175','7c047a05-a9dc-440f-b5b1-9d312369af6e','SYNTHETIC decision','SYNTHETIC private rationale','proposed'),
 ('64603f05-a2b9-4033-a01b-0a2825c50393','896673db-f43e-41a7-85dd-e0ffc18e75fe','SYNTHETIC foreign decision','SYNTHETIC foreign rationale','approved'),
 ('38d0b606-acce-4ef9-9311-e618c142c226','2c56c864-68a6-470c-b4b4-c4de14eece14','SYNTHETIC unlinked decision','SYNTHETIC unlinked rationale','rejected');
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,configuration_version_id,geometry,submitted_by,moderation_notes,metadata_json)
 SELECT '22ee166f-608b-4cbd-8858-51183953b69d','d4788d7b-2e7f-465c-9529-798d4e9a720e',chr(160)||'SYNTHETIC raw title'||chr(65279),
 'SYNTHETIC original source words','pending','internal',configuration_version_id,
 '{"type":"LineString","coordinates":[[12.5,-8.25],[12.75,-8.5]]}',
 'SYNTHETIC private contact','SYNTHETIC moderation notes','{"private":"SYNTHETIC metadata"}'
 FROM engagement_campaigns WHERE id='d4788d7b-2e7f-465c-9529-798d4e9a720e';
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type) VALUES
 ('b7d0772a-1711-46cd-b644-04490d7a0639','d4788d7b-2e7f-465c-9529-798d4e9a720e',NULL,'SYNTHETIC unknown historical configuration','pending','internal'),
 ('fb266e1f-6ee3-4518-918e-dd01808e9e53','e91b7624-b9eb-4ba1-80fd-e8156556c25b','SYNTHETIC foreign source','SYNTHETIC foreign words','pending','internal');
INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids) VALUES
 ('7534b1f7-cd8a-49e5-8a66-c95a14f11e29','d4788d7b-2e7f-465c-9529-798d4e9a720e','SYNTHETIC theme','SYNTHETIC minority input','SYNTHETIC original answer','draft',
 ARRAY['22ee166f-608b-4cbd-8858-51183953b69d'::uuid,'b7d0772a-1711-46cd-b644-04490d7a0639'::uuid,'22ee166f-608b-4cbd-8858-51183953b69d'::uuid,'c999bfc0-5927-4a91-af7e-e2397155c8c7'::uuid,'fb266e1f-6ee3-4518-918e-dd01808e9e53'::uuid]),
 ('cb7549e0-2521-4a93-a4fb-d087ae97ea85','e91b7624-b9eb-4ba1-80fd-e8156556c25b','SYNTHETIC foreign theme','','','draft','{}');
UPDATE engagement_closeloop_entries SET we_did='SYNTHETIC corrected answer' WHERE id='7534b1f7-cd8a-49e5-8a66-c95a14f11e29';
UPDATE engagement_campaigns SET title='SYNTHETIC revised question context' WHERE id='d4788d7b-2e7f-465c-9529-798d4e9a720e';

SELECT set_config('request.jwt.claim.sub','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef',true);
CREATE TEMP TABLE resolution_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON resolution_probe TO authenticated;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, observed %',label,expected,coalesce(observed,'success'); END IF;
END $$;
INSERT INTO resolution_probe SELECT 'preview',read_engagement_response_decision_context('d4788d7b-2e7f-465c-9529-798d4e9a720e','7534b1f7-cd8a-49e5-8a66-c95a14f11e29','dd3917ff-564b-44d1-a478-81dba6022175');
SET LOCAL ROLE authenticated;
INSERT INTO resolution_probe SELECT 'cancel',resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy');

SELECT pg_temp.assert_true((SELECT (value->>'resultText')::jsonb->>'state'='cancelled' AND (value->>'resultText')::jsonb->'link'='null'::jsonb AND NOT (value->>'replayed')::boolean FROM resolution_probe WHERE key='cancel'),'Unknown request was not cancelled');
SELECT pg_temp.assert_true((SELECT (value->>'payloadText')::jsonb->>'copyJson'='"SYNTHETIC damaged bytes \ud800 \u0000 \n"' FROM resolution_probe WHERE key='cancel'),'Damaged copy bytes changed');
SELECT pg_temp.assert_true((SELECT value->>'payloadSha256'=encode(extensions.digest(value->>'payloadText','sha256'),'hex') AND value->>'resultSha256'=encode(extensions.digest(value->>'resultText','sha256'),'hex') FROM resolution_probe WHERE key='cancel'),'Resolution checksum differs');
SELECT pg_temp.assert_true(((SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy'))->>'replayed')::boolean,'Exact resolution retry not recognized');
SELECT pg_temp.assert_true((SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy'))-'replayed'=(SELECT value-'replayed' FROM resolution_probe WHERE key='cancel'),'Exact resolution retry changed bytes');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_decision_request_resolutions),'Installed original requester cannot read recovery copies');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC changed bytes"','SYNTHETIC preserve my original copy')$query$,'PT409','Changed copy reused resolution identity');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','da63405e-61a2-424e-861b-47ec104af631','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'PT409','Changed request reused resolution identity');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','da63405e-61a2-424e-861b-47ec104af631','{}','SYNTHETIC preserve my original copy')$query$,'22023','Nonstring copy accepted');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','da63405e-61a2-424e-861b-47ec104af631','broken','SYNTHETIC preserve my original copy')$query$,'22023','Malformed JSON copy accepted');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','da63405e-61a2-424e-861b-47ec104af631','"SYNTHETIC damaged bytes \ud800 \u0000 \n"',' ')$query$,'22023','Blank reason accepted');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','da63405e-61a2-424e-861b-47ec104af631','"SYNTHETIC damaged bytes \ud800 \u0000 \n"',chr(160)||chr(65279))$query$,'22023','Unicode blank reason accepted');
SELECT pg_temp.expect_error($query$SELECT write_engagement_response_decision_link('d4788d7b-2e7f-465c-9529-798d4e9a720e','7534b1f7-cd8a-49e5-8a66-c95a14f11e29','dd3917ff-564b-44d1-a478-81dba6022175','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','link',NULL,(SELECT value->>'contextSha256' FROM resolution_probe WHERE key='preview'),'SYNTHETIC original decision intent')$query$,'PT409','Resolved request arrived late');
INSERT INTO resolution_probe SELECT 'secondCopy',resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','a0b05230-98f4-49d1-9857-42f7d39e57a2','"SYNTHETIC alternate surviving copy"','SYNTHETIC preserve my original copy');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_decision_request_resolutions),'Second original copy was lost');
INSERT INTO resolution_probe SELECT 'saved',write_engagement_response_decision_link('d4788d7b-2e7f-465c-9529-798d4e9a720e','7534b1f7-cd8a-49e5-8a66-c95a14f11e29','dd3917ff-564b-44d1-a478-81dba6022175','878ac5f4-d5b5-4c30-b4b7-ef5c3e6d1b0e','link',NULL,(SELECT value->>'contextSha256' FROM resolution_probe WHERE key='preview'),'SYNTHETIC original decision intent');
INSERT INTO resolution_probe SELECT 'savedResolution',resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','878ac5f4-d5b5-4c30-b4b7-ef5c3e6d1b0e','cd45daef-cec6-469a-9b1a-384714413fdb','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy');
SELECT pg_temp.assert_true((SELECT (value->>'resultText')::jsonb->>'state'='saved' AND (value->>'resultText')::jsonb->'link'=(SELECT value->'link' FROM resolution_probe WHERE key='saved') FROM resolution_probe WHERE key='savedResolution'),'Saved decision receipt was not preserved');
SELECT pg_temp.assert_true((SELECT write_engagement_response_decision_link('d4788d7b-2e7f-465c-9529-798d4e9a720e','7534b1f7-cd8a-49e5-8a66-c95a14f11e29','dd3917ff-564b-44d1-a478-81dba6022175','878ac5f4-d5b5-4c30-b4b7-ef5c3e6d1b0e','link',NULL,(SELECT value->>'contextSha256' FROM resolution_probe WHERE key='preview'),'SYNTHETIC original decision intent'))->'link'=(SELECT value->'link' FROM resolution_probe WHERE key='saved'),'Resolution broke exact saved retry');
RESET ROLE; UPDATE workspace_members SET role='admin' WHERE workspace_id='9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c' AND user_id='d9ec4791-470c-4ce3-9972-c8a71c105b28'; SELECT set_config('request.jwt.claim.sub','d9ec4791-470c-4ce3-9972-c8a71c105b28',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_decision_request_resolutions),'Other staff read private recovery copies');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','Other staff replayed original resolution');
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','878ac5f4-d5b5-4c30-b4b7-ef5c3e6d1b0e','eaa0c1fe-ef88-4fb0-85b8-2bf2868d8fa4','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','Other staff recovered private original receipt');
RESET ROLE; UPDATE workspace_members SET role='viewer' WHERE workspace_id='9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c' AND user_id='d9ec4791-470c-4ce3-9972-c8a71c105b28'; SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','Viewer recovered private resolution');
SELECT set_config('request.jwt.claim.sub','bfee723c-e834-4909-81da-96c2cf6eef41',true);
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','Outsider recovered private resolution');
SELECT set_config('request.jwt.claim.sub','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef',true);
SELECT pg_temp.expect_error($query$UPDATE engagement_decision_request_resolutions SET actor_id=gen_random_uuid()$query$,'42501','Staff updated immutable recovery');
SELECT pg_temp.expect_error($query$DELETE FROM engagement_decision_request_resolutions$query$,'42501','Staff removed immutable recovery');
RESET ROLE; SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','anon executed recovery');
SELECT pg_temp.expect_error($query$SELECT * FROM engagement_decision_request_resolutions$query$,'42501','anon read private copies');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','service_role executed recovery');
SELECT pg_temp.expect_error($query$SELECT * FROM engagement_decision_request_resolutions$query$,'42501','service_role read private copies');
RESET ROLE;
SELECT pg_temp.expect_error($query$UPDATE engagement_decision_request_resolutions SET actor_id=gen_random_uuid()$query$,'P0001','Privileged update destroyed recovery');
SELECT pg_temp.expect_error($query$DELETE FROM engagement_decision_request_resolutions$query$,'P0001','Privileged delete destroyed recovery');
DELETE FROM engagement_closeloop_entries WHERE id='7534b1f7-cd8a-49e5-8a66-c95a14f11e29'; DELETE FROM project_decisions WHERE id='dd3917ff-564b-44d1-a478-81dba6022175'; SET LOCAL ROLE authenticated;
INSERT INTO resolution_probe SELECT 'laterResolution',resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','878ac5f4-d5b5-4c30-b4b7-ef5c3e6d1b0e','5586f9cb-ac71-440f-9460-13c1d0c18f88','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy');
SELECT pg_temp.assert_true((SELECT (value->>'resultText')::jsonb->'link'=(SELECT value->'link' FROM resolution_probe WHERE key='saved') FROM resolution_probe WHERE key='laterResolution'),'Missing source lost saved receipt');
SELECT pg_temp.assert_true((SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','878ac5f4-d5b5-4c30-b4b7-ef5c3e6d1b0e','cd45daef-cec6-469a-9b1a-384714413fdb','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy'))-'replayed'=(SELECT value-'replayed' FROM resolution_probe WHERE key='savedResolution'),'Missing source changed prior resolution');
RESET ROLE; UPDATE workspace_members SET role='owner' WHERE workspace_id='9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c' AND user_id='d9ec4791-470c-4ce3-9972-c8a71c105b28'; UPDATE workspace_members SET role='viewer' WHERE workspace_id='9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c' AND user_id='78f9d0f8-0e4b-48aa-a006-221a20f5e6ef'; SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($query$SELECT resolve_engagement_decision_request('d4788d7b-2e7f-465c-9529-798d4e9a720e','48259ddc-7e71-4ae8-b7fc-c8caf5dc76f0','72ac9585-42e6-4eab-a253-fc3a57cd9518','"SYNTHETIC damaged bytes \ud800 \u0000 \n"','SYNTHETIC preserve my original copy')$query$,'42501','Lost membership replayed recovery');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_decision_request_resolutions),'Lost membership retained table access'); RESET ROLE; SELECT 'decision-resolution-verified';
SELECT jsonb_build_object('synthetic',true,'scope',jsonb_build_object('campaignId','d4788d7b-2e7f-465c-9529-798d4e9a720e','workspaceId','9f55a4ad-fa5f-4908-bf08-d45dbaeaac2c','actorId','78f9d0f8-0e4b-48aa-a006-221a20f5e6ef'),'cancelled',(SELECT value FROM resolution_probe WHERE key='cancel'),'saved',(SELECT value FROM resolution_probe WHERE key='savedResolution'));

RESET ROLE; SELECT 'decision-resolution-activation-verified';
