"""Fresh-process source reconciliation against isolated native services."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid

import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired


def recover_sources(writer, base, token, connection, database, output, sql, *, wrong_claim=False):
    try: writer.patch_stage(writer.context.stage_id, {'status':'succeeded'})
    except ReconciliationRequired: pass
    else: raise AssertionError('Stopped source publisher accepted completion')
    tables=('public.model_runs','public.model_run_stages','public.model_stage_attempts','public.model_stage_write_receipts')
    def snapshot():
        values={table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM {table} t;") for table in tables}
        with sqlite3.connect(writer.directory/'model-commands.sqlite3') as db:
            values['admissions']=db.execute('SELECT * FROM execution_admissions ORDER BY request_id').fetchall()
        return values
    before=snapshot()
    code="""
import base64,contextlib,io,json,os,sys
config=json.load(sys.stdin)
sys.path.insert(0,config['worker'])
import requests
original=requests.request
order=[]
def adapt(method,url,**kwargs):
    assert url.startswith(config['base']+'/rest/v1/')
    kwargs['headers']={**kwargs['headers'],'apikey':config['gateway_key'],'Authorization':'Bearer '+config['gateway_key']}
    return original(method,config['gateway']+url.removeprefix(config['base']+'/rest/v1'),**kwargs)
requests.post=lambda url,**kwargs:adapt('POST',url,**kwargs)
requests.get=lambda url,**kwargs:adapt('GET',url,**kwargs)
def storage(method,url,**kwargs):
    assert url.startswith(config['base']+'/storage/v1/')
    if method=='POST':
        metadata=dict(part.split(' ',1) for part in kwargs['headers']['Upload-Metadata'].split(','))
        order.append(base64.b64decode(metadata['objectName']).decode())
    return original(method,config['base']+url.removeprefix(config['base']+'/storage/v1'),**kwargs)
requests.request=storage
os.environ['SUPABASE_SERVICE_ROLE_KEY']=config['storage_key']
import model_source_publication_recovery
capture=io.StringIO()
with contextlib.redirect_stdout(capture):
    status=model_source_publication_recovery.main(['--root',config['root'],'--journal',config['journal'],
      '--base-url',config['base'],'--deployment-id',config['database'],'--claim-request-id',config['claim'],'--method','activitysim'])
print(json.dumps({'result':json.loads(capture.getvalue()),'order':order}))
raise SystemExit(status)
"""
    config={'worker':str(Path(__file__).resolve().parents[4]/'workers/aequilibrae_worker'),
            'base':base,'gateway':connection['url'],'gateway_key':connection['service_token'],'storage_key':token,
            'root':str(writer.files.root),'journal':str(writer.directory),'database':database,
            'claim':str(uuid.uuid4()) if wrong_claim else writer.context.claim_request_id}
    result=subprocess.run([sys.executable,'-B','-c',code],input=json.dumps(config),capture_output=True,text=True,timeout=90)
    (output/'source-reconciliation.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0,'Native source reconciliation CLI failed'
    response=json.loads(result.stdout)
    assert response['result']['outcome']=='source_publication_reconciled'
    assert all(response['result'][key] is False for key in ('model_resumed','stage_status_changed','execution_admission_created'))
    assert snapshot()==before,'Source recovery changed stage or admission records'
    assert writer.stopped and journal.pending(writer.directory,writer.context.destination)==[]
    artifact=sql(database,"SELECT file_url FROM public.model_run_artifacts WHERE id='"+str(uuid.UUID(response['result']['artifact_id']))+"';")
    assert artifact.startswith('storage://run-artifacts/'),'Recovered artifact is not a Storage manifest'
    return {'manifest_uri':artifact},response['order']
