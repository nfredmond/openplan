"""Prepare a fresh acceptance database without changing the frozen preview.

Uses an explicitly identified idle proof template and the installed migration
CLI. No service is started and no source database is upgraded or reset.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

os.umask(0o077)
ROOT = Path(__file__).resolve().parent
source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
checkout = Path(os.environ['OPENPLAN_RECOVERY_ACCEPTANCE_CHECKOUT']).resolve()
output = Path(os.environ['OPENPLAN_RECOVERY_ACCEPTANCE_OUTPUT']).resolve()
if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
    raise ValueError('An owned retention proof template is required')
if not checkout.name.startswith('recovery-acceptance-') or not (checkout/'openplan/supabase/config.toml').is_file():
    raise ValueError('An isolated acceptance checkout is required')
head = subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'],text=True).strip()
if subprocess.check_output(['git','-C',str(checkout),'status','--porcelain','--untracked-files=no'],text=True).strip():
    raise ValueError('Acceptance checkout has tracked changes')
output.mkdir(mode=0o700,parents=True,exist_ok=False)

def sql(database, statement):
    result = subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

version = sql(source['database'],'SELECT max(version) FROM supabase_migrations.schema_migrations;')
if version != '20261016000021':
    raise ValueError('Expected the retained migration21 template')
if sql('postgres',f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
    raise ValueError('Template has active sessions')
tables = sql(source['database'],"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'model%' ORDER BY tablename;").splitlines()
if not tables or any(not re.fullmatch(r'[a-z_0-9]+',name) for name in tables):
    raise ValueError('Unexpected model table inventory')

def inventory(database):
    return {name: sql(database,f"SELECT count(*)::text||':'||md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{name} t;") for name in tables}

before = inventory(source['database'])
database = 'openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
metadata = {'container':source['container'],'database':database,'source_database':source['database'],'source_version':version,'fixture_run':str(uuid.UUID(source['fixture_run'])),'checkout':str(checkout),'head':head,'status':'clone created; upgrade pending'}
(output/'candidate.json').write_text(json.dumps(metadata,indent=2)+'\n')
state = json.loads(subprocess.check_output(['docker','inspect',source['container']],text=True))[0]
settings = dict(item.split('=',1) for item in state['Config']['Env'] if '=' in item)
port = state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
url = f'postgresql://postgres@127.0.0.1:{port}/{database}?sslmode=disable'
cli = os.environ['OPENPLAN_PROOF_SUPABASE_CLI']
for number in (1,2):
    result = subprocess.run([cli,'migration','up','--db-url',url,'--workdir',str(checkout/'openplan'),'--yes'],env={**os.environ,'PGPASSWORD':settings['POSTGRES_PASSWORD']},capture_output=True,text=True,timeout=180)
    (output/f'migration-{number}.log').write_text(result.stdout+'\n'+result.stderr)
    if result.returncode:
        raise RuntimeError('Acceptance clone upgrade failed; inspect private log')
    if inventory(database) != before:
        raise AssertionError('Existing execution rows changed during upgrade')
    if sql(database,'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000023':
        raise AssertionError('Recovery migrations are not recorded')
if inventory(source['database']) != before or sql(source['database'],'SELECT max(version) FROM supabase_migrations.schema_migrations;') != version:
    raise AssertionError('Template changed')
privileges = sql(database,"SELECT has_function_privilege('anon','public.abandon_model_run_execution(uuid,uuid,uuid,uuid,jsonb,text,jsonb)','EXECUTE')::text||':'||has_function_privilege('authenticated','public.abandon_model_run_execution(uuid,uuid,uuid,uuid,jsonb,text,jsonb)','EXECUTE')::text||':'||has_function_privilege('service_role','public.abandon_model_run_execution(uuid,uuid,uuid,uuid,jsonb,text,jsonb)','EXECUTE')::text;")
if privileges != 'false:false:true':
    raise AssertionError('Recovery RPC privileges differ')
metadata.update(status='upgraded and reapplied; ready for isolated auth and application configuration',migration_version='20261016000023',compared_tables=before,source_unchanged=True,recovery_rpc_privileges=privileges,limits='Fresh owned clone with real CLI upgrade/reapply and row preservation. No authentication server, configured app, browser journey, physical termination or scientific acceptance.')
(output/'candidate.json').write_text(json.dumps(metadata,indent=2)+'\n')
report = {**metadata,'preparation_script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
(ROOT/'recovery-acceptance-database.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'database':database,'head':head,'migration_version':metadata['migration_version'],'preserved_model_tables':len(tables),'source_unchanged':True,'rpc_privileges':privileges}))
