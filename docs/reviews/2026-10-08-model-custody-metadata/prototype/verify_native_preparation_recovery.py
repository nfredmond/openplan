"""Recover only a lost consumer artifact receipt in a separate process."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired


def verify(worker, writer, method, output, sql, database, base, key, control):
    original = writer.post
    committed = []
    def lose(url, **kwargs):
        response = original(url, **kwargs)
        if url.endswith('/write_model_attempt_artifact'):
            assert response.status_code == 200, 'Consumer artifact command did not commit'
            committed.append(response.json())
            response.close()
            raise TimeoutError('Synthetic reply loss after native consumer artifact commit')
        return response
    writer.post = lose
    try:
        worker.retain_managed_validation_preparation(method)
    except worker.WorkerStateWriteUnconfirmed:
        pass
    else:
        raise AssertionError('Consumer continued after lost artifact reply')
    assert writer.stopped and len(committed) == 1, 'Consumer reply loss did not stop writer'
    pending = journal.pending(writer.directory, writer.context.destination)
    assert len(pending) == 1
    command = pending[0]['command']
    assert command['operation'] == 'write_model_attempt_artifact'
    assert command['arguments']['attempt_id'] == writer.context.attempt_id
    payload = command['arguments']['payload']
    assert payload['artifact_type'] == 'model_validation_preparation_consumption'
    def snapshot():
        tables = ('model_runs','model_run_stages','model_stage_attempts','model_run_artifacts',
                  'model_stage_claim_receipts','model_stage_write_receipts','model_artifact_write_receipts')
        native = {table: sql(database, f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
        with closing(journal.connect(writer.directory)) as connection:
            admissions = connection.execute('SELECT request_id,workspace_id,entered FROM execution_admissions ORDER BY request_id').fetchall()
        files = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in writer.files.root.rglob('*') if path.is_file()}
        return native, admissions, files
    before = snapshot()
    config = {'worker':str(Path(worker.__file__).parent), 'base':base, 'key':key,
              'journal':str(writer.directory), 'database':database,
              'request':str(uuid.uuid4()) if control=='lost-reply-wrong-request' else command['request_id']}
    code = '''
import json,os,sys,requests
config=json.load(sys.stdin)
sys.path.insert(0,config['worker'])
os.environ['SUPABASE_SERVICE_ROLE_KEY']=config['key']
original=requests.post
def post(url,**kwargs):
    return original(url.replace(config['base']+'/rest/v1/',config['base']+'/'),**kwargs)
requests.post=post
import model_command_recovery
raise SystemExit(model_command_recovery.main(['--journal',config['journal'],'--base-url',config['base'],
 '--deployment-id',config['database'],'--request-id',config['request']]))
'''
    result = subprocess.run([sys.executable,'-B','-c',code],input=json.dumps(config),text=True,capture_output=True,timeout=30)
    (output/(method+'-receipt-recovery.log')).write_text(result.stdout+result.stderr)
    assert result.returncode == 0, 'Fresh consumer receipt recovery failed'
    recovered = json.loads(result.stdout)
    assert recovered == {'request_id':command['request_id'],'outcome':'command_receipt_retained','model_resumed':False}
    assert snapshot() == before, 'Receipt recovery changed native state, admissions or files'
    saved = journal.read_existing(writer.directory,writer.context.destination,command['request_id'])[0]
    assert saved['resolved'] and saved['response'] == committed[0], 'Recovered receipt differs from original transaction'
    assert journal.pending(writer.directory,writer.context.destination) == []
    assert writer.stopped
    if control=='lost-reply-bypass-stop': writer.require_open=lambda:None
    try:writer.patch_stage(writer.context.stage_id,{'status':'succeeded'})
    except ReconciliationRequired:pass
    else:raise AssertionError('Recovered consumer writer accepted completion')
    assert snapshot() == before, 'Refused completion changed native state, admissions or files'
    path=Path(payload['file_url'].removeprefix('local://'))
    manifest=json.loads(path.read_bytes())
    # This is evidence reconstruction after recovery, not a returned execution
    # continuation. The enclosing proof checks these files against native rows.
    return {'execution_authorized':manifest['execution_authorized'],'producer':payload['metadata_json']['producer'],
            'source_paths':{entry['role']:str(path.parent/entry['object_name']) for entry in manifest['entries']},
            'recovery':{'fresh_process':True,'original_receipt':True,'native_tables_unchanged':7,
                        'execution_admissions_unchanged':True,'files_unchanged':True,'writer_stopped':True,'model_resumed':False}}
