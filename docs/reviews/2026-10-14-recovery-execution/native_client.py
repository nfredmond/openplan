"""Compose original custody through actual RPCs, callback socket and download."""
import hashlib,http.client,json,subprocess,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'workers/odm_worker'))
import main
from application_delivery_authority import Authority
from application_dispatch_http import Transport as RPC,DELIVERY_RPC,DEFAULT_RPC
from application_dispatch_reader import Reader
from progress_http import Transport as POST
from runtime_outcome_recovery import Runtime,Recovery
from runtime_dispatch_custody import Custody
from runtime_observation import Observer
from runtime_output_intake import Intake
from runtime_products import Products
from runtime_georef import Inspection
from runtime_artifact_plan import ArtifactPlan
from runtime_artifact_access import ArtifactAccess
from runtime_artifact_http import Download
from runtime_terminal_delivery import Delivery,BODY_LIMIT
from runtime_worker_coordinator import Coordinator
from runtime_running_pipeline import Pipeline,RunningDelivery
from runtime_execution import Execution
from runtime_dispatch_custody import Pipeline as DispatchPipeline
from runtime_url_intake import Intake as SourceIntake
from runtime_url_draft import Pipeline as UrlDraft
from runtime_preparation import Preparation
from runtime_draft import Draft
from runtime_commit import Commit
from retained_source import json_bytes,publish
from runtime_admission import OUTCOME


def quote(value):return "'"+str(value).replace("'","''")+"'"


