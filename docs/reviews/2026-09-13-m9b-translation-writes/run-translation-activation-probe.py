"""Apply pending translation migrations and run fixtures in a disposable rollback transaction."""
from pathlib import Path
import hashlib,json,subprocess,sys
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
container='supabase_db_openplan-restore-target-2026091050'
database='openplan_translation_activation_proof_20260913'
command=['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1']
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
def query(sql):return subprocess.run(command,input=sql,text=True,capture_output=True,timeout=110)
fingerprint="""SELECT jsonb_build_object('migrationCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migrationMax',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'tables',(SELECT md5(string_agg(c.oid::text||c.relname||coalesce(c.relacl::text,''),',' ORDER BY c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'functions',(SELECT md5(string_agg(p.oid::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')),
 'triggers',(SELECT md5(string_agg(t.oid::text||t.tgenabled::text,',' ORDER BY t.oid)) FROM pg_trigger t),
 'users',(SELECT count(*) FROM auth.users),'campaigns',(SELECT count(*) FROM engagement_campaigns),
 'translations',(SELECT count(*) FROM engagement_content_translations),'history',(SELECT count(*) FROM engagement_translation_history),
 'receipts',(SELECT count(*) FROM engagement_translation_write_receipts));"""
before=query(fingerprint);assert before.returncode==0,before.stderr
baseline=json.loads(before.stdout);assert baseline['migrationCount']==331 and baseline['migrationMax']=='20261014000012','Expected explicitly isolated pre-activation stack'
migrations=[next((app/'supabase/migrations').glob(f'202610140000{number}_*.sql')) for number in (13,14,15,16,17)]
fixtures=[app/'src/test/fixtures/engagement'/name for name in ('translation-command-activation.sql','translation-scope.sql','translation-history.sql','translation-history-receipts.sql')]
assert len(sys.argv)<=2 and (len(sys.argv)==1 or sys.argv[1] in [path.name for path in fixtures]), 'Unknown fixture selector'
if len(sys.argv)==2: fixtures=[path for path in fixtures if path.name==sys.argv[1]]
# Legacy broad grants are transaction-local negative prerequisites. Activation
# must remove inherited PUBLIC and anon grants, not just authenticated grants.
legacy_grants="""GRANT INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.engagement_content_translations TO PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO PUBLIC,anon;"""
sql="BEGIN;SET LOCAL statement_timeout='90s';SET LOCAL lock_timeout='2s';\n"+'\n'.join(path.read_text() for path in migrations[:-1])+"\n"+legacy_grants+"\n"+migrations[-1].read_text()+"\n"+'\n'.join(path.read_text() for path in fixtures)+"\nROLLBACK;"
run=query(sql);(private/'translation-activation-latest.log').write_text(run.stdout+run.stderr)
after=query(fingerprint)
assert after.returncode==0 and json.loads(after.stdout)==baseline,'Activation probe escaped rollback'
markers=[path.stem+'-verified' for path in fixtures]
if run.returncode or not all(marker in run.stdout.splitlines() for marker in markers):
 print((run.stdout+run.stderr)[-6000:]);raise SystemExit(1)
print(json.dumps({'passed':True,'rollbackContained':True,'container':container,'database':database,'baseline':{'count':331,'latest':'20261014000012'},'markers':markers,'sha256':{str(path.relative_to(app)):hashlib.sha256(path.read_bytes()).hexdigest() for path in migrations+fixtures},'limits':'Pending migrations and real SQL role/constraint/history fixtures rolled back on a named isolated stack. No permanently applied upgrade, browser, public model call or new worker execution.'}))
