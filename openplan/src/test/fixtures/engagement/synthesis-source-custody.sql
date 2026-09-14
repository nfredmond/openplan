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

CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, observed %',label,expected,coalesce(observed,'success'); END IF;
END $$;
INSERT INTO engagement_categories(id,campaign_id,label,slug) VALUES
 ('a0000000-0000-4000-8000-000000000001','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','SYNTHETIC original routine','routine'),
 ('a0000000-0000-4000-8000-000000000002','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','SYNTHETIC distinct concern','distinct');
INSERT INTO engagement_survey_questions(id,campaign_id,question_type,prompt,status,category_id)
 VALUES('a0000000-0000-4000-8000-000000000003','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','free_text','SYNTHETIC original question','published','a0000000-0000-4000-8000-000000000002');
INSERT INTO engagement_items(id,campaign_id,body,title,status,source_type,category_id,configuration_version_id,created_at,geometry,submitted_by,metadata_json)
 SELECT ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,c.id,'SYNTHETIC routine '||n,NULL,'approved','internal','a0000000-0000-4000-8000-000000000001',c.configuration_version_id,
 '2026-01-02T12:00:00Z','{"type":"LineString","coordinates":[[12.5,-8.25],[12.75,-8.5]]}', 'SYNTHETIC private contact','{"fingerprint":"SYNTHETIC secret fingerprint"}'
 FROM engagement_campaigns c CROSS JOIN generate_series(1,300) n WHERE c.id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';
INSERT INTO engagement_survey_response_sessions(id,campaign_id,status,source_type,configuration_version_id,respondent_fingerprint,submitted_by,created_at)
 SELECT 'c0000000-0000-4000-8000-000000000001',id,'approved','internal',configuration_version_id,'SYNTHETIC survey fingerprint','SYNTHETIC private survey contact','2026-01-02T12:00:00Z'
 FROM engagement_campaigns WHERE id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';
INSERT INTO engagement_survey_answers(id,session_id,campaign_id,question_id,question_type,question_prompt_snapshot,answer_json,answer_text) VALUES
 ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','a0000000-0000-4000-8000-000000000003','free_text','SYNTHETIC original question','{"text":"SYNTHETIC survey concern"}','SYNTHETIC survey concern'),
 ('c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',NULL,'free_text','SYNTHETIC historical missing question','{"text":"SYNTHETIC answer with no current question"}','SYNTHETIC answer with no current question');
