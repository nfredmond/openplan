"""Drop a committed kpi reply and recover through the actual worker CLI."""
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
import model_legacy_kpi_command as kpi_command
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
    operation = "record_legacy_model_kpi"
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
                            raise AssertionError('Native kpi was not confirmed')
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
            workspace = str(uuid.UUID(sql(f"SELECT workspace_id FROM public.model_runs WHERE id='{run}';")))
            payload = dict(run_id=run,stage_id=stage,kpi_name='daily_vmt',kpi_label='Daily VMT',kpi_category='assignment',value=12.5,unit='vehicle-miles/day',geometry_ref=None,breakdown_json={})
            command = kpi_command.prepare(directory,workspace,payload,name='daily_vmt',base_url=base,deployment_id=meta['database'])
            def deliver_saved():
                return client.deliver(directory,command,base_url=base,deployment_id=meta['database'],service_key=token,post=requests.post)
            try:
                deliver_saved()
            except client.DeliveryUnconfirmed:
                pass
            else:
                raise AssertionError('Client did not propagate lost committed reply')
            pending = journal.pending(directory, client.destination(base, meta['database']))
            if errors or len(pending) != 1:
                raise AssertionError('Lost reply did not leave the exact command pending')
            command = pending[0]['command']
            request = command['request_id']
            kpi = command['arguments']['payload']['id']
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
            counts = json.loads(sql(f"SELECT json_build_array((SELECT count(*) FROM public.model_legacy_kpi_receipts WHERE kpi_id='{kpi}'),(SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}'));"))
            if counts != [1,1]:
                raise AssertionError('CLI recovery duplicated receipt or kpi records')
            retained = journal.read_existing(directory,command['destination'],request)[0]
            stored = json.loads(sql(f"SELECT response_payload FROM public.model_legacy_kpi_receipts WHERE kpi_id='{kpi}';"))
            if not retained['resolved'] or retained['response'] != stored:
                raise AssertionError('CLI receipt differs from committed kpi')
            if deliver_saved() != stored or len(posts) != 2:
                raise AssertionError('Client did not reuse recovered kpi receipt')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError('Owned recovery bridge did not stop')
    result = {'run_id':run,'request_id':request,'http_posts':2,'lost_tcp_reply_after_commit':True,'fresh_cli_recovered':True,'cached_cli_sent_no_request':True,'client_reused_recovered_receipt':True,'record_counts':counts,'operation':operation,'model_resumed':False,'scope':'Actual retained client with synthetic KPI, real PostgREST, dropped TCP reply after native commit, fresh recovery CLI and client receipt reuse. Candidate objects removed. No normal dispatch, Storage bytes, managed ingestion or scientific acceptance.'}
    (output / 'recovery-cli.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def check():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    def sql(statement):
        result = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=25)
        if result.returncode:
            raise RuntimeError('Owned kpi proof database operation failed')
        return result.stdout.strip()
    if sql("SELECT to_regclass('public.model_legacy_kpi_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_kpi(uuid,jsonb)') IS NULL;") != 't':
        raise RuntimeError('Candidate proof objects already exist; leave them unchanged')
    sql('BEGIN;\n'+Path(__file__).with_name('legacy-kpi-command.sql').read_text()+'\nCOMMIT;')
    try:
        return _check()
    finally:
        sql("""BEGIN;
DROP FUNCTION public.record_legacy_model_kpi(uuid,jsonb);
DROP TABLE public.model_legacy_kpi_receipts;
COMMIT;""")
        if sql("SELECT to_regclass('public.model_legacy_kpi_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_kpi(uuid,jsonb)') IS NULL;") != 't':
            raise AssertionError('KPI proof cleanup failed')


if __name__ == '__main__':
    print(json.dumps(check(), indent=2))
