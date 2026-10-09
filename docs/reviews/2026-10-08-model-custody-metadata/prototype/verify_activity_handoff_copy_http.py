"""Actual database-selected ActivitySim file handoff against an owned native database clone."""
import inspect
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import types
import uuid
import requests
from isolated_postgrest import gateway
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_predecessor_inputs as predecessor
from test_model_skip_dispatch import activity as worker
import model_activitysim_handoff as handoff


def main():
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}',source['database']):
        raise ValueError('Owned installed proof source required')
    database = 'openplan_attempt_cli_' + uuid.uuid4().hex
    def sql(db, body):
        result = subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],
                                input=body,text=True,capture_output=True,timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    if sql('postgres',f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions')
    sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    (output/'candidate.json').write_text(json.dumps({'container':source['container'],'database':database,'source_database':source['database']},indent=2)+'\n')
    fixture = str(uuid.UUID(source['fixture_run']))
    run, producer, unrelated, consumer, expected_artifact, unrelated_artifact = [str(uuid.uuid4()) for _ in range(6)]
    workspace = sql(database,f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic predecessor read',created_by FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('{producer}','{run}','Artifact Extraction','queued',1),
 ('{unrelated}','{run}','Synthetic unrelated','queued',2),
 ('{consumer}','{run}','ActivitySim Bundle & Preflight','queued',3);
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")
    workspace = str(uuid.UUID(workspace))
    mode=os.environ.get('OPENPLAN_HANDOFF_COPY_MODE','normal')
    assert mode in ('normal','harmless','tampered','bypass-hash','drop-provenance','restored')
    source_root=output/'screening';source_dir=source_root/'runs'/run;source_dir.mkdir(parents=True)
    os.environ['AEQ_WORK_DIR']=str(source_root)
    source_files={}
    native_files=None
    if os.environ.get('OPENPLAN_STAGE_PUBLICATION_CONTROL')=='native':
        native_root=Path('/home/nathaniel/code/openplan/data/screening-runs/study-08014-base')
        original_manifest=json.loads((native_root/'bundle_manifest.json').read_text())
        native_files={'zone_attributes':(native_root/'package/zone_attributes.csv').read_bytes(),
            'skim_matrix':(native_root/'run_output/travel_time_skims.omx').read_bytes(),
            'network_setup_summary':json.dumps({'network':original_manifest['network'],'source':'development screening bundle manifest; network excerpt for integration fixture'}).encode()}
    expected_ids=[]; unrelated_ids=[]
    for stage, target in ((producer,expected_ids),(unrelated,unrelated_ids)):
        receipt = json.loads(sql(database,f"SET ROLE service_role; SELECT public.claim_model_stage_attempt('{uuid.uuid4()}','{stage}','native-activity-handoff');"))
        attempt = str(uuid.UUID(receipt['attempt_id']))
        for kind in handoff.KINDS:
            artifact=str(uuid.uuid4());target.append(artifact)
            content=('synthetic '+stage+' '+kind).encode()
            if kind=='zone_attributes':
                content=b'GEOID,NAMELSAD,zone_id,centroid_lon,centroid_lat,area_sq_mi,total_jobs,retail_jobs,health_jobs,education_jobs,accommodation_jobs,govt_jobs,est_population,households\n06001000100,Synthetic zone,1,-121.7,38.55,2.5,400,80,40,30,20,10,3000,1200\n'
            elif kind=='network_setup_summary':content=b'{"synthetic":true}'
            if native_files is not None:content=native_files[kind]
            path=source_dir/(stage+'-'+kind);path.write_bytes(content)
            if stage==producer:source_files[kind]=(path,content)
            payload=json.dumps({'id':artifact,'artifact_type':kind,'file_url':'local://'+str(path),
                'content_hash':hashlib.sha256(content).hexdigest(),'file_size_bytes':len(content),'metadata_json':{'scientific_acceptance':'unassessed'}})
            sql(database,f"SET ROLE service_role; SELECT public.write_model_attempt_artifact('{uuid.uuid4()}','{attempt}','{payload}'::jsonb);")
        sql(database,f"SET ROLE service_role; SELECT public.write_model_stage_attempt('{uuid.uuid4()}','{attempt}','succeeded','Synthetic complete',NULL);")
    calls, results = [], []
    publication = os.environ.get('OPENPLAN_STAGE_PUBLICATION_CONTROL')
    storage = {}
    original = Path(predecessor.__file__).read_text()
    def snapshot():
        tables=('model_runs','model_run_stages','model_stage_attempts','model_run_artifacts','model_stage_claim_receipts','model_stage_write_receipts','model_artifact_write_receipts')
        return {table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
    with gateway('public',database=database) as connection:
        key=connection['service_token']
        class Bridge(BaseHTTPRequestHandler):
            def log_message(self,*args):
                pass
            def forward(self,method):
                path=self.path.removeprefix('/rest/v1')
                if publication and self.path.startswith('/storage/v1/object/'):
                    if self.headers.get('Authorization') != 'Bearer '+key:
                        self.send_error(403);return
                    object_key=self.path.removeprefix('/storage/v1/object/').removeprefix('authenticated/')
                    if method=='POST':
                        content=self.rfile.read(int(self.headers.get('Content-Length','0')))
                        storage.setdefault(object_key,content)
                        status,content=200,b'{}'
                    else:
                        status,content=(200,storage[object_key]) if object_key in storage else (404,b'{}')
                    self.send_response(status);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content);return
                allowed=(method=='GET' and (path.startswith('/model_run_stages?') or path.startswith('/model_run_artifacts?'))) or (method=='POST' and (path=='/rpc/claim_model_stage_attempt' or (publication and path in ('/rpc/write_model_stage_attempt','/rpc/write_model_attempt_artifact','/rpc/write_model_attempt_kpi'))))
                if not allowed or self.headers.get('Authorization')!='Bearer '+key:
                    self.send_error(403);return
                body=self.rfile.read(int(self.headers.get('Content-Length','0')))
                with requests.request(method,connection['url']+path,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},data=body or None,timeout=15) as response:
                    status,content=response.status_code,response.content
                calls.append({'method':method,'status':status})
                self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
            def do_GET(self):
                self.forward('GET')
            def do_POST(self):
                self.forward('POST')
        server=HTTPServer(('127.0.0.1',0),Bridge)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        directory=output/'journal'
        try:
            def handler(context):
                writer=managed.AttemptWriter(directory,context,base_url=base,deployment_id=database,service_key=key)
                before=snapshot()
                try:
                    with managed.bind(writer):
                        for control in ('baseline','harmless','wrong-predecessor-name','restored'):
                            body=original+ ('\n# Harmless comment.\n' if control=='harmless' else '')
                            if control=='wrong-predecessor-name':
                                anchor="'ActivitySim Bundle & Preflight': 'Artifact Extraction'"
                                if body.count(anchor)!=1:raise AssertionError('Native mutation anchor changed')
                                body=body.replace(anchor,"'ActivitySim Bundle & Preflight': 'Synthetic unrelated'")
                            candidate=types.ModuleType('model_predecessor_inputs')
                            exec(compile(body,predecessor.__file__,'exec'),candidate.__dict__)
                            handoff.select=candidate.select
                            selected=worker.sb_get_run_artifacts(run)
                            fault_detected=False
                            try:
                                assert [row['id'] for row in selected]==expected_ids, 'Native declared producer selection differs'
                            except AssertionError:
                                if control!='wrong-predecessor-name':raise
                                fault_detected=True
                            if control=='wrong-predecessor-name' and not fault_detected:
                                raise AssertionError('Wrong selector mutation survived the declared-producer check')
                            results.append({'control':control,'selected_declared_producer':not fault_detected,'fault_detected':fault_detected})
                        if snapshot()!=before:raise AssertionError('Predecessor reads mutated native records')
                        if publication:
                            from verify_activity_stage_publication import verify_stage
                            results.append(verify_stage(worker,writer,run,consumer,base,key,output,storage,sql,database,publication))
                            return
                        destination=writer.workspace(output/'consumer',run)
                        import model_handoff_files
                        original_copy=model_handoff_files.copy_registered
                        if mode=='bypass-hash':
                            body=Path(model_handoff_files.__file__).read_text()
                            anchor='if size != size_bytes or digest.hexdigest() != sha256:'
                            assert body.count(anchor)==1
                            candidate=types.ModuleType('faulty_copy')
                            exec(compile(body.replace(anchor,'if size != size_bytes:'),model_handoff_files.__file__,'exec'),candidate.__dict__)
                            model_handoff_files.copy_registered=candidate.copy_registered
                        try:
                            selected=worker.sb_get_run_artifacts(run)
                            for kind in handoff.KINDS:
                                path,content=source_files[kind]
                                corrupt=mode in ('tampered','bypass-hash') and kind==handoff.KINDS[-1]
                                if corrupt:path.write_bytes(b'x'*len(content))
                                try:
                                    copied=worker._retain_handoff_file(selected,kind,run,str(destination))
                                except RuntimeError as error:
                                    if not corrupt or 'Handoff bytes differ from registered artifact' not in str(error):raise
                                    assert writer.stopped and not (destination/(kind+'.retained')).exists()
                                    results.append({'control':'changed-source-bytes','refused':True,'writer_stopped':True})
                                else:
                                    assert not corrupt, 'Corrupted source survived registered-byte verification'
                                    assert Path(copied).read_bytes()==content and path.read_bytes()==content
                                    results.append({'control':'retained-'+kind,'registered_bytes_match':True})
                        finally:
                            model_handoff_files.copy_registered=original_copy
                        if mode=='tampered':
                            assert snapshot()==before,'Copy changed database records'
                            return
                        materialize=worker._materialize_screening_dir
                        if mode=='drop-provenance':
                            body=inspect.getsource(materialize)
                            anchor='"model_run_id": run_id,'
                            assert body.count(anchor)==1
                            scope=dict(worker.__dict__)
                            exec(compile(body.replace(anchor,'"model_run_id": None,'),worker.__file__,'exec'),scope)
                            materialize=scope['_materialize_screening_dir']
                        screening=Path(materialize(run,str(destination/'skim_matrix.retained'),
                            str(destination/'zone_attributes.retained'),str(destination/'network_setup_summary.retained'),
                            str(destination),source_artifacts=selected,consumer_stage_id=consumer))
                        manifest=json.loads((screening/'bundle_manifest.json').read_text())
                        assert manifest['model_run_id']==run and manifest['consumer_stage_id']==consumer, 'Materialized handoff lost run or consumer provenance'
                        assert [row['id'] for row in manifest['source_artifacts']]==expected_ids
                        for entry in manifest['materialized_files']:
                            content=(screening/entry['path']).read_bytes()
                            assert len(content)==entry['bytes'] and hashlib.sha256(content).hexdigest()==entry['sha256']
                        import shutil
                        assert shutil.which('activitysim') is None,'Preflight proof requires no implicit native CLI'
                        sys.path.insert(0,str(REPO/'scripts/modeling'))
                        from run_behavioral_demand_prototype import run_behavioral_demand_prototype
                        pipeline=run_behavioral_demand_prototype(screening_run_dir=str(screening),
                            output_root=str(destination/'pipeline'),population_source='scaffold',config_package='starter')
                        assert pipeline['pipeline_status']=='prototype_preflight_complete' and pipeline['runtime_mode']=='preflight_only'
                        for path,content in source_files.values():assert path.read_bytes()==content
                        results.append({'control':'joined-preflight','materialized_provenance_verified':True,'pipeline_status':pipeline['pipeline_status'],'native_model_executed':False})
                        sql(database,f"SET ROLE service_role; SELECT public.write_model_stage_attempt('{uuid.uuid4()}','{context.attempt_id}','failed','Synthetic revocation',NULL);")
                        before=snapshot()
                        try:
                            worker.sb_get_run_artifacts(run)
                        except worker.WorkerStateReadUnconfirmed:
                            pass
                        else:
                            raise AssertionError('Database-revoked consumer attempt accepted')
                        if not writer.stopped:raise AssertionError('Refused read did not stop writer')
                        results.append({'control':'database-revoked-consumer','refused':True,'writer_stopped':True})
                finally:
                    handoff.select=predecessor.select
                if snapshot()!=before:raise AssertionError('Predecessor reads mutated native records')
            invocation.invoke_new_attempt(directory,run_id=run,stage_id=consumer,worker_id='native-predecessor-consumer',workspace_id=workspace,
                                          base_url=base,deployment_id=database,service_key=key,handler=handler)
        finally:
            server.shutdown();thread.join(timeout=5);server.server_close()
    report={'handoff_sha256':hashlib.sha256(Path(handoff.__file__).read_bytes()).hexdigest(),'selector_sha256':hashlib.sha256(original.encode()).hexdigest(),'worker_sha256':hashlib.sha256(Path(worker.__file__).read_bytes()).hexdigest(),
            'controls':results,'http_calls':calls,'native_tables_unchanged':7,'gateway_removed':True,
            'limits':'Actual ActivitySim adapter, fresh admitted consumer, native completed producers and three later unrelated artifacts. The consumer attempt is failed by an explicit database command before the refused read; table snapshots exclude that declared mutation. Synthetic files are retained, materialized and passed through the actual scaffold preflight pipeline. No model execution, full dispatcher, RLS matrix, concurrent revocation fence or scientific acceptance.'}
    if publication:
        report.pop('native_tables_unchanged')
        report['limits']='Actual stage handler, native database commands and scaffold pipeline. Storage HTTP byte service is synthetic. No normal dispatcher, native model, real Storage service, concurrent revocation fence or scientific acceptance.'
        if publication=='native':
            report['limits']='Actual native runtime, ingestion, demand packaging and managed writes; copied prepared development bundle with 100-household sample. Synthetic Storage byte service. No Census rebuild, normal dispatcher, full population or scientific acceptance.'
        content=json.dumps(report,indent=2)+'\n'
        (output/'activity-stage-publication.json').write_text(content)
        print(content)
        return
    content=json.dumps(report,indent=2)+'\n'
    (output/'activity-handoff-copy-http.json').write_text(content);(ROOT/'activity-handoff-copy-http.json').write_text(content)
    print(content)


if __name__=='__main__':main()
