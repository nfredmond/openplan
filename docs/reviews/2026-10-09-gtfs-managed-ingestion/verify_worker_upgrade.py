"""Upgrade a recorded predecessor to exact main, then preserve populated GTFS data."""
from pathlib import Path
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import uuid

here = Path(__file__).resolve().parent
root = here.parents[2]
container = 'supabase_db_openplan-restore-target-2026091050'
if os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER') != container:
    raise SystemExit('Select the named disposable restore-target container explicitly')
source_database = 'openplan_retention_upgrade_7aeef48b83fd4bd0ab03c56bf5f3020c'
out = Path(sys.argv[1]).resolve(); out.mkdir(mode=0o700,parents=True,exist_ok=False)
main_head = subprocess.check_output(['git','rev-parse','origin/main'],cwd=root,text=True).strip()
main_package = out/'main/openplan'
archive = subprocess.check_output(['git','archive',main_head,'openplan/supabase/migrations','openplan/supabase/config.toml'],cwd=root)
with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
    bundle.extractall(out/'main',filter='data')
main_files = sorted((main_package/'supabase/migrations').glob('*.sql'))
candidate_file = root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
assert main_files[-1].name == '20261016000027_run_project_workspace_foreign_keys.sql'
assert all(path.read_bytes() == (root/'openplan/supabase/migrations'/path.name).read_bytes() for path in main_files)

def sql(database, query):
    r = subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],
                       input=query,text=True,capture_output=True,timeout=30)
    if r.returncode: raise RuntimeError(r.stderr[:3000])
    return r.stdout.strip()

assert sql(source_database, 'SELECT count(*) FROM supabase_migrations.schema_migrations;') == '393'
assert sql(source_database, 'SELECT max(version) FROM supabase_migrations.schema_migrations;') == '20261016000021'
assert sql(source_database, "SELECT to_regclass('public.gtfs_ingest_storage_cleanup') IS NULL AND to_regclass('public.model_run_recovery_receipts') IS NULL;") == 't'
assert sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source_database}';") == '0'
main_database = 'openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {main_database} TEMPLATE {source_database};')
main_config = {'container':container,'database':main_database}
(out/'main-database.json').write_text(json.dumps(main_config)+'\n')
state=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
settings=dict(value.split('=',1) for value in state['Config']['Env'] if '=' in value)
port=state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
cli=root/'openplan/node_modules/.bin/supabase'
cli_version=subprocess.check_output([str(cli),'--version'],text=True).strip()

def upgrade(database, package, label):
    url=f'postgresql://postgres@127.0.0.1:{port}/{database}?sslmode=disable'
    result=subprocess.run([str(cli),'migration','up','--db-url',url,'--workdir',str(package),'--yes'],
                          capture_output=True,text=True,timeout=90,env={**os.environ,'PGPASSWORD':settings['POSTGRES_PASSWORD']})
    (out/f'{label}.log').write_text(result.stdout+'\n'+result.stderr)
    assert result.returncode == 0, 'CLI upgrade failed; inspect private '+label+'.log'

def versions(database):
    return sql(database,'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').splitlines()

upgrade(main_database,main_package,'main-upgrade')
assert versions(main_database) == [path.name.split('_')[0] for path in main_files]
assert sql(main_database,"SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';") == '0'
workspace,actor,feed,version=[str(uuid.uuid4()) for _ in range(4)]
sql(main_database,f"""INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic managed upgrade','upgrade-{workspace}');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');
INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES('{feed}','{workspace}','Synthetic predecessor GTFS');
INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,route_count,stop_count,route_service_level_rows,stop_service_level_rows,is_current)
 VALUES('{version}','{workspace}','{feed}','upload','ready',1,1,1,1,true);
INSERT INTO public.gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method)
 VALUES('{workspace}','{version}','synthetic-route',3,'monday',1,'scheduled');
INSERT INTO public.gtfs_stop_service_levels(workspace_id,feed_version_id,stop_id,stop_name,latitude,longitude,service_day,trips_per_day,derivation_method)
 VALUES('{workspace}','{version}','synthetic-stop','Synthetic stop',13.4443,144.7937,'monday',1,'scheduled');
UPDATE public.gtfs_feeds SET current_version_id='{version}' WHERE id='{feed}';
INSERT INTO public.gtfs_feed_versions(workspace_id,feed_id,source_kind,status)
 SELECT '{workspace}','{feed}','upload',status FROM unnest(ARRAY['pending','fetching','parsing']) status;
INSERT INTO public.gtfs_feed_versions(workspace_id,feed_id,source_kind,status,failure_code)
 VALUES('{workspace}','{feed}','upload','failed','synthetic_existing_failure');""")
