"""Full native assignment with actual claims, reads and writes in a cloned database."""
from http.server import BaseHTTPRequestHandler,HTTPServer
import json,os,re,subprocess,threading,uuid
from pathlib import Path
import requests
from isolated_postgrest import gateway
import verify_native_bound_assignment as native
import model_attempt_invocation as invocation
import model_attempt_writer as managed

source=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
if source['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}',source['database']):
    raise ValueError('Owned retention template required')
output=Path(os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT']).absolute()
output.mkdir(mode=0o700,parents=True,exist_ok=False)
control=os.environ.get('OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROL','baseline')
if control not in ('baseline','harmless','omit-geometry-registration'):raise ValueError('Unknown native HTTP control')
def sql(database,statement):
    result=subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=30)
    if result.returncode:raise RuntimeError(result.stderr)
    return result.stdout.strip()
if sql('postgres',f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';")!='0':raise RuntimeError('Template has active sessions')
if sql(source['database'],"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261016000020','20261016000021');")!='2':raise RuntimeError('Installed command migrations required')
database='openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
(output/'candidate.json').write_text(json.dumps({'container':source['container'],'database':database,'source_database':source['database']},indent=2)+'\n')
run,stage=str(uuid.uuid4()),str(uuid.uuid4());fixture=str(uuid.UUID(source['fixture_run']))
workspace=sql(database,f"""INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic full native assignment HTTP',created_by FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order,log_tail) VALUES('{stage}','{run}','Network Assignment','queued',1,'Synthetic native assignment');
SELECT workspace_id FROM public.model_runs WHERE id='{run}';""")
workspace=str(uuid.UUID(workspace));calls=[]
with gateway('public',database=database) as connection:
    key=connection['service_token']
    class Bridge(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def forward(self,method):
            path=self.path.removeprefix('/rest/v1')
            allowed=(method=='GET' and path.startswith('/model_run_stages?')) or (method=='POST' and path in ('/rpc/claim_model_stage_attempt','/rpc/write_model_stage_attempt','/rpc/write_model_attempt_artifact'))
            if not allowed or self.headers.get('Authorization')!='Bearer '+key:
                self.send_error(403);return
            body=self.rfile.read(int(self.headers.get('Content-Length','0'))) if method=='POST' else None
            with requests.request(method,connection['url']+path,data=body,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},timeout=15,allow_redirects=False) as response:
                status,content=response.status_code,response.content
            calls.append({'method':method,'operation':path.split('?')[0],'status':status})
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
        def do_GET(self):self.forward('GET')
        def do_POST(self):self.forward('POST')
    server=HTTPServer(('127.0.0.1',0),Bridge);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=f'http://127.0.0.1:{server.server_port}'
    class LiveFixture:
        live_transport=True
        def setUp(self):
            self.directory=output/'journal';self.get=requests.get
            self.artifact={name:str(uuid.uuid4()) for name in ('id','stage_id','attempt_id')}
            self.writer=invocation.invoke_new_attempt(self.directory,run_id=run,stage_id=stage,worker_id='native-http-proof',workspace_id=workspace,
                base_url=base,deployment_id=database,service_key=key,
                handler=lambda context:managed.AttemptWriter(self.directory,context,base_url=base,deployment_id=database,service_key=key))
            if self.writer is None:raise AssertionError('Native claim did not admit assignment')
            if control=='omit-geometry-registration':
                record_artifact=self.writer.record_artifact
                def omit_geometry(payload,**kwargs):
                    if payload['artifact_type']=='model_assignment_geometry':return None
                    return record_artifact(payload,**kwargs)
                self.writer.record_artifact=omit_geometry
        def doCleanups(self):pass
    try:
        native.ProjectWorkingCopyTests=LiveFixture
        os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT']=str(output/'native')
        os.environ['OPENPLAN_BOUND_ASSIGNMENT_CONTROL']='harmless' if control=='harmless' else 'baseline'
        native.main()
        result=json.loads((output/'native/result.json').read_text())
        assert result['live_parent_transport'] is True
        state=json.loads(sql(database,f"SELECT row_to_json(s) FROM (SELECT status,attempt_managed,active_attempt_id FROM public.model_run_stages WHERE id='{stage}') s;"))
        assert state['status']=='running' and state['attempt_managed'] is True
        artifacts=json.loads(sql(database,f"SELECT coalesce(json_agg(artifact_type ORDER BY artifact_type),'[]') FROM public.model_run_artifacts WHERE run_id='{run}';"))
        assert set(artifacts)=={'model_project_working_copy','model_package_working_copy','model_count_inputs','model_transit_inputs','model_assignment_geometry'},'Installed input registration differs'
        assert all(call['status']==200 for call in calls),calls
        report={'control':control,'database':database,'run_id':run,'stage_id':stage,'native_converged':result['convergence']['converged'],'modeled_transit':result['mode_split']['transit_status'],
                'registered_artifacts':artifacts,'http_calls':calls,'stage_remains_running':True,'worker_sha256':result['worker_sha256'],
                'limits':'Full small native assignment with live isolated PostgREST and installed command schema. Synthetic predecessor inventories directly constructed. No lost-commit replay, final publication, model restart, scientific acceptance or normal dispatcher activation.'}
        content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(native.ROOT/('native-assignment-http-'+control+'.json')).write_text(content);print(content)
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
