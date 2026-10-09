"""Join retained source catalogs, native TUS objects and admitted artifact commands."""
import base64
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
import uuid
from unittest.mock import patch

import requests
from isolated_postgrest import gateway
import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_command_client as client
import model_command_journal as journal
import model_validation_source_publication as publication
from test_model_validation_source_writer import BoundSourceTests


class SourceInterruption(RuntimeError):
    pass


def verify(native, token, output, sql, database, fixture_run):
    control = os.environ.get('OPENPLAN_SOURCE_SET_CONTROL', 'normal')
    assert control in ('normal','harmless','drop-registration','wrong-reference','omit-object','lost-reply','lost-reply-wrong-request','source-interruption','source-wrong-claim','restored')
    fixture_run = str(uuid.UUID(fixture_run))
    run, stage = str(uuid.uuid4()), str(uuid.uuid4())
    workspace = str(uuid.UUID(sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic native source-set publication',created_by
 FROM public.model_runs WHERE id='{fixture_run}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES ('{stage}','{run}','Artifact Extraction','queued',1);
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")))
    original_request = requests.request
    order, results, lost = [], [], []
    headers = {'Authorization':'Bearer '+token, 'apikey':token}
    def storage_request(method, url, **kwargs):
        assert url.startswith(native+'/storage/v1/'), 'Unexpected source Storage destination'
        if method == 'POST':
            metadata = dict(part.split(' ',1) for part in kwargs['headers']['Upload-Metadata'].split(','))
            order.append(base64.b64decode(metadata['objectName']).decode())
        return original_request(method, native+url.removeprefix(native+'/storage/v1'), **kwargs)
    omitted, interrupted = [], []
    original_upload = publication.upload_file
    def upload(**kwargs):
        if control == 'omit-object' and '/sha256/' in kwargs['object_path'] and not omitted:
            omitted.append(kwargs['object_path'])
            return 'storage://' + kwargs['bucket'] + '/' + kwargs['object_path']
        result = original_upload(**kwargs)
        if control.startswith('source-') and '/validation-sources/activitysim/' in kwargs['object_path'] and not interrupted:
            interrupted.append(kwargs['object_path'])
            raise SourceInterruption('Synthetic interruption after a verified source object')
        return result
    with gateway('public', database=database) as connection:
        def adapt(method, url, **kwargs):
            assert url.startswith(native+'/rest/v1/'), 'Unexpected source custody destination'
            kwargs['headers'] = {**kwargs['headers'], 'apikey':connection['service_token'],
                                 'Authorization':'Bearer '+connection['service_token']}
            return original_request(method, connection['url']+url.removeprefix(native+'/rest/v1'), **kwargs)
        def post(url, **kwargs):
            response = adapt('POST',url,**kwargs)
            payload = kwargs.get('json', {}).get('p_payload', {})
            if (control.startswith('lost-reply') and payload.get('artifact_type')=='model_validation_source_publication'
                    and payload['metadata_json']['context']['method']=='activitysim' and not lost):
                assert response.status_code==200, 'Remote manifest artifact did not commit'
                lost.append(response.json()); response.close()
                raise TimeoutError('Synthetic lost remote manifest registration reply')
            return response
        def get(url, **kwargs): return adapt('GET',url,**kwargs)
        directory = output/'source-set-journal'
        def handler(context):
            writer = managed.AttemptWriter(directory, context, base_url=native, deployment_id=database,
                                           service_key=token, post=post, get=get)
            original_record = writer.record_artifact
            def record(payload, **kwargs):
                if payload['artifact_type']=='model_validation_source_publication':
                    if control=='drop-registration': return {}
                    if control=='wrong-reference': payload={**payload,'file_url':payload['file_url']+'-wrong'}
                return original_record(payload,**kwargs)
            fixture = SimpleNamespace(writer=writer,directory=output/'source-inputs')
            with managed.bind(writer), patch.object(writer,'record_artifact',record), patch.object(requests,'request',storage_request), patch.object(publication,'upload_file',upload):
                for method in ('aequilibrae','activitysim'):
                    args = BoundSourceTests.prepare(fixture,method)
                    if control=='harmless': args['catalog_arguments']['bindings']=dict(reversed(list(args['catalog_arguments']['bindings'].items())))
                    retained = writer.retain_validation_sources(**args)
                    try:
                        published = writer.publish_validation_sources(method=method)
                    except SourceInterruption:
                        assert control.startswith('source-') and writer.stopped and len(interrupted)==1
                        assert journal.pending(directory,context.destination)==[], 'Unexpected prepared artifact command'
                        from verify_native_source_reconciliation import recover_sources
                        published, recovered_order = recover_sources(writer, native, token, connection, database, output, sql,
                            wrong_claim=control=='source-wrong-claim')
                        order.extend(recovered_order)
                    except client.DeliveryUnconfirmed:
                        assert control.startswith('lost-reply') and writer.stopped and len(lost)==1
                        pending = journal.pending(directory,context.destination)
                        assert len(pending)==1 and pending[0]['command']['operation']=='write_model_attempt_artifact'
                        published = {'manifest_uri':pending[0]['command']['arguments']['payload']['file_url']}
                        recover(writer, pending[0]['command'], lost[0], native, connection, database, output, sql,
                                wrong_request=control=='lost-reply-wrong-request')
                    results.append({'method':method,'retained':retained,'published':published,'attempt':context.attempt_id})
        invocation.invoke_new_attempt(directory,run_id=run,stage_id=stage,worker_id='native-source-set',workspace_id=workspace,
                                      base_url=native,deployment_id=database,service_key=token,handler=handler,post=post,get=get)
    rows=json.loads(sql(database,f"SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.model_run_artifacts a WHERE stage_id='{stage}';"))
    assert len(rows)==4,'Native source artifact inventory differs'
    object_count=0
    for result in results:
        method=result['method']
        local=next(row for row in rows if row['artifact_type']=='model_validation_sources' and row['metadata_json']['context']['method']==method)
        remote=next(row for row in rows if row['artifact_type']=='model_validation_source_publication' and row['metadata_json']['context']['method']==method)
        assert remote['file_url']==result['published']['manifest_uri'],'Registered source manifest URI differs'
        assert local['content_hash']==remote['content_hash']==result['retained']['manifest_sha256']
        assert local['attempt_id']==remote['attempt_id']==result['attempt']
        assert remote['metadata_json']['context']['workspace_id']==workspace
        path=remote['file_url'].removeprefix('storage://')
        with original_request('GET',native+'/object/authenticated/'+path,headers=headers,timeout=15) as response:
            assert response.status_code==200,'Native source manifest unavailable'
            content=response.content
        assert hashlib.sha256(content).hexdigest()==remote['content_hash'] and len(content)==remote['file_size_bytes']
        assert content==Path(result['retained']['manifest_path']).read_bytes(),'Published source manifest changed original bytes'
        catalog=json.loads(content)
        assert len(catalog['entries'])==23 and catalog['context']['method']==method
        prefix=path.removesuffix('manifest.json')
        unique={entry['object_name']:entry['artifact'] for entry in catalog['entries']}
        for name,artifact in unique.items():
            with original_request('GET',native+'/object/authenticated/'+prefix+name,headers=headers,timeout=15) as response:
                assert response.status_code==200,'Declared native source object unavailable'
                data=response.content
            assert len(data)==artifact['bytes'] and hashlib.sha256(data).hexdigest()==artifact['sha256'],'Native source object bytes differ'
        method_order=[name for name in order if '/validation-sources/'+method+'/' in name]
        assert len(method_order)==len(unique)+1 and method_order[-1].endswith('/manifest.json'),'Native source manifest was not uploaded last'
        object_count+=len(unique)+1
    (output/'upload-order.json').write_text(json.dumps(order,indent=2)+'\n')
    return {'control':control,'methods':2,'native_artifacts':4,'roles_per_method':23,
            'native_objects_verified':object_count,'unchanged_manifests':True,'manifest_last':True,
            'postgrest_gateway_removed':True,'fresh_process_receipt_recovered':bool(lost),
            'fresh_process_source_recovered':bool(interrupted),
            'limits':'Joined native TUS and admitted artifact commands over synthetic source sets. Source recovery interrupts between verified objects, not mid-object or a process kill. No normal dispatch, independent preparation, human or scientific acceptance.'}


def recover(writer, command, committed, base, connection, database, output, sql, *, wrong_request):
    try: writer.patch_stage(writer.context.stage_id, {'status':'succeeded'})
    except invocation.ReconciliationRequired: pass
    else: raise AssertionError('Stopped publisher accepted completion')
    tables=('public.model_runs','public.model_run_stages','public.model_stage_attempts',
            'public.model_run_artifacts','public.model_artifact_write_receipts','public.model_stage_write_receipts','storage.objects')
    def snapshot():
        return {table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM {table} t;") for table in tables}
    before=snapshot()
    code="""
import json,os,sys
config=json.load(sys.stdin)
sys.path.insert(0,config['worker'])
import requests
original=requests.post
def post(url,**kwargs):
    assert url.startswith(config['base']+'/rest/v1/')
    return original(config['gateway']+url.removeprefix(config['base']+'/rest/v1'),**kwargs)
requests.post=post
os.environ['SUPABASE_SERVICE_ROLE_KEY']=config['key']
import model_command_recovery
raise SystemExit(model_command_recovery.main(['--journal',config['journal'],'--base-url',config['base'],
 '--deployment-id',config['database'],'--request-id',config['request']]))
"""
    config={'worker':str(Path(__file__).resolve().parents[4]/'workers/aequilibrae_worker'),
            'base':base,'gateway':connection['url'],'key':connection['service_token'],
            'journal':str(writer.directory),'database':database,
            'request':str(uuid.uuid4()) if wrong_request else command['request_id']}
    result=subprocess.run([sys.executable,'-B','-c',code],input=json.dumps(config),capture_output=True,text=True,timeout=30)
    (output/'remote-artifact-recovery.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0, 'Remote artifact receipt recovery failed'
    response=json.loads(result.stdout)
    assert response['outcome']=='command_receipt_retained' and response['model_resumed'] is False
    assert snapshot()==before, 'Remote artifact recovery changed native records'
    saved=journal.read_existing(writer.directory,writer.context.destination,command['request_id'])[0]
    assert saved['resolved'] and saved['response']==committed and writer.stopped
    assert journal.pending(writer.directory,writer.context.destination)==[]
