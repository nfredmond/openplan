"""Terminal journals with actual PostgREST and a supervised callback socket.

The retained observation below is a synthetic failure for the original task.
It is not a new engine observation or evidence of photogrammetry quality.
"""
import base64
from datetime import datetime,timedelta
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'workers/odm_worker'))
from application_delivery_authority import Authority
from application_dispatch_http import Transport as RPC,DELIVERY_RPC,DEFAULT_RPC
from application_dispatch_reader import Reader
from progress_http import Transport as POST
from retained_source import json_bytes
from retained_task_observation import Observations
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody
from runtime_observation import Observer
from runtime_terminal_delivery import Delivery,BODY_LIMIT


def quote(value):return "'"+str(value).replace("'","''")+"'"

def run(path,mode):
    config=json.loads(Path(path).read_text());root=Path(config['runtimeRoot'])
    runtime=Runtime(root,config['installationId'],max_queued=4,pipeline=lambda _:None,timeout=10)
    dispatch=Custody(runtime,config['targetId'],timeout=10)
    tokens={'apiKey':config['token'],'bearerToken':config['token']}
    common=dict(allow_http=True,max_response_bytes=65536)
    authority=Authority(dispatch,RPC(config['endpoint'],'native-terminal-authority',lambda _:tokens,rpc=DELIVERY_RPC,**common),timeout=10)
    reader=Reader(dispatch,RPC(config['endpoint'],'native-processing',lambda _:tokens,rpc=DEFAULT_RPC,**common),timeout=10)
    observer=Observer(reader,lambda _:None,lambda *_:False,timeout=10)
    request=config['requestId'];received=[];errors=[];first=True
    original=json.loads(next(root.glob('original-dispatch-*/receipt.json')).read_text());job=original['applicationJob']
    prefix=['docker','exec','-i',config['container'],'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1','-d',config['database']]
    where=' WHERE id='+quote(job['id'])+';'
    def sql(text):
        result=subprocess.run(prefix,input=text,text=True,capture_output=True,timeout=10)
        assert result.returncode==0,'Native terminal fixture SQL succeeds'
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            nonlocal first
            try:
                raw=self.rfile.read(int(self.headers['Content-Length']));body=json.loads(raw);received.append(raw)
                assert self.headers.get('Authorization')=='Bearer synthetic-native-terminal','Original callback credential reaches actual endpoint'
                if mode=='ignored':
                    stored={**body,'callbackId':body['callbackId']+'-superseded',
                        'occurredAt':(datetime.fromisoformat(body['occurredAt'])+timedelta(seconds=1)).isoformat()}
                    sql('INSERT INTO public.aerial_processing_callbacks(processing_job_id,workspace_id,callback_id,status,occurred_at,payload) VALUES ('+
                        ','.join(quote(v) for v in [job['id'],job['workspace_id'],stored['callbackId'],stored['status'],stored['occurredAt']])+','+quote(json.dumps(stored))+'::jsonb);')
                    sql('UPDATE public.aerial_processing_jobs SET status='+quote(stored['status'])+',last_callback_id='+quote(stored['callbackId'])+',last_callback_at='+quote(stored['occurredAt'])+where)
                    reply=b'{"ok":true,"ignored":"superseded"}'
                else:
                    sql('INSERT INTO public.aerial_processing_callbacks(processing_job_id,workspace_id,callback_id,status,occurred_at,payload) VALUES ('+
                        ','.join(quote(v) for v in [job['id'],job['workspace_id'],body['callbackId'],body['status'],body['occurredAt']])+','+quote(json.dumps(body))+'::jsonb) ON CONFLICT DO NOTHING;')
                    sql('UPDATE public.aerial_processing_jobs SET status='+quote(body['status'])+',last_callback_id='+quote(body['callbackId'])+',last_callback_at='+quote(body['occurredAt'])+where)
                    if first:
                        first=False;self.close_connection=True;return
                    reply=json.dumps({'ok':True,'status':body['status']}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(reply)));self.end_headers();self.wfile.write(reply);self.close_connection=True
            except BaseException as error:
                errors.append(type(error).__name__);self.close_connection=True
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        # The original dispatch URL must stay unchanged. An explicit adapter maps
        # it to this private fixture socket while retaining exact callback bytes.
        callback_url=f'http://127.0.0.1:{server.server_port}/original-callback'
        transport=POST(callback_url,'native-terminal-callback',lambda _: 'synthetic-native-terminal',
            allowed_networks=('127.0.0.1/32',),allowed_ports=(server.server_port,),max_body_bytes=BODY_LIMIT)
        def send(original_url,reference,body,deadline,*,owned):
            assert original_url==json.loads(original['payloadText'])['callbackUrl'],'Saved original callback URL remains unchanged'
            return transport(callback_url,reference,body,deadline,owned=owned)
        send.max_body=BODY_LIMIT
        delivery=Delivery(observer,authority,send,'native-terminal-callback',timeout=10)
        with runtime.owner():
            prepared,plan=observer._original(request,time.monotonic()+10)
            ledger=Observations(prepared/'engine',plan,records_root=prepared/'task-observations')
            completed=next(json.loads(p.read_text()) for p in (prepared/'task-observations').glob('*.json') if p.name!='plan.json' and json.loads(p.read_text()).get('reportedState')=='completed')
            synthetic=json.loads(base64.b64decode(completed['bodyBase64']));synthetic['status']={'code':30}
            observation=ledger.record(200,json_bytes(synthetic))['bodySha256']
            command=delivery.prepare_original(request,observation)
            try:delivery.advance(request)
            except (ValueError,PermissionError):pass
            else:raise AssertionError('First native terminal attempt must remain uncertain or refused')
            assert len(received)==1 and not errors,'First native callback reaches its owned socket once'
            if mode=='ignored':
                try:delivery.advance(request)
                except PermissionError:pass
                else:raise AssertionError('Different applied terminal callback refuses another POST')
                receipt=delivery.historical_receiver_receipt(request)
                assert receipt['historicalReceiverOutcome']=='receiver_ignored','Ignored native reply remains a historical fact'
                assert receipt['transportPermission'] is False,'Historical native receipt grants no POST permission'
                assert len(received)==1,'Ignored native receipt never creates another POST'
            elif mode=='revoked':
                sql('DELETE FROM public.workspace_members WHERE workspace_id='+quote(job['workspace_id'])+' AND user_id='+quote(job['created_by'])+';')
                try:delivery.advance(request)
                except PermissionError:pass
                else:raise AssertionError('Revoked native original actor refuses another POST')
                assert len(received)==1,'Revoked actor sends no second callback'
            else:
                try:result=delivery.advance(request)
                except PermissionError:raise AssertionError('Completed native original permits exact lost-ack replay') from None
                assert result['state']=='acknowledged','Completed native original permits exact lost-ack replay'
                assert received==[command['bodyText'].encode()]*2,'Native uncertain recovery preserves exact callback bytes'
                replay=delivery.advance(request)
                assert replay==result and len(received)==2,'Saved native acknowledgement suppresses another POST'
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)

if __name__=='__main__':run(*sys.argv[1:])
