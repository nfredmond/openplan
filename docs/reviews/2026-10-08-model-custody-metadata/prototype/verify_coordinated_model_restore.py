"""Restore an owned PostgreSQL dump and local records after a committed lost reply.

Synthetic data, one legacy KPI command and an interrupted local computation.
Does not resume a stage, restore Storage, or establish scientific acceptance.
"""
from contextlib import closing
from http.server import BaseHTTPRequestHandler, HTTPServer
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import threading
import uuid

import requests
from isolated_postgrest import gateway
from verify_worker_local_restore import snapshot

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal
import model_legacy_kpi_command as kpi
import model_stage_computation as computation


def verify():
    os.umask(0o077)
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    container = meta['container']
    if container != os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER') or container != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the owned restore container explicitly')
    if not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select the populated retention upgrade proof source')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source, restored = ('openplan_attempt_cli_' + uuid.uuid4().hex for _ in range(2))
    record = {'container': container, 'source': source, 'restored': restored,
              'template': meta['database'], 'status': 'preparing'}
    (output / 'candidate.json').write_text(json.dumps(record, indent=2) + '\n')

    def sql(database, statement):
        result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True, timeout=60)
        if result.returncode:
            (output / 'failed-sql.log').write_text(result.stderr)
            raise RuntimeError('Proof query failed; inspect private failed-sql.log')
        return result.stdout.strip()

    def no_sessions(database):
        if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{database}';") != '0':
            raise RuntimeError('Owned proof database has sessions; do not interrupt them')

    if sql(meta['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000018':
        raise ValueError('Source lacks retention migration')
    migration = REPO / 'openplan/supabase/migrations/20261016000018_model_execution_retention.sql'
    if hashlib.sha256(migration.read_bytes()).hexdigest() != meta['migration_sha256']:
        raise ValueError('Source migration digest differs')
    no_sessions(meta['database'])
    sql('postgres', f'CREATE DATABASE {source} TEMPLATE {meta["database"]};')
    run, stage = (str(uuid.uuid4()) for _ in range(2))
    fixture = str(uuid.UUID(meta['fixture_run']))
    workspace = str(uuid.UUID(sql(source, f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic coordinated restore',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;")))
    sql(source, f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic restore','queued',1); UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued'; UPDATE public.model_runs SET status='running' WHERE id='{run}';")
    local = output / 'worker-before'
    local.mkdir()
    (local / 'files').mkdir()
    (local / 'files/input.json').write_bytes(b'{"synthetic":true}\n')
    (local / 'files/output.bin').write_bytes(bytes(range(256)))
    proxy = {'connection': None, 'drop': True}
    calls, errors, replies = [], [], []

    class Bridge(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            try:
                connection = proxy['connection']
                if connection is None or self.path != '/rest/v1/rpc/record_legacy_model_kpi':
                    raise AssertionError('Unexpected proof route')
                if self.headers.get('Authorization') != 'Bearer ' + connection['service_token']:
                    raise AssertionError('Unexpected proof credential')
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length < 131072:
                    raise AssertionError('Unexpected proof body')
                body = self.rfile.read(length)
                with requests.post(connection['url'] + '/rpc/record_legacy_model_kpi', data=body, headers={'Authorization': self.headers['Authorization'], 'Content-Type': 'application/json'}, timeout=15, allow_redirects=False) as response:
                    status, content = response.status_code, response.content
                calls.append({'status': status, 'body_sha256': hashlib.sha256(body).hexdigest()})
                if status != 200:
                    raise AssertionError('Native command did not commit successfully')
                replies.append(json.loads(content))
                if proxy['drop']:
                    proxy['drop'] = False
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except Exception as error:
                errors.append(type(error).__name__)
                self.close_connection = True

    bridge = HTTPServer(('127.0.0.1', 0), Bridge)
    thread = threading.Thread(target=bridge.serve_forever, daemon=True)
    thread.start()
    scope = {'base_url': 'http://127.0.0.1:' + str(bridge.server_port), 'deployment_id': 'synthetic-installation-' + uuid.uuid4().hex}
    bound = client.destination(**scope)
    command = kpi.prepare(local, workspace, {'run_id': run, 'stage_id': stage, 'kpi_name': 'probe', 'kpi_label': 'Restore probe', 'kpi_category': 'assignment', 'value': 12.5, 'unit': 'vehicles', 'geometry_ref': None, 'breakdown_json': None}, name='probe', **scope)
    computation_args = dict(**scope, run_id=run, stage_id=stage, name='protected', inputs={'synthetic': True})
    class Interrupted(Exception):
        pass
    def interrupted():
        raise Interrupted()
    try:
        computation.compute_once(local, **computation_args, compute=interrupted)
    except Interrupted:
        pass

    def recover(directory, connection, *, wrong_identity=False):
        result = subprocess.run([sys.executable, str(REPO / 'workers/aequilibrae_worker/model_command_recovery.py'), '--journal', str(directory), '--base-url', scope['base_url'], '--deployment-id', scope['deployment_id'] + ('-other' if wrong_identity else ''), '--request-id', command['request_id']], capture_output=True, text=True, timeout=45, env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': connection['service_token']})
        return result.returncode, json.loads(result.stdout)

    tables = ('model_runs', 'model_run_stages', 'model_run_kpis', 'model_legacy_kpi_receipts', 'model_stage_execution_starts', 'model_execution_custody_enrollment', 'model_stage_attempts', 'model_stage_claim_receipts')
    def inventory(database):
        return {name: json.loads(sql(database, f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.{name} t;")) for name in tables}

    try:
        with gateway('public', database=source) as connection:
            proxy['connection'] = connection
            code, response = recover(local, connection)
            if code != 2 or response['outcome'] != 'delivery_unconfirmed' or len(replies) != 1:
                raise AssertionError('Committed reply loss was not retained as uncertainty')
        proxy['connection'] = None
        no_sessions(source)
        pending = journal.read_existing(local, bound, command['request_id'])
        if len(pending) != 1 or pending[0]['resolved']:
            raise AssertionError('Lost reply did not leave the original pending command')
        before = inventory(source)
        if len([r for r in before['model_run_kpis'] if r['id'] == command['request_id']]) != 1:
            raise AssertionError('Lost reply did not commit exactly one KPI')
        if len([r for r in before['model_stage_execution_starts'] if r['run_id'] == run]) != 1:
            raise AssertionError('Source execution start missing')
        dump = output / 'postgres.dump'
        with dump.open('xb') as handle:
            subprocess.run(['docker', 'exec', container, 'pg_dump', '-U', 'supabase_admin', '-d', source, '--format=custom'], stdout=handle, stderr=subprocess.PIPE, check=True, timeout=120)
        recovered_local = output / 'worker-restored'
        snapshot(local, recovered_local)
        if inventory(source) != before:
            raise AssertionError('Source changed during coordinated backup')
        no_sessions(source)
        sql('postgres', f'CREATE DATABASE {restored} TEMPLATE template0;')
        with dump.open('rb') as handle:
            result = subprocess.run(['docker', 'exec', '-i', container, 'pg_restore', '-U', 'supabase_admin', '-d', restored, '--exit-on-error', '--single-transaction'], stdin=handle, capture_output=True, timeout=120)
        if result.returncode:
            (output / 'failed-restore.log').write_bytes(result.stderr)
            raise RuntimeError('Native restore failed; inspect private failed-restore.log')
        if inventory(restored) != before:
            raise AssertionError('Restored model rows differ before recovery')
        # Harmless serialization changes must not invalidate row evidence.
        if json.loads(json.dumps(before, sort_keys=True)) != inventory(restored):
            raise AssertionError('Harmless inventory serialization changed comparison')
        controls = []
        for table, predicate in (
            ('model_run_kpis', f"id='{command['request_id']}'"),
            ('model_stage_execution_starts', f"run_id='{run}'"),
        ):
            # Only this disposable restored database is mutated. Rollback also
            # restores trigger behavior; the native image remains unchanged.
            damaged = json.loads(sql(restored, f"BEGIN; SET LOCAL session_replication_role=replica; DELETE FROM public.{table} WHERE {predicate}; SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.{table} t; ROLLBACK;"))
            if damaged == before[table]:
                raise AssertionError('Incomplete-restore control survived row comparison')
            if inventory(restored) != before:
                raise AssertionError('Control did not roll back')
            controls.append({'missing_table_record': table, 'row_comparison_refused': True})
        for file in (local / 'files').iterdir():
            if file.read_bytes() != (recovered_local / 'files' / file.name).read_bytes():
                raise AssertionError('Restored local bytes differ')
        if journal.read_existing(recovered_local, bound, command['request_id']) != pending:
            raise AssertionError('Restored pending command differs')
        called = []
        def forbidden():
            called.append(True)
            return {}
        try:
            computation.compute_once(recovered_local, **computation_args, compute=forbidden)
        except computation.ComputationUnconfirmed:
            pass
        else:
            raise AssertionError('Restored computation replay accepted')
        if called:
            raise AssertionError('Protected computation ran again')
        with gateway('public', database=restored) as connection:
            proxy['connection'] = connection
            count = len(calls)
            if recover(recovered_local, connection, wrong_identity=True)[0] != 3 or len(calls) != count:
                raise AssertionError('Wrong installation was not refused before transport')
            code, response = recover(recovered_local, connection)
            if code != 0 or response != {'request_id': command['request_id'], 'outcome': 'command_receipt_retained', 'model_resumed': False}:
                raise AssertionError('Fresh process did not recover the pending receipt')
            if len(calls) != count + 1 or replies[0] != replies[1] or calls[0] != calls[1]:
                raise AssertionError('Recovery changed the original request or receipt')
            if inventory(restored) != before:
                raise AssertionError('Recovery duplicated or changed model rows')
            count = len(calls)
            if recover(recovered_local, connection)[0] != 0 or len(calls) != count:
                raise AssertionError('Resolved local receipt caused another request')
        if errors:
            raise AssertionError('Proof bridge failed: ' + ','.join(errors))
        record.update(status='coordinated synthetic restore and fresh-process receipt recovery passed', dump_sha256=hashlib.sha256(dump.read_bytes()).hexdigest(), compared_tables={key: len(value) for key, value in before.items()}, http_requests=len(calls), incomplete_restore_controls=controls, original_receipt_equal=True, wrong_installation_refused=True, computation_replay_refused=True, source_unchanged=inventory(source) == before, scope='Full native PostgreSQL dump and restore in one owned cluster; eight model table inventories, synthetic local files, pending legacy KPI and interrupted computation. Same logical installation URL retained through a private bridge. No physical host recovery, Storage, real worker quiescence, current managed-attempt ownership, full dispatcher, browser or scientific acceptance.')
        (output / 'candidate.json').write_text(json.dumps(record, indent=2) + '\n')
        return record
    finally:
        proxy['connection'] = None
        bridge.shutdown()
        bridge.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
