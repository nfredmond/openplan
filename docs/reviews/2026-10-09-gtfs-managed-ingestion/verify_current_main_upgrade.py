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

def check_default_refusal(code,diagnostic,after_versions,main_versions,after_rows,before_rows,schema_missing):
    """Require the specific refusal and unchanged database before include-all."""
    assert code != 0, 'Default CLI unexpectedly accepted older missing migrations'
    assert 'Found local migration files to be inserted before the last migration on remote database' in diagnostic, 'Default CLI failed for another reason'
    assert after_versions==main_versions, 'Default refusal changed migration history'
    assert after_rows==before_rows, 'Default refusal changed existing rows'
    assert schema_missing, 'Default refusal installed managed schema'

here = Path(__file__).resolve().parent
root = Path('/home/nathaniel/.local/state/openplan/gtfs-encryption-join-20261011')
container = 'supabase_db_openplan-restore-target-2026091050'
if os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER') != container:
    raise SystemExit('Select the named disposable restore-target container explicitly')
source_database = 'openplan_retention_upgrade_7aeef48b83fd4bd0ab03c56bf5f3020c'
out = Path(sys.argv[1]).resolve(); out.mkdir(mode=0o700,parents=True,exist_ok=False)
main_head = 'e435e58b1741f7c3438b98f4bfcf3756a70ee12b'
main_package = out/'main/openplan'
archive = subprocess.check_output(['git','archive',main_head,'openplan/supabase/migrations','openplan/supabase/config.toml'],cwd=root)
with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
    bundle.extractall(out/'main',filter='data')
main_files = sorted((main_package/'supabase/migrations').glob('*.sql'))
candidate_files = sorted(path for path in (root/'openplan/supabase/migrations').glob('*.sql') if path.name not in {main.name for main in main_files})
assert [path.name.split('_')[0] for path in candidate_files] == ['20261016000028','20261016000029','20261016000030','20261016000031']
assert main_files[-1].name == '20261017000001_project_map_packages.sql'
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

def upgrade(database, package, label, include_all=False, require_success=True):
    url=f'postgresql://postgres@127.0.0.1:{port}/{database}?sslmode=disable'
    args=[str(cli),'migration','up','--db-url',url,'--workdir',str(package),'--yes']
    if include_all: args.append('--include-all')
    result=subprocess.run(args,
                          capture_output=True,text=True,timeout=90,env={**os.environ,'PGPASSWORD':settings['POSTGRES_PASSWORD']})
    (out/f'{label}.log').write_text(result.stdout+'\n'+result.stderr)
    if require_success: assert result.returncode == 0, 'CLI upgrade failed; inspect private '+label+'.log'
    return result

def versions(database):
    return sql(database,'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').splitlines()

upgrade(main_database,main_package,'main-upgrade')
assert versions(main_database) == [path.name.split('_')[0] for path in main_files]
assert sql(main_database,"SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';") == '0'
workspace,actor,feed,version,project,map_package,map_file=[str(uuid.uuid4()) for _ in range(7)]
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
sql(main_database,f"""INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES('{project}','{workspace}','Synthetic upgrade project','{actor}');
INSERT INTO public.project_map_packages(id,request_id,workspace_id,project_id,requested_by,title,source,deliverable,state,upload_file_name)
VALUES('{map_package}','{uuid.uuid4()}','{workspace}','{project}','{actor}','Synthetic retained map package','upload','general','uploading','fixture.zip');
INSERT INTO public.project_map_package_files(id,package_id,workspace_id,project_id,role,name,object_path,bytes,sha256)
VALUES('{map_file}','{map_package}','{workspace}','{project}','package_zip','fixture.zip','{workspace}/{project}/{map_package}/fixture.zip',123,'{'0'*64}');""")
tables=['projects','project_map_packages','project_map_package_files','gtfs_feeds','gtfs_feed_versions','gtfs_route_service_levels','gtfs_stop_service_levels','gtfs_tract_service','gtfs_ingest_storage_cleanup']
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
ddl_parts=[]
for candidate_file in candidate_files:
    source=candidate_file.read_text();assert source.count('BEGIN;') == 1 and source.count('COMMIT;') == 1 and source.rstrip().endswith('COMMIT;')
    ddl_parts.append(source.replace('BEGIN;','',1).rsplit('COMMIT;',1)[0])
