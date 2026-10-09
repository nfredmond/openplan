"""Native completed preparation producer and separately admitted assignment consumer.

Synthetic fixture bytes establish transport and custody only. No engine is run.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

import requests
from isolated_postgrest import gateway

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO/'workers/aequilibrae_worker'))
import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_validation_preparation as preparation
from test_model_skip_dispatch import aeq as worker
from test_model_validation_preparation import source_fixtures


def main():
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Owned proof source required')
    control = os.environ.get('OPENPLAN_PREPARATION_HANDOFF_CONTROL', 'normal')
    assert control in ('normal', 'harmless', 'drop-registration', 'wrong-producer', 'restored', 'lost-reply', 'lost-reply-harmless', 'lost-reply-wrong-request', 'lost-reply-bypass-stop', 'lost-reply-restored')
    database = 'openplan_attempt_cli_' + uuid.uuid4().hex
    def sql(db, body):
        result = subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'], input=body, text=True, capture_output=True, timeout=30)
        if result.returncode: raise RuntimeError(result.stderr)
        return result.stdout.strip()
    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions')
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    (output/'candidate.json').write_text(json.dumps({'container':source['container'],'database':database}, indent=2)+'\n')
    fixture = str(uuid.UUID(source['fixture_run']))
    results = []
    with gateway('public', database=database) as connection:
        base, key = connection['url'], connection['service_token']
        # The isolated gateway exposes public REST at its root. Keep the worker's
        # installation identity fixed while adapting only this test transport.
        def get(url, **kwargs): return requests.get(url.replace(base+'/rest/v1/', base+'/'), **kwargs)
        def post(url, **kwargs): return requests.post(url.replace(base+'/rest/v1/', base+'/'), **kwargs)
        for method, producer_name, consumer_name in (
                ('aequilibrae','AequilibraE Setup','Network Assignment'),
                ('activitysim','ActivitySim Bundle & Preflight','ActivitySim Network Assignment')):
            run, producer, consumer = [str(uuid.uuid4()) for _ in range(3)]
            if control=='wrong-producer': producer_name='Synthetic unrelated'
            workspace = str(uuid.UUID(sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic preparation handoff',created_by FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
('{producer}','{run}','{producer_name}','queued',1),('{consumer}','{run}','{consumer_name}','queued',2);
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")))
            directory=output/method/'journal'
            runs=output/method/'runs'
            producer_bytes={}
            producer_attempt=[]
            def prepare(context):
                writer=managed.AttemptWriter(directory,context,base_url=base,deployment_id=database,service_key=key,post=post,get=get)
                inputs=writer.workspace(runs,run)/('renamed-inputs' if control in ('harmless','lost-reply-harmless') else 'inputs')
                fixture=source_fixtures.SourceRecordsTests();fixture.setUp()
                try:
                    shutil.copytree(fixture.root,inputs)
                    arguments={name:(inputs/value.name if name in preparation.PATH_FIELDS else value) for name,value in fixture.arguments.items()}
                    arguments.update(relative_to=inputs,source_artifacts=[fixture.record],created_at='2026-10-09T00:00:00Z')
                    writer.prepare_validation_bundle(method=method,bundle_arguments=arguments)
                finally: fixture.doCleanups()
                for path in writer.files.path.rglob('*'):
                    if path.is_file():producer_bytes[path]=path.read_bytes()
                producer_attempt.append(context.attempt_id)
                writer.patch_stage(producer,{'status':'succeeded'})
            invocation.invoke_new_attempt(directory,run_id=run,stage_id=producer,worker_id='preparation-producer-proof',workspace_id=workspace,base_url=base,deployment_id=database,service_key=key,handler=prepare,post=post,get=get)
            def consume(context):
                writer=managed.AttemptWriter(directory,context,base_url=base,deployment_id=database,service_key=key,post=post,get=get)
                writer.workspace(runs,run)
                if control=='drop-registration':writer.record_artifact=lambda *args,**kwargs:None
                with managed.bind(writer):
                    if control.startswith('lost-reply'):
                        from verify_native_preparation_recovery import verify
                        result=verify(worker,writer,method,output,sql,database,base,key,control)
                    else:
                        result=worker.retain_managed_validation_preparation(method)
                assert result['execution_authorized'] is False
                assert result['producer']['attempt_id']==producer_attempt[0]!=context.attempt_id
                assert len(result['source_paths'])==6
                rows=json.loads(sql(database,f"SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.model_run_artifacts a WHERE stage_id='{consumer}';"))
                assert len(rows)==1, 'Native consumption registration missing'
                row=rows[0]
                assert row['artifact_type']=='model_validation_preparation_consumption'
                assert row['attempt_id']==context.attempt_id
                assert row['metadata_json']['producer']==result['producer']
                assert row['metadata_json']['demand_method']==method
                content=Path(row['file_url'].removeprefix('local://')).read_bytes()
                assert len(content)==row['file_size_bytes'] and hashlib.sha256(content).hexdigest()==row['content_hash']
                manifest=json.loads(content)
                for entry in manifest['entries']:
                    content=Path(result['source_paths'][entry['role']]).read_bytes()
                    assert len(content)==entry['bytes'] and hashlib.sha256(content).hexdigest()==entry['sha256']
                assert all(path.read_bytes()==content for path,content in producer_bytes.items()), 'Producer bytes changed'
                states=json.loads(sql(database,f"SELECT jsonb_object_agg(id,status) FROM public.model_run_stages WHERE run_id='{run}';"))
                assert states=={producer:'succeeded',consumer:'running'}, 'Preparation consumption changed stage status'
                results.append({'method':method,'roles':6,'producer_completed':True,'separate_consumer_attempt':True,'consumer_registered':True,'producer_bytes_unchanged':True,'execution_authorized':False,**({'recovery':result['recovery']} if 'recovery' in result else {})})
            invocation.invoke_new_attempt(directory,run_id=run,stage_id=consumer,worker_id='preparation-consumer-proof',workspace_id=workspace,base_url=base,deployment_id=database,service_key=key,handler=consume,post=post,get=get)
    report={'control':control,'results':results,'gateway_removed':True,'worker_sha256':hashlib.sha256(Path(worker.__file__).read_bytes()).hexdigest(),'limits':'Synthetic inputs and explicit managed invocation. No normal dispatcher, engine execution, structural preparation, source completeness, scientific acceptance or browser evidence.'}
    (output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
