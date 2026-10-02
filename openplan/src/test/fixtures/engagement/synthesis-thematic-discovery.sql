RESET ROLE;
-- The command fixture has retained one thematic request after its parent requester departed.
-- Generate additional requests through the real commands, then impose a tied timestamp
-- inside this rollback-only fixture to exercise both cursor fields independently.
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN FOR n IN 100..126 LOOP PERFORM pg_temp.thm_create(('f0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid); END LOOP; END $$;
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000099',(SELECT value FROM thematic_probe WHERE key='otherSource'));
SELECT pg_temp.thm_create('f0000000-0000-4000-8000-000000000200','{"parentRequestId":"f0000000-0000-4000-8000-000000000099"}',(SELECT value FROM thematic_probe WHERE key='otherSource'));
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000126','f0000000-0000-4000-8000-000000000999');
RESET ROLE;
ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable;
UPDATE engagement_synthesis_generation_requests SET created_at='2026-10-02T00:00:00Z' WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f';
ALTER TABLE engagement_synthesis_generation_requests ENABLE TRIGGER synthesis_generation_request_immutable;
CREATE TEMP TABLE discovery_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON discovery_probe TO authenticated;
CREATE FUNCTION pg_temp.discover(source uuid DEFAULT 'd0000000-0000-4000-8000-000000000002',cursor jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT list_engagement_synthesis_thematic_requests('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',source,cursor); $$;
SET LOCAL ROLE authenticated;
INSERT INTO discovery_probe VALUES('first',pg_temp.discover());
INSERT INTO discovery_probe SELECT 'second',pg_temp.discover(cursor:=value->'nextCursor') FROM discovery_probe WHERE key='first';
SELECT pg_temp.assert_true((SELECT value->>'sourceId'='d0000000-0000-4000-8000-000000000002'
 AND value->>'sourceSha256'=(SELECT value#>>'{snapshotSha256}' FROM synthesis_probe WHERE key='completeBytes')
 AND value->>'campaignId'='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f' AND value->>'workspaceId'='d51d566d-28c6-49d2-95d2-3a7a2f0902e1'
 AND value->>'schemaVersion'='1' AND value->>'pageSize'='25' FROM discovery_probe WHERE key='first'),'Discovery scope metadata differs');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=25 AND value->'nextCursor'<>'null'::jsonb FROM discovery_probe WHERE key='first'),'Discovery first page bound differs');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=3 AND value->'nextCursor'='null'::jsonb FROM discovery_probe WHERE key='second'),'Discovery tail page differs');
SELECT pg_temp.assert_true((SELECT count(*)=28 AND count(DISTINCT e->>'requestId')=28 FROM discovery_probe d CROSS JOIN LATERAL jsonb_array_elements(d.value->'entries') e),'Discovery cursor duplicated or omitted requests');
SELECT pg_temp.assert_true((SELECT value#>>'{entries,0,requestId}'='f0000000-0000-4000-8000-000000000126' AND value#>>'{entries,0,cancelled}'='true'
 AND value#>>'{entries,0,actorId}'='7a50d4fb-35b7-41f4-9bce-8a4e7d157569' AND value#>>'{entries,0,parentRequestId}'='f0000000-0000-4000-8000-000000000001'
 FROM discovery_probe WHERE key='first'),'Discovery ordering, cancellation or authorship differs');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM discovery_probe d CROSS JOIN LATERAL jsonb_array_elements(d.value->'entries') e WHERE e->>'requestId' IN ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000200')),'Discovery included a segment or another source');
SELECT pg_temp.assert_true(pg_temp.discover('d0000000-0000-4000-8000-000000000003')->'entries'='[]'::jsonb,'Empty source acquired requests');
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover('d0000000-0000-4000-8000-000000000900')$q$,'42501','Foreign source exposed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover('d0000000-0000-4000-8000-000000000999')$q$,'42501','Missing source treated as empty');
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover(cursor:='{"createdAt":"2026-10-02T00:00:00Z","id":"f0000000-0000-4000-8000-000000000110","extra":true}')$q$,'22023','Unknown cursor field accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover(cursor:='{"createdAt":"2026-10-02","id":"f0000000-0000-4000-8000-000000000110"}')$q$,'22023','Date-only cursor accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover(cursor:='{"createdAt":"2026-10-02T00:00:00Z"}')$q$,'22023','Incomplete cursor accepted');
RESET ROLE;
-- Current staff can browse an earlier requester's history without granting execution.
-- A distinct retained owner keeps the workspace valid during role and departure probes.
INSERT INTO auth.users(id,aud,role,email) VALUES('b0000000-0000-4000-8000-000000000099','authenticated','authenticated','discovery-owner@synthetic-decision.invalid');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('d51d566d-28c6-49d2-95d2-3a7a2f0902e1','b0000000-0000-4000-8000-000000000099','owner');
UPDATE workspace_members SET role='member' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
DELETE FROM workspace_members WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.discover()->'entries')=25,'Requester departure hid staff history');
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover()$q$,'42501','Viewer browsed thematic requests');
RESET ROLE;
UPDATE workspace_members SET role='admin' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.discover()->'entries')=25,'Admin could not browse history');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover()$q$,'42501','Foreign account browsed thematic requests');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.discover()$q$,'42501','Missing principal browsed thematic requests');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.list_engagement_synthesis_thematic_requests(uuid,uuid,jsonb)','EXECUTE'),'Anonymous discovery grant');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.list_engagement_synthesis_thematic_requests(uuid,uuid,jsonb)','EXECUTE'),'Service discovery grant');
SELECT 'thematic-discovery-verified';
