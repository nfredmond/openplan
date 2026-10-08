"""Native state/package pairing with real files and an explicit mapping control."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import types
import uuid
import requests
from isolated_postgrest import gateway
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_command_client as client
import model_command_journal as journal
import model_package_inputs as package
import model_predecessor_inputs as predecessor
from worker_import_for_tests import import_worker_main


def main(*, include_project=False):
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    source=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}',source['database']):
        raise ValueError('Owned installed proof source required')
    database='openplan_attempt_cli_'+uuid.uuid4().hex
    def sql(db,body):
        result=subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],input=body,text=True,capture_output=True,timeout=30)
        if result.returncode:raise RuntimeError(result.stderr)
        return result.stdout.strip()
    if sql('postgres',f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';")!='0':
        raise RuntimeError('Source has active sessions')
    sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    (output/'candidate.json').write_text(json.dumps({'container':source['container'],'database':database,'source_database':source['database']},indent=2)+'\n')
    if sql(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000021';")!='1':
        raise AssertionError('Installed migration21 required')
    fixture=str(uuid.UUID(source['fixture_run']))
    worker=import_worker_main()
    original=Path(predecessor.__file__).read_text()
    results=[]
    with gateway('public',database=database) as connection:
        base,key=connection['url'],connection['service_token']
        calls=[]
        dropped={'mapping':False}
        def transport(method,url,**kwargs):
            # The isolated gateway exposes PostgREST directly, without /rest/v1.
            if not url.startswith(base+'/rest/v1/'):
                raise AssertionError('Unexpected native proof destination')
            response=requests.request(method,base+'/'+url.removeprefix(base+'/rest/v1/'),**kwargs)
            calls.append({'method':method,'status':response.status_code})
            if (control=='lost-mapping-reply' and method=='POST' and response.status_code==200
                    and kwargs.get('json',{}).get('p_payload',{}).get('artifact_type')=='model_input_mapping'
                    and not dropped['mapping']):
                dropped['mapping']=True
                response.close()
                raise requests.Timeout('Synthetic committed mapping reply loss')
            return response
        def get(url,**kwargs):return transport('GET',url,**kwargs)
        def post(url,**kwargs):return transport('POST',url,**kwargs)
        try:
            for control in ('baseline','harmless','omit-package-mapping','source-mismatch','lost-mapping-reply','restored'):
                start=len(calls)
                run,producer_stage,consumer_stage,state_id,package_id=[str(uuid.uuid4()) for _ in range(5)]
                workspace=sql(database,f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic paired input proof',created_by FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('{producer_stage}','{run}','Network Assignment','queued',1),('{consumer_stage}','{run}','Artifact Extraction','queued',2);
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")
                workspace=str(uuid.UUID(workspace))
                claim=json.loads(sql(database,f"SET ROLE service_role; SELECT public.claim_model_stage_attempt('{uuid.uuid4()}','{producer_stage}','native-paired-producer');"))
                attempt=str(uuid.UUID(claim['attempt_id']))
                installation=hashlib.sha256(client.destination(base,database).encode()).hexdigest()
                producer=output/'files/runs'/run/'attempts'/installation/producer_stage/attempt
                source_package=producer/'package';source_package.mkdir(parents=True)
                (source_package/'zones.csv').write_bytes(b'zone,population\n1,123\n')
                package_record=package.retain(source_package,producer/'package_inputs')
                original_state={'package':{'package_dir':str(source_package) if control!='source-mismatch' else '/different/package',
                                           'source_label':str(source_package)},'setup':{'bbox':[-122,38,-120,40]},'assignment':{'counts_path':'/original/counts.csv'}}
                state_content=(json.dumps(original_state)+'\n').encode()
                state_path=producer/'predecessor_state.json';state_path.write_bytes(state_content)
                payloads=[{'id':state_id,'artifact_type':'model_predecessor_state','file_url':'local://'+str(state_path),
                           'content_hash':hashlib.sha256(state_content).hexdigest(),'file_size_bytes':len(state_content),'metadata_json':{'schema':'openplan.predecessor-state.v1'}},
                          {'id':package_id,'artifact_type':'model_package_inputs','file_url':'local://'+package_record['manifest_path'],
                           'content_hash':package_record['manifest_sha256'],'file_size_bytes':package_record['manifest_size_bytes'],'metadata_json':{'schema':'openplan.package-inputs.v1'}}]
                if include_project:
                    import sqlite3
                    import model_project_inputs
                    project_id=str(uuid.uuid4())
                    source_project=producer/'aeq_project';source_project.mkdir()
                    db=sqlite3.connect(source_project/'project_database.sqlite')
                    db.execute('CREATE TABLE evidence (id INTEGER)');db.execute('INSERT INTO evidence VALUES (7)')
                    db.commit();db.close()
                    project_bytes=(source_project/'project_database.sqlite').read_bytes()
                    project_record=model_project_inputs.retain(source_project,producer/'project_inputs')
                    payloads.append({'id':project_id,'artifact_type':'model_project_inputs',
                        'file_url':'local://'+project_record['manifest_path'],'content_hash':project_record['manifest_sha256'],
                        'file_size_bytes':project_record['manifest_size_bytes'],
                        'metadata_json':{'schema':'openplan.project-inputs.v1','inventory_schema':'openplan.package-inputs.v1',
                            'database_checks':project_record['database_checks'],'database_consistency':project_record['database_consistency'],
                            'engine_closure':'unassessed','cross_database_consistency':'unassessed',
                            'scientific_acceptance':'unassessed','execution_ready':False}})
                for payload in payloads:
                    encoded=json.dumps(payload).replace("'","''")
                    sql(database,f"SET ROLE service_role; SELECT public.write_model_attempt_artifact('{uuid.uuid4()}','{attempt}','{encoded}'::jsonb);")
                sql(database,f"SET ROLE service_role; SELECT public.write_model_stage_attempt('{uuid.uuid4()}','{attempt}','succeeded','Synthetic complete',NULL);")
                before=sql(database,f"SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_run_artifacts a WHERE stage_id='{producer_stage}';")
                body=original+ ('\n# Harmless comment.\n' if control=='harmless' else '')
                if control=='omit-package-mapping':
                    anchor="mapped['package']['package_dir'] = package_input['package_directory']"
                    if body.count(anchor)!=1:raise AssertionError('Mapping mutation anchor changed')
                    body=body.replace(anchor,'pass')
                candidate=types.ModuleType('model_predecessor_inputs');exec(compile(body,predecessor.__file__,'exec'),candidate.__dict__)
                sys.modules['model_predecessor_inputs']=candidate
                directory=output/control/'journal'
                writers=[]
                def handler(context):
                    writer=managed.AttemptWriter(directory,context,base_url=base,deployment_id=database,service_key=key,post=post,get=get)
                    writers.append(writer)
                    writer.workspace(output/'files/runs',run)
                    with managed.bind(writer):
                        try:
                            result=worker.retain_managed_state_and_package(include_project=include_project)
                        except worker.WorkerStateWriteUnconfirmed as error:
                            if control=='lost-mapping-reply':
                                if not dropped['mapping'] or not writer.stopped:raise
                                return {'delivery_unconfirmed':True,'writer_stopped':True}
                            if control!='source-mismatch' or 'source directory disagree' not in str(error.__cause__) or not writer.stopped:raise
                            return {'refused':True,'writer_stopped':True}
                    mapped=result['package_mapped_state']
                    expected={**original_state,'package':{**original_state['package'],'package_dir':str(writer.files.path/'package_working/files') if include_project else result['package_input']['package_directory']}}
                    if mapped!=expected:
                        if control!='omit-package-mapping':raise AssertionError('Native paired mapping differs')
                        return {'mapping_fault_detected':True}
                    if control=='omit-package-mapping':raise AssertionError('Missing mapping fault passed')
                    if result['execution_ready'] is not False or result['state_input']['state']!=original_state:
                        raise AssertionError('Native pair altered original state or claimed readiness')
                    if Path(result['state_input']['retained_path']).read_bytes()!=state_content or state_path.read_bytes()!=state_content:
                        raise AssertionError('Native pair changed original state bytes')
                    return {'paired':True,'original_preserved':True,'execution_ready':False}
                outcome=invocation.invoke_new_attempt(directory,run_id=run,stage_id=consumer_stage,worker_id='native-paired-consumer',workspace_id=workspace,
                    base_url=base,deployment_id=database,service_key=key,handler=handler,post=post,get=get)
                records=json.loads(sql(database,f"SELECT jsonb_agg(to_jsonb(a) ORDER BY artifact_type) FROM public.model_run_artifacts a WHERE stage_id='{consumer_stage}';"))
                expected_types=['model_package_consumption','model_state_consumption']
                if control!='source-mismatch':
                    expected_types.insert(0,'model_input_mapping')
                    if include_project:expected_types=sorted(expected_types+['model_project_consumption','model_project_working_copy','model_package_working_copy'])
                if [row['artifact_type'] for row in records]!=expected_types:
                    raise AssertionError('Native paired input/mapping records differ')
                for row in records:
                    if row['artifact_type']=='model_input_mapping':
                        mapping_path=Path(row['file_url'].removeprefix('local://'))
                        content=mapping_path.read_bytes();mapping=json.loads(content)
                        expected_saved_state={**original_state,'package':{**original_state['package'],
                            'package_dir':str(mapping_path.parent/('package_working/files' if include_project else 'predecessor_package/files'))}}
                        if control=='omit-package-mapping':expected_saved_state=original_state
                        if mapping['state']!=expected_saved_state:
                            raise AssertionError('Native saved mapping state differs')
                        if (row['content_hash']!=hashlib.sha256(content).hexdigest() or row['file_size_bytes']!=len(content)
                                or mapping['execution_ready'] is not False or mapping['mapped_fields']!=['package.package_dir']
                                or mapping['inputs']['state']['artifact_id']!=state_id
                                or mapping['inputs']['package']['artifact_id']!=package_id
                                or row['metadata_json']['inputs']!=mapping['inputs']):
                            raise AssertionError('Native durable mapping identity differs')
                        if include_project:
                            working_dir=mapping_path.parent/'project_working/files'
                            working_manifest=mapping_path.parent/'project_working/manifest.json'
                            consumed_manifest=mapping_path.parent/'predecessor_project/manifest.json'
                            if (mapping['inputs']['project']['artifact_id']!=project_id
                                    or mapping['execution_paths']!={'project_directory':str(working_dir)}
                                    or mapping['working_project']['initial_manifest_path']!=str(working_manifest)
                                    or mapping['working_project']['initial_manifest_sha256']!=hashlib.sha256(working_manifest.read_bytes()).hexdigest()
                                    or mapping['working_project']['input_manifest_sha256']!=hashlib.sha256(consumed_manifest.read_bytes()).hexdigest()):
                                raise AssertionError('Native combined mapping lost project working identity')
                            package_manifest=mapping_path.parent/'package_working/manifest.json'
                            consumed_package=mapping_path.parent/'predecessor_package/manifest.json'
                            if (mapping['working_package']['initial_manifest_path']!=str(package_manifest)
                                    or mapping['working_package']['initial_manifest_sha256']!=hashlib.sha256(package_manifest.read_bytes()).hexdigest()
                                    or mapping['working_package']['input_manifest_sha256']!=hashlib.sha256(consumed_package.read_bytes()).hexdigest()):
                                raise AssertionError('Native combined mapping lost package working identity')
                        continue
                    if include_project and row['artifact_type'] in ('model_project_consumption','model_project_working_copy'):
                        manifest_path=Path(row['file_url'].removeprefix('local://'))
                        manifest_bytes=manifest_path.read_bytes()
                        copied=manifest_path.parent/'files/project_database.sqlite'
                        retained_project=producer/'project_inputs/files/project_database.sqlite'
                        if (row['content_hash']!=hashlib.sha256(manifest_bytes).hexdigest()
                                or row['file_size_bytes']!=len(manifest_bytes)
                                or copied.read_bytes()!=project_bytes or retained_project.read_bytes()!=project_bytes
                                or copied.stat().st_ino==retained_project.stat().st_ino
                                or row['metadata_json']['database_checks']!=project_record['database_checks']
                                or row['metadata_json']['execution_ready'] is not False):
                            raise AssertionError('Native combined project bytes or checks differ')
                        if row['artifact_type']=='model_project_working_copy':
                            consumed=manifest_path.parent.parent/'predecessor_project'
                            if (row['metadata_json']['role']!='initial_working_inventory'
                                    or row['metadata_json']['files_mutable'] is not True
                                    or row['metadata_json']['input_manifest_sha256']!=hashlib.sha256((consumed/'manifest.json').read_bytes()).hexdigest()
                                    or copied.stat().st_ino==(consumed/'files/project_database.sqlite').stat().st_ino):
                                raise AssertionError('Native combined working boundary differs')
                    if include_project and row['artifact_type']=='model_package_working_copy':
                        manifest_path=Path(row['file_url'].removeprefix('local://'))
                        content=manifest_path.read_bytes()
                        consumed=manifest_path.parent.parent/'predecessor_package'
                        copied=manifest_path.parent/'files/zones.csv'
                        if (row['content_hash']!=hashlib.sha256(content).hexdigest()
                                or row['file_size_bytes']!=len(content)
                                or row['metadata_json']['role']!='initial_working_inventory'
                                or row['metadata_json']['files_mutable'] is not True
                                or row['metadata_json']['execution_ready'] is not False
                                or row['metadata_json']['input_manifest_sha256']!=hashlib.sha256((consumed/'manifest.json').read_bytes()).hexdigest()
                                or copied.read_bytes()!=(consumed/'files/zones.csv').read_bytes()
                                or copied.stat().st_ino==(consumed/'files/zones.csv').stat().st_ino):
                            raise AssertionError('Native combined package working boundary differs')
                    provenance=row['metadata_json']['producer']
                    expected_id=(project_id if include_project and row['artifact_type'] in ('model_project_consumption','model_project_working_copy') else package_id if row['artifact_type'] in ('model_package_consumption','model_package_working_copy') else state_id)
                    if provenance['artifact_id']!=expected_id or provenance['stage_id']!=producer_stage or provenance['attempt_id']!=attempt:
                        raise AssertionError('Native paired provenance differs')
                if sql(database,f"SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_run_artifacts a WHERE stage_id='{producer_stage}';")!=before:
                    raise AssertionError('Native pair rewrote producer artifacts')
                if control=='lost-mapping-reply':
                    pending=journal.pending(directory,client.destination(base,database))
                    if len(pending)!=1 or pending[0]['command']['arguments']['payload']['artifact_type']!='model_input_mapping':
                        raise AssertionError('Exact pending mapping command missing')
                    request=pending[0]['command']['request_id']
                    def snapshot():
                        tables=('model_runs','model_run_stages','model_stage_attempts','model_run_artifacts','model_stage_claim_receipts','model_stage_write_receipts','model_artifact_write_receipts')
                        return {table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
                    saved=snapshot()
                    shim="""
