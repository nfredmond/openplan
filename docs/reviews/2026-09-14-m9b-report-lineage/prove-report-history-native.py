"""Upgrade a synthetic report inside a rollback-only transaction on the disconnected proof DB."""
import hashlib,json,os,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[3]
app=root/'openplan'
out=Path(os.environ['OPENPLAN_REPORT_HISTORY_NATIVE_EVIDENCE']);out.mkdir(parents=True,exist_ok=True)
container='supabase_db_openplan-restore-target-2026091050'
database='openplan_decision_link_proof_20260914'
fixture=(app/'src/test/fixtures/engagement/decision-link-activation.sql').read_text()
migration=(app/'supabase/migrations/20261014000024_engagement_report_decision_history.sql').read_text()
before='''
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
CREATE TEMP TABLE report_probe(key text,value jsonb);
GRANT SELECT,INSERT ON report_probe TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO report_probe SELECT 'old',queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','a0000000-0000-4000-8000-000000000001','internal','{}');
RESET ROLE;
INSERT INTO report_probe SELECT 'original-bytes',to_jsonb(j) FROM engagement_report_jobs j WHERE request_id='a0000000-0000-4000-8000-000000000001';
INSERT INTO engagement_report_jobs(workspace_id,campaign_id,report_id,requested_by,request_id,scope,filters_json,snapshot_text,snapshot_sha256,status)
 SELECT j.workspace_id,j.campaign_id,j.report_id,j.requested_by,gen_random_uuid(),'internal','{"nativeUnknown":true}',raw,encode(extensions.digest(raw,'sha256'),'hex'),'failed'
 FROM engagement_report_jobs j CROSS JOIN (VALUES ('SYNTHETIC unreadable snapshot'),('{}'),('[]'),('{"schema":"1"}'),('{"schema":1.5}'),('{"schema":99999999999}'),('{"schema":null}')) unknown(raw)
 WHERE request_id='a0000000-0000-4000-8000-000000000001';
INSERT INTO report_probe SELECT 'unknown-bytes',to_jsonb(j) FROM engagement_report_jobs j WHERE filters_json='{"nativeUnknown":true}';

RESET ROLE;
'''
after='''
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=7 AND bool_and(j.snapshot_format IS NULL AND j.snapshot_text=p.value->>'snapshot_text' AND j.snapshot_sha256=p.value->>'snapshot_sha256') FROM report_probe p JOIN engagement_report_jobs j ON j.id=(p.value->>'id')::uuid WHERE p.key='unknown-bytes'),'Unreadable legacy snapshots changed or invented a format');
SELECT pg_temp.assert_true((SELECT snapshot_format=1 AND snapshot_text=(SELECT value->>'snapshot_text' FROM report_probe WHERE key='original-bytes') AND snapshot_sha256=(SELECT value->>'snapshot_sha256' FROM report_probe WHERE key='original-bytes') FROM engagement_report_jobs WHERE request_id='a0000000-0000-4000-8000-000000000001'),'Upgrade changed original snapshot');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','a0000000-0000-4000-8000-000000000001','internal','{}')=(SELECT value FROM report_probe WHERE key='old'),'Old request was recaptured');
INSERT INTO report_probe SELECT 'internal',queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','a0000000-0000-4000-8000-000000000002','internal','{"status":"approved","from":"2100-01-01T00:00:00Z"}');
INSERT INTO report_probe SELECT 'public',queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','a0000000-0000-4000-8000-000000000003','public','{"status":"approved"}');
RESET ROLE;
INSERT INTO report_probe SELECT 'archive',snapshot_text::jsonb FROM engagement_report_jobs WHERE request_id='a0000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_true((SELECT snapshot_format=2 AND snapshot_sha256=encode(extensions.digest(snapshot_text,'sha256'),'hex') FROM engagement_report_jobs WHERE request_id='a0000000-0000-4000-8000-000000000002'),'New format or snapshot checksum differs');
SELECT pg_temp.assert_true((SELECT value->>'workspaceId'='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND value->>'decisionLinkHistoryScope'='campaign' AND (value->>'decisionLinkCount')::int=3 AND jsonb_array_length(value->'decisionLinks')=3 AND jsonb_array_length(value->'items')=0 FROM report_probe WHERE key='archive'),'Filtered export lost complete private history');
SELECT pg_temp.assert_true((SELECT array_agg(e->>'operation' ORDER BY (e->>'created_at')::timestamptz,e->>'id')=ARRAY['link','refresh','withdraw'] FROM report_probe CROSS JOIN LATERAL jsonb_array_elements(value->'decisionLinks') e WHERE key='archive'),'Original correction or withdrawal missing');
SELECT pg_temp.assert_true((SELECT bool_and(e->>'payload_sha256'=encode(extensions.digest(e->>'payload_text','sha256'),'hex') AND e->>'context_sha256'=encode(extensions.digest(e->>'context_text','sha256'),'hex') AND (e->>'payload_text')::jsonb=e->'payload_json') FROM report_probe CROSS JOIN LATERAL jsonb_array_elements(value->'decisionLinks') e WHERE key='archive'),'Exact payload or context bytes differ');
SELECT pg_temp.assert_true((SELECT snapshot_format=1 AND NOT snapshot_text::jsonb ?| ARRAY['workspaceId','decisionLinkHistoryScope','decisionLinkCount','decisionLinks'] AND position('SYNTHETIC private rationale' IN snapshot_text)=0 FROM engagement_report_jobs WHERE request_id='a0000000-0000-4000-8000-000000000003'),'Public snapshot exposed private history');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT array_agg(snapshot_format ORDER BY created_at,id) @> ARRAY[1,2] FROM engagement_report_jobs WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Staff cannot read derived formats');
SELECT pg_temp.expect_error('SELECT snapshot_text FROM engagement_report_jobs','42501','Staff raw snapshot read was not refused');
SELECT pg_temp.assert_true(queue_engagement_report('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','a0000000-0000-4000-8000-000000000002','internal','{"status":"approved","from":"2100-01-01T00:00:00Z"}')=(SELECT value FROM report_probe WHERE key='internal'),'New retry was recaptured');
RESET ROLE;
SELECT jsonb_build_object('snapshotText',snapshot_text,'snapshotSha256',snapshot_sha256,'workspaceId',workspace_id,'campaignId',campaign_id,'scope',scope) FROM engagement_report_jobs WHERE request_id='a0000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(scope='public') FROM engagement_report_jobs WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Viewer could read private archives');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_report_jobs WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'),'Foreign workspace could read archives');
RESET ROLE;
SELECT 'report-history-native-verified';
'''
cases=[('baseline',None,None,None),('harmless-comment','-- Preserve every original','-- Keep every original',None),('history-missing',"d.campaign_id=p_campaign AND d.workspace_id=c.workspace_id","false",'Filtered export lost complete private history'),('payload-text-missing',"jsonb_build_object('payload_text',d.payload_json::text)","'{}'::jsonb",'Exact payload or context bytes differ'),('format-read-grant-missing','GRANT SELECT(snapshot_format) ON public.engagement_report_jobs TO authenticated;','','permission denied for table engagement_report_jobs'),('format-not-derived',"(CASE WHEN snapshot_text IS JSON OBJECT THEN\n    CASE snapshot_text::jsonb->'schema' WHEN '1'::jsonb THEN 1 WHEN '2'::jsonb THEN 2 END\n  END)",'(1)','Unreadable legacy snapshots changed or invented a format'),('unsafe-legacy-parse', 'CASE WHEN snapshot_text IS JSON OBJECT THEN', 'CASE WHEN true THEN', 'invalid input syntax for type json'),('public-history-leaked',"CASE WHEN p_scope='internal' THEN jsonb_build_object(","CASE WHEN true THEN jsonb_build_object(",'Public snapshot exposed private history')]
results=[]
for label,old,new,expected in cases:
 changed=migration
 if old:
  assert old in changed,label
  changed=changed.replace(old,new)
 script="BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n"+fixture+before+changed+after+'\nROLLBACK;'
 result=subprocess.run(['docker','exec','-i',container,'psql','-U','supabase_admin','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=script,text=True,capture_output=True,timeout=45)
 (out/(label+'.log')).write_text(result.stdout+'\n'+result.stderr)
 correct=(result.returncode==0 and result.stdout.strip().endswith('report-history-native-verified')) if expected is None else (result.returncode!=0 and expected in result.stderr)
 results.append({'case':label,'exit':result.returncode,'expectedOutcome':correct})
 print(label,correct,flush=True)
 if label=='baseline' and correct:
  packet=next(value for line in result.stdout.splitlines() if line.startswith('{') for value in [json.loads(line)] if 'snapshotText' in value)
  (out/'native-archive.json').write_text(json.dumps(packet,indent=2)+'\n')
 (out/'results.json').write_text(json.dumps({'container':container,'database':database,'rollbackOnly':True,'migrationSha256':hashlib.sha256(migration.encode()).hexdigest(),'results':results,'limits':['Synthetic native lifecycle after source deletion; does not prove UI reachability or generated file layout.','No concurrent queue/link transaction overlap is exercised here.','No application stack migration was committed.']},indent=2)+'\n')
 assert correct,label
