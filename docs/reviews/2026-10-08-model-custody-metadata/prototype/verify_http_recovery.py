"""Real loopback HTTP disconnect after SQL commit; this bridge is not PostgREST."""
from contextlib import ExitStack
import requests
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import uuid
import artifact_rpc as rpc
import request_journal as journal
from verify_journal_recovery import sql, ROOT


def client(mode, fixture_path):
    fixture = json.loads(Path(fixture_path).read_text())
    directory = Path(fixture['journal'])
    command = fixture['command']
    if mode == 'recover':
        pending = journal.pending(directory, command['destination'])
        if len(pending) != 1:
            raise AssertionError('HTTP recovery request missing')
        command = pending[0]['command']
        if fixture['fault'] == 'new-request-id':
            command['request_id'] = str(uuid.uuid4())
    try:
        rpc.deliver(directory, command, base_url=fixture['base_url'], deployment_id=fixture['schema'], service_key=os.environ.get('OPENPLAN_PROBE_SERVICE_KEY', 'synthetic-http-secret'))
    except rpc.DeliveryUnconfirmed:
        if mode != 'lost-ack':
            os._exit(79)
        os._exit(77)
    if mode == 'lost-ack':
        raise AssertionError('First HTTP response was not lost')
    # A completed retry must use its retained response with no third POST.
    rpc.deliver(directory, command, base_url=fixture['base_url'], deployment_id=fixture['schema'], service_key=os.environ.get('OPENPLAN_PROBE_SERVICE_KEY', 'synthetic-http-secret'))
    os._exit(78)


