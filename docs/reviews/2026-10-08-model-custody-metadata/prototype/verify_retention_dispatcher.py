"""Exercise the real dispatcher and HTTP writes with synthetic stage computations.

Never executes an engine or enrolls a historical run as new. The database is an
owned clone of the installed retention/recovery migrations. This does not prove
scientific accuracy, process restart continuation or managed-attempt ownership.
"""
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import uuid

import requests
from isolated_postgrest import gateway

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
from worker_import_for_tests import import_worker_main


def verify():
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if (source['container'] != 'supabase_db_openplan-restore-target-2026091050'
            or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database'])):
        raise ValueError('Select an owned installed retention database')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(parents=True, exist_ok=False)
    command = ['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt',
               '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']

    def query(database, statement):
        result = subprocess.run([*command, '-d', database], input=statement,
                                text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    history = query(source['database'], "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261016000018','20261016000019');")
    if history != '2':
        raise AssertionError('Both installed migration history rows are required')
    meta = {'container': source['container'], 'database': 'openplan_attempt_cli_' + uuid.uuid4().hex,
            'source_database': source['database'], 'fixture_run': str(uuid.UUID(source['fixture_run'])),
            'worker_sha256': hashlib.sha256((REPO / 'workers/aequilibrae_worker/main.py').read_bytes()).hexdigest()}
    query('postgres', f"CREATE DATABASE {meta['database']} TEMPLATE {source['database']};")
    (output / 'candidate.json').write_text(json.dumps(meta, indent=2) + '\n')

    def sql(statement):
        return query(meta['database'], statement)

    worker = import_worker_main()
    import model_run_state
    records = []
    with gateway('public', database=meta['database']) as connection:
        token = connection['service_token']
        calls, errors = [], []
        drop = {'stage': None}

        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def forward(self):
                try:
                    if not self.path.startswith('/rest/v1/') or self.headers.get('Authorization') != 'Bearer ' + token:
                        raise AssertionError('Unexpected destination or authentication')
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 <= length <= 131072:
                        raise AssertionError('Unexpected request size')
                    body = self.rfile.read(length) if length else None
                    headers = {key: self.headers[key] for key in ('Authorization', 'Content-Type', 'Prefer') if self.headers.get(key)}
                    with requests.request(self.command, connection['url'] + self.path[len('/rest/v1'):],
                                          headers=headers, data=body, timeout=15, allow_redirects=False) as response:
                        status, content = response.status_code, response.content
                        content_type = response.headers.get('Content-Type', 'application/json')
                    calls.append((self.command, self.path, status))
                    if self.command == 'PATCH' and drop['stage'] and ('id=eq.' + drop['stage']) in self.path and status == 200:
                        drop['stage'] = None
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    self.send_response(status)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                except Exception as error:
                    errors.append(type(error).__name__)
                    self.close_connection = True

            do_GET = forward
            do_PATCH = forward
            do_POST = forward

        bridge = HTTPServer(('127.0.0.1', 0), Bridge)
        thread = threading.Thread(target=bridge.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(bridge.server_port)
        workspaces, computations = {}, []
        mode = {'failure': False}

        def create_run():
            run = str(uuid.uuid4())
            workspace = sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic dispatcher retention',created_by FROM public.model_runs WHERE id='{meta['fixture_run']}' RETURNING workspace_id;")
            workspaces[run] = str(uuid.UUID(workspace))
            for order, name in enumerate(('AequilibraE Setup', 'Network Assignment', 'Artifact Extraction'), 1):
                stage = str(uuid.uuid4())
                sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','{name}','queued',{order});")
            return run

        def facts(run):
            return json.loads(sql(f"SELECT json_build_object('parent',(SELECT status FROM public.model_runs WHERE id='{run}'),'stages',(SELECT json_agg(status ORDER BY sort_order) FROM public.model_run_stages WHERE run_id='{run}'),'starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),'kpis',(SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}'));"))

        def package(run, work_dir, **kwargs):
            return {'package_dir': work_dir, 'bbox': [-121, 38, -120, 39]}

        def setup(run, stage, work_dir, bbox, package_dir):
            computations.append((run, 'setup'))
            if mode['failure']:
                raise ValueError('Synthetic domain failure')
            return {'log': 'Synthetic setup', 'synthetic': True}

        def assignment(run, stage, work_dir, setup_result, package_dir):
            if setup_result != {'log': 'Synthetic setup', 'synthetic': True}:
                raise AssertionError('Setup handoff changed')
            computations.append((run, 'assignment'))
            return {'log': 'Synthetic assignment', 'synthetic': True}

        def artifacts(run, stage, work_dir, setup_result, assignment_result, package_result):
            if assignment_result != {'log': 'Synthetic assignment', 'synthetic': True}:
                raise AssertionError('Assignment handoff changed')
            computations.append((run, 'artifacts'))
            payload = {'run_id': run, 'kpi_name': 'synthetic_dispatcher', 'kpi_label': 'Synthetic dispatcher',
                       'kpi_category': 'assignment', 'value': 12.5, 'unit': 'vehicles'}
            worker.sb_record_retained_kpi(payload, workspace_id=workspaces[run], stage_id=stage,
                                          journal_dir=str(Path(work_dir) / 'stage-journals' / stage))
            return 'Synthetic artifact extraction with retained KPI'

        try:
            with ExitStack() as stack:
                for name, value in {'SUPABASE_URL': base, 'SUPABASE_KEY': token,
                                    'HEADERS': {'apikey': token, 'Authorization': 'Bearer ' + token,
                                                'Content-Type': 'application/json', 'Prefer': 'return=representation'},
                                    'RUN_WORK_ROOT': str(output / 'worker'), 'ensure_dynamic_package': package,
                                    'stage_setup': setup, 'stage_assignment': assignment, 'stage_artifacts': artifacts}.items():
                    stack.enter_context(patch.object(worker, name, value))
                stack.enter_context(patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': meta['database']}))
                original_claim = worker.sb_claim_stage
                original_write = worker.write_run_state
                for variant in ('baseline', 'harmless', 'lost-reply-swallowed', 'state-error-swallowed', 'restored'):
                    def claim(stage, payload):
                        try:
                            return original_claim(stage, dict(payload) if variant == 'harmless' else payload)
                        except worker.WorkerStateWriteUnconfirmed as error:
                            if variant == 'lost-reply-swallowed' and isinstance(error.__cause__, requests.RequestException):
                                return True
                            raise

                    def write_state(directory, state):
                        try:
                            return original_write(directory, state)
                        except worker.WorkerStateWriteUnconfirmed:
                            if variant == 'state-error-swallowed':
                                return None
                            raise

                    try:
                        with patch.object(worker, 'sb_claim_stage', claim), patch.object(worker, 'write_run_state', write_state):
                            run = create_run()
                            if worker.process_first_actionable_stage(worker.fetch_queued_stages(run)[1:]) != 'idle':
                                raise AssertionError('Later stage bypassed queued prerequisite')
                            for _ in range(3):
                                if worker.process_first_actionable_stage(worker.fetch_queued_stages(run)) != 'processed':
                                    raise AssertionError('Dispatcher did not process next stage')
                            expected = {'parent': 'succeeded', 'stages': ['succeeded'] * 3, 'starts': 3, 'kpis': 1}
                            if facts(run) != expected or worker.fetch_queued_stages(run):
                                raise AssertionError('Native completed run differs')
                            state = json.loads((Path(worker.run_work_directory(run)) / 'state.json').read_text())
                            if set(state) != {'setup', 'package', 'assignment'} or [name for item, name in computations if item == run] != ['setup', 'assignment', 'artifacts']:
                                raise AssertionError('State handoff or computation count differs')
                            lost_run = create_run()
                            pending = worker.fetch_queued_stages(lost_run)
                            drop['stage'] = pending[0]['id']
                            try:
                                worker.process_first_actionable_stage(pending)
                            except worker.WorkerStateWriteUnconfirmed:
                                pass
                            else:
                                raise AssertionError('Dispatcher hid committed claim uncertainty')
                            if facts(lost_run) != {'parent': 'queued', 'stages': ['running', 'queued', 'queued'], 'starts': 1, 'kpis': 0}:
                                raise AssertionError('Lost claim state changed')
                            if any(item == lost_run for item, _ in computations) or worker.process_first_actionable_stage(pending) != 'lost':
                                raise AssertionError('Uncertain claim repeated computation')
                            if worker.process_first_actionable_stage(worker.fetch_queued_stages(lost_run)) != 'idle':
                                raise AssertionError('Later stage bypassed uncertain prerequisite')
                            failed_run = create_run()
                            mode['failure'] = True
                            try:
                                worker.process_first_actionable_stage(worker.fetch_queued_stages(failed_run))
                            finally:
                                mode['failure'] = False
                            for _ in range(2):
                                if worker.process_first_actionable_stage(worker.fetch_queued_stages(failed_run)) != 'skipped':
                                    raise AssertionError('Failed prerequisite did not skip later stage')
                            if facts(failed_run) != {'parent': 'failed', 'stages': ['failed', 'skipped', 'skipped'], 'starts': 1, 'kpis': 0}:
                                raise AssertionError('Domain failure state differs')
                            state_run = create_run()
                            with patch.object(model_run_state.os, 'replace', side_effect=OSError('Synthetic local write failure')):
                                try:
                                    worker.process_first_actionable_stage(worker.fetch_queued_stages(state_run))
                                except worker.WorkerStateWriteUnconfirmed:
                                    pass
                                else:
                                    raise AssertionError('Dispatcher hid local publication uncertainty')
                            if facts(state_run) != {'parent': 'running', 'stages': ['running', 'queued', 'queued'], 'starts': 1, 'kpis': 0}:
                                raise AssertionError('Uncertain publication marked terminal')
                    except AssertionError as error:
                        expected_faults = {
                            'lost-reply-swallowed': 'Dispatcher hid committed claim uncertainty',
                            'state-error-swallowed': 'Dispatcher hid local publication uncertainty',
                        }
                        if str(error) != expected_faults.get(variant):
                            raise
                        records.append({'variant': variant, 'caught': str(error)})
                    else:
                        if variant in {'lost-reply-swallowed', 'state-error-swallowed'}:
                            raise AssertionError('Adverse control survived')
                        records.append({'variant': variant, 'completed_run': run, 'lost_claim_run': lost_run,
                                        'failed_run': failed_run, 'uncertain_state_run': state_run, 'passed': True})
        finally:
            bridge.shutdown()
            bridge.server_close()
            thread.join(timeout=5)
        if errors:
            raise AssertionError('Bridge errors: ' + ','.join(errors))
    result = {'cases': records, 'http_requests': len(calls), 'gateway_removed': True,
              'scope': 'Actual fetch, readiness, dispatcher, stage runner, HTTP writes, atomic state publication and retained KPI. Synthetic computation suppliers. No real model execution, restart continuation, managed-attempt ownership, Storage, browser, human or scientific acceptance.'}
    (output / 'dispatcher-result.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
