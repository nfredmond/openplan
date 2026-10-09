"""Native source manifest registration and exact reply-loss reconciliation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import uuid
import requests

import model_command_client as client
import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired
from test_model_validation_source_writer import BoundSourceTests


def verify(writer, output, sql, database, base, key):
    control = os.environ.get('OPENPLAN_SOURCE_REGISTRATION_CONTROL', 'normal')
    assert control in ('normal', 'harmless', 'drop-write', 'wrong-request', 'bypass-stop', 'restored')
    loss_method = os.environ.get('OPENPLAN_SOURCE_LOSS_METHOD', 'activitysim')
    assert loss_method in ('aequilibrae', 'activitysim')
    original = writer.post or requests.post
    committed = []
    def lose(url, **kwargs):
        if url.endswith('/write_model_attempt_artifact'):
            payload = kwargs['json']['p_payload']
            if control == 'drop-write':
                raise AssertionError('Source registration transport reached after dropped writer control')
        response = original(url, **kwargs)
        if response.status_code != 200:
            diagnostic = response.json()
            (output / 'source-response-error.json').write_text(json.dumps({'status': response.status_code, 'code': diagnostic.get('code'), 'message': diagnostic.get('message')}, indent=2))
        if url.endswith('/write_model_attempt_artifact') and payload['metadata_json']['context']['method'] == loss_method:
            assert response.status_code == 200, 'Source artifact command did not commit'
            committed.append(response.json())
            response.close()
            raise TimeoutError('Synthetic reply loss after native source artifact commit')
        return response
    writer.post = lose
    if control == 'drop-write': writer.record_artifact = lambda *args, **kwargs: {}
    fixture = SimpleNamespace(writer=writer, directory=output / ('harmless-inputs' if control == 'harmless' else 'inputs'))
    completed = 0
    for method in ('aequilibrae', 'activitysim'):
        arguments = BoundSourceTests.prepare(fixture, method)
        try:
            writer.retain_validation_sources(**arguments)
        except client.DeliveryUnconfirmed:
            break
        completed += 1
    assert writer.stopped and len(committed) == 1, 'Native source reply loss did not stop writer'
    pending = journal.pending(writer.directory, writer.context.destination)
    assert len(pending) == 1
    command = pending[0]['command']
    assert command['operation'] == 'write_model_attempt_artifact'
    payload = command['arguments']['payload']
    manifest = Path(payload['file_url'].removeprefix('local://'))
    assert hashlib.sha256(manifest.read_bytes()).hexdigest() == payload['content_hash']
    rows = json.loads(sql(database, f"SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.model_run_artifacts a WHERE stage_id='{writer.context.stage_id}';"))
    assert len(rows) == completed + 1, 'Native source artifact inventory differs'
    for row in rows:
        assert row['artifact_type'] == 'model_validation_sources'
        assert row['attempt_id'] == writer.context.attempt_id
        content = Path(row['file_url'].removeprefix('local://')).read_bytes()
        assert len(content) == row['file_size_bytes'] and hashlib.sha256(content).hexdigest() == row['content_hash']
        catalog = json.loads(content)
        assert catalog['context'] == row['metadata_json']['context']
        assert catalog['context']['workspace_id'] == writer.context.workspace_id
        assert catalog['publication_state'] == 'retained_locally'
        for entry in catalog['entries']:
            data = (Path(row['file_url'].removeprefix('local://')).parent / entry['object_name']).read_bytes()
            assert len(data) == entry['artifact']['bytes'] and hashlib.sha256(data).hexdigest() == entry['artifact']['sha256']
    if control == 'bypass-stop': writer.require_open = lambda: None
    try: writer.patch_stage(writer.context.stage_id, {'status': 'succeeded'})
    except ReconciliationRequired: pass
    else: raise AssertionError('Stopped source writer accepted completion')
    tables = ('model_runs', 'model_run_stages', 'model_stage_attempts', 'model_run_artifacts',
              'model_artifact_write_receipts', 'model_stage_write_receipts')
    def snapshot():
        return {table: sql(database, f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
    before = snapshot()
    worker = Path(__file__).resolve().parents[4] / 'workers/aequilibrae_worker'
    code = '''
import json,os,sys
config=json.load(sys.stdin)
sys.path.insert(0,config['worker'])
os.environ['SUPABASE_SERVICE_ROLE_KEY']=config['key']
import model_command_recovery
raise SystemExit(model_command_recovery.main(['--journal',config['journal'],'--base-url',config['base'],
 '--deployment-id',config['database'],'--request-id',config['request']]))
'''
    config = {'worker':str(worker), 'base':base, 'key':key, 'journal':str(writer.directory), 'database':database,
              'request':str(uuid.uuid4()) if control == 'wrong-request' else command['request_id']}
    result = subprocess.run([sys.executable, '-B', '-c', code], input=json.dumps(config), capture_output=True, text=True, timeout=30)
    (output / 'source-recovery.log').write_text(result.stdout + result.stderr)
    assert result.returncode == 0, 'Fresh source receipt recovery failed'
    recovered = json.loads(result.stdout)
    assert recovered['outcome'] == 'command_receipt_retained' and recovered['model_resumed'] is False
    assert snapshot() == before, 'Source receipt recovery changed native tables'
    assert journal.pending(writer.directory, writer.context.destination) == []
    saved = journal.read_existing(writer.directory, writer.context.destination, command['request_id'])[0]
    assert saved['resolved'] and saved['response'] == committed[0]
    assert writer.stopped
    return {'control':'native-source-registration', 'loss_method':loss_method,
            'registered_manifests':len(rows), 'roles_per_manifest':23,
            'fresh_process_exact_receipt_recovered':True, 'native_tables_unchanged':len(tables),
            'execution_resumed':False, 'storage_uploaded':False,
            'limits':'Synthetic source bytes; native artifact metadata and local object verification. No independent preparation, Storage publication, normal dispatch or scientific acceptance.'}
