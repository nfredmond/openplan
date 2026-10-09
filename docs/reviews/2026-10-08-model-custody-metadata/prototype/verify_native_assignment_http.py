"""Full native assignment with actual claims, reads and writes in a cloned database."""
from http.server import BaseHTTPRequestHandler,HTTPServer
import hashlib,json,os,re,socket,subprocess,sys,threading,uuid
from pathlib import Path
import requests
from unittest.mock import patch
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
if control not in ('baseline','harmless','omit-geometry-registration','lost-progress','lost-progress-harmless','omit-disconnect','cancel-progress','cancel-progress-harmless','omit-cancellation','cancel-receipt-loss','cancel-receipt-loss-harmless','omit-receipt-loss','parent-loss','parent-loss-harmless','omit-parent-loss','swallow-parent-loss','startup-before','startup-before-harmless','startup-after','startup-early'):raise ValueError('Unknown native HTTP control')
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
        cancel_on_iteration=control in ('cancel-progress','cancel-progress-harmless','omit-cancellation','cancel-receipt-loss','cancel-receipt-loss-harmless','omit-receipt-loss')
        cancel_receipt_loss=control in ('cancel-receipt-loss','cancel-receipt-loss-harmless','omit-receipt-loss')
        omit_cancellation=control=='omit-cancellation'
        @staticmethod
        def external_config():
            return {'journal':str(output/'journal'),'run_id':run,'stage_id':stage,'workspace_id':workspace,
                    'base_url':base,'deployment_id':database},key
        def cancel_engine(self,handle):
            if not self.cancel_receipt_loss or control=='omit-receipt-loss':return handle.cancel()
            import model_engine_process as engine
            class SyntheticCancellationReceiptLoss(OSError):pass
            record=engine._record
            def lose_receipt(descriptor,name,payload):
                if name=='cancellation-signal-written.json':raise SyntheticCancellationReceiptLoss('Native cancellation signal receipt lost')
                return record(descriptor,name,payload)
            with patch.object(engine,'_record',side_effect=lose_receipt):
                try:handle.cancel()
                except SyntheticCancellationReceiptLoss:return
            raise AssertionError('Native cancellation receipt fault did not occur')
        def inspect_native_cancel(self,handle):
            from test_engine_scope_recovery import AUDIT
            import model_command_journal as journal
            records=lambda:{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in handle.directory.glob('*.json')}
            before=records();before_commands=journal.read_existing(self.directory,self.writer.context.destination,include_resolved=True)
            http_count=len(calls);outcomes=[]
            inspection_env=dict(os.environ,PYTHONPATH=str(native.WORKER))
            inspection_env.pop('SUPABASE_SERVICE_ROLE_KEY',None)
            command=[sys.executable,'-B','-c',AUDIT,'--root',str(self.writer.files.root),'--journal',str(self.directory),
                     '--base-url',base,'--deployment-id',database,'--request-id',self.writer.context.claim_request_id]
            for index in range(2):
                inspected=subprocess.run(command,env=inspection_env,capture_output=True,text=True,timeout=15)
                assert inspected.returncode==0,'Fresh native scope inspection failed: '+inspected.stderr+inspected.stdout
                outcome=json.loads(inspected.stdout)
                assert outcome['outcome']=='scope_absent_observed' and outcome['scope_has_live_processes'] is False
                assert outcome['cancellation_requested'] is True
                assert outcome['cancellation_signal_written'] is (not self.cancel_receipt_loss)
                assert outcome['cancellation_observed'] is (not self.cancel_receipt_loss)
                assert outcome['termination_cause']=='unconfirmed'
                assert all(outcome[key] is False for key in ('signal_sent','model_resumed','continuation_authorized','database_status_changed','server_ownership_checked'))
                outcomes.append(outcome)
            assert outcomes[0]==outcomes[1] and before==records(),'Inspection changed retained custody'
            assert before_commands==journal.read_existing(self.directory,self.writer.context.destination,include_resolved=True),'Inspection changed command inventory'
            assert len(calls)==http_count,'Inspection contacted database transport'
            report={'fresh_process_outcomes':outcomes,'records_unchanged':True,'command_inventory_unchanged':True,'database_http_calls':0}
            (output/'engine-inspection.json').write_text(json.dumps(report,indent=2)+'\n')
            return report
        def native_cancel_state(self):
            return sql(database,f"""SELECT jsonb_build_object(
'parent',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{run}'),
'stage',(SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id='{stage}'),
'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a WHERE run_id='{run}'),
'starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),
'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_run_artifacts a WHERE run_id='{run}'),
'kpis',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY id),'[]'::jsonb) FROM public.model_run_kpis k WHERE run_id='{run}'));""")
        def before_native_cancel(self):
            self.before_cancel=self.native_cancel_state()
            state=json.loads(self.before_cancel)
            assert state['stage']['status']=='running' and 'Assignment iteration' in state['stage']['log_tail']
            assert len(state['attempts'])==1 and state['starts']==1
        def after_native_cancel(self):
            assert self.native_cancel_state()==self.before_cancel,'Native cancellation changed database state'
            return {'database_state_unchanged':True,'one_attempt_and_execution_start':True,'stage_status':'running'}
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
        if control in ('lost-progress-harmless','cancel-progress-harmless','cancel-receipt-loss-harmless'):native.CHILD+='\n# Harmless native child comment.\n'
        native.main()
        result=json.loads((output/'native/result.json').read_text())
        assert result['live_parent_transport'] is True
        state=json.loads(sql(database,f"SELECT row_to_json(s) FROM (SELECT status,attempt_managed,active_attempt_id FROM public.model_run_stages WHERE id='{stage}') s;"))
        assert state['status']=='running' and state['attempt_managed'] is True
        artifacts=json.loads(sql(database,f"SELECT coalesce(json_agg(artifact_type ORDER BY artifact_type),'[]') FROM public.model_run_artifacts WHERE run_id='{run}';"))
        expected_artifacts={'model_project_working_copy','model_package_working_copy'}
        if not control.startswith('startup-'):expected_artifacts.update({'model_count_inputs','model_transit_inputs','model_assignment_geometry'})
        assert set(artifacts)==expected_artifacts,'Installed input registration differs'
        assert all(call['status']==200 for call in calls),calls
        report={'control':control,'database':database,'run_id':run,'stage_id':stage,'native_converged':result.get('convergence',{}).get('converged'),'modeled_transit':result.get('mode_split',{}).get('transit_status'),'replay':result.get('replay'),'final_outputs_absent':result.get('final_outputs_absent'),'cancellation':result.get('cancellation'),'cancellation_receipt_lost':result.get('cancellation_receipt_lost'),'engine_inspection':result.get('engine_inspection'),'parent_loss':result.get('parent_loss'),'database_observation':result.get('database_observation'),
                'registered_artifacts':artifacts,'http_calls':calls,'stage_remains_running':True,'worker_sha256':result['worker_sha256'],
                'limits':'Full small native assignment with live isolated PostgREST and installed command schema. Synthetic predecessor inventories directly constructed. Lost-commit replay is recorded when selected. No final publication, model restart, scientific acceptance or normal dispatcher activation.'}
        content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(native.ROOT/('native-assignment-http-'+control+'.json')).write_text(content);print(content)
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
