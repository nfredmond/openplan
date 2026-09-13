"""Apply only migration 14 transactionally to the retained two-field proof case."""
from pathlib import Path
import hashlib,json,subprocess,uuid
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
evidence=json.loads((review/'generation-output-concurrency.json').read_text())
f=json.loads((Path(evidence['privateEvidence'])/'fixture.json').read_text())
ctx={k:f[k] for k in ['workspaceId','campaignId','actorId','requestId']}
ctx.update({k:str(uuid.uuid4()) for k in ['member','viewer','outsider']})
command=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-X','-U','supabase_admin','-d','openplan_translation_command_proof_20260913','-qAt','-v','ON_ERROR_STOP=1']
def query(sql):return subprocess.run(command,input=sql,text=True,capture_output=True,timeout=15)
r=query("SELECT delivery_digest FROM engagement_translation_generation_outputs WHERE field_id='"+evidence['fieldId']+"';");assert r.returncode==0,r.stderr
ctx['digest']=r.stdout.strip()
r=query("SELECT id FROM engagement_translation_generation_requests WHERE campaign_id<>'"+ctx['campaignId']+"' ORDER BY id LIMIT 1;");assert r.returncode==0 and r.stdout.strip()
ctx['foreignRequest']=r.stdout.strip()
source=app/'supabase/migrations/20261014000014_engagement_translation_generation_reads.sql'
probe=review/'generation-request-read-probe.sql'
run=query("BEGIN;SET LOCAL statement_timeout='5s';\n"+source.read_text()+"\nSELECT set_config('openplan.generation_read_fixture',$fixture$"+json.dumps(ctx)+"$fixture$,true) IS NOT NULL;\n"+probe.read_text()+"\nROLLBACK;")
(private/'generation-request-read-probe-latest.log').write_text(run.stdout+run.stderr)
r=query("SELECT to_regprocedure('public.read_translation_generation_request(uuid,uuid)') IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id='"+ctx['member']+"');")
assert r.returncode==0 and r.stdout.strip()=='t','Read probe escaped rollback'
passed=run.returncode==0 and 'GENERATION_READ_PROBE_PASSED' in run.stdout
if not passed:print((run.stdout+run.stderr)[-5000:]);raise SystemExit(1)
raw=next(line.removeprefix('GENERATION_READ_RESULT:') for line in run.stdout.splitlines() if line.startswith('GENERATION_READ_RESULT:'))
checked=subprocess.run(['npm','exec','--','tsx',str(review/'generation-request-read-fixture.ts')],cwd=app,input=raw,text=True,capture_output=True,timeout=15)
(private/'generation-request-read-native.log').write_text(checked.stdout+checked.stderr)
assert checked.returncode==0,'Native generation reader rejected SQL output: '+checked.stderr
result={'passed':True,'rollbackContained':True,'migrationSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'nativeRead':json.loads(checked.stdout)}
print(json.dumps(result))
