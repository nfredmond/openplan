"""Commit a full worker lifecycle in an owned clone and kill before its final reply."""
from pathlib import Path
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
import requests

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent/'2026-10-09-gtfs-ingest-recovery'))
sys.path.insert(0, str(here.parent/'2026-10-08-model-custody-metadata/prototype'))
from isolated_storage import storage
from isolated_postgrest import gateway

source_config = json.loads(Path(sys.argv[1]).read_text())
assert source_config['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}', source_config['database'])
archive = Path(sys.argv[2]).resolve(strict=True)
out = Path(sys.argv[3]).resolve()
out.mkdir(mode=0o700, parents=True, exist_ok=False)
config = {**source_config, 'database': 'openplan_attempt_cli_'+uuid.uuid4().hex}
# This fresh clone is retained for inspection and later native fencing checks.
(out/'database.json').write_text(json.dumps(config)+'\n'); (out/'database.json').chmod(0o600)

def sql(query, database=None, timeout=20):
    result = subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',database or config['database'],
                             '-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr[:4000])
    return result.stdout.strip()

assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';", source_config['database']) == '0'
assert sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();", source_config['database']) == '0'
sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source_config["database"]};', 'postgres', 30)
source = root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
sql(source.read_text(), timeout=30)
baseline = json.loads(sql("SELECT jsonb_build_object('migrationRecords', (SELECT count(*) FROM supabase_migrations.schema_migrations), 'latestMigrationRecord', (SELECT max(version) FROM supabase_migrations.schema_migrations), 'postgres', current_setting('server_version'), 'bytes', pg_database_size(current_database()));"))
recorded_versions = set(sql('SELECT version FROM supabase_migrations.schema_migrations;').splitlines())
baseline['filesWithoutMigrationRecord'] = sorted(path.name for path in source.parent.glob('*.sql') if path.name.split('_')[0] not in recorded_versions)
baseline['boundary'] = 'Candidate DDL is applied directly to an owned clone. Missing migration records are listed; source schema custody belongs to its separate upgrade record. This is not an empty-platform installation or restore proof.'
workspace, actor = str(uuid.uuid4()), str(uuid.uuid4())
sql(f"""INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic native worker recovery','proof-{workspace}');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');""")
loader = ['node','--import',str(root/'openplan/node_modules/tsx/dist/loader.mjs'),str(here/'verify_worker_database.mts')]
directory = out/'worker'
runs = []

def snapshot(version):
    version = str(uuid.UUID(version))
    return f"""SELECT jsonb_build_object(
      'version', (SELECT jsonb_build_object('status',status,'routeCount',route_count,'stopCount',stop_count,'current',is_current,'routeRows',route_service_level_rows,'stopRows',stop_service_level_rows,'tractRows',tract_service_rows) FROM public.gtfs_feed_versions WHERE id='{version}'),
      'execution', (SELECT jsonb_build_object('state',state,'attempt',attempt,'token',token) FROM openplan_gtfs.executions WHERE version_id='{version}'),
      'feedPointer', (SELECT current_version_id FROM public.gtfs_feeds WHERE id=(SELECT feed_id FROM public.gtfs_feed_versions WHERE id='{version}')),
      'routes', (SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}'),
      'stops', (SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id='{version}'),
      'routeHash', (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'')) FROM public.gtfs_route_service_levels r WHERE feed_version_id='{version}'),
      'stopHash', (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'')) FROM public.gtfs_stop_service_levels r WHERE feed_version_id='{version}'),
      'batches', (SELECT count(*) FROM openplan_gtfs.batch_receipts WHERE version_id='{version}'),
      'completion', (SELECT jsonb_agg(to_jsonb(r)) FROM openplan_gtfs.completion_receipts r WHERE version_id='{version}'),
      'writeContexts', (SELECT count(*) FROM openplan_gtfs.write_context));"""

def check_snapshot(row):
    assert row['version']['status'] == 'ready', 'Committed ready status missing'
    assert row['execution']['state'] == 'ready', 'Committed ready execution missing'
    assert row['version']['routeCount'] == 14 and row['version']['stopCount'] == 287, 'Parser counts changed'
    assert row['routes'] == row['version']['routeRows'] == 95, 'Stored route rows incomplete'
    assert row['stops'] == row['version']['stopRows'] == 717, 'Stored stop rows incomplete'
    assert row['version']['current'] is False and row['feedPointer'] is None, 'Completion adopted without a decision'
    assert row['batches'] == 9, 'Batch receipts incomplete'
    assert len(row['completion'] or []) == 1, 'Completion receipt missing or duplicated'
    assert row['writeContexts'] == 0, 'Write context leaked'

