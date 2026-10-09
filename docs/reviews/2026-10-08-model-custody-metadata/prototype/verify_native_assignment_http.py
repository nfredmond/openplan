"""Full native assignment with actual claims, reads and writes in a cloned database."""
from http.server import BaseHTTPRequestHandler,HTTPServer
import hashlib,json,os,re,socket,subprocess,sys,threading,uuid
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
if control not in ('baseline','harmless','omit-geometry-registration','lost-progress','lost-progress-harmless','omit-disconnect'):raise ValueError('Unknown native HTTP control')
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
workspace=str(uuid.UUID(workspace));calls=[];dropped=[]
lost_control=control in ('lost-progress','lost-progress-harmless','omit-disconnect')
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
            calls.append({'method':method,'operation':path.split('?')[0],'status':status,'body_sha256':hashlib.sha256(body).hexdigest() if body else None})
            payload=json.loads(body) if body else {}
            if lost_control and control!='omit-disconnect' and not dropped and path=='/rpc/write_model_stage_attempt' and 'Assignment iteration' in payload.get('p_log_tail',''):
                assert status==200,'Progress write did not commit'
                dropped.append(payload)
                self.close_connection=True
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
        def do_GET(self):self.forward('GET')
        def do_POST(self):self.forward('POST')
    server=HTTPServer(('127.0.0.1',0),Bridge);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=f'http://127.0.0.1:{server.server_port}'
    class LiveFixture:
        live_transport=True
        handles_progress_loss=True
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
        def replay_native_failure(self,snapshot,iteration,native_output):
            request=str(uuid.UUID(iteration['command']['request_id']))
            assert len(dropped)==1 and dropped[0]['p_request_id']==request,'Committed reply loss missing'
            def state():
                return sql(database,f"""SELECT jsonb_build_object(
'parent',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{run}'),
'stage',(SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id='{stage}'),
'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a WHERE run_id='{run}'),
'starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),
'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_run_artifacts a WHERE run_id='{run}'),
'receipt',(SELECT response_payload FROM public.model_stage_write_receipts WHERE request_id='{request}'));""")
            before=state();observed=json.loads(before)
            assert observed['receipt'] is not None and len(observed['attempts'])==1 and observed['starts']==1
            assert 'Assignment iteration' in observed['stage']['log_tail']
            command=[sys.executable,'-B',str(native.WORKER/'model_command_recovery.py'),'--journal',str(snapshot),'--base-url',base,'--deployment-id',database,'--request-id',request]
            outcomes=[];counts=[]
            for number in range(2):
                count=len(calls)
                recovered=subprocess.run(command,env=dict(os.environ,SUPABASE_SERVICE_ROLE_KEY=key),capture_output=True,text=True,timeout=30)
                assert recovered.returncode==0,'Live recovery CLI failed: '+recovered.stderr
                outcome=json.loads(recovered.stdout)
                assert outcome=={'request_id':request,'outcome':'command_receipt_retained','model_resumed':False},outcome
                assert state()==before,'Replay changed committed database state'
                counts.append(len(calls)-count);outcomes.append(outcome)
            assert counts==[1,0],'Replay transport count differs'
            digest=hashlib.sha256(json.dumps(dropped[0],allow_nan=False).encode()).hexdigest()
            # Requests serializes the same original command on both processes.
            matching=[call for call in calls if call['body_sha256']==digest]
            assert len(matching)==2,'Replay changed original HTTP payload'
            report={'request_id':request,'committed_reply_dropped':True,'fresh_process_outcomes':outcomes,'http_calls_per_recovery':counts,
                    'database_state_unchanged':True,'request_body_sha256':digest,'model_resumed':False,
                    'limits':'Real installed SQL receipt replay from a journal backup. Original journal remains pending. No model continuation or supervisor restart.'}
            (native_output/'replay-result.json').write_text(json.dumps(report,indent=2)+'\n')
            return report
        def doCleanups(self):pass
    try:
        native.ProjectWorkingCopyTests=LiveFixture
        os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT']=str(output/'native')
        os.environ['OPENPLAN_BOUND_ASSIGNMENT_CONTROL']='lost-progress' if lost_control else ('harmless' if control=='harmless' else 'baseline')
        if control=='lost-progress-harmless':native.CHILD+='\n# Harmless native child comment.\n'
        native.main()
        result=json.loads((output/'native/result.json').read_text())
        assert result['live_parent_transport'] is True
        state=json.loads(sql(database,f"SELECT row_to_json(s) FROM (SELECT status,attempt_managed,active_attempt_id FROM public.model_run_stages WHERE id='{stage}') s;"))
        assert state['status']=='running' and state['attempt_managed'] is True
        artifacts=json.loads(sql(database,f"SELECT coalesce(json_agg(artifact_type ORDER BY artifact_type),'[]') FROM public.model_run_artifacts WHERE run_id='{run}';"))
        assert set(artifacts)=={'model_project_working_copy','model_package_working_copy','model_count_inputs','model_transit_inputs','model_assignment_geometry'},'Installed input registration differs'
        assert all(call['status']==200 for call in calls),calls
        report={'control':control,'database':database,'run_id':run,'stage_id':stage,'native_converged':result.get('convergence',{}).get('converged'),'modeled_transit':result.get('mode_split',{}).get('transit_status'),'replay':result.get('replay'),'final_outputs_absent':result.get('final_outputs_absent'),
                'registered_artifacts':artifacts,'http_calls':calls,'stage_remains_running':True,'worker_sha256':result['worker_sha256'],
                'limits':'Full small native assignment with live isolated PostgREST and installed command schema. Synthetic predecessor inventories directly constructed. Lost-commit replay is recorded when selected. No final publication, model restart, scientific acceptance or normal dispatcher activation.'}
        content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(native.ROOT/('native-assignment-http-'+control+'.json')).write_text(content);print(content)
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
