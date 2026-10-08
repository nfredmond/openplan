"""Verify a fresh read-only CLI against a synthetic native managed claim.

No model computation, scientific acceptance, restart or operator reconciliation.
"""
from contextlib import closing
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import uuid

import requests
from isolated_postgrest import gateway

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_command_client as client


def verify():
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if (source['container'] != 'supabase_db_openplan-restore-target-2026091050'
            or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database'])):
        raise ValueError('An owned installed retention proof database is required')
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    database = 'openplan_attempt_cli_' + uuid.uuid4().hex

    def query(db, statement):
        result = subprocess.run(['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt',
                                 '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'],
                                input=statement, text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    query('postgres', f"CREATE DATABASE {database} TEMPLATE {source['database']};")
    (root / 'candidate.json').write_text(json.dumps({'database': database, 'container': source['container'],
                                                   'source_database': source['database']}, indent=2) + '\n')
    run, stage = str(uuid.uuid4()), str(uuid.uuid4())
    fixture = str(uuid.UUID(source['fixture_run']))
    query(database, f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','SYNTHETIC ownership CLI proof',created_by FROM public.model_runs WHERE id='{fixture}'; INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','SYNTHETIC no computation','queued',1);")
    workspace = str(uuid.UUID(query(database, f"SELECT workspace_id FROM public.model_runs WHERE id='{run}';")))
    directory = root / 'journal'
    calls = []
    with gateway('public', database=database) as connection:
        key = connection['service_token']

        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def forward(self):
                if not self.path.startswith('/rest/v1/') or self.headers.get('Authorization') != 'Bearer ' + key:
                    self.send_error(403)
                    return
                body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
                headers = {name: self.headers[name] for name in ('Authorization', 'Content-Type') if self.headers.get(name)}
                with requests.request(self.command, connection['url'] + self.path[len('/rest/v1'):],
                                      data=body or None, headers=headers, timeout=15, allow_redirects=False) as response:
                    status, content = response.status_code, response.content
                calls.append({'method': self.command, 'path': self.path, 'status': status})
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            do_GET = forward
            do_POST = forward

        server = HTTPServer(('127.0.0.1', 0), Bridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            claim = {'request_id': str(uuid.uuid4()), 'destination': client.destination(base, database),
                     'operation': 'claim_model_stage_attempt',
                     'arguments': {'run_id': run, 'stage_id': stage, 'worker_id': 'synthetic-ownership-cli'}}
            receipt = client.deliver(directory, claim, base_url=base, deployment_id=database, service_key=key)
            assert receipt['outcome'] == 'claimed'

            def state():
                with closing(sqlite3.connect(directory / 'model-commands.sqlite3')) as db:
                    rows = db.execute('SELECT * FROM commands ORDER BY request_id').fetchall()
                database_state = query(database, f"SELECT jsonb_build_object('run',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{run}'),'stage',(SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id='{stage}'),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a WHERE run_id='{run}')); ")
                return rows, database_state

            records = []
            def inspect(label, expected, scope=workspace, credential=key):
                before, start = state(), len(calls)
                result = subprocess.run([sys.executable, '-B', str(REPO / 'workers/aequilibrae_worker/model_command_recovery.py'),
                                         '--journal', str(directory), '--base-url', base, '--deployment-id', database,
                                         '--inspect-ownership', claim['request_id'], '--workspace-id', scope],
                                        env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': credential},
                                        capture_output=True, text=True, timeout=40)
                data = json.loads(result.stdout)
                assert state() == before, 'Inspection changed journal or native run/stage/attempt rows'
                assert all(call['method'] == 'GET' for call in calls[start:]), 'Inspection sent a write'
                assert data['model_resumed'] is False and data['continuation_authorized'] is False
                assert key not in result.stdout and key not in result.stderr
                if expected is None:
                    assert result.returncode == 2 and data['outcome'] == 'ownership_unconfirmed', data
                else:
                    assert result.returncode == 0 and data['ownership']['owns_stage'] is expected, data
                    assert data['point_in_time_only'] is True
                    assert data['run_id'] == run and data['stage_id'] == stage and data['workspace_id'] == workspace
                records.append({'case': label, 'exit': result.returncode, 'result': data, 'read_only': True})

            inspect('active_claim', True)
            inspect('wrong_workspace', None, scope=str(uuid.uuid4()))
            inspect('invalid_credential', None, credential='synthetic-invalid')
            completion = {'request_id': str(uuid.uuid4()), 'destination': claim['destination'],
                          'operation': 'write_model_stage_attempt',
                          'arguments': {'run_id': run, 'stage_id': stage, 'attempt_id': receipt['attempt_id'],
                                        'status': 'succeeded', 'log_tail': 'SYNTHETIC no computation', 'error': None}}
            client.deliver(directory, completion, base_url=base, deployment_id=database, service_key=key)
            inspect('completed_attempt', False)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
    result = {'cases': records, 'http_requests': len(calls), 'gateway_removed': True,
              'boundary': 'Fresh CLI, native installed database, scoped authenticated HTTP, real retained claim. Synthetic explicit completion only. No engine execution, restart, scientific or human acceptance.'}
    (root / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    verify()