def run(path,mode):
    config=json.loads(Path(path).read_text());root=Path(config['runtimeRoot'])
    runtime=Runtime(root,config['installationId'],max_queued=4,pipeline=lambda _:None,timeout=30)
    dispatch=Custody(runtime,config['targetId'],timeout=30)
    tokens={'apiKey':config['token'],'bearerToken':config['token']};common=dict(allow_http=True,max_response_bytes=65536)
    authority=Authority(dispatch,RPC(config['endpoint'],'native-coordinator-authority',lambda _:tokens,rpc=DELIVERY_RPC,**common),timeout=30)
    reader=Reader(dispatch,RPC(config['endpoint'],'native-processing',lambda _:tokens,rpc=DEFAULT_RPC,**common),timeout=30)
    def refuse(*_,**__):raise AssertionError('Retained native coordinator cannot query engine or fetch input')
    observer=Observer(reader,refuse,refuse,timeout=30)
    intake=Intake(observer,max_archive_bytes=256*1024**2,max_expanded_bytes=1024**3,max_entries=10000,max_directory_bytes=4*1024**2,timeout=120)
    plan=ArtifactPlan(Inspection(Products(intake,timeout=120),timeout=120),timeout=120)
    access=ArtifactAccess(plan,authority,timeout=30)
    original=json.loads(next(root.glob('original-dispatch-*/receipt.json')).read_text());job=original['applicationJob'];request=config['requestId']
    received=[];errors=[];first=mode!='ack-revoked'
    prefix=['docker','exec','-i',config['container'],'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1','-d',config['database']]
    def sql(text):
        result=subprocess.run(prefix,input=text,text=True,capture_output=True,timeout=15)
        assert result.returncode==0,'Native coordinator fixture SQL succeeds'
    where=' WHERE id='+quote(job['id'])+';'
    class Callback(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            nonlocal first
            try:
                raw=self.rfile.read(int(self.headers['Content-Length']));body=json.loads(raw);received.append(raw)
                assert self.headers.get('Authorization')=='Bearer synthetic-native-coordinator','Native callback keeps its original credential'
                sql('INSERT INTO public.aerial_processing_callbacks(processing_job_id,workspace_id,callback_id,status,occurred_at,payload) VALUES ('+
                    ','.join(quote(v) for v in [job['id'],job['workspace_id'],body['callbackId'],body['status'],body['occurredAt']])+','+quote(json.dumps(body))+'::jsonb) ON CONFLICT DO NOTHING;')
                sql('UPDATE public.aerial_processing_jobs SET status='+quote(body['status'])+',last_callback_id='+quote(body['callbackId'])+',last_callback_at='+quote(body['occurredAt'])+where)
                if first and body['status']=='succeeded':first=False;self.close_connection=True;return
                reply=json.dumps({'ok':True,'status':body['status']}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(reply)));self.end_headers();self.wfile.write(reply);self.close_connection=True
            except BaseException as error:errors.append(type(error).__name__);self.close_connection=True
    sink=ThreadingHTTPServer(('127.0.0.1',0),Callback);sink.daemon_threads=True
    sink_thread=threading.Thread(target=sink.serve_forever,daemon=True);sink_thread.start()
    url=f'http://127.0.0.1:{sink.server_port}/original-callback'
    post=POST(url,'native-worker-callback',lambda _: 'synthetic-native-coordinator',allowed_networks=('127.0.0.1/32',),allowed_ports=(sink.server_port,),max_body_bytes=BODY_LIMIT)
    def send(original_url,reference,body,deadline,*,owned):
        assert original_url==json.loads(original['payloadText'])['callbackUrl'],'Native coordinator preserves original dispatch callback URL'
        return post(url,reference,body,deadline,owned=owned)
    send.max_body=BODY_LIMIT
    delivery=Delivery(observer,authority,send,'native-worker-callback',access=access,timeout=30)
    coordinator=Coordinator(observer,plan,access,delivery,public_base_url='https://worker.example',lease_seconds=300,timeout=30)
    source=root.with_name(root.name+'-unused-source');source.mkdir(mode=0o700)
    source_intake=SourceIntake(runtime,source,dispatch.target,refuse,refuse,timeout=120)
    url_draft=UrlDraft(source_intake,refuse,refuse,timeout=120,authorize_with_deadline=True)
    inputs=DispatchPipeline(url_draft,dispatch,refuse,capture_with_deadline=True)
    preparation=Preparation(runtime,lambda entry:url_draft._inputs(entry,time.monotonic()+120),timeout=120)
    commit=Commit(Draft(preparation,refuse,refuse,timeout=120),refuse,refuse,timeout=120)
    progress=RunningDelivery(reader,send,'native-worker-callback',timeout=30)
    pipeline=Pipeline(inputs,commit,coordinator,progress);runtime.pipeline=pipeline;recovery=Recovery(pipeline,timeout=120)
    execution=Execution(pipeline,recovery)
    download=None;download_thread=None
    try:
        with runtime.owner():
            prepared,_engine=observer._original(request,time.monotonic()+30)
            completed=next(json.loads(p.read_text()) for p in (prepared/'task-observations').glob('*.json') if p.name!='plan.json' and json.loads(p.read_text()).get('reportedState')=='completed')
            observation=completed['bodySha256']
            initial=pipeline.advance(request)
            assert len(received)==2 and not errors,'Native original running and terminal callbacks reach actual socket once each'
            command=delivery._load(request,'terminal',delivery.folder(request),time.monotonic()+30)
            entry=runtime.journal.get(request)
            local={'format':OUTCOME,'binding':runtime._binding(entry),'state':'failed','reportedEngineTerminal':None,
                'callbackDeliveryVerification':'unassessed','sourceCustodyVerification':'unassessed','engineCustodyVerification':'unassessed'}
            publish(root,runtime._name(entry),json_bytes(local));old=root/runtime._name(entry)
            old_bytes=old.read_bytes();old_inode=old.stat().st_ino
            if mode in ('revoked','ack-revoked'):
                sql('DELETE FROM public.workspace_members WHERE workspace_id='+quote(job['workspace_id'])+' AND user_id='+quote(job['created_by'])+';')
            if mode=='missing':
                (delivery.folder(request)/'command.json').unlink()
                try:execution.step()
                except ValueError as error:assert str(error)=='Outcome recovery requires its saved original terminal command','Native missing command has static recovery refusal'
                else:raise AssertionError('Native missing original command cannot repair')
            else:assert execution.step()['state']=='outcome_recovery_attempted','Native owned scheduler attempts original outcome recovery first'
            recovered=runtime._outcome(entry);record=recovery.folder(request)/'record.json'
            if mode in ('revoked','missing'):
                assert not record.exists() and recovered['reportedEngineTerminal'] is None and len(received)==2,'Native revoked pending actor cannot repair original outcome'
                assert runtime.status()['heldStarted']==1,'Native unresolved original outcome keeps its hold'
            else:
                assert record.exists() and recovered['state']=='succeeded' and recovered['reportedEngineTerminal']['statusCode']==40,'Native original outcome repair records acknowledged completion'
                assert runtime.status()['heldStarted']==0,'Native acknowledged original outcome repair releases its local hold'
                assert len(received)==(2 if mode=='ack-revoked' else 3),'Native acknowledged outcome repair avoids unnecessary callback POST'
                assert received[1:]==[command['bodyText'].encode()]*(len(received)-1),'Native outcome repair preserves exact original terminal callback bytes'
                assert execution.step()['state']=='idle','Native original outcome repair is not repeated'
            assert old.read_bytes()==old_bytes and old.stat().st_ino==old_inode,'Native outcome repair preserves original record bytes and inode'
            if mode=='revoked':
                failures=[json.loads(p.read_bytes()) for p in root.glob('local-stage-failures-*/*.json')]
                failures=[v for v in failures if v['stage']=='outcome_recovery']
                assert len(failures)==1 and failures[0]['reportedEngine']['reportedStatusCode']==40 and failures[0]['reportedEngine']['observationSha256']==observation,'Native revoked recovery retains known original completion'
            lease=access._load(*access._plan(request,observation,time.monotonic()+30))
        row=next(r for r in lease['artifacts'] if r['filename']=='orthophoto.tif');expected=(prepared/row['localRelativePath']).read_bytes()
        assert len(expected)==row['sizeBytes'] and hashlib.sha256(expected).hexdigest()==row['checksumSha256'],'Native coordinator original product matches its fixed descriptor'
        download=main.build_server('127.0.0.1',0,admissions=runtime,artifact_download=Download(access,timeout=30))
        download_thread=threading.Thread(target=download.serve_forever,daemon=True);download_thread.start()
        connection=http.client.HTTPConnection('127.0.0.1',download.server_port,timeout=35)
        try:
            with runtime.owner():
                connection.request('GET',row['downloadUrl'].removeprefix('https://worker.example'));response=connection.getresponse();body=response.read()
            if mode in ('revoked','ack-revoked'):assert response.status==403 and body!=expected,'Native revoked coordinator cannot release original product'
            else:assert response.status==200 and body==expected,'Native acknowledged coordinator serves exact original product bytes'
        finally:connection.close()
    finally:
        if download:download.shutdown();download.server_close();download_thread.join(timeout=5)
        sink.shutdown();sink.server_close();sink_thread.join(timeout=5)
    print(json.dumps({'mode':mode,'callbackPosts':len(received),'originalProductBytes':len(expected),'productSha256':row['checksumSha256'],
        'scope':'Actual isolated PostgREST, copied original input/commit/output journals, separate old-outcome scheduling, supervised callback and artifact sockets; fixture sink directly writes callback ledger; no fresh input/engine dispatch or application receiver route/default/quality/placement/browser/hosted acceptance'}))


if __name__=='__main__':run(sys.argv[1],sys.argv[2])