ddl='\n'.join(ddl_parts)
controls=[]
for name,extra,passes in [
 ('baseline','',True),('harmless','\n-- Harmless migration comment.',True),
 ('change-feed',f"\nUPDATE public.gtfs_feeds SET agency_name='Changed fixture' WHERE id='{feed}';",False),
 ('drop-existing-route',f"\nDELETE FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}';",False),
 ('rewrite-existing-status',f"\nUPDATE public.gtfs_feed_versions SET status='pending' WHERE id='{version}';",False),
 ('rewrite-map-package',f"\nUPDATE public.project_map_packages SET title='Changed fixture' WHERE id='{map_package}';",False),
 ('drop-map-file',f"\nDELETE FROM public.project_map_package_files WHERE id='{map_file}';",False),
 ('change-project',f"\nUPDATE public.projects SET name='Changed fixture' WHERE id='{project}';",False),
 ('restored','',True)]:
    observed=json.loads(sql(candidate_database,'BEGIN;\n'+ddl+extra+'\n'+snapshot+'ROLLBACK;'))
    try:
        assert observed == before, 'Existing project, map package or GTFS records changed'
    except AssertionError as error:
        assert not passes and str(error)=='Existing project, map package or GTFS records changed',name
        controls.append({'name':name,'result':'intended assertion failure','assertion':str(error)})
    else:
        assert passes,'Mutation survived '+name
        controls.append({'name':name,'result':'pass'})
assert json.loads(sql(candidate_database,snapshot)) == before
default = upgrade(candidate_database,root/'openplan','candidate-default',require_success=False)
check_default_refusal(default.returncode,default.stderr,versions(candidate_database),versions(main_database),json.loads(sql(candidate_database,snapshot)),before,sql(candidate_database,"SELECT to_regnamespace('openplan_gtfs') IS NULL;")=='t')
upgrade(candidate_database,root/'openplan','candidate-upgrade',include_all=True)
upgrade(candidate_database,root/'openplan','candidate-repeat')
expected=sorted(path.name.split('_')[0] for path in (root/'openplan/supabase/migrations').glob('*.sql'))
assert versions(candidate_database)==expected
assert json.loads(sql(candidate_database,snapshot)) == before
assert sql(candidate_database,'SELECT count(*) FROM openplan_gtfs.executions;') == '0'
assert sql(main_database,"SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';") == '0'
assert versions(main_database)==[path.name.split('_')[0] for path in main_files]
record={'mainHead':main_head,'cliVersion':cli_version,'mainMigrationCount':len(main_files),'candidateMigrationCount':len(expected),
        'mainMigrations':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in main_files},
        'candidateMigrations':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in candidate_files},
        'proofSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'defaultCliRefusedOlderMissingMigrations':True,'defaultRefusalPreservedRowsAndHistory':True,'includeAllAppliedOnlyReviewedGTFS':True,
        'controls':controls,'rowCounts':{table:len(rows) for table,rows in before.items()},
        'beforeSha256':hashlib.sha256((out/'before.json').read_bytes()).hexdigest(),
        'rowsUnchanged':True,'repeatMigrationNoChange':True,'existingImportsNotEnrolled':True,
        'scope':'CLI upgrade of a retained recorded predecessor through exact current-main files, then populated synthetic project, map package and GTFS upgrade to candidate. Not installation from empty platform, full archive restore, all deployment data or browser acceptance.'}
(out/'upgrade.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({key:record[key] for key in ['mainHead','mainMigrationCount','candidateMigrationCount','rowCounts','rowsUnchanged','repeatMigrationNoChange']}))
