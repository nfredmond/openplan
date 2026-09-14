-- Append after decision-link-activation.sql in the same rollback-only transaction.
-- The installed queue captures all three retained actions after current sources disappear.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
CREATE TEMP TABLE report_history_probe(key text,value jsonb);
GRANT SELECT,INSERT ON report_history_probe TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO report_history_probe SELECT 'internal',queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b0000000-0000-4000-8000-000000000001','internal','{"status":"approved","from":"2100-01-01T00:00:00Z"}');
INSERT INTO report_history_probe SELECT 'public',queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b0000000-0000-4000-8000-000000000002','public','{"status":"approved"}');
SELECT pg_temp.assert_true((SELECT snapshot_format=2 FROM engagement_report_jobs WHERE request_id='b0000000-0000-4000-8000-000000000001'),'Staff cannot read installed history format');
SELECT pg_temp.expect_error('SELECT snapshot_text FROM engagement_report_jobs','42501','Staff raw archive access was not refused');
RESET ROLE;
INSERT INTO report_history_probe SELECT 'archive',snapshot_text::jsonb FROM engagement_report_jobs WHERE request_id='b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT value->>'workspaceId'='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND value->>'decisionLinkHistoryScope'='campaign' AND (value->>'decisionLinkCount')::int=3 AND jsonb_array_length(value->'decisionLinks')=3 AND jsonb_array_length(value->'items')=0 FROM report_history_probe WHERE key='archive'),'Installed queue lost complete private history');
SELECT pg_temp.assert_true((SELECT array_agg(e->>'operation' ORDER BY ord)=ARRAY['link','refresh','withdraw'] FROM report_history_probe CROSS JOIN LATERAL jsonb_array_elements(value->'decisionLinks') WITH ORDINALITY AS rows(e,ord) WHERE key='archive'),'Installed queue lost ordered history actions');
SELECT pg_temp.assert_true((SELECT bool_and((e->>'payload_sha256'=encode(extensions.digest(e->>'payload_text','sha256'),'hex') AND e->>'context_sha256'=encode(extensions.digest(e->>'context_text','sha256'),'hex') AND (e->>'payload_text')::jsonb=e->'payload_json') IS TRUE) FROM report_history_probe CROSS JOIN LATERAL jsonb_array_elements(value->'decisionLinks') e WHERE key='archive'),'Installed queue changed exact history bytes');
SELECT pg_temp.assert_true((SELECT snapshot_format=1 AND NOT snapshot_text::jsonb ?| ARRAY['workspaceId','decisionLinkHistoryScope','decisionLinkCount','decisionLinks'] AND position('SYNTHETIC private rationale' IN snapshot_text)=0 FROM engagement_report_jobs WHERE request_id='b0000000-0000-4000-8000-000000000002'),'Installed public queue exposed private history');
-- Preserve the installed legacy retry path without modifying any retained job.
INSERT INTO engagement_report_jobs(workspace_id,campaign_id,report_id,requested_by,request_id,scope,filters_json,snapshot_text,snapshot_sha256,status)
 SELECT workspace_id,campaign_id,report_id,requested_by,'b0000000-0000-4000-8000-000000000003','internal','{}',legacy.raw,encode(extensions.digest(legacy.raw,'sha256'),'hex'),'failed'
 FROM engagement_report_jobs CROSS JOIN LATERAL (SELECT (snapshot_text::jsonb || jsonb_build_object('scope','internal'))::text AS raw) legacy WHERE request_id='b0000000-0000-4000-8000-000000000002';
INSERT INTO report_history_probe SELECT 'legacy',to_jsonb(j) FROM engagement_report_jobs j WHERE request_id='b0000000-0000-4000-8000-000000000003';
INSERT INTO engagement_report_jobs(workspace_id,campaign_id,report_id,requested_by,request_id,scope,filters_json,snapshot_text,snapshot_sha256,status)
 SELECT j.workspace_id,j.campaign_id,j.report_id,j.requested_by,gen_random_uuid(),'internal','{"nativeUnknown":true}',raw,encode(extensions.digest(raw,'sha256'),'hex'),'failed'
 FROM engagement_report_jobs j CROSS JOIN (VALUES ('SYNTHETIC unreadable snapshot'),('{}'),('[]'),('{"schema":"1"}'),('{"schema":1.5}'),('{"schema":99999999999}'),('{"schema":null}')) unknown(raw)
 WHERE request_id='b0000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true((SELECT count(*)=7 AND bool_and(snapshot_format IS NULL) FROM engagement_report_jobs WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f' AND filters_json='{"nativeUnknown":true}'),'Installed format invented readable legacy history');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b0000000-0000-4000-8000-000000000001','internal','{"status":"approved","from":"2100-01-01T00:00:00Z"}')=(SELECT value FROM report_history_probe WHERE key='internal'),'Installed exact retry changed new receipt');
SELECT pg_temp.assert_true(queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b0000000-0000-4000-8000-000000000003','internal','{}')->>'snapshotSha256'=(SELECT value->>'snapshot_sha256' FROM report_history_probe WHERE key='legacy'),'Installed legacy retry recaptured history');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT snapshot_text=(SELECT value->>'snapshot_text' FROM report_history_probe WHERE key='legacy') AND snapshot_format=1 FROM engagement_report_jobs WHERE request_id='b0000000-0000-4000-8000-000000000003'),'Installed legacy retry changed saved bytes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(scope='public') FROM engagement_report_jobs WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Viewer read private report history');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_report_jobs WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Foreign workspace read report history');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($probe$SELECT queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','b0000000-0000-4000-8000-000000000003','internal','{}')$probe$,'42501','Anonymous queue execution was not refused');
RESET ROLE;
SELECT 'report-history-activation-verified';