tables=['gtfs_feeds','gtfs_feed_versions','gtfs_route_service_levels','gtfs_stop_service_levels','gtfs_tract_service','gtfs_ingest_storage_cleanup']
parts=[]
for table in tables:
    key='version_id' if table=='gtfs_ingest_storage_cleanup' else 'id'
    parts.extend([f"'{table}'",f"(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY {key}),'[]'::jsonb) FROM public.{table} t)"])
snapshot='SELECT jsonb_build_object('+','.join(parts)+');'
before=json.loads(sql(main_database,snapshot))
assert len(before['gtfs_feed_versions']) >= 5 and before['gtfs_route_service_levels'] and before['gtfs_stop_service_levels']
(out/'before.json').write_text(json.dumps(before,indent=2)+'\n')
candidate_database='openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {candidate_database} TEMPLATE {main_database};')
(out/'candidate-database.json').write_text(json.dumps({'container':container,'database':candidate_database})+'\n')
source=candidate_file.read_text();assert source.count('\nBEGIN;\n') == 1 and source.endswith('COMMIT;\n')
ddl=source.replace('\nBEGIN;\n','\n',1).removesuffix('COMMIT;\n')
controls=[]
for name,extra,passes in [
 ('baseline','',True),('harmless','\n-- Harmless migration comment.',True),
 ('change-feed',f"\nUPDATE public.gtfs_feeds SET agency_name='Changed fixture' WHERE id='{feed}';",False),
 ('drop-existing-route',f"\nDELETE FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}';",False),
 ('rewrite-existing-status',f"\nUPDATE public.gtfs_feed_versions SET status='pending' WHERE id='{version}';",False),
 ('restored','',True)]:
    observed=json.loads(sql(candidate_database,'BEGIN;\n'+ddl+extra+'\n'+snapshot+'ROLLBACK;'))
    try:
        assert observed == before, 'Existing GTFS records changed'
    except AssertionError as error:
        assert not passes and str(error)=='Existing GTFS records changed',name
        controls.append({'name':name,'result':'intended assertion failure','assertion':str(error)})
    else:
        assert passes,'Mutation survived '+name
        controls.append({'name':name,'result':'pass'})
assert json.loads(sql(candidate_database,snapshot)) == before
upgrade(candidate_database,root/'openplan','candidate-upgrade')
upgrade(candidate_database,root/'openplan','candidate-repeat')
expected=sorted(path.name.split('_')[0] for path in (root/'openplan/supabase/migrations').glob('*.sql'))
assert versions(candidate_database)==expected
assert json.loads(sql(candidate_database,snapshot)) == before
assert sql(candidate_database,'SELECT count(*) FROM openplan_gtfs.executions;') == '0'
assert sql(main_database,"SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';") == '0'
assert versions(main_database)==[path.name.split('_')[0] for path in main_files]
record={'mainHead':main_head,'cliVersion':cli_version,'mainMigrationCount':len(main_files),'candidateMigrationCount':len(expected),
        'mainMigrations':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in main_files},
        'candidateMigrationSha256':hashlib.sha256(candidate_file.read_bytes()).hexdigest(),
        'proofSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'controls':controls,'rowCounts':{table:len(rows) for table,rows in before.items()},
        'beforeSha256':hashlib.sha256((out/'before.json').read_bytes()).hexdigest(),
        'rowsUnchanged':True,'repeatMigrationNoChange':True,'existingImportsNotEnrolled':True,
        'scope':'CLI upgrade of a retained recorded predecessor through exact current-main files, then populated synthetic GTFS upgrade to candidate. Not installation from empty platform, full archive restore, all deployment data or browser acceptance.'}
(out/'upgrade.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({key:record[key] for key in ['mainHead','mainMigrationCount','candidateMigrationCount','rowCounts','rowsUnchanged','repeatMigrationNoChange']}))
