"""Rollback-only catalog projection proof in a named, isolated proof database."""
from pathlib import Path
import hashlib,json,subprocess
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
command=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-X','-U','supabase_admin','-d','openplan_translation_command_proof_20260913','-qAt','-v','ON_ERROR_STOP=1']
def query(sql):return subprocess.run(command,input=sql,text=True,capture_output=True,timeout=20)
generated=subprocess.run(['npm','exec','--','tsx',str(review/'generation-catalog-fixture.ts')],cwd=app,text=True,capture_output=True,timeout=20)
assert generated.returncode==0,generated.stderr
fixture=json.loads(generated.stdout)
source=app/'supabase/migrations/20261014000015_engagement_translation_generation_catalog.sql'
run=query("BEGIN;SET LOCAL statement_timeout='5s';\n"+source.read_text()+"\nSELECT set_config('openplan.catalog_fixture',$fixture$"+json.dumps(fixture)+"$fixture$,true) IS NOT NULL;\n"+(review/'generation-catalog-probe.sql').read_text()+"\nROLLBACK;")
(private/'generation-catalog-sql-latest.log').write_text(run.stdout+run.stderr)
check=query("SELECT to_regprocedure('public.list_translation_generation_requests(uuid,timestamptz,uuid)') IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id='"+fixture['actorId']+"');")
assert check.returncode==0 and check.stdout.strip()=='t','Catalog fixture escaped rollback'
if run.returncode!=0 or 'CATALOG_PROBE_PASSED' not in run.stdout:print((run.stdout+run.stderr)[-5000:]);raise SystemExit(1)
pages=json.loads(next(line.removeprefix('CATALOG_PAGES:') for line in run.stdout.splitlines() if line.startswith('CATALOG_PAGES:')))
checked=subprocess.run(['npm','exec','--','tsx',str(review/'generation-catalog-fixture.ts'),'--read'],cwd=app,input=json.dumps({'fixture':fixture,'pages':pages}),text=True,capture_output=True,timeout=20)
assert checked.returncode==0,'Native catalog decode: '+checked.stderr
print(json.dumps({'passed':True,'rollbackContained':True,'migrationSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'nativeRead':json.loads(checked.stdout)}))
