"""Exercise the actual route and SDK against the retained isolated PostgREST stack.

This compiled route adapter is not a full Next build or browser acceptance.
Only new synthetic callback/job fixtures are written. No engine or Storage runs.
"""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, parse_qs
import uuid

PROOF = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009')
PG = 'a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
REST = '3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f'
DATABASE = 'odm_output_68adf5426c164b71b653efeb24d42c9a'
PROFILE = PROOF/'odm-output-schema-recovery-20261014/main41c-controls-01/baseline-private'


def inspect(identity):
    return json.loads(subprocess.check_output(['docker','inspect',identity]))[0]


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    spec=importlib.util.spec_from_file_location('owned_helper',repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    original=json.loads(next((PROFILE/'upgraded-runtime').glob('original-dispatch-*/receipt.json')).read_bytes())['applicationJob']
    pg,rest=inspect(PG),inspect(REST)
    for value,image,limit in [(pg,helper.PG_IMAGE,1073741824),(rest,helper.REST_IMAGE,134217728)]:
        assert not value['State']['Running'] and value['Image']==image
        assert value['HostConfig']['Memory']==value['HostConfig']['MemorySwap']==limit
        assert not value['HostConfig']['PortBindings']
    assert pg['Config']['Labels']['openplan.purpose']==helper.PURPOSE
    assert rest['Config']['Labels']['openplan.proof']==str(PROFILE)
    network=next(iter(pg['NetworkSettings']['Networks']))
    assert list(rest['NetworkSettings']['Networks'])==[network]
    net=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0]
    assert net['Internal'] and net['Labels']['openplan.purpose']==helper.PURPOSE
    values=dict(row.split('=',1) for row in rest['Config']['Env'] if '=' in row)
    assert urlsplit(values['PGRST_DB_URI']).path=='/'+DATABASE
    q=helper.quote;started=[];server=None;child=None;sequence=0
    def sql(query):
        nonlocal sequence
        sequence+=1
        p=subprocess.run(['docker','exec','-i',PG,'psql','-XqAt','-U','postgres','-d',DATABASE,'-v','ON_ERROR_STOP=1'],input=query.encode(),capture_output=True,timeout=30)
        (out/(str(sequence).zfill(3)+'-sql-private.log')).write_bytes(p.stdout+p.stderr)
        assert p.returncode==0,'Owned callback SQL failed'
        return p.stdout.decode().strip()
    encode=lambda value:base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
    raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':'service_role','exp':int(time.time())+3600})
    key=(raw+b'.'+base64.urlsafe_b64encode(hmac.new(values['PGRST_JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()
    jobs={name:{'id':str(uuid.uuid4()),'request':'callback-native-'+uuid.uuid4().hex,
        'reference':'owned-callback-'+uuid.uuid4().hex} for name in ['interrupted','raced']}
    fail_patch=True;race_read=True;events=[]
    try:
        subprocess.run(['docker','start',PG],check=True,stdout=subprocess.DEVNULL);started.append(PG)
        for _ in range(120):
            if subprocess.run(['docker','exec',PG,'pg_isready','-U','supabase_admin'],capture_output=True).returncode==0:break
            time.sleep(.25)
        else:raise TimeoutError('Owned callback database readiness')
        assert sql('SELECT count(*) FROM supabase_migrations.schema_migrations;')=='409','Native callback fixture stays selected409'
        for job in jobs.values():
            sql('INSERT INTO public.aerial_processing_jobs (id,workspace_id,mission_id,created_by,request_id,job_reference,status,imagery_url) VALUES ('+
                ','.join(q(value) for value in [job['id'],original['workspace_id'],original['mission_id'],original['created_by'],job['request'],job['reference'],'accepted','https://example.invalid/synthetic-native.zip'])+');')
        subprocess.run(['docker','start',REST],check=True,stdout=subprocess.DEVNULL);started.append(REST)
        upstream='http://'+inspect(REST)['NetworkSettings']['Networks'][network]['IPAddress']+':3000'
        class Proxy(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def forward(self):
                nonlocal fail_patch,race_read
                target=self.path.removeprefix('/rest/v1')
                parsed=urlsplit(target)
                if parsed.path not in ['/aerial_processing_jobs','/aerial_processing_callbacks']:
                    self.send_response(404);self.end_headers();return
                body=self.rfile.read(int(self.headers.get('content-length','0')))
                events.append({'method':self.command,'table':parsed.path,'query':parsed.query})
                if self.command=='PATCH' and fail_patch:
                    fail_patch=False;status=500;payload=b'{"message":"Owned proof interrupts the first status write","code":"P0001"}'
                else:
                    request=urllib.request.Request(upstream+target,data=body if self.command!='GET' else None,method=self.command,
                        headers={key:value for key,value in self.headers.items() if key.lower() not in ['host','content-length','connection']})
                    for attempt in range(120):
                        try:
                            with urllib.request.urlopen(request,timeout=5) as response:status=response.status;payload=response.read()
                            break
                        except urllib.error.HTTPError as error:status=error.code;payload=error.read();break
                        except OSError:
                            if attempt==119:raise
                            time.sleep(.25)
                    if self.command=='GET' and parsed.path=='/aerial_processing_jobs' and race_read and parse_qs(parsed.query).get('request_id')==['eq.'+jobs['raced']['request']]:
                        race_read=False
                        sql("UPDATE public.aerial_processing_jobs SET status='succeeded' WHERE id="+q(jobs['raced']['id'])+';')
                self.send_response(status);self.send_header('content-type','application/json');self.send_header('content-length',str(len(payload)));self.end_headers();self.wfile.write(payload)
            do_GET=forward;do_POST=forward;do_PATCH=forward
        server=ThreadingHTTPServer(('127.0.0.1',0),Proxy)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        bundle=out/'route.cjs'
        build=subprocess.run([str(repo/'openplan/node_modules/.bin/esbuild'),str(repo/'openplan/src/app/api/aerial/processing-callback/route.ts'),
            '--bundle','--platform=node','--packages=external','--format=cjs','--outfile='+str(bundle)],cwd=repo/'openplan',capture_output=True,timeout=60)
        (out/'build-private.log').write_bytes(build.stdout+build.stderr);assert build.returncode==0,'Actual callback route must compile'
        bearer=secrets.token_urlsafe(32)
        env={**os.environ,'NODE_PATH':str(repo/'openplan/node_modules'),'NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:'+str(server.server_port),
            'SUPABASE_SERVICE_ROLE_KEY':key,'OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN':bearer,'OPENPLAN_NATIVE_ROUTE_BUNDLE':str(bundle)}
        logs=(out/'route-private.log').open('wb')
        child=subprocess.Popen(['node',str(Path(__file__).with_name('route_server.cjs'))],cwd=repo/'openplan',env=env,stdout=subprocess.PIPE,stderr=logs)
        port=json.loads(child.stdout.readline())['port'];address='http://127.0.0.1:'+str(port)+'/callback'
        def post(job,callback_id,progress=40,reference=None):
            payload={'schemaVersion':'natford-aerial-processing.v1','requestId':job['request'],'callbackId':callback_id,
                'jobReference':reference or job['reference'],'status':'running','occurredAt':'2026-10-14T06:00:00Z','progress':progress}
            request=urllib.request.Request(address,data=json.dumps(payload).encode(),method='POST',headers={'content-type':'application/json','authorization':'Bearer '+bearer})
            try:
                with urllib.request.urlopen(request,timeout=20) as response:return response.status,json.loads(response.read())
            except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
        callback_id='native-callback-'+uuid.uuid4().hex
        first=post(jobs['interrupted'],callback_id)
        assert first[0]==500,'First actual status write must be interrupted'
        assert sql('SELECT status FROM public.aerial_processing_jobs WHERE id='+q(jobs['interrupted']['id'])+';')=='accepted','Interrupted native job remains unapplied'
        assert sql('SELECT count(*) FROM public.aerial_processing_callbacks WHERE callback_id='+q(callback_id)+';')=='1','Original callback survives before application'
        resumed=post(jobs['interrupted'],callback_id)
        assert resumed==(200,{'ok':True,'status':'running','replayed':True}),'Actual retained retry must finish the original status write'
        assert sql('SELECT status FROM public.aerial_processing_jobs WHERE id='+q(jobs['interrupted']['id'])+';')=='running','Actual native retry must apply job state'
        assert post(jobs['interrupted'],callback_id,90)[0]==409,'Changed original callback must refuse'
        assert sql('SELECT progress::text FROM public.aerial_processing_jobs WHERE id='+q(jobs['interrupted']['id'])+';')=='40.00','Changed callback cannot alter native progress'
        assert post(jobs['interrupted'],'native-callback-'+uuid.uuid4().hex,reference='other-worker')[0]==409,'Other worker identity must refuse'
        raced_callback='native-callback-'+uuid.uuid4().hex
        raced=post(jobs['raced'],raced_callback)
        assert raced[0]==503,'Concurrent native state change must request a fresh retry'
        assert sql('SELECT status FROM public.aerial_processing_jobs WHERE id='+q(jobs['raced']['id'])+';')=='succeeded','Stale callback cannot downgrade actual terminal state'
        assert post(jobs['raced'],raced_callback)==(200,{'ok':True,'ignored':'terminal'}),'Fresh native retry preserves terminal state'
        (out/'result.json').write_text(json.dumps({'scope':'isolated_selected409_compiled_route_sdk_http','firstWriteInterrupted':True,
            'originalLedgerRetained':True,'exactRetryApplied':True,'changedPayloadRefused':True,'foreignWorkerRefused':True,
            'concurrentStateRefused':True,'terminalStatePreserved':True,'fullNextBuildAcceptance':False,'browserAcceptance':False,
            'hostedAcceptance':False,'routeSha256':hashlib.sha256((repo/'openplan/src/app/api/aerial/processing-callback/route.ts').read_bytes()).hexdigest()},indent=2)+'\n')
        (out/'transport-private.json').write_text(json.dumps(events,indent=2)+'\n')
        print(json.dumps({'exactRetryApplied':True,'concurrentStateRefused':True,'selectedSchema':409}),flush=True)
    finally:
        if child:
            child.terminate();child.wait(timeout=20)
        if server:server.shutdown();server.server_close()
        for identity in reversed(started):
            if inspect(identity)['State']['Running']:subprocess.run(['docker','stop','--time','120',identity],check=True,stdout=subprocess.DEVNULL)
            assert not inspect(identity)['State']['Running'] and not inspect(identity)['State']['OOMKilled']


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
