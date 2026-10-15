"""Serve copied original products through HTTP and actual delivery authority."""
import hashlib
import http.client
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'workers/odm_worker'))
import main
from application_delivery_authority import Authority
from application_dispatch_http import Transport as RPC,DELIVERY_RPC,DEFAULT_RPC
from application_dispatch_reader import Reader
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody
from runtime_observation import Observer
from runtime_output_intake import Intake
from runtime_products import Products
from runtime_georef import Inspection
from runtime_artifact_plan import ArtifactPlan
from runtime_artifact_access import ArtifactAccess
from runtime_artifact_http import Download


def quote(value):return "'"+str(value).replace("'","''")+"'"


def run(path,mode):
    config=json.loads(Path(path).read_text());root=Path(config['runtimeRoot'])
    runtime=Runtime(root,config['installationId'],max_queued=4,pipeline=lambda _:None,timeout=30)
    dispatch=Custody(runtime,config['targetId'],timeout=30)
    tokens={'apiKey':config['token'],'bearerToken':config['token']}
    common=dict(allow_http=True,max_response_bytes=65536)
    authority=Authority(dispatch,RPC(config['endpoint'],'native-artifact-authority',lambda _:tokens,rpc=DELIVERY_RPC,**common),timeout=30)
    reader=Reader(dispatch,RPC(config['endpoint'],'native-processing',lambda _:tokens,rpc=DEFAULT_RPC,**common),timeout=30)
    def refuse(*_,**__):raise AssertionError('Native download cannot fetch input or query an engine')
    observer=Observer(reader,refuse,refuse,timeout=30)
    intake=Intake(observer,max_archive_bytes=256*1024**2,max_expanded_bytes=1024**3,
        max_entries=10000,max_directory_bytes=4*1024**2,timeout=120)
    plan=ArtifactPlan(Inspection(Products(intake,timeout=120),timeout=120),timeout=120)
    access=ArtifactAccess(plan,authority,timeout=30)
    original=json.loads(next(root.glob('original-dispatch-*/receipt.json')).read_text());job=original['applicationJob']
    request=config['requestId'];prefix=['docker','exec','-i',config['container'],'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1','-d',config['database']]
    def sql(text):
        r=subprocess.run(prefix,input=text,text=True,capture_output=True,timeout=15)
        assert r.returncode==0,'Native artifact fixture SQL succeeds'
    where=' WHERE id='+quote(job['id'])+';'
    with runtime.owner():
        prepared,engine=observer._original(request,time.monotonic()+30)
        completed=next(json.loads(p.read_text()) for p in (prepared/'task-observations').glob('*.json')
            if p.name!='plan.json' and json.loads(p.read_text()).get('reportedState')=='completed')
        observation=completed['bodySha256']
        plan.advance(request,observation)
        lease=access.prepare(request,observation,public_base_url='https://worker.example',expires_at=time.time()+300)
    row=next(r for r in lease['artifacts'] if r['filename']=='orthophoto.tif')
    expected=(prepared/row['localRelativePath']).read_bytes()
    assert len(expected)==row['sizeBytes'] and hashlib.sha256(expected).hexdigest()==row['checksumSha256'],'Native original product matches its descriptor'
    # This is an isolated fixture transition, after genuine preparation under
    # active processing access. Downloads then use the distinct delivery RPC.
    sql("UPDATE public.aerial_processing_jobs SET status='succeeded'"+where)
    if mode=='revoked':
        sql('DELETE FROM public.workspace_members WHERE workspace_id='+quote(job['workspace_id'])+' AND user_id='+quote(job['created_by'])+';')
    if mode=='canceled':sql("UPDATE public.aerial_processing_jobs SET status='canceled'"+where)
    server=main.build_server('127.0.0.1',0,admissions=runtime,artifact_download=Download(access,timeout=30))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=35)
    try:
        with runtime.owner():
            connection.request('GET',row['downloadUrl'].removeprefix('https://worker.example'))
            response=connection.getresponse();body=response.read()
        if mode=='completed':
            assert response.status==200 and body==expected,'Native completed original reaches HTTP with exact bytes'
            assert response.getheader('Content-Length')==str(len(expected)),'Native original length reaches HTTP'
        elif mode=='revoked':assert response.status==403 and body!=expected,'Native revoked original actor receives no product'
        else:assert response.status==403 and body!=expected,'Native canceled original receives no product'
        assert next(root.glob('preparation-*/private-artifact-access/lease.json')).read_bytes()==__import__('retained_source').json_bytes(lease),'Native HTTP preserves its original lease'
    finally:
        connection.close();server.shutdown();server.server_close();thread.join(timeout=5)
    print(json.dumps({'mode':mode,'status':response.status,'originalBytes':len(expected),'originalSha256':row['checksumSha256'],
        'scope':'Actual private HTTP and PostgREST on intended415 clone; original retained archive, no engine/input fetch, no quality/map/default-worker acceptance'}))


if __name__=='__main__':run(sys.argv[1],sys.argv[2])
