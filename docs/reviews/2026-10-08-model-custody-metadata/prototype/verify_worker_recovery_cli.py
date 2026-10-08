"""Drop a committed claim reply, then recover it through the actual worker CLI."""
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
from isolated_postgrest import gateway


def _check(publication=False):
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
    operation = "publish_legacy_model_evidence" if publication else "claim_model_stage_attempt"
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
                            raise AssertionError('Native claim was not confirmed')
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
            arguments = {'run_id': run, 'stage_id': stage, 'worker_id': 'synthetic-cli-proof'}
            if publication:
                from worker_import_for_tests import import_worker_main
                worker = import_worker_main()
                workspace = str(uuid.UUID(sql(f"SELECT workspace_id FROM public.model_runs WHERE id='{run}';")))
                prior = json.loads(sql(f"SELECT public.read_legacy_model_evidence('{workspace}','{run}','behavioral_demand');"))
                validation = {'stations_matched':1,'median_ape':20,'max_ape':20,'validation_rules_version':4,'model_validation_assessment':{'scientific_outcome':'inconclusive'}}
                payload = worker.build_model_run_modeling_evidence(run,workspace,validation,track='behavioral_demand')
                arguments = {'run_id':run,'workspace_id':workspace,'track':'behavioral_demand','expected':prior,'payload':payload}
            command = {'request_id': request, 'destination': client.destination(base, meta['database']), 'operation': operation, 'arguments': arguments}
            try:
                client.deliver(directory, command, base_url=base, deployment_id=meta['database'], service_key=token)
            except client.DeliveryUnconfirmed:
                pass
            else:
                raise AssertionError('Committed reply was not lost')
            if errors or len(journal.pending(directory, command['destination'])) != 1:
                raise AssertionError('Lost reply did not leave the exact command pending')
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
            if publication:
                if sql(f"SELECT count(*) FROM public.model_evidence_publication_receipts WHERE request_id='{request}';") != '1':
                    raise AssertionError('CLI recovery duplicated publication')
                if sql(f"SELECT response_payload->'evidence'=public.read_legacy_model_evidence('{workspace}','{run}','behavioral_demand') FROM public.model_evidence_publication_receipts WHERE request_id='{request}';") != 't':
                    raise AssertionError('Recovered publication receipt differs from stored evidence')
                if sql(f"SELECT count(*) FROM public.modeling_validation_results WHERE model_run_id='{run}';") != '2':
                    raise AssertionError('Publication metric set differs')
            elif sql(f"SELECT count(*) FROM public.model_stage_attempts WHERE run_id='{run}';") != '1' or sql(f"SELECT count(*) FROM public.model_stage_claim_receipts WHERE request_id='{request}';") != '1':
                raise AssertionError('CLI recovery duplicated the native claim')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError('Owned recovery bridge did not stop')
    result = {'run_id': run, 'request_id': request, 'http_posts': 2, 'lost_tcp_reply_after_commit': True, 'fresh_cli_recovered': True, 'cached_cli_sent_no_request': True, 'retained_attempts': None if publication else 1, 'retained_claim_receipts': None if publication else 1, 'retained_publication_receipts': 1 if publication else None, 'operation': operation, 'model_resumed': False, 'scope': 'Synthetic command and fresh operator CLI, actual PostgREST and dropped TCP response after commit. Publication mode uses temporary candidate objects and the actual worker payload builder; claim mode uses installed migration. No normal dispatcher, model execution, file reuse or scientific acceptance.'}
    (output / 'recovery-cli.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def check(publication=False):
    if not publication:
        return _check()
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    def sql(statement):
        result = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=25)
        if result.returncode:
            raise RuntimeError('Owned publication proof database operation failed')
        return result.stdout.strip()
    if sql("SELECT to_regclass('public.model_evidence_publication_receipts') IS NULL AND to_regclass('public.model_evidence_publication_context') IS NULL;") != 't':
        raise RuntimeError('Candidate proof objects already exist; leave them unchanged')
    sql('BEGIN;\n'+Path(__file__).with_name('evidence-publication.sql').read_text()+'\nCOMMIT;')
    try:
        return _check(publication=True)
    finally:
        sql("""BEGIN;
DROP TRIGGER retained_model_evidence ON public.modeling_claim_decisions;
DROP TRIGGER retained_model_evidence ON public.modeling_validation_results;
DROP FUNCTION public.guard_retained_model_evidence();
DROP FUNCTION public.publish_legacy_model_evidence(uuid,uuid,uuid,text,jsonb,jsonb);
DROP FUNCTION public.read_legacy_model_evidence(uuid,uuid,text);
DROP TABLE public.model_evidence_publication_context;
DROP TABLE public.model_evidence_publication_receipts;
COMMIT;""")
        if sql("SELECT to_regclass('public.model_evidence_publication_receipts') IS NULL;") != 't':
            raise AssertionError('Publication proof cleanup failed')


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publication',action='store_true')
    print(json.dumps(check(publication=parser.parse_args().publication), indent=2))
