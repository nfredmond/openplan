"""Rollback-only queue probe against the explicitly named owned test stack."""
from generation_schema_source import GenerationSection, MIGRATION
from pathlib import Path
import hashlib,json,subprocess,sys,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
container='supabase_db_openplan-restore-target-2026091050'
fixture_run=subprocess.run(['npm','exec','--','tsx',str(review/'generation-queue-fixture.ts')],cwd=app,capture_output=True,text=True,timeout=30)
if fixture_run.returncode:
 print(fixture_run.stderr); raise SystemExit(fixture_run.returncode)
fixture=json.loads(fixture_run.stdout)
source=GenerationSection('queue').read_text()
probe=(review/'generation-queue-probe.sql').read_text()
migration=MIGRATION.read_text()
sql="BEGIN;\nSET statement_timeout='20s';\n"+migration+"\nSELECT set_config('openplan.queue_fixture',$fixture$"+json.dumps(fixture)+"$fixture$,true) IS NOT NULL;\n"+probe+'\nROLLBACK;\n'
run=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=sql,capture_output=True,text=True,timeout=35)
(private/'generation-queue-probe-latest.log').write_text(run.stdout+run.stderr)
# A connection closing on any error also rolls back its uncommitted DDL/fixtures.
check=subprocess.run(['docker','exec',container,'psql','-X','-U','postgres','-d','postgres','-At','-c',"SELECT to_regclass('public.engagement_translation_generation_requests') IS NULL AND to_regclass('public.engagement_translation_generation_fields') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%%translation_generation%%') AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id='%s') AND NOT has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE');" % fixture['actorId']],capture_output=True,text=True,timeout=10)
assert check.returncode==0 and check.stdout.strip()=='t', 'Queue rollback/grant containment failed: '+check.stdout+check.stderr
passed=run.returncode==0 and '"queueProbePassed": true' in run.stdout
result={'passed':passed,'rollbackContained':True,'container':container,'migrationSha256':hashlib.sha256(migration.encode()).hexdigest(),'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'probeSha256':hashlib.sha256(probe.encode()).hexdigest()}
print(json.dumps(result))
if not passed:
 print((run.stdout+run.stderr)[-6000:]); sys.exit(1)