CREATE TEMP TABLE synthesis_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON synthesis_probe TO authenticated;
INSERT INTO synthesis_probe VALUES('selection','{"statuses":["approved"],"includeItems":true,"includeSurveys":true,"categoryIds":[],"from":null,"to":null}');
CREATE FUNCTION pg_temp.capture(request uuid,selection jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.capture_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request,COALESCE(selection,(SELECT value FROM synthesis_probe WHERE key='selection')));
$$;
CREATE FUNCTION pg_temp.read_source(request uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.read_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request);
$$;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
INSERT INTO synthesis_probe SELECT 'control',pg_temp.capture('d0000000-0000-4000-8000-000000000001');
INSERT INTO synthesis_probe SELECT 'controlBytes',pg_temp.read_source('d0000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true((SELECT value->'counts'->>'items'='300' AND value->'counts'->>'answers'='2' FROM synthesis_probe WHERE key='control'),'300-source control was not retained');
RESET ROLE;
-- Same timestamp, distinct final concern beyond the previous cap, full long text.
INSERT INTO engagement_items(id,campaign_id,body,title,status,source_type,category_id,configuration_version_id,created_at)
 SELECT 'b0000000-0000-4000-8000-000000000301',id,repeat('SYNTHETIC Unicode concern é ',50)||'FINAL SOURCE TAIL','SYNTHETIC minority concern','approved','internal',
 'a0000000-0000-4000-8000-000000000002',configuration_version_id,'2026-01-02T12:00:00Z' FROM engagement_campaigns WHERE id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';
UPDATE engagement_categories SET label='SYNTHETIC renamed current category' WHERE id='a0000000-0000-4000-8000-000000000001';
UPDATE engagement_survey_questions SET prompt='SYNTHETIC renamed current question' WHERE id='a0000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
INSERT INTO synthesis_probe SELECT 'complete',pg_temp.capture('d0000000-0000-4000-8000-000000000002');
INSERT INTO synthesis_probe SELECT 'completeBytes',pg_temp.read_source('d0000000-0000-4000-8000-000000000002');
INSERT INTO synthesis_probe SELECT 'snapshot',(value->>'snapshotText')::jsonb FROM synthesis_probe WHERE key='completeBytes';
SELECT pg_temp.assert_true((SELECT value->'counts'->>'items'='301' AND jsonb_array_length(value->'items')=301 AND value->'items'->300->>'id'='b0000000-0000-4000-8000-000000000301' FROM synthesis_probe WHERE key='snapshot'),'Complete source capture lost the 301st concern');
SELECT pg_temp.assert_true((SELECT right(value->'items'->300->>'body',17)='FINAL SOURCE TAIL' AND length(value->'items'->300->>'body')>600 FROM synthesis_probe WHERE key='snapshot'),'Source text was truncated');
SELECT pg_temp.assert_true((SELECT value->'counts'->>'sessions'='1' AND value->'counts'->>'answers'='2' AND jsonb_array_length(value->'answers')=2 FROM synthesis_probe WHERE key='snapshot'),'Survey source coverage was lost');
SELECT pg_temp.assert_true((SELECT value->'items'->0->'geometry'='{"type":"LineString","coordinates":[[12.5,-8.25],[12.75,-8.5]]}'::jsonb FROM synthesis_probe WHERE key='snapshot'),'Source geometry changed');
SELECT pg_temp.assert_true((SELECT value->>'scope'='internal' AND NOT (value->'items'->0 ?| ARRAY['submitted_by','metadata_json']) AND NOT (value->'sessions'->0 ?| ARRAY['respondent_fingerprint','submitted_by']) FROM synthesis_probe WHERE key='snapshot'),'Private source scope or contact exclusion changed');
SELECT pg_temp.assert_true((SELECT count(*)>=2 AND bool_and(d->>'sha256'=encode(extensions.digest(d->>'definitionText','sha256'),'hex')) FROM synthesis_probe CROSS JOIN LATERAL jsonb_array_elements(value->'definitions') d WHERE key='snapshot'),'Historical definition set or exact bytes differ');
SELECT pg_temp.assert_true((SELECT (d->>'definitionText')::jsonb->'categories'->0->>'label'='SYNTHETIC original routine' FROM synthesis_probe CROSS JOIN LATERAL jsonb_array_elements(value->'definitions') d WHERE key='snapshot' AND d->>'id'=synthesis_probe.value->'items'->0->>'configuration_version_id'),'Historical label was replaced by current label');
SELECT pg_temp.assert_true((SELECT value->>'snapshotSha256'=encode(extensions.digest(value->>'snapshotText','sha256'),'hex') FROM synthesis_probe WHERE key='completeBytes'),'Saved source checksum differs');
SELECT pg_temp.assert_true(pg_temp.read_source('d0000000-0000-4000-8000-000000000001')=(SELECT value FROM synthesis_probe WHERE key='controlBytes'),'Later source capture rewrote the original');
SELECT pg_temp.assert_true(pg_temp.capture('d0000000-0000-4000-8000-000000000001')=(SELECT value||'{"replayed":true}'::jsonb FROM synthesis_probe WHERE key='control'),'Exact retry recaptured changed source');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_synthesis_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC save failure'; END $$;
CREATE TRIGGER synthesis_insert_failure BEFORE INSERT ON engagement_synthesis_sources FOR EACH ROW WHEN (NEW.id='d0000000-0000-4000-8000-000000000099'::uuid) EXECUTE FUNCTION pg_temp.fail_synthesis_insert();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000099')$q$,'P0001','Failed persistence returned a source receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000001',(SELECT value||'{"includeItems":false}' FROM synthesis_probe WHERE key='selection'))$q$,'PT409','Changed retry selection was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000010',(SELECT value||'{"statuses":[]}' FROM synthesis_probe WHERE key='selection'))$q$,'22023','Empty status selection was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000010',(SELECT value||'{"unexpected":true}' FROM synthesis_probe WHERE key='selection'))$q$,'22023','Unknown selection field was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000010',(SELECT value||'{"statuses":["approved","approved"]}' FROM synthesis_probe WHERE key='selection'))$q$,'22023','Duplicate status selection was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000010',(SELECT value||'{"from":"now"}' FROM synthesis_probe WHERE key='selection'))$q$,'22023','Relative source date was accepted');
INSERT INTO synthesis_probe SELECT 'empty',pg_temp.capture('d0000000-0000-4000-8000-000000000003',(SELECT value||'{"from":"2100-01-01T00:00:00Z"}' FROM synthesis_probe WHERE key='selection'));
SELECT pg_temp.assert_true((SELECT value->'counts'->>'items'='0' AND value->'counts'->>'campaignItems'='301' FROM synthesis_probe WHERE key='empty'),'Empty selection hid excluded source count');
INSERT INTO synthesis_probe SELECT 'surveyOnly',pg_temp.capture('d0000000-0000-4000-8000-000000000004',(SELECT value||'{"includeItems":false}' FROM synthesis_probe WHERE key='selection'));
SELECT pg_temp.assert_true((SELECT value->'counts'->>'items'='0' AND value->'counts'->>'answers'='2' FROM synthesis_probe WHERE key='surveyOnly'),'Explicit survey-only scope differs');
INSERT INTO synthesis_probe SELECT 'categoryOnly',pg_temp.capture('d0000000-0000-4000-8000-000000000005',(SELECT value||'{"categoryIds":["a0000000-0000-4000-8000-000000000002"]}' FROM synthesis_probe WHERE key='selection'));
SELECT pg_temp.assert_true((SELECT value->'counts'->>'items'='1' AND value->'counts'->>'answers'='1' AND value->'counts'->>'sessions'='1' FROM synthesis_probe WHERE key='categoryOnly'),'Historical category selection differs');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_sources('250f0f62-7225-48b3-a2f7-5a134d3b9f78','d0000000-0000-4000-8000-000000000001')$q$,'42501','Saved source read ignored requested campaign');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_sources','42501','Direct private source table read was allowed');
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.read_source('d0000000-0000-4000-8000-000000000001')$q$,'42501','Viewer read private source text');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000001')$q$,'42501','Viewer replayed private source capture');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.read_source('d0000000-0000-4000-8000-000000000001')$q$,'42501','Another workspace read private source text');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000001')$q$,'PT409','Another actor reused the source request');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000001')$q$,'42501','Revoked staff replayed source capture');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT pg_temp.read_source('d0000000-0000-4000-8000-000000000001')$q$,'42501','Anonymous source read was allowed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.capture('d0000000-0000-4000-8000-000000000001')$q$,'42501','Anonymous source capture was allowed');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_sources SET snapshot_text='{}' WHERE id='d0000000-0000-4000-8000-000000000001'$q$,'P0001','Retained source mutation was allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000001'$q$,'P0001','Retained source deletion was allowed');
SELECT pg_temp.assert_true((SELECT count(*)=5 FROM engagement_synthesis_sources),'Source request count differs after refusals/retries');
SELECT 'synthesis-source-custody-verified';
