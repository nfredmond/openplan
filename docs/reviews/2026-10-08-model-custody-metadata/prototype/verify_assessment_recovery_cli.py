"""Drop a committed assessment reply and recover through the actual worker CLI."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import os
import re
import socket
import subprocess
import sys
import threading
import uuid
import requests

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal
from unittest.mock import patch
from worker_import_for_tests import import_worker_main
from isolated_postgrest import gateway


def _check():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    run, stage, request = [str(uuid.uuid4()) for _ in range(3)]
    directory = output / request

    def sql(statement):
        result = subprocess.run(['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', meta['database'], '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True, timeout=20)
        if result.returncode:
            raise RuntimeError('Owned proof database query failed')
        return result.stdout.strip()

    sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic CLI recovery',created_by FROM public.model_runs WHERE id='{fixture}'; INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic CLI recovery','queued',1);")
    operation = "record_legacy_model_assessment"
    posts, errors = [], []
    with gateway('public', database=meta['database']) as connection:
        token = connection['service_token']

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                try:
                    if self.path != '/rest/v1/rpc/' + operation or self.headers.get('Authorization') != 'Bearer ' + token:
                        raise AssertionError('Unexpected proof route or credential')
                    length = int(self.headers['Content-Length'])
                    if not 0 < length < 65536:
                        raise AssertionError('Unexpected proof body size')
                    body = json.loads(self.rfile.read(length))
                    posts.append(body)
                    with requests.post(connection['url'] + '/rpc/' + operation, headers={'Authorization': 'Bearer ' + token}, json=body, timeout=15) as response:
                        if response.status_code != 200:
                            raise AssertionError('Native assessment was not confirmed')
                        data = response.content
                    if len(posts) == 1:
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as error:
                    errors.append(type(error).__name__)
                    self.close_connection = True

        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            from test_model_assessment_client import fixture
            payload, _ = fixture()
            workspace = str(uuid.UUID(sql(f"SELECT workspace_id FROM public.model_runs WHERE id='{run}';")))
            artifact = str(uuid.uuid4())
            sql(f"INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash) VALUES('{artifact}','{run}','{stage}','link_volumes','storage://run-artifacts/synthetic/output.csv',2,repeat('a',64));")
            payload.update(p_workspace_id=workspace,p_model_run_id=run,p_stage_id=stage,p_model_output_artifact_id=artifact)
            payload['p_validation_input_metadata'] = {'schema':'openplan.validation-input-bundle.v1','comparison_basis_sha256':'a'*64}
            payload['p_comparison_basis_metadata'] = {'schema':'openplan.model-comparison-basis.v1'}
            payload['p_assessment_metadata'] = {'schema':'openplan.model-validation-assessment.v1','comparison_basis_sha256':'a'*64,'rules_version':4,'scientific_outcome':payload['p_scientific_outcome'],'planning_use':payload['p_planning_use'],'partition':payload['p_partition'],'reasons':payload['p_reasons']}
            worker = import_worker_main()
            assessment_identity = request
            def deliver_from_worker():
                with patch.object(worker, 'SUPABASE_URL', base), patch.object(worker, 'SUPABASE_KEY', token), patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID':meta['database']}):
                    return worker.sb_record_retained_modeling_validation_assessment(payload, assessment_id=assessment_identity, journal_dir=str(directory))
            try:
                deliver_from_worker()
            except worker.WorkerStateWriteUnconfirmed:
                pass
            else:
                raise AssertionError('Worker did not propagate lost committed reply')
            pending = journal.pending(directory, client.destination(base, meta['database']))
            if errors or len(pending) != 1:
                raise AssertionError('Lost reply did not leave the exact command pending')
            command = pending[0]['command']
            request = command['request_id']
            cli = [sys.executable, '-B', str(REPO / 'workers/aequilibrae_worker/model_command_recovery.py'), '--journal', str(directory), '--base-url', base, '--deployment-id', meta['database']]
            def invoke(action):
                result = subprocess.run([*cli, *action], capture_output=True, text=True, timeout=40, env={**os.environ, 'SUPABASE_SERVICE_ROLE_KEY': token})
                if result.returncode or token in result.stdout or token in result.stderr:
                    raise AssertionError('CLI did not safely retain the receipt')
                return json.loads(result.stdout)
            if invoke(['--list-pending'])['pending'][0]['request_id'] != request:
                raise AssertionError('CLI did not identify the pending request')
            expected = {'request_id': request, 'outcome': 'command_receipt_retained', 'model_resumed': False}
            if invoke(['--request-id', request]) != expected or invoke(['--request-id', request]) != expected:
                raise AssertionError('CLI recovery summary differs')
            if invoke(['--list-pending']) != {'pending': []} or errors or len(posts) != 2 or posts[0] != posts[1]:
                raise AssertionError('CLI changed the command or sent a third POST')
            counts = json.loads(sql(f"SELECT json_build_array((SELECT count(*) FROM public.model_assessment_command_receipts WHERE request_id='{request}'),(SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id='{run}'),(SELECT count(*) FROM public.model_run_artifacts WHERE run_id='{run}'));"))
            if counts != [1,1,4]:
                raise AssertionError('CLI recovery duplicated assessment or artifact records')
            retained = journal.read_existing(directory,command['destination'],request)[0]
            stored = json.loads(sql(f"SELECT response_payload FROM public.model_assessment_command_receipts WHERE request_id='{request}';"))
            if not retained['resolved'] or retained['response'] != stored:
                raise AssertionError('CLI receipt differs from committed assessment')
            if deliver_from_worker() != stored['assessment'] or len(posts) != 2:
                raise AssertionError('Worker did not reuse recovered assessment receipt')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError('Owned recovery bridge did not stop')
    result = {'run_id':run,'request_id':request,'http_posts':2,'lost_tcp_reply_after_commit':True,'fresh_cli_recovered':True,'cached_cli_sent_no_request':True,'worker_reused_recovered_receipt':True,'record_counts':counts,'operation':operation,'model_resumed':False,'scope':'Actual normal worker delivery helper with synthetic assessment, real PostgREST, dropped TCP reply after native commit, fresh recovery CLI and worker receipt reuse. Candidate objects removed. No normal dispatch, Storage bytes, managed ingestion or scientific acceptance.'}
    (output / 'recovery-cli.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def check():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    def sql(statement):
        result = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=25)
        if result.returncode:
            raise RuntimeError('Owned assessment proof database operation failed')
        return result.stdout.strip()
    if sql("SELECT to_regclass('public.model_assessment_command_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_assessment(uuid,jsonb)') IS NULL;") != 't':
        raise RuntimeError('Candidate proof objects already exist; leave them unchanged')
    sql('BEGIN;\n'+Path(__file__).with_name('assessment-command.sql').read_text()+'\nCOMMIT;')
    try:
        return _check()
    finally:
        sql("""BEGIN;
DROP FUNCTION public.record_legacy_model_assessment(uuid,jsonb);
DROP TABLE public.model_assessment_command_receipts;
COMMIT;""")
        if sql("SELECT to_regclass('public.model_assessment_command_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_assessment(uuid,jsonb)') IS NULL;") != 't':
            raise AssertionError('Assessment proof cleanup failed')


if __name__ == '__main__':
    print(json.dumps(check(), indent=2))
