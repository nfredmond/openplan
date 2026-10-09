"""Actual worker helpers over private PostgREST, including a lost claim reply.

Synthetic records only. Does not execute a model, upload Storage bytes, or prove
full dispatcher recovery, historical reconciliation or scientific acceptance.
"""
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
from unittest.mock import patch
import hashlib,json,os,re,socket,subprocess,sys,threading,uuid
import requests
from isolated_postgrest import gateway
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
from worker_import_for_tests import import_worker_main


def verify():
    source=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}',source['database']):
        raise ValueError('Select owned source database')
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
    names=('retained-output-protection.sql','stage-execution-start.sql','relaunch-custody-inspection.sql','historical-execution-fence.sql')
    bodies={name:(ROOT/name).read_text() for name in names}
    hashes={name:hashlib.sha256(body.encode()).hexdigest() for name,body in bodies.items()}
    command=['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
    def query(database,sql):
        result=subprocess.run([*command,'-d',database],input=sql,text=True,capture_output=True,timeout=30)
        if result.returncode: raise RuntimeError(result.stderr)
        return result.stdout.strip()
    metadata=output/'candidate.json'
    if metadata.exists():
        meta=json.loads(metadata.read_text())
        if meta.get('prototype_sha256')!=hashes: raise RuntimeError('Owned clone has other source; retain for diagnosis')
    else:
        meta={'container':source['container'],'database':'openplan_attempt_cli_'+uuid.uuid4().hex,'source_database':source['database'],'fixture_run':source['fixture_run'],'prototype_sha256':hashes}
        query('postgres',f"CREATE DATABASE {meta['database']} TEMPLATE {source['database']};")
        metadata.write_text(json.dumps(meta,indent=2)+'\n')
        query(meta['database'],'BEGIN;\n'+'\n'.join(bodies.values())+'\nCOMMIT;')
    if meta['container']!=source['container'] or not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',meta['database']): raise ValueError('Invalid owned HTTP clone')
    def sql(value): return query(meta['database'],value)
    fixture=str(uuid.UUID(meta['fixture_run']))
    worker=import_worker_main()
    records=[]
    with gateway('public',database=meta['database']) as connection:
        token=connection['service_token'];calls=[];errors=[];drop={'stage':None}
        class Bridge(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def forward(self):
                try:
                    if not self.path.startswith('/rest/v1/') or self.headers.get('Authorization')!='Bearer '+token:
                        raise AssertionError('Unexpected proof destination')
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<=length<=131072: raise AssertionError('Unexpected proof body')
                    body=self.rfile.read(length) if length else None
                    headers={key:self.headers[key] for key in ('Authorization','Content-Type','Prefer') if self.headers.get(key)}
                    with requests.request(self.command,connection['url']+self.path[len('/rest/v1'):],headers=headers,data=body,timeout=15,allow_redirects=False) as response:
                        status=response.status_code;content=response.content;ctype=response.headers.get('Content-Type','application/json')
                    calls.append((self.command,self.path,status))
                    if self.command=='PATCH' and drop['stage'] and ('id=eq.'+drop['stage']) in self.path and status==200:
                        drop['stage']=None
                        self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
                except Exception as error:
                    errors.append(type(error).__name__);self.close_connection=True
            do_PATCH=forward
            do_POST=forward
            do_GET=forward
        bridge=HTTPServer(('127.0.0.1',0),Bridge);thread=threading.Thread(target=bridge.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(bridge.server_port)
        def create_run():
            run,stage=[str(uuid.uuid4()) for _ in range(2)]
            workspace=sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic HTTP retention',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;")
            sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic HTTP retention','queued',1);")
            return run,stage,str(uuid.UUID(workspace))
        try:
            with patch.object(worker,'SUPABASE_URL',base),patch.object(worker,'SUPABASE_KEY',token),patch.object(worker,'HEADERS',{'apikey':token,'Authorization':'Bearer '+token,'Content-Type':'application/json','Prefer':'return=representation'}),patch.dict(os.environ,{'OPENPLAN_DEPLOYMENT_ID':meta['database']}):
                for variant in ('baseline','harmless','lost-reply-swallowed','restored'):
                    original=worker.sb_claim_stage
                    def claim(stage,payload):
                        if variant=='harmless': payload=dict(payload)
                        try: return original(stage,payload)
                        except worker.WorkerStateWriteUnconfirmed as error:
                            if variant=='lost-reply-swallowed' and isinstance(error.__cause__,requests.RequestException): return True
                            raise
                    try:
                        with patch.object(worker,'sb_claim_stage',claim):
                            run,stage,workspace=create_run()
                            if worker.sb_claim_stage(stage,{'status':'running'}) is not True: raise AssertionError('New worker claim failed')
                            if worker.sb_claim_stage(stage,{'status':'running'}) is not False: raise AssertionError('Claim retry executed twice')
                            worker.sb_patch_run(run,{'status':'running'})
                            payload={'run_id':run,'kpi_name':'probe','kpi_label':'Probe','kpi_category':'assignment','value':12.5,'unit':'vehicles'}
                            directory=str(output/variant/uuid.uuid4().hex)
                            receipt=worker.sb_record_retained_kpi(payload,workspace_id=workspace,stage_id=stage,journal_dir=directory)
                            delivered=len(calls)
                            if worker.sb_record_retained_kpi(payload,workspace_id=workspace,stage_id=stage,journal_dir=directory)!=receipt or len(calls)!=delivered: raise AssertionError('KPI retry changed receipt or sent another request')
                            worker.sb_patch_stage(stage,{'status':'succeeded'})
                            worker.sb_patch_run(run,{'status':'succeeded'})
                            facts=json.loads(sql(f"SELECT json_build_array((SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),(SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}'),(SELECT status FROM public.model_runs WHERE id='{run}'));"))
                            if facts!=[1,1,'succeeded']: raise AssertionError('Normal helper results differ')
                            lost_run,lost_stage,_=create_run();drop['stage']=lost_stage
                            try: worker.sb_claim_stage(lost_stage,{'status':'running'})
                            except worker.WorkerStateWriteUnconfirmed: pass
                            else: raise AssertionError('Committed claim loss was hidden')
                            lost_facts=json.loads(sql(f"SELECT json_build_array((SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{lost_run}'),(SELECT status FROM public.model_run_stages WHERE id='{lost_stage}'));"))
                            if lost_facts!=[1,'running'] or worker.sb_claim_stage(lost_stage,{'status':'running'}) is not False: raise AssertionError('Lost reply repeated or erased claim')
                            # Existing fixture is enrolled as historical; late worker state must fail.
                            try: worker.sb_patch_run(fixture,{'status':'running'})
                            except worker.WorkerStateWriteUnconfirmed: pass
                            else: raise AssertionError('Historical worker update accepted')
                    except AssertionError as failure:
                        if variant!='lost-reply-swallowed' or str(failure)!='Committed claim loss was hidden': raise
                        records.append({'case':variant,'caught':str(failure)})
                    else:
                        if variant=='lost-reply-swallowed': raise AssertionError('Fault survived')
                        records.append({'case':variant,'normal_claim_kpi_completion':facts,'lost_reply_retained_start':lost_facts,'historical_update_refused':True})
        finally:
            bridge.shutdown();bridge.server_close();thread.join(timeout=5)
        if errors: raise AssertionError('Proof bridge errors: '+','.join(errors))
    result={'cases':records,'gateway_removed':True,'scope':'Actual normal worker HTTP helpers, native database guards, dropped TCP reply after claim commit and cached KPI retry. Synthetic outputs; no model computation, Storage, full dispatcher, stage resumption, browser or scientific acceptance.'}
    (output/'retention-worker-http.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__=='__main__': print(json.dumps(verify(),indent=2))
