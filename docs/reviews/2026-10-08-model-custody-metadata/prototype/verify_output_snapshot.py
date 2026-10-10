"""Observe a reader paused between parent and output reads while reaping commits.

Uses private table copies, without original application triggers, foreign keys
or RLS. The injected advisory wait is test instrumentation, not installed code.
"""
from pathlib import Path
import json
import os
import re
import selectors
import subprocess
import time
import uuid

container = os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER', '')
if not re.fullmatch(r'supabase_db_openplan-restore-target-[1-9][0-9]*', container):
    raise SystemExit('Select a named disposable restore-target container explicitly')
root = Path(__file__).resolve().parent
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
source = '\n'.join((root / name).read_text() for name in ('claim.sql', 'write.sql', 'reap.sql', 'kpi.sql', 'artifact.sql'))
reader_source = (root / 'read-outputs.sql').read_text()


def sql(statement):
    return subprocess.run(command, input=statement, text=True, capture_output=True, timeout=20, check=True).stdout.strip()


def ready(process):
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(12):
            raise RuntimeError('Owned snapshot session did not become ready')
    if process.stdout.readline().strip() != 'ready':
        raise RuntimeError('Owned snapshot session closed before ready')


def check(candidate):
    schema = 'attempt_snapshot_' + uuid.uuid4().hex
    run, stage, workspace = [str(uuid.uuid4()) for _ in range(3)]
    key = int(uuid.uuid4().hex[:14], 16)
    holder = reader = None
    try:
        tables = ('model_runs', 'model_run_stages', 'model_run_kpis', 'model_run_artifacts')
        definitions = '\n'.join(f'CREATE TABLE {schema}.{name} (LIKE public.{name} INCLUDING ALL);' for name in tables)
        instrumented = candidate.replace(' WITH outputs AS (', f' PERFORM pg_advisory_xact_lock({key});\n WITH outputs AS (')
        assert instrumented != candidate
        sql(f'CREATE SCHEMA {schema};\n' + definitions + f'\nGRANT USAGE ON SCHEMA {schema} TO service_role;\n' + (source + '\n' + instrumented).replace('public.', schema + '.') + f'''
INSERT INTO {schema}.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
VALUES('{run}','{workspace}',gen_random_uuid(),'aequilibrae','queued','Synthetic snapshot',gen_random_uuid());
INSERT INTO {schema}.model_run_stages(id,run_id,stage_name,status,sort_order)
VALUES('{stage}','{run}','Synthetic snapshot','queued',1);
''')
        attempt = json.loads(sql(f"SET ROLE service_role; SELECT {schema}.claim_model_stage_attempt('{uuid.uuid4()}','{stage}','snapshot-worker');"))['attempt_id']
        sql(f"SET ROLE service_role; SELECT {schema}.write_model_attempt_kpi('{uuid.uuid4()}','{attempt}','{{\"kpi_name\":\"snapshot\",\"kpi_label\":\"Snapshot\",\"value\":null}}');")
        holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        holder.stdin.write(f"SET idle_session_timeout=20000; DO $$ BEGIN PERFORM pg_advisory_lock({key}); END; $$; SELECT 'ready';\n")
        holder.stdin.flush()
        ready(holder)
        read_call = f"{schema}.read_model_attempt_outputs('{run}','{workspace}')"
        reader = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        reader.stdin.write(f"SET application_name='{schema}'; SET statement_timeout=15000; SET ROLE service_role; SELECT {read_call};")
        reader.stdin.close()
        reader.stdin = None
        blocked = False
        for _ in range(40):
            if sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{schema}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);") == 't':
                blocked = True
                break
            if reader.poll() is not None:
                break
            time.sleep(0.05)
        if not blocked:
            raise AssertionError('reader never paused between queries')
        if sql(f"SET ROLE service_role; SELECT {schema}.reap_model_run_if_stale('{run}',clock_timestamp(),'Synthetic snapshot revoke');") != 't':
            raise AssertionError('concurrent reaper did not commit')
        holder.stdin.write('\\q\n')
        holder.stdin.flush()
        holder.stdin.close()
        holder.stdin = None
        _, error = holder.communicate(timeout=15)
        if holder.returncode:
            raise RuntimeError(error)
        output, error = reader.communicate(timeout=15)
        if reader.returncode:
            raise RuntimeError(error)
        before = json.loads(output)
        after = json.loads(sql(f'SET ROLE service_role; SELECT {read_call};'))
        if before['run_status'] != 'running' or len(before['outputs']) != 1 or before['outputs'][0]['ownership_state'] != 'current_in_progress':
            raise AssertionError('mixed output snapshot')
        if after['run_status'] != 'failed' or len(after['outputs']) != 1 or after['outputs'][0]['ownership_state'] != 'retained_inactive':
            raise AssertionError('fresh read missed committed revocation')
        if before['outputs'][0]['record'] != after['outputs'][0]['record']:
            raise AssertionError('read or reaper mutated retained output')
        return {'blocked_observed': True, 'one_snapshot_preserved': True, 'fresh_read_observes_revocation': True}
    finally:
        for process in (holder, reader):
            if process is not None and process.poll() is None:
                if process.stdin is not None:
                    process.stdin.close()
                    process.stdin = None
                process.communicate(timeout=25)
        sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE;')
        if sql(f"SELECT to_regnamespace('{schema}') IS NULL;") != 't':
            raise RuntimeError('Private snapshot schema remains')


results = []
for name, candidate, expected in (
    ('baseline', reader_source, None),
    ('harmless', reader_source + '\n-- Harmless snapshot control.\n', None),
    ('volatile-reader', reader_source.replace('plpgsql STABLE', 'plpgsql VOLATILE'), 'mixed output snapshot'),
    ('restored', reader_source, None),
):
    try:
        evidence = check(candidate)
    except AssertionError as error:
        if str(error) != expected:
            raise
        results.append({'control': name, 'detected': str(error)})
    else:
        if expected:
            raise AssertionError(f'{name}: defect not detected')
        results.append({'control': name, **evidence})
print(json.dumps(results, indent=2))
