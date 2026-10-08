"""Exercise both bound worker writers against installed commands and lost replies."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import types
import uuid
from unittest.mock import patch
import requests
from isolated_postgrest import gateway

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_command_client as client
import model_command_journal as journal
from worker_import_for_tests import import_worker_main


def verify(output, writer_module, outputs=False, state_output=False, count_output=False, count_consumer=False):
    count_output = count_output or count_consumer
    outputs = outputs or state_output or count_output
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Select owned retention source')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    database = 'openplan_attempt_cli_' + uuid.uuid4().hex

    def sql(db, body):
        result = subprocess.run(['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt',
            '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], input=body,
            text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions')
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    (output / 'candidate.json').write_text(json.dumps({'container': source['container'], 'database': database,
        'source_database': source['database']}, indent=2) + '\n')
    if sql(database, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000020';") != '1':
        raise AssertionError('Installed migration20 required')
    if outputs and sql(database, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000021';") != '1':
        raise AssertionError('Installed migration21 required for outputs')
    fixture = str(uuid.UUID(source['fixture_run']))
    aeq = import_worker_main()
    sys.path.insert(0, str(REPO / 'workers/activitysim_worker'))
    import supabase_poll
    calls, cases = [], []
    fault = {'operation': None}
    with gateway('public', database=database) as connection:
        key = connection['service_token']

        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def forward(self, method):
                path = self.path.removeprefix('/rest/v1')
                allowed = (method == 'GET' and path.startswith('/model_run_stages?')) or (
                    method == 'POST' and path in ('/rpc/claim_model_stage_attempt', '/rpc/write_model_stage_attempt', '/rpc/write_model_attempt_artifact', '/rpc/write_model_attempt_kpi'))
                if not allowed or self.headers.get('Authorization') != 'Bearer ' + key:
                    self.send_error(403)
                    return
                body = self.rfile.read(int(self.headers.get('Content-Length', '0'))) if method == 'POST' else None
                with requests.request(method, connection['url'] + path, data=body,
                    headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
                    timeout=15, allow_redirects=False) as response:
                    status, content = response.status_code, response.content
                calls.append({'method': method, 'status': status})
                if status == 200 and method == 'POST' and path == '/rpc/' + str(fault['operation']):
                    fault['operation'] = None
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def do_POST(self):
                self.forward('POST')

            def do_GET(self):
                self.forward('GET')

        server = HTTPServer(('127.0.0.1', 0), Bridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            for worker in ((aeq,) if state_output or count_output else (aeq, supabase_poll)):
                modes = (('artifact', 'kpi', 'retained_artifact', 'retained_kpi') if worker is aeq else ('artifact', 'kpi')) if outputs else ('claim', 'running', 'succeeded', 'failed')
                if state_output or count_output:
                    modes = ('count_artifact' if count_output else 'state_artifact',)
                for status in modes:
                    run, stage = [str(uuid.uuid4()) for _ in range(2)]
                    workspace = str(uuid.UUID(sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic managed writer HTTP',created_by
 FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order,log_tail)
 VALUES('{stage}','{run}','Synthetic computation','queued',1,'Existing synthetic log');
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")))
                    directory = output / worker.__name__ / status
                    artifact_id = str(uuid.uuid4())
                    handled = []
                    writers = []
                    fault['operation'] = 'claim_model_stage_attempt' if status == 'claim' else None

                    def handler(context):
                        handled.append(context)
                        writer = writer_module.AttemptWriter(directory, context, base_url=base,
                            deployment_id=database, service_key=key)
                        writers.append(writer)
                        with writer_module.bind(writer):
                            worker.sb_patch_stage(stage, {'log_tail': 'Useful synthetic partial log'})
                            if outputs:
                                kind = 'artifact' if status.endswith('artifact') else 'kpi'
                                fault['operation'] = 'write_model_attempt_' + kind
                                if kind == 'artifact':
                                    payload = {'id': artifact_id, 'run_id': run, 'stage_id': stage,
                                        'artifact_type': 'synthetic', 'file_url': 'local://synthetic-unread',
                                        'file_size_bytes': 7, 'content_hash': 'a' * 64,
                                        'metadata_json': {'claim_tier': 'prototype'}}
                                else:
                                    payload = {'run_id': run, 'kpi_name': 'synthetic', 'kpi_label': 'Unassessed',
                                        'value': None, 'breakdown_json': {'status': 'unassessed'}}
                                if status == 'count_artifact':
                                    external = output / 'selected_counts.csv'
                                    external.write_bytes(b'station_id,count_year,aadt\nA,2020,123\n')
                                    Path(str(external) + '.count-source.json').write_text('{"source":{"vintage":"2020"}}')
                                    (output / 'count_source_status.json').write_text('{"status":"available"}')
                                    with patch.object(worker, 'RUN_WORK_ROOT', str(output / 'scratch')):
                                        path = Path(worker.run_work_directory(run)) / 'run_output'
                                        path.mkdir()
                                        if count_consumer:
                                            import model_count_inputs
                                            predecessor = model_count_inputs.retain(str(external), str(output), output / 'predecessor-counts')
                                            worker.stage_artifacts(run, stage, str(path.parent), {},
                                                {'count_inputs': predecessor, 'counts_path': predecessor['counts_path']})
                                        else:
                                            worker.retain_assignment_counts(str(external), str(path), status_directory=str(output))
                                elif status == 'state_artifact':
                                    with patch.object(worker, 'RUN_WORK_ROOT', str(output / 'scratch')):
                                        path = worker.run_work_directory(run)
                                        worker.write_run_state(path, {'setup': {'synthetic': True},
                                            'package': {'package_dir': '/original/synthetic/package'}})
                                elif status == 'retained_artifact':
                                    worker.sb_record_retained_artifact(payload, workspace_id=workspace,
                                        journal_dir=str(directory), logical_name='synthetic-output')
                                elif status == 'retained_kpi':
                                    worker.sb_record_retained_kpi(payload, workspace_id=workspace,
                                        stage_id=stage, journal_dir=str(directory))
                                else:
                                    getattr(worker, 'sb_post_' + kind)(payload)
                                raise AssertionError('Lost output reply did not stop handler')
                            fault['operation'] = 'write_model_stage_attempt'
                            payload = {'status': status}
                            if status == 'failed':
                                payload['error_message'] = 'Synthetic computation failure'
                            worker.sb_patch_stage(stage, payload)

                    with patch.dict(sys.modules, {'model_attempt_writer': writer_module}), patch.object(
                        worker.requests, 'patch', side_effect=AssertionError('Direct PATCH forbidden')), patch.object(
                        worker, '_confirmed_record_insert', side_effect=AssertionError('Direct insert forbidden')), patch.object(
                        worker, 'SUPABASE_URL', base), patch.object(worker, 'SUPABASE_KEY', key), patch.dict(
                        os.environ, {'OPENPLAN_DEPLOYMENT_ID': database}):
                        try:
                            invocation.invoke_new_attempt(directory, run_id=run, stage_id=stage,
                                worker_id='synthetic-native-writer', workspace_id=workspace,
                                base_url=base, deployment_id=database, service_key=key, handler=handler)
                        except (client.DeliveryUnconfirmed, worker.WorkerStateWriteUnconfirmed):
                            pass
                        else:
                            raise AssertionError('Lost reply did not stop invocation')
                    if fault['operation'] is not None or len(handled) != (0 if status == 'claim' else 1):
                        raise AssertionError('Writer did not reach intended dropped reply')
                    pending = journal.pending(directory, client.destination(base, database))
                    if len(pending) != 1:
                        raise AssertionError('Original unresolved command missing')
                    command = pending[0]['command']
                    request = command['request_id']

                    receipt_table = ('model_artifact_write_receipts' if status.endswith('artifact') else 'model_kpi_write_receipts') if outputs else ('model_stage_claim_receipts' if status == 'claim' else 'model_stage_write_receipts')

                    def native_state():
                        return sql(database, f"""SELECT jsonb_build_object(
 'parent',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{run}'),
 'stage',(SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id='{stage}'),
 'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a WHERE run_id='{run}'),
 'starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),
 'artifacts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.model_run_artifacts a WHERE run_id='{run}'),
 'kpis',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY id),'[]'::jsonb) FROM public.model_run_kpis k WHERE run_id='{run}'),
 'receipt',(SELECT response_payload FROM public.{receipt_table} WHERE request_id='{request}'));""")

                    before = native_state()
                    observed = json.loads(before)
                    expected_status = 'running' if outputs or status == 'claim' else status
                    if observed['stage']['status'] != expected_status or observed['parent']['status'] != expected_status:
                        raise AssertionError('Native terminal outcome differs')
                    if status != 'claim' and observed['stage']['log_tail'] != 'Useful synthetic partial log':
                        raise AssertionError('Native stage did not retain partial log')
                    if observed['receipt'] is None or observed['starts'] != 1 or len(observed['attempts']) != 1:
                        raise AssertionError('Native receipt or execution identity missing')
                    if outputs:
                        records = observed['artifacts'] if status.endswith('artifact') else observed['kpis']
                        if len(records) != 1 or records[0]['attempt_id'] != observed['attempts'][0]['id']:
                            raise AssertionError('Output is absent, duplicated or belongs to another attempt')
                        if status == 'count_artifact':
                            retained_dir = writers[0].files.path / 'run_output' / ('artifact_count_inputs' if count_consumer else 'count_inputs')
                            manifest = retained_dir / 'manifest.json'
                            content = manifest.read_bytes()
                            inventory = json.loads(content)
                            expected_files = {
                                'counts.csv': b'station_id,count_year,aadt\nA,2020,123\n',
                                'counts.csv.count-source.json': b'{"source":{"vintage":"2020"}}',
                                'count_source_status.json': b'{"status":"available"}',
                            }
                            if (records[0]['content_hash'] != hashlib.sha256(content).hexdigest()
                                    or records[0]['file_size_bytes'] != len(content)
                                    or records[0]['file_url'] != 'local://' + str(manifest)
                                    or records[0]['artifact_type'] != 'model_count_inputs'):
                                raise AssertionError('Native count manifest differs from retained bytes')
                            for name, expected in expected_files.items():
                                if count_consumer and (retained_dir / name).stat().st_ino == (output / 'predecessor-counts' / name).stat().st_ino:
                                    raise AssertionError('Consumer reused predecessor count inode')
                                item = inventory['files'][name]
                                if ((retained_dir / name).read_bytes() != expected or item['status'] != 'retained'
                                        or item['sha256'] != hashlib.sha256(expected).hexdigest() or item['size_bytes'] != len(expected)):
                                    raise AssertionError('Native count inventory differs from retained inputs')
                        elif status == 'state_artifact':
                            retained_path = writers[0].files.path / 'predecessor_state.json'
                            content = retained_path.read_bytes()
                            expected_state = {'setup': {'synthetic': True}, 'package': {'package_dir': '/original/synthetic/package'}}
                            if (json.loads(content) != expected_state or records[0]['content_hash'] != hashlib.sha256(content).hexdigest()
                                    or records[0]['file_size_bytes'] != len(content)
                                    or records[0]['file_url'] != 'local://' + str(retained_path)
                                    or records[0]['artifact_type'] != 'model_predecessor_state'):
                                raise AssertionError('Native predecessor state differs from retained bytes')
                        elif status.endswith('artifact'):
                            if records[0]['id'] != artifact_id or records[0]['content_hash'] != 'a' * 64 or records[0]['metadata_json'] != {'claim_tier': 'prototype'}:
                                raise AssertionError('Native artifact lost prepared identity or evidence')
                        elif records[0]['value'] is not None or records[0]['breakdown_json'] != {'status': 'unassessed'}:
                            raise AssertionError('Native KPI lost unassessed null value')
                    argv = [sys.executable, '-B', str(REPO / 'workers/aequilibrae_worker/model_command_recovery.py'),
                        '--journal', str(directory), '--base-url', base, '--deployment-id', database, '--request-id', request]
                    recovered = subprocess.run(argv, env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': key},
                        text=True, capture_output=True, timeout=40)
                    if recovered.returncode or json.loads(recovered.stdout) != {'request_id': request,
                        'outcome': 'command_receipt_retained', 'model_resumed': False}:
                        raise AssertionError('Fresh CLI did not recover original command')
                    if key in recovered.stdout or key in recovered.stderr or before != native_state():
                        raise AssertionError('Recovery changed native state or disclosed credential')
                    start = len(calls)
                    cached = subprocess.run(argv, env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': ''},
                        text=True, capture_output=True, timeout=20)
                    if cached.returncode or len(calls) != start:
                        raise AssertionError('Cached recovery sent HTTP')
                    if writers:
                        try:
                            writers[0].require_open()
                        except invocation.ReconciliationRequired:
                            pass
                        else:
                            raise AssertionError('Recovered write reopened stopped invocation')
                    cases.append({'worker': worker.__name__, 'lost_reply': status,
                        'handler_calls': len(handled), 'fresh_cli_recovered': True,
                        'native_records_unchanged': True, 'cached_no_http': True})
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
    return {'cases': cases, 'http_calls': len(calls), 'gateway_removed': True}


def main():
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(managed.__file__).read_text()
    anchor = 'state = {**self.state}'
    if source.count(anchor) != 1:
        raise AssertionError('Partial log mutation anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                       ('erase-log', source.replace(anchor, "state = {'status': 'running', 'log_tail': None, 'error': None}")),
                       ('restored', source)]:
        candidate = types.ModuleType('model_attempt_writer')
        exec(compile(body, managed.__file__, 'exec'), candidate.__dict__)
        try:
            result = verify(root / name, candidate)
        except AssertionError as error:
            if name != 'erase-log' or str(error) != 'Native stage did not retain partial log':
                raise
            results.append({'control': name, 'expected_failure': str(error)})
        else:
            if name == 'erase-log':
                raise AssertionError('Lost partial log passed native proof')
            results.append({'control': name, 'result': result})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': results,
              'limits': 'Installed native claim and stage commands, fresh invocation helper and both bound worker stage adapters. Synthetic handler only; no normal poll/push loop, outputs, filesystem continuation, engine or scientific acceptance.'}
    (root / 'writer-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
