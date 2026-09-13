"""Real PostgreSQL retention of application-codec output; all changes roll back."""
from generation_schema_source import GenerationSection, MIGRATION
from pathlib import Path
import hashlib,json,subprocess,sys
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
container='supabase_db_openplan-restore-target-2026091050'
base=subprocess.run(['npm','exec','--','tsx',str(review/'generation-queue-fixture.ts')],cwd=app,capture_output=True,text=True,timeout=30)
assert base.returncode==0,base.stderr
encoded=subprocess.run(['npm','exec','--','tsx',str(review/'generation-output-fixture.ts')],input=base.stdout,cwd=app,capture_output=True,text=True,timeout=30)
assert encoded.returncode==0,encoded.stderr
f=json.loads(encoded.stdout)
queue=GenerationSection('queue').read_text()
source=GenerationSection('output').read_text()
probe=(review/'generation-output-probe.sql').read_text()
migration=MIGRATION.read_text()
sql="BEGIN; SET statement_timeout='20s';\n"+migration+"\nSELECT set_config('openplan.queue_fixture',$fixture$"+json.dumps(f)+"$fixture$,true) IS NOT NULL;\n"+probe+'\nROLLBACK;\n'
run=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=sql,capture_output=True,text=True,timeout=35)
(private/'generation-output-probe-latest.log').write_text(run.stdout+run.stderr)
check=subprocess.run(['docker','exec',container,'psql','-X','-U','postgres','-d','postgres','-At','-c',"SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'engagement_translation_generation_%%') AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%%translation_generation%%') AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id='%s') AND NOT has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE');" % f['actorId']],capture_output=True,text=True,timeout=10)
assert check.returncode==0 and check.stdout.strip()=='t','Output rollback containment failed: '+check.stdout+check.stderr
passed=run.returncode==0 and '"outputProbePassed": true' in run.stdout
print(json.dumps({'passed':passed,'rollbackContained':True,'migrationSha256':hashlib.sha256(migration.encode()).hexdigest(),'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'probeSha256':hashlib.sha256(probe.encode()).hexdigest()}))
if not passed: print((run.stdout+run.stderr)[-6000:]);sys.exit(1)
