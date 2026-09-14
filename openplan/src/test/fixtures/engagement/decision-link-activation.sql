-- Synthetic native fixtures only. The installed commands and grants are not replaced here.

INSERT INTO auth.users(id,aud,role,email)
 SELECT id,'authenticated','authenticated',id::text||'@synthetic-decision.invalid'
 FROM unnest(ARRAY['13466ed2-dcb7-4861-a528-68cc5579eea9'::uuid,'7a50d4fb-35b7-41f4-9bce-8a4e7d157569'::uuid,'14a71429-1cb2-49b5-8711-c696a2f394c3'::uuid]) id;
INSERT INTO workspaces(id,name,slug) VALUES
 ('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','SYNTHETIC decision traceability','d51d566d-28c6-49d2-95d2-3a7a2f0902e1'),
 ('7791bbb4-6c7c-435e-9d1d-d2146334a944','SYNTHETIC foreign workspace','7791bbb4-6c7c-435e-9d1d-d2146334a944');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES
 ('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','13466ed2-dcb7-4861-a528-68cc5579eea9','owner'),('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','7a50d4fb-35b7-41f4-9bce-8a4e7d157569','viewer'),
 ('7791bbb4-6c7c-435e-9d1d-d2146334a944','14a71429-1cb2-49b5-8711-c696a2f394c3','owner');
INSERT INTO projects(id,workspace_id,name) VALUES
 ('cf0b2bac-b1b0-4032-8f37-748f0c67a5b3','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','SYNTHETIC linked project'),
 ('d87eb129-2878-4b11-a46f-49378321c7c1','7791bbb4-6c7c-435e-9d1d-d2146334a944','SYNTHETIC foreign project'),
 ('e8460025-ea03-46f5-a373-9067288d5595','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','SYNTHETIC unlinked project');
INSERT INTO engagement_campaigns(id,workspace_id,project_id,title,created_by) VALUES
 ('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','cf0b2bac-b1b0-4032-8f37-748f0c67a5b3','SYNTHETIC original question context','13466ed2-dcb7-4861-a528-68cc5579eea9'),
 ('250f0f62-7225-48b3-a2f7-5a134d3b9f78','7791bbb4-6c7c-435e-9d1d-d2146334a944','d87eb129-2878-4b11-a46f-49378321c7c1','SYNTHETIC foreign context','14a71429-1cb2-49b5-8711-c696a2f394c3');
INSERT INTO project_decisions(id,project_id,title,rationale,status) VALUES
 ('f2252494-1f26-4936-9969-0b94e3787473','cf0b2bac-b1b0-4032-8f37-748f0c67a5b3','SYNTHETIC decision','SYNTHETIC private rationale','proposed'),
 ('8242bb1b-ae2e-4cf1-94d2-a9a91fcd877b','d87eb129-2878-4b11-a46f-49378321c7c1','SYNTHETIC foreign decision','SYNTHETIC foreign rationale','approved'),
 ('fd45fd2b-aa0a-40c8-a326-da4f40f519a2','e8460025-ea03-46f5-a373-9067288d5595','SYNTHETIC unlinked decision','SYNTHETIC unlinked rationale','rejected');
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,configuration_version_id,geometry,submitted_by,moderation_notes,metadata_json)
 SELECT '32bbdc2f-c8c0-4ce7-84f7-4f5a7ae31ebe','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',chr(160)||'SYNTHETIC raw title'||chr(65279),
 'SYNTHETIC original source words','pending','internal',configuration_version_id,
 '{"type":"LineString","coordinates":[[12.5,-8.25],[12.75,-8.5]]}',
 'SYNTHETIC private contact','SYNTHETIC moderation notes','{"private":"SYNTHETIC metadata"}'
 FROM engagement_campaigns WHERE id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type) VALUES
 ('d75d0f46-f9c4-42c1-b294-c5fd5b2f5fd3','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',NULL,'SYNTHETIC unknown historical configuration','pending','internal'),
 ('48811b31-e863-47c3-b8c3-7ebe30abb1e2','250f0f62-7225-48b3-a2f7-5a134d3b9f78','SYNTHETIC foreign source','SYNTHETIC foreign words','pending','internal');
INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids) VALUES
 ('b312438e-4d8c-46bb-a2fb-9bd9c9b890c5','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','SYNTHETIC theme','SYNTHETIC minority input','SYNTHETIC original answer','draft',
 ARRAY['32bbdc2f-c8c0-4ce7-84f7-4f5a7ae31ebe'::uuid,'d75d0f46-f9c4-42c1-b294-c5fd5b2f5fd3'::uuid,'32bbdc2f-c8c0-4ce7-84f7-4f5a7ae31ebe'::uuid,'7ecfa41c-b792-46ce-9967-6707390024f7'::uuid,'48811b31-e863-47c3-b8c3-7ebe30abb1e2'::uuid]),
 ('c1ed26b1-e80c-4b6d-9245-2f74b5d16882','250f0f62-7225-48b3-a2f7-5a134d3b9f78','SYNTHETIC foreign theme','','','draft','{}');
UPDATE engagement_closeloop_entries SET we_did='SYNTHETIC corrected answer' WHERE id='b312438e-4d8c-46bb-a2fb-9bd9c9b890c5';
UPDATE engagement_campaigns SET title='SYNTHETIC revised question context' WHERE id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';

SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
CREATE TEMP TABLE decision_probe(key text,value jsonb);
GRANT SELECT,INSERT ON decision_probe TO authenticated;
INSERT INTO decision_probe SELECT 'preview',read_engagement_response_decision_context('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b312438e-4d8c-46bb-a2fb-9bd9c9b890c5','f2252494-1f26-4936-9969-0b94e3787473');
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, observed %',label,expected,coalesce(observed,'success'); END IF;
END $$;
CREATE FUNCTION pg_temp.link(request uuid,operation text,predecessor uuid,expected text,reason text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.write_engagement_response_decision_link(
 '10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b312438e-4d8c-46bb-a2fb-9bd9c9b890c5','f2252494-1f26-4936-9969-0b94e3787473',request,operation,predecessor,expected,reason); $$;
SET LOCAL ROLE authenticated;
INSERT INTO decision_probe SELECT 'original',pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Installed staff history is not readable');
SELECT pg_temp.assert_true((read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')->>'entryCount')='1','Installed history reader lost the original');

SELECT pg_temp.assert_true((SELECT (value->>'replayed')::boolean=false AND value->'link'->>'id'='07f5c0d8-3bb5-4bfc-8e74-c02658766c10' AND value->'link'->>'actor_id'='13466ed2-dcb7-4861-a528-68cc5579eea9' FROM decision_probe WHERE key='original'),'Original receipt differs');
SELECT pg_temp.assert_true((SELECT value->'link'->>'context_text'=(SELECT value->>'contextText' FROM decision_probe WHERE key='preview') FROM decision_probe WHERE key='original'),'Original context changed on save');
SELECT pg_temp.assert_true((SELECT (value->'link'->>'context_text')::jsonb->'decision'->>'status'='proposed' FROM decision_probe WHERE key='original'),'Link promoted decision');
SELECT pg_temp.assert_true((SELECT (value->'link'->>'context_text')::jsonb->'responseHistory'->>'revision'='2' FROM decision_probe WHERE key='original'),'Link lost response revision');
SELECT pg_temp.assert_true(((SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason'))->>'replayed')::boolean,'Exact replay not recognized');
SELECT pg_temp.assert_true((SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason'))->'link'=(SELECT value->'link' FROM decision_probe WHERE key='original'),'Exact replay changed original receipt');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Exact replay duplicated row');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC changed intent')$probe$,'23505','Different payload reused request');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('013e0a3a-1a0b-443e-8b93-ff681b4075f3','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'PT409','Second root was not refused');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','link',NULL,'0000000000000000000000000000000000000000000000000000000000000000','SYNTHETIC link reason')$probe$,'PT409','Changed source context was not refused');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','refresh','07f5c0d8-3bb5-4bfc-8e74-c02658766c10','0000000000000000000000000000000000000000000000000000000000000000','SYNTHETIC link reason')$probe$,'PT409','Stale context was not refused');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','refresh','013e0a3a-1a0b-443e-8b93-ff681b4075f3',(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'PT409','Missing predecessor was not refused');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'')$probe$,'22023','Empty reason was not refused');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','withdraw','07f5c0d8-3bb5-4bfc-8e74-c02658766c10',(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'22023','Withdrawal accepted current context');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','refresh',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'22023','Refresh accepted missing predecessor');
RESET ROLE; UPDATE workspace_members SET role='admin' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'23505','Different staff actor reused receipt');
RESET ROLE; UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'; SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'42501','Viewer replay was not refused');
SELECT pg_temp.expect_error($probe$SELECT read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')$probe$,'42501','Viewer history RPC was not refused');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Viewer read leaked history'); SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'42501','Outsider replay was not refused');
SELECT pg_temp.expect_error($probe$SELECT read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')$probe$,'42501','Outsider history RPC was not refused');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Outsider read leaked history'); SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SELECT pg_temp.expect_error($probe$UPDATE engagement_response_decision_links SET reason='SYNTHETIC overwrite' WHERE id='07f5c0d8-3bb5-4bfc-8e74-c02658766c10'$probe$,'42501','Direct staff update was not refused');
SELECT pg_temp.expect_error($probe$DELETE FROM engagement_response_decision_links WHERE id='07f5c0d8-3bb5-4bfc-8e74-c02658766c10'$probe$,'42501','Direct staff delete was not refused');
RESET ROLE;
SELECT pg_temp.expect_error($probe$UPDATE engagement_response_decision_links SET reason='SYNTHETIC overwrite' WHERE id='07f5c0d8-3bb5-4bfc-8e74-c02658766c10'$probe$,'P0001','Retained receipt update was not refused');
SELECT pg_temp.expect_error($probe$DELETE FROM engagement_response_decision_links WHERE id='07f5c0d8-3bb5-4bfc-8e74-c02658766c10'$probe$,'P0001','Retained receipt delete was not refused');
UPDATE project_decisions SET rationale='SYNTHETIC corrected rationale' WHERE id='f2252494-1f26-4936-9969-0b94e3787473'; SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','refresh','07f5c0d8-3bb5-4bfc-8e74-c02658766c10',(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason')$probe$,'PT409','Old preview survived decision correction');
INSERT INTO decision_probe SELECT 'new-preview',read_engagement_response_decision_context('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b312438e-4d8c-46bb-a2fb-9bd9c9b890c5','f2252494-1f26-4936-9969-0b94e3787473');
INSERT INTO decision_probe SELECT 'refresh',pg_temp.link('0226a959-c1f9-4fd1-a29b-c45ccb0038c4','refresh','07f5c0d8-3bb5-4bfc-8e74-c02658766c10',(SELECT value->>'contextSha256' FROM decision_probe WHERE key='new-preview'),'SYNTHETIC corrected link');
SELECT pg_temp.assert_true((SELECT (value->'link'->>'context_text')::jsonb->'decision'->>'rationale'='SYNTHETIC corrected rationale' AND value->'link'->>'predecessor_id'='07f5c0d8-3bb5-4bfc-8e74-c02658766c10' FROM decision_probe WHERE key='refresh'),'Correction context differs');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('f14bf59c-491b-476c-8bf4-322dc0684c0c','refresh','07f5c0d8-3bb5-4bfc-8e74-c02658766c10',(SELECT value->>'contextSha256' FROM decision_probe WHERE key='new-preview'),'SYNTHETIC link reason')$probe$,'PT409','Correction fork was not refused');
SELECT pg_temp.assert_true((SELECT context_text=(SELECT value->'link'->>'context_text' FROM decision_probe WHERE key='original') FROM engagement_response_decision_links WHERE id='07f5c0d8-3bb5-4bfc-8e74-c02658766c10'),'Correction changed original');
RESET ROLE;
SELECT pg_temp.expect_error($probe$INSERT INTO engagement_response_decision_links(id,workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text) SELECT 'f14bf59c-491b-476c-8bf4-322dc0684c0c',workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text FROM engagement_response_decision_links WHERE id='0226a959-c1f9-4fd1-a29b-c45ccb0038c4'$probe$,'23505','Unique predecessor constraint did not refuse fork');
DELETE FROM project_decisions WHERE id='f2252494-1f26-4936-9969-0b94e3787473'; DELETE FROM engagement_closeloop_entries WHERE id='b312438e-4d8c-46bb-a2fb-9bd9c9b890c5'; DELETE FROM engagement_campaign_projects WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'; SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT pg_temp.link('07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),'SYNTHETIC link reason'))->'link'=(SELECT value->'link' FROM decision_probe WHERE key='original'),'Original retry lost after source deletion');
INSERT INTO decision_probe SELECT 'withdraw',pg_temp.link('13f0f5ad-fbbc-467d-b965-0526d3cf655d','withdraw','0226a959-c1f9-4fd1-a29b-c45ccb0038c4',NULL,'SYNTHETIC withdrawal after source removal');
SELECT pg_temp.assert_true((SELECT value->'link'->>'context_text'=(SELECT value->'link'->>'context_text' FROM decision_probe WHERE key='refresh') AND value->'link'->>'operation'='withdraw' FROM decision_probe WHERE key='withdraw'),'Withdrawal lost retained context');
SELECT pg_temp.expect_error($probe$SELECT pg_temp.link('a226e4a0-2d31-4dad-88df-b5b141f1165d','withdraw','13f0f5ad-fbbc-467d-b965-0526d3cf655d',NULL,'SYNTHETIC link reason')$probe$,'PT409','Repeated withdrawal was not refused');
SELECT pg_temp.assert_true((SELECT pg_temp.link('13f0f5ad-fbbc-467d-b965-0526d3cf655d','withdraw','0226a959-c1f9-4fd1-a29b-c45ccb0038c4',NULL,'SYNTHETIC withdrawal after source removal'))->'link'=(SELECT value->'link' FROM decision_probe WHERE key='withdraw'),'Withdrawal retry differs');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Unexpected lifecycle row count');
SELECT jsonb_build_object('lifecycleRows',count(*),'originalsRetained',bool_and(context_sha256=encode(extensions.digest(context_text,'sha256'),'hex'))) FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';
SELECT pg_temp.assert_true((read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')->>'entryCount')='3' AND (read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')#>>'{current,0,sourceState}')='unavailable','Installed history lost removed sources');
SELECT set_config('openplan.activation_sha',(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview'),true);
RESET ROLE; SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($probe$SELECT write_engagement_response_decision_link('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b312438e-4d8c-46bb-a2fb-9bd9c9b890c5','f2252494-1f26-4936-9969-0b94e3787473','07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,current_setting('openplan.activation_sha'),'SYNTHETIC link reason')$probe$,'42501','anon installed command was not refused');
SELECT pg_temp.expect_error($probe$SELECT read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')$probe$,'42501','anon installed history RPC was not refused');
SELECT pg_temp.expect_error($probe$SELECT * FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'$probe$,'42501','anon installed table read was not refused');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($probe$SELECT write_engagement_response_decision_link('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b312438e-4d8c-46bb-a2fb-9bd9c9b890c5','f2252494-1f26-4936-9969-0b94e3787473','07f5c0d8-3bb5-4bfc-8e74-c02658766c10','link',NULL,current_setting('openplan.activation_sha'),'SYNTHETIC link reason')$probe$,'42501','service_role installed command was not refused');
SELECT pg_temp.expect_error($probe$SELECT read_engagement_decision_links('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')$probe$,'42501','service_role installed history RPC was not refused');
SELECT pg_temp.expect_error($probe$SELECT * FROM engagement_response_decision_links WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'$probe$,'42501','service_role installed table read was not refused');
RESET ROLE; SELECT 'decision-link-activation-verified';
