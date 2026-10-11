"""Prepare an owned candidate clone without using the walkthrough database."""
from pathlib import Path
import hashlib,json,os,re,subprocess,sys,uuid
from urllib.parse import urlsplit,unquote
root=Path(__file__).resolve().parents[3];source=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False);os.umask(0o077)
container=source['container'];assert container=='supabase_db_openplan-restore-target-2026091050';assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
def sql(database,text,auth=False):
 command=['docker','exec','-i']
 environment=os.environ.copy()
 if auth:
  command+=['--env','PGPASSWORD'];environment['PGPASSWORD']=unquote(auth_uri.password)
 command+=[container,'psql','-h','127.0.0.1','-U','supabase_auth_admin' if auth else 'postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1']
 result=subprocess.run(command,input=text,text=True,capture_output=True,timeout=30,env=environment)
 if result.returncode:
  (out/('sql-failure-'+uuid.uuid4().hex+'.log')).write_text(result.stderr)
  raise RuntimeError('Owned database statement failed; inspect the private diagnostic')
 return result.stdout.strip()
def auth_schema(database):
 result=subprocess.run(['docker','exec',container,'pg_dump','-U','postgres','-d',database,'--schema=auth','--schema-only','--no-owner','--no-privileges'],capture_output=True,text=True,timeout=30)
 if result.returncode:raise RuntimeError('Owned Auth schema read failed')
 return '\n'.join(line for line in result.stdout.splitlines() if not line.startswith(('\\restrict','\\unrestrict','--')))
versions=sorted(path.name.split('_')[0] for path in (root/'openplan/supabase/migrations').glob('*.sql'))
assert sql(source['database'],'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').splitlines()==versions
assert sql(source['database'],'SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();')=='0'
assert int(sql(source['database'],'SELECT pg_database_size(current_database());'))<1024**3
schema=auth_schema('postgres');assert auth_schema(source['database'])==schema,'Auth schemas differ; do not transfer a version ledger'
source_auth=sql('postgres','SELECT version FROM auth.schema_migrations ORDER BY version;').splitlines();assert source_auth and all(re.fullmatch(r'[0-9]+',v) for v in source_auth)
existing=sql(source['database'],'SELECT version FROM auth.schema_migrations ORDER BY version;').splitlines();assert set(existing)<=set(source_auth)
auth_rows="SELECT jsonb_build_object('users',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM auth.users t),'identities',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM auth.identities t));"
source_auth_rows=sql(source['database'],auth_rows)
# Auth owns its ledger. Read its configured role privately rather than granting
# the application or postgres additional privileges over the Auth schema.
auth_inspection=subprocess.run(['docker','inspect','supabase_auth_openplan-restore-target-2026091050'],capture_output=True,text=True,timeout=20)
if auth_inspection.returncode:raise RuntimeError('Owned Auth configuration is unavailable')
auth_settings=dict(value.split('=',1) for value in json.loads(auth_inspection.stdout)[0]['Config']['Env'] if '=' in value)
auth_uri=urlsplit(auth_settings['GOTRUE_DB_DATABASE_URL'])
assert auth_uri.username=='supabase_auth_admin' and auth_uri.password
assert auth_uri.hostname==container and auth_uri.path=='/postgres'
source_public=sql(source['database'],"SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.gtfs_feed_versions t;")
database='openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
config={**source,'database':database};(out/'database.json').write_text(json.dumps(config)+'\n')
assert auth_schema(database)==schema
# This recorded predecessor has the installed Auth schema. Transfer only its
# exact version ledger after schema equality, before GoTrue can replay old DDL.
assert sql(database,"SELECT has_table_privilege(current_user,'auth.schema_migrations','INSERT');",auth=True)=='t'
sql(database,'INSERT INTO auth.schema_migrations(version) VALUES '+','.join("('"+v+"')" for v in source_auth)+' ON CONFLICT(version) DO NOTHING;',auth=True)
assert sql(database,'SELECT version FROM auth.schema_migrations ORDER BY version;').splitlines()==source_auth
assert auth_schema(database)==schema and auth_schema('postgres')==schema and auth_schema(source['database'])==schema
assert sql(database,auth_rows)==source_auth_rows and sql(source['database'],auth_rows)==source_auth_rows
assert sql(source['database'],"SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.gtfs_feed_versions t;")==source_public
record={'database':database,'sourceDatabase':source['database'],'migrationCount':len(versions),'candidateLedgerMatches':True,'authSchemaSha256':hashlib.sha256(schema.encode()).hexdigest(),'authLedgerWriter':'supabase_auth_admin','authHistoryRowsBefore':len(existing),'authHistoryRowsAfter':len(source_auth),'sourceUnchanged':True,'boundary':'Owned browser clone of the populated official CLI candidate. Version-only Auth ledger after schema equality excludes ownership, grants, dump comments and restriction markers. Auth ledger transfer changes no user records; the clone retains predecessor fixtures. No login, browser, complete restore or installation acceptance.'}
(out/'preparation.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
