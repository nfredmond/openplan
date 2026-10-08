"""Drop a real committed RPC reply, then recover through a fresh worker CLI."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from contextlib import ExitStack
from pathlib import Path
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import uuid
from unittest.mock import patch
import requests
from isolated_postgrest import gateway

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal


def verify(sql_source, output, worker=None):
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Select owned retention source')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    database = 'openplan_attempt_cli_' + uuid.uuid4().hex

    def sql(db, body):
        result = subprocess.run(['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], input=body, text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions')
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    (output / 'candidate.json').write_text(json.dumps({'container': source['container'], 'database': database, 'source_database': source['database']}, indent=2) + '\n')
    if sql_source is not None:
        sql(database, 'BEGIN;\n' + sql_source + '\nCOMMIT;')
    elif sql(database, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000020';") != '1':
        raise AssertionError('Installed skip migration required')
    fixture = str(uuid.UUID(source['fixture_run']))
    calls, cases = [], []
    fault = {'armed': False, 'change_blocker': None}
    with gateway('public', database=database) as connection:
        key = connection['service_token']

        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                if self.path != '/rest/v1/rpc/skip_blocked_model_stage' or self.headers.get('Authorization') != 'Bearer ' + key:
                    self.send_error(403)
                    return
                body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
                if fault['change_blocker'] is not None:
                    blocker_id = str(uuid.UUID(fault['change_blocker']))
                    sql(database, f"UPDATE public.model_run_stages SET status='succeeded' WHERE id='{blocker_id}';")
                    fault['change_blocker'] = None
                with requests.post(connection['url'] + '/rpc/skip_blocked_model_stage', data=body,
                    headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
                    timeout=15, allow_redirects=False) as response:
                    status, content = response.status_code, response.content
                calls.append({'method': 'POST', 'status': status, 'request_id': json.loads(body)['p_request_id']})
                if status == 200 and fault['armed']:
                    fault['armed'] = False
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def do_GET(self):
                if not self.path.startswith(('/rest/v1/model_runs?', '/rest/v1/model_run_stages?')) or self.headers.get('Authorization') != 'Bearer ' + key:
                    self.send_error(403)
                    return
                with requests.get(connection['url'] + self.path[len('/rest/v1'):],
                    headers={'Authorization': 'Bearer ' + key}, timeout=15, allow_redirects=False) as response:
                    status, content = response.status_code, response.content
                calls.append({'method': 'GET', 'status': status})
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

        server = HTTPServer(('127.0.0.1', 0), Bridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            for blocker_status, expected in [('failed', 'skipped'), ('succeeded', 'not_skipped')]:
                if worker is not None:
                    blocker_status = 'failed'
                run, stage, prior, request = [str(uuid.uuid4()) for _ in range(4)]
                workspace = sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic skip HTTP recovery',created_by
 FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('{prior}','{run}','Synthetic prerequisite','{blocker_status}',1),('{stage}','{run}','Synthetic dependent','queued',2);
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")
                workspace = str(uuid.UUID(workspace))
                command = {'request_id': request, 'destination': client.destination(base, database),
                    'operation': 'skip_blocked_model_stage', 'arguments': {'workspace_id': workspace,
                    'run_id': run, 'stage_id': stage, 'blocker_id': prior, 'blocker_status': 'failed'}}
                directory = output / expected
                fault['armed'] = True
                if worker is None:
                    try:
                        client.deliver(directory, command, base_url=base, deployment_id=database, service_key=key)
                    except client.DeliveryUnconfirmed:
                        pass
                    else:
                        raise AssertionError('Dropped reply reported confirmed')
                else:
                    observed = json.loads(sql(database, f"SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id='{stage}';"))
                    fault['change_blocker'] = prior if expected == 'not_skipped' else None
                    root_setting = 'RUN_WORK_ROOT' if worker.__name__ == 'main' else 'ACTIVITYSIM_WORK_DIR'
                    with ExitStack() as stack:
                        stack.enter_context(patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': database}))
                        stack.enter_context(patch.object(worker, 'SUPABASE_URL', base))
                        stack.enter_context(patch.object(worker, 'SUPABASE_KEY', key))
                        stack.enter_context(patch.object(worker, 'HEADERS', {'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}))
                        stack.enter_context(patch.object(worker, root_setting, str(directory)))
                        try:
                            worker.mark_stage_skipped(observed, 'Synthetic prior observation')
                        except worker.WorkerStateWriteUnconfirmed:
                            pass
                        else:
                            raise AssertionError('Worker did not stop after dropped reply')
                    journals = list(directory.rglob('model-commands.sqlite3'))
                    if len(journals) != 1:
                        raise AssertionError('Worker did not retain one command journal')
                    directory = journals[0].parent
                    pending = journal.pending(directory, client.destination(base, database))
                    if len(pending) != 1:
                        raise AssertionError('Worker did not preserve one unresolved decision')
                    command = pending[0]['command']
                    request = command['request_id']
                if fault['armed'] or journal.pending(directory, command['destination'])[0]['command'] != command:
                    raise AssertionError('Dropped native receipt did not leave original pending')
                if sql(database, f"SELECT count(*) FROM public.model_stage_skip_receipts WHERE request_id='{request}';") != '1':
                    raise AssertionError('Committed skip receipt missing')

                def native_state():
                    return sql(database, f"""SELECT jsonb_build_object(
 'parent',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{run}'),
 'stages',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s WHERE run_id='{run}'),
 'receipt',(SELECT to_jsonb(r) FROM public.model_stage_skip_receipts r WHERE request_id='{request}'),
 'starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),
 'attempts',(SELECT count(*) FROM public.model_stage_attempts WHERE run_id='{run}'));""")

                before = native_state()
                argv = [sys.executable, '-B', str(REPO / 'workers/aequilibrae_worker/model_command_recovery.py'),
                    '--journal', str(directory), '--base-url', base, '--deployment-id', database, '--request-id', request]
                recovered = subprocess.run(argv, env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': key}, text=True, capture_output=True, timeout=40)
                if recovered.returncode != 0 or json.loads(recovered.stdout) != {'request_id': request, 'outcome': 'command_receipt_retained', 'model_resumed': False}:
                    raise AssertionError('Fresh CLI did not recover exact skip receipt')
                if key in recovered.stdout or key in recovered.stderr:
                    raise AssertionError('Recovery disclosed credential')
                saved = journal.read_existing(directory, command['destination'], request)[0]
                if not saved['resolved'] or saved['response']['outcome'] != expected or journal.pending(directory, command['destination']):
                    raise AssertionError('Recovered skip outcome differs')
                if before != native_state():
                    raise AssertionError('Exact HTTP retry changed native records')
                start = len(calls)
                cached = subprocess.run(argv, env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': ''}, text=True, capture_output=True, timeout=15)
                if cached.returncode or len(calls) != start:
                    raise AssertionError('Cached fresh CLI sent another request')
                state = json.loads(before)
                if state['starts'] != 0 or state['attempts'] != 0:
                    raise AssertionError('Skip recovery invented execution')
                cases.append({'outcome': expected, 'committed_reply_dropped': True, 'fresh_cli_recovered': True,
                              'native_records_unchanged_by_retry': True, 'cached_cli_no_http': True})
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
    return {'cases': cases, 'http_calls': len(calls), 'rpc_calls': sum(call['method'] == 'POST' for call in calls),
            'worker_read_calls': sum(call['method'] == 'GET' for call in calls), 'gateway_removed': True,
            'worker': None if worker is None else worker.__name__}


def main():
    source = (ROOT / 'skip-blocked-stage.sql').read_text()
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    anchor = 'VALUES(p_request_id,p_run_id,p_stage_id,p_blocker_id,request,response);'
    if source.count(anchor) != 1:
        raise AssertionError('Receipt mutation anchor changed')
    broken = source.replace(anchor, 'SELECT p_request_id,p_run_id,p_stage_id,p_blocker_id,request,response WHERE false;')
    records = []
    for name, body in [('baseline', source), ('harmless', source + '\n-- Harmless comment.\n'), ('missing-receipt', broken), ('restored', source)]:
        try:
            result = verify(body, root / name)
        except AssertionError as error:
            if name != 'missing-receipt' or str(error) != 'Committed skip receipt missing':
                raise
            records.append({'control': name, 'expected_failure': str(error)})
        else:
            if name == 'missing-receipt':
                raise AssertionError('Missing retained receipt passed')
            records.append({'control': name, 'result': result})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': records,
              'limits': 'Native committed skip RPC and fresh CLI recovery through a loopback fault bridge. No installation migration, normal dispatcher, model computation, browser or scientific acceptance.'}
    (root / 'skip-http-recovery.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