def check(fault='none', harmless=False, use_postgrest=False):
    schema = 'http_recovery_' + uuid.uuid4().hex
    run, stage = [str(uuid.uuid4()) for _ in range(2)]
    server = thread = None
    requests_seen = []
    errors = []
    receipts = []
    resources = ExitStack()
    try:
        source = '\n'.join((ROOT / file).read_text() for file in ('claim.sql', 'artifact.sql'))
        if harmless:
            source += '\n-- Harmless HTTP recovery control.\n'
        sql(f'''CREATE SCHEMA {schema};
CREATE TABLE {schema}.model_runs (LIKE public.model_runs INCLUDING ALL);
CREATE TABLE {schema}.model_run_stages (LIKE public.model_run_stages INCLUDING ALL);
CREATE TABLE {schema}.model_run_artifacts (LIKE public.model_run_artifacts INCLUDING ALL);
GRANT USAGE ON SCHEMA {schema} TO service_role;
GRANT ALL ON {schema}.model_runs,{schema}.model_run_stages TO service_role;
''' + source.replace('public.', schema + '.') + f'''
INSERT INTO {schema}.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
VALUES('{run}',gen_random_uuid(),gen_random_uuid(),'aequilibrae','queued','Synthetic HTTP recovery',gen_random_uuid());
INSERT INTO {schema}.model_run_stages(id,run_id,stage_name,status,sort_order)
VALUES('{stage}','{run}','Synthetic HTTP recovery','queued',1);
''')
        attempt = json.loads(sql(f"SET ROLE service_role; SELECT {schema}.claim_model_stage_attempt('{uuid.uuid4()}','{stage}','http-probe');"))['attempt_id']

        gateway_info = None
        service_key = 'synthetic-http-secret'
        if use_postgrest:
            from isolated_postgrest import gateway
            gateway_info = resources.enter_context(gateway(schema))
            service_key = gateway_info['service_token']
            # Both unsigned and signed anon requests must fail before mutation.
            for headers in ({}, {'Authorization': 'Bearer ' + gateway_info['anon_token']}):
                with requests.post(gateway_info['url'] + '/rpc/write_model_attempt_artifact', headers=headers,
                                   json={'p_request_id': str(uuid.uuid4()), 'p_attempt_id': attempt, 'p_payload': {}}, timeout=10) as response:
                    if response.status_code not in (401, 403):
                        raise AssertionError('Anonymous prototype RPC did not refuse access')
            if sql(f'SELECT count(*) FROM {schema}.model_run_artifacts;') != '0':
                raise AssertionError('Anonymous prototype RPC mutated artifacts')

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                try:
                    if self.path != '/rest/v1/rpc/write_model_attempt_artifact' or self.headers.get('Authorization') != 'Bearer ' + service_key or self.headers.get('apikey') != service_key:
                        raise AssertionError('HTTP route or credential binding differs')
                    length = int(self.headers['Content-Length'])
                    if not 0 < length < 65536:
                        raise AssertionError('Unexpected fixture body size')
                    body = json.loads(self.rfile.read(length))
                    requests_seen.append(body)
                    request_id = str(uuid.UUID(body['p_request_id']))
                    if body['p_attempt_id'] != attempt or body['p_payload'] != payload:
                        raise AssertionError('HTTP command payload changed')
                    encoded = json.dumps(body['p_payload']).replace("'", "''")
                    if gateway_info:
                        with requests.post(gateway_info['url'] + '/rpc/write_model_attempt_artifact',
                                           headers={'Authorization': self.headers['Authorization']}, json=body, timeout=15) as upstream:
                            if upstream.status_code != 200:
                                raise AssertionError('PostgREST artifact RPC returned status ' + str(upstream.status_code))
                            receipt = upstream.json()
                    else:
                        receipt = json.loads(sql(f"SET ROLE service_role; SELECT {schema}.write_model_attempt_artifact('{request_id}','{attempt}','{encoded}'::jsonb);"))
                    receipts.append(receipt)
                    # SQL autocommit has completed. Drop the TCP connection
                    # before sending even the HTTP status line for this receipt.
                    if len(requests_seen) == 1:
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    if fault == 'wrong-receipt':
                        receipt = {**receipt, 'attempt_id': run}
                    response = json.dumps(receipt).encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(response)))
                    self.end_headers()
                    self.wfile.write(response)
                except Exception as error:
                    errors.append(type(error).__name__ + ': ' + str(error))
                    self.close_connection = True

        payload = {'artifact_type': 'synthetic_metadata', 'file_url': 'local://http-synthetic.json', 'file_size_bytes': 0, 'content_hash': 'a' * 64}
        server = HTTPServer(('127.0.0.1', 0), Handler)
        base_url = 'http://127.0.0.1:' + str(server.server_port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        command = {'request_id': str(uuid.uuid4()), 'destination': rpc.destination(base_url, schema), 'operation': 'write_model_attempt_artifact', 'arguments': {'run_id': run, 'stage_id': stage, 'attempt_id': attempt, 'payload': payload}}
        with tempfile.TemporaryDirectory() as directory:
            fixture_path = Path(directory) / 'fixture.json'
            journal_path = Path(directory) / 'journal'
            fixture_path.write_text(json.dumps({'base_url': base_url, 'schema': schema, 'command': command, 'journal': str(journal_path), 'fault': fault}))
            for mode, expected in [('lost-ack', 77), ('recover', 78)]:
                result = subprocess.run([sys.executable, '-B', __file__, mode, str(fixture_path)], capture_output=True, text=True, timeout=40, env={**os.environ, 'OPENPLAN_PROBE_SERVICE_KEY': service_key})
                if errors:
                    raise RuntimeError('; '.join(errors))
                if mode == 'recover' and result.returncode == 79:
                    if not journal.pending(journal_path, command['destination']):
                        raise AssertionError('Invalid receipt incorrectly resolved journal')
                    raise AssertionError('Mismatched HTTP receipt stayed pending')
                if result.returncode != expected:
                    raise RuntimeError(mode + ': ' + result.stderr)
                if mode == 'lost-ack':
                    if sql(f'SELECT count(*) FROM {schema}.model_run_artifacts;') != '1' or len(journal.pending(journal_path, command['destination'])) != 1:
                        raise AssertionError('Lost HTTP acknowledgement did not retain both sides')
            if sql(f'SELECT count(*) FROM {schema}.model_run_artifacts;') != '1' or sql(f'SELECT count(*) FROM {schema}.model_artifact_write_receipts;') != '1':
                raise AssertionError('Changed HTTP request identity duplicated server records')
            if len(requests_seen) != 2 or requests_seen[0] != requests_seen[1] or receipts[0] != receipts[1]:
                raise AssertionError('HTTP retry changed command or receipt')
            if journal.prepare(journal_path, command) != {'command': command, 'response': receipts[0], 'resolved': True}:
                raise AssertionError('HTTP recovery did not retain the exact receipt')
        return {'postgrest': bool(gateway_info), 'anonymous_refused': True if gateway_info else None, 'http_posts': 2, 'first_response_dropped_after_commit': True, 'fresh_client_recovery': True, 'retained_artifacts': 1, 'retained_server_receipts': 1}
    finally:
        if server:
            server.shutdown()
            server.server_close()
        if thread:
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError('Owned HTTP server failed to stop')
        resources.close()
        sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE;')
        if sql(f"SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='{schema}');") != 'f':
            raise RuntimeError('Owned HTTP schema survived cleanup')


if __name__ == '__main__':
    if len(sys.argv) == 3:
        client(sys.argv[1], sys.argv[2])
    else:
        results = {}
        for name, fault, harmless, expected in [
            ('baseline', 'none', False, None),
            ('harmless', 'none', True, None),
            ('wrong-receipt', 'wrong-receipt', False, 'Mismatched HTTP receipt stayed pending'),
            ('new-request-id', 'new-request-id', False, 'Changed HTTP request identity duplicated server records'),
            ('restored', 'none', False, None),
        ]:
            try:
                result = check(fault, harmless, use_postgrest=os.environ.get('OPENPLAN_PROBE_POSTGREST') == '1')
            except AssertionError as error:
                if str(error) != expected:
                    raise
                results[name] = {'detected': str(error)}
            else:
                if expected:
                    raise AssertionError(name + ': adverse control was not detected')
                results[name] = result
        print(json.dumps(results, indent=2))