with storage(config) as native, gateway('public', database=config['database'], subjects=(actor,)) as rest:
    env = {**os.environ, 'NODE_OPTIONS':'--max-old-space-size=512',
           'OPENPLAN_PROOF_HTTP_URL':rest['url'], 'OPENPLAN_PROOF_HTTP_TOKEN':rest['service_token'],
           'OPENPLAN_PROOF_STORAGE_URL':native['url'], 'OPENPLAN_PROOF_STORAGE_TOKEN':native['token'],
           'OPENPLAN_PROOF_WORKSPACE':workspace, 'OPENPLAN_PROOF_ACTOR':actor,
           'OPENPLAN_PROOF_PARSER_BUILD':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()}
    def run(mode):
        child = subprocess.Popen(loader+[str(directory),mode,str(archive)],cwd=root/'openplan',env=env,
                                 text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try:
            if mode.startswith('interrupt'):
                deadline = time.monotonic()+55
                marker = directory/'committed-before-kill.json'
                while not marker.exists() and child.poll() is None and time.monotonic()<deadline:
                    time.sleep(.05)
                assert marker.exists(), 'Worker did not reach committed completion'
                os.killpg(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate(timeout=60)
            (out/f'{mode}.log').write_text(stdout+stderr)
            expected = -signal.SIGKILL if mode.startswith('interrupt') else 0
            assert child.returncode == expected, (mode, child.returncode, stderr[:3000])
            return json.loads(stdout) if stdout.strip() else None
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL); stdout,stderr=child.communicate(timeout=10)
                (out/f'{mode}.log').write_text(stdout+stderr)
    run('seed')
    try:
        identity = json.loads((directory/'identity.json').read_text())
        version = identity['versionId']
        run('interrupt')
        committed = json.loads((directory/'committed-before-kill.json').read_text())
        pending_path = directory/'commands/command-terminal/pending.json'
        pending = json.loads(pending_path.read_text())
        assert pending['resolved'] is False and pending['receipt'] is None, 'Reply retained before deliberate kill'
        assert committed['downloads'] == 1 and committed['workCalls'] == 1
        before = json.loads(sql(snapshot(version))); check_snapshot(before)
        assert before['completion'][0]['command_id'] == committed['command']
        assert before['completion'][0]['response'] == committed['receipt']
        completion_args = json.loads((directory/'completion-request.json').read_text())
        batch = json.loads((directory/'commands/command-route-0/pending.json').read_text())
        batch_input = batch['payload']['arguments']['input']
        batch_args = {'p_version':version,'p_token':batch['identity']['token'],'p_command':str(uuid.uuid4()),
                      'p_kind':batch_input['kind'],'p_ordinal':batch_input['ordinal'],'p_rows':batch_input['rows']}
        changed_metadata = {**completion_args, 'p_metadata':{**completion_args['p_metadata'],'route_count':13}}
        http_refusals = []
        requests_to_refuse = [
          ('anonymous-completion', 'rpc/complete_gtfs_ingest', rest['anon_token'], completion_args, '42501'),
          ('member-completion', 'rpc/complete_gtfs_ingest', rest['authenticated_tokens'][actor], completion_args, '42501'),
          ('changed-completion-replay', 'rpc/complete_gtfs_ingest', rest['service_token'], changed_metadata, '22023'),
          ('new-completion-after-close', 'rpc/complete_gtfs_ingest', rest['service_token'], {**completion_args,'p_command':str(uuid.uuid4())}, '55000'),
          ('batch-after-close', 'rpc/write_gtfs_ingest_batch', rest['service_token'], batch_args, '55000'),
          ('direct-service-row-write', 'gtfs_route_service_levels', rest['service_token'], batch_input['rows'][0], '55000'),
        ]
        for name, endpoint, credential, payload, code in requests_to_refuse:
            response = requests.post(rest['url']+'/'+endpoint, headers={'Authorization':'Bearer '+credential}, json=payload, timeout=10)
            assert response.status_code >= 400 and response.json().get('code') == code, (name,response.status_code,response.text[:500])
            assert json.loads(sql(snapshot(version))) == before, 'Refused request changed committed database'
            http_refusals.append({'name':name,'status':response.status_code,'code':code,'databaseUnchanged':True})
        for mode in ['recover','retained']:
            row = run(mode); after = json.loads(sql(snapshot(version))); check_snapshot(after)
            assert after == before, 'Recovery changed committed rows or receipts'
            runs.append(row)
        # Independent SQL observation must detect real corruption and ignore an
        # irrelevant timestamp change. Every mutation rolls back in this clone.
        controls = []
        variants = [
          ('harmless-timestamp', f"UPDATE public.gtfs_feed_versions SET updated_at=clock_timestamp() WHERE id='{version}';", None),
          ('public-status', f"UPDATE public.gtfs_feed_versions SET status='parsing' WHERE id='{version}';", 'Committed ready status missing'),
          ('execution-state', f"UPDATE openplan_gtfs.executions SET state='running' WHERE version_id='{version}';", 'Committed ready execution missing'),
          ('silent-adoption', f"UPDATE public.gtfs_feed_versions SET is_current=true WHERE id='{version}';", 'Completion adopted without a decision'),
          ('missing-route', f"DELETE FROM public.gtfs_route_service_levels WHERE id=(SELECT id FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}' LIMIT 1);", 'Stored route rows incomplete'),
          ('missing-stop', f"DELETE FROM public.gtfs_stop_service_levels WHERE id=(SELECT id FROM public.gtfs_stop_service_levels WHERE feed_version_id='{version}' LIMIT 1);", 'Stored stop rows incomplete'),
          ('parser-count', f"UPDATE public.gtfs_feed_versions SET route_count=13 WHERE id='{version}';", 'Parser counts changed'),
          ('missing-completion', f"DELETE FROM openplan_gtfs.completion_receipts WHERE version_id='{version}';", 'Completion receipt missing or duplicated'),
          ('missing-batch', f"DELETE FROM openplan_gtfs.batch_receipts WHERE command_id=(SELECT command_id FROM openplan_gtfs.batch_receipts WHERE version_id='{version}' LIMIT 1);", 'Batch receipts incomplete'),
        ]
        for name, change, expected in variants:
            observed = json.loads(sql("BEGIN; SET LOCAL session_replication_role='replica';"+change+snapshot(version)+'ROLLBACK;'))
            try:
                check_snapshot(observed)
            except AssertionError as error:
                assert expected is not None and str(error) == expected, (name,str(error))
                controls.append({'name':name,'result':'intended assertion failure','assertion':str(error)})
            else:
                assert expected is None, 'Corruption survived '+name
                controls.append({'name':name,'result':'pass'})
        restored = json.loads(sql(snapshot(version))); check_snapshot(restored); assert restored == before
    finally:
        run('cleanup')
    directory = out/'batch-worker'
    run('seed')
    try:
        batch_identity = json.loads((directory/'identity.json').read_text())
        batch_version = batch_identity['versionId']
        run('interrupt-batch')
        partial = json.loads(sql(snapshot(batch_version)))
        assert partial['version']['status'] == 'parsing' and partial['execution']['state'] == 'running'
        assert partial['routes'] == 95 and partial['stops'] == 0 and partial['batches'] == 1
        assert partial['completion'] is None and partial['writeContexts'] == 0
        original_output = json.loads((directory/'artifact/pending.json').read_text())['output']
        batch_pending = json.loads((directory/'commands/command-route-0/pending.json').read_text())
        assert batch_pending['resolved'] is False and batch_pending['receipt'] is None
        resumed = run('resume-batch')
        completed_batch = json.loads(sql(snapshot(batch_version))); check_snapshot(completed_batch)
        assert completed_batch['routeHash'] == partial['routeHash'], 'Recovery replaced committed route rows'
        assert json.loads((directory/'artifact/pending.json').read_text())['output'] == original_output, 'Recovery reparsed the saved artifact'
        retained_batch = run('retained-batch')
        assert json.loads(sql(snapshot(batch_version))) == completed_batch
        batch_recovery = {'partialBeforeKill':partial,'completed':completed_batch,'resume':resumed,
                          'retained':retained_batch,'artifactUnchanged':True,'committedRouteRowsUnchanged':True}
    finally:
        run('cleanup')
assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';",source_config['database']) == '0'
sources = ['parsed-artifact','managed-worker-publication','managed-worker-service','managed-worker-artifact',
           'managed-worker-attempt','managed-worker-dispatch','managed-worker-journal']
record = {'proofSources':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),Path(__file__).with_suffix('.mts')]},
          'migrationSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
          'sources':{name:hashlib.sha256((root/f'openplan/src/lib/gtfs/{name}.ts').read_bytes()).hexdigest() for name in sources},
          'baseline':baseline, 'archiveSha256':identity['archive']['sha256'],'archiveBytes':identity['archive']['bytes'],
          'committedBeforeKill':committed,'databaseBeforeRecovery':before,'runs':runs,'databaseUnchangedAfterRecovery':True,
          'partialBatchRecovery':batch_recovery,'observationControls':controls,'httpRefusals':http_refusals,'sourceCandidateSchemaAbsent':True,'ownedHttpAndStorageRemoved':True,
          'scope':'Actual committed PostgreSQL lifecycle RPCs through PostgREST, native isolated Storage, parser child and worker kill before final acknowledgement. Fresh clone retained privately. No browser, adoption, concurrent replacement, scientific, practitioner or full release acceptance.'}
(out/'native.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'nativeCompletion':True,'killedBeforeAcknowledgement':True,'freshProcessRecovery':True,
                  'routes':before['routes'],'stops':before['stops'],'observationControls':len(controls)}))