import os,requests
import model_command_recovery as recovery
original=requests.post
def post(url,**kwargs):
 if os.environ.get('OPENPLAN_PROOF_CACHED')=='1':raise AssertionError('Cached recovery attempted HTTP')
 return original(url.replace('/rest/v1/','/'),**kwargs)
requests.post=post
raise SystemExit(recovery.main())
"""
                    argv=[sys.executable,'-B','-c',shim,'--journal',str(directory),'--base-url',base,'--deployment-id',database,'--request-id',request]
                    for cached in (False,True):
                        response=subprocess.run(argv,cwd=REPO/'workers/aequilibrae_worker',capture_output=True,text=True,timeout=40,
                            env={**os.environ,'SUPABASE_SERVICE_ROLE_KEY':'' if cached else key,'OPENPLAN_PROOF_CACHED':'1' if cached else '0'})
                        if response.returncode or json.loads(response.stdout)!={'request_id':request,'outcome':'command_receipt_retained','model_resumed':False}:
                            raise AssertionError('Fresh CLI mapping recovery failed: '+response.stderr)
                        if key in response.stdout or key in response.stderr:raise AssertionError('Recovery disclosed credential')
                    if snapshot()!=saved:raise AssertionError('Mapping recovery changed native records')
                    try: writers[0].require_open()
                    except invocation.ReconciliationRequired: pass
                    else: raise AssertionError('Mapping recovery reopened writer')
                    outcome.update(fresh_cli_recovered=True,cached_no_http=True,native_tables_unchanged=7)
                results.append({'control':control,'outcome':outcome,'consumer_artifacts':len(records),'http_calls':calls[start:]})
        finally:
            sys.modules['model_predecessor_inputs']=predecessor
    report={'selector_sha256':hashlib.sha256(original.encode()).hexdigest(),'worker_sha256':hashlib.sha256(Path(worker.__file__).read_bytes()).hexdigest(),
            'controls':results,'gateway_removed':True,'limits':'Actual paired helper and native commands through a route-prefix transport adapter. Producer fixture registration uses native SQL commands. Durable partial mapping is verified. Fresh CLI mapping recovery uses the same route-prefix adapter; cached recovery forbids HTTP. No project/output/count mapping, full dispatcher or scientific acceptance.'}
    if include_project:
        report['limits']='Actual combined state/package/project and working-copy helper with native commands through a direct-PostgREST route-prefix adapter. Producer fixture registration uses native SQL commands. Final mapping lost-reply recovery uses a fresh CLI with the same adapter; cached recovery forbids HTTP. No complete output/count mapping, closure enforcement, full dispatcher or scientific acceptance.'
    content=json.dumps(report,indent=2)+'\n'
    name='execution-input-http.json' if include_project else 'paired-input-http.json'
    (output/name).write_text(content);(ROOT/name).write_text(content)
    print(content)


if __name__=='__main__':main()
