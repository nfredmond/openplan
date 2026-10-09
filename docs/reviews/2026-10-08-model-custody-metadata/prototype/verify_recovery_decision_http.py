"""Lose a committed abandonment reply, then recover the exact command in a fresh CLI."""
from http.server import BaseHTTPRequestHandler,HTTPServer
import hashlib,json,os,runpy,socket,subprocess,sys,threading,uuid
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parent;WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
import model_command_client as client
import model_command_journal as journal
from isolated_postgrest import gateway
output=Path(os.environ['OPENPLAN_RECOVERY_HTTP_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
control=os.environ.get('OPENPLAN_RECOVERY_HTTP_CONTROL','baseline')
if control not in ('baseline','harmless','omit-disconnect'):raise ValueError('Unknown HTTP control')
os.environ['OPENPLAN_RECOVERY_DECISION_OUTPUT']=str(output/'database-proof')
fixture=runpy.run_path(str(ROOT/'verify_recovery_decision.py'),run_name='__main__')
database=fixture['database'];sql=fixture['sql'];run=fixture['r'];workspace=fixture['workspace'];actor=fixture['actor']
def snapshot():
    return sql(database,f"SELECT jsonb_build_object('run',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{run}'),'stages',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s WHERE run_id='{run}'),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a WHERE run_id='{run}'),'starts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stage_id) FROM public.model_stage_execution_starts x WHERE run_id='{run}'),'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM public.model_run_recovery_receipts x WHERE run_id='{run}'));").stdout.strip()
with gateway('public',database=database) as connection:
    key=connection['service_token'];bodies=[];dropped=[]
    class Bridge(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            if self.path!='/rest/v1/rpc/abandon_model_run_execution' or self.headers.get('Authorization')!='Bearer '+key:self.send_error(403);return
            body=self.rfile.read(int(self.headers['Content-Length']))
            with requests.post(connection['url']+'/rpc/abandon_model_run_execution',data=body,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},timeout=15,allow_redirects=False) as response:
                status,content=response.status_code,response.content
            bodies.append({'status':status,'sha256':hashlib.sha256(body).hexdigest()})
            if control!='omit-disconnect' and not dropped:
                assert status==200,'Decision did not commit before response loss'
                dropped.append(True);self.close_connection=True;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
    server=HTTPServer(('127.0.0.1',0),Bridge);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        base=f'http://127.0.0.1:{server.server_port}'
        with requests.post(connection['url']+'/rpc/inspect_model_run_recovery',headers={'Authorization':'Bearer '+key},json={'p_workspace_id':workspace,'p_run_id':run,'p_actor_id':actor},timeout=15) as response:
            assert response.status_code==200,'Recovery inspection failed';observation=response.json()
        command={'request_id':str(uuid.uuid4()),'destination':client.destination(base,database),'operation':'abandon_model_run_execution',
            'arguments':{'workspace_id':workspace,'run_id':run,'actor_id':actor,'expected_state':observation['expected_state'],
                         'reason':'Synthetic operator abandonment after unconfirmed interruption','evidence':{'scope':'unconfirmed','fixture':True}}}
        directory=output/'journal';before=json.loads(snapshot());lost=False
        try:client.deliver(directory,command,base_url=base,deployment_id=database,service_key=key)
        except client.DeliveryUnconfirmed:lost=True
        assert lost and dropped,'Recovery reply loss was not observed'
        assert len(journal.pending(directory,command['destination']))==1
        committed=snapshot();state=json.loads(committed)
        assert state['run']['status']=='cancelled' and len(state['receipts'])==1
        assert state['starts']==before['starts'] and all(s['active_attempt_id'] is None for s in state['stages'])
        audit="""import os,runpy,sys
port=int(os.environ['OPENPLAN_PROOF_PORT'])
def audit(event,args):
 if event in ('subprocess.Popen','os.system','os.exec','os.fork','os.posix_spawn'):raise RuntimeError('Recovery attempted process launch')
 if event=='socket.connect' and args[1]!=('127.0.0.1',port):raise RuntimeError('Recovery contacted another destination')
sys.addaudithook(audit)
runpy.run_module('model_command_recovery',run_name='__main__')
"""
        if control=='harmless':audit+='\n# Harmless recovery-process comment.\n'
        outcomes=[];request_counts=[]
        for _ in range(2):
            count=len(bodies)
            result=subprocess.run([sys.executable,'-B','-c',audit,'--journal',str(directory),'--base-url',base,'--deployment-id',database,'--request-id',command['request_id']],
                env=dict(os.environ,PYTHONPATH=str(WORKER),SUPABASE_SERVICE_ROLE_KEY=key,OPENPLAN_PROOF_PORT=str(server.server_port)),capture_output=True,text=True,timeout=30)
            assert result.returncode==0,'Fresh recovery failed: '+result.stderr+result.stdout
            outcome=json.loads(result.stdout);assert outcome=={'request_id':command['request_id'],'outcome':'command_receipt_retained','model_resumed':False}
            assert snapshot()==committed,'Receipt retry changed installed execution state'
            outcomes.append(outcome);request_counts.append(len(bodies)-count)
        assert request_counts==[1,0] and len(bodies)==2 and bodies[0]==bodies[1]
        assert journal.pending(directory,command['destination'])==[]
        retained=journal.read_existing(directory,command['destination'],include_resolved=True)
        assert len(retained)==1 and retained[0]['command']==command
        client.checked_receipt(command,retained[0]['response'])
        report={'control':control,'database':database,'http_requests':bodies,'recovery_request_counts':request_counts,'fresh_cli':outcomes,
                'database_unchanged_after_retry':True,'execution_starts_preserved':True,'command_sha256':hashlib.sha256(journal.canonical(command).encode()).hexdigest(),
                'receipt_sha256':hashlib.sha256(journal.canonical(retained[0]['response']).encode()).hexdigest(),
                'limits':'Synthetic operator through a service-role gateway, SQL commit followed by socket loss and fresh CLI recovery. No authenticated application route, human approval UI, physical process termination, restart or scientific acceptance.'}
        content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);print(content)
    finally:server.shutdown();server.server_close();thread.join(timeout=5)
