"""Use a retained clone, private internal PostgREST and actual compiled app code."""
import argparse,base64,faulthandler,hashlib,hmac,json,os,secrets,subprocess,threading,time,urllib.request,urllib.error,uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit
import importlib.util
PG='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
REST='3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f'
def run(repo,out,migration=None):
 os.umask(0o077);out.mkdir(mode=0o700,parents=True)
 spec=importlib.util.spec_from_file_location('guard',Path(__file__).with_name('native_guard.py'));guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
 guard.run(repo,out/'clone',migration=migration,only='privileges')
 database=json.loads((out/'clone/database-private.json').read_text())['database']
 original=json.loads(next((guard.PROFILE/'upgraded-runtime').glob('original-dispatch-*/receipt.json')).read_text())['applicationJob']
 rest=json.loads(subprocess.check_output(['docker','inspect',REST]))[0]
 assert not rest['State']['Running'] and rest['HostConfig']['Memory']==rest['HostConfig']['MemorySwap']==134217728
 network=next(iter(rest['NetworkSettings']['Networks']));assert not rest['HostConfig']['PortBindings']
 values=dict(row.split('=',1) for row in rest['Config']['Env'] if '=' in row)
 uri=urlsplit(values['PGRST_DB_URI']);assert uri.path=='/'+guard.SOURCE
 owned='openplan-held-aftermath-'+uuid.uuid4().hex
 started=False;created=False;server=None;sequence=0;events=[];conflicts=set()
 jobs={name:{'id':str(uuid.uuid4()),'request':'held-app-'+uuid.uuid4().hex,'reference':'held-worker-'+uuid.uuid4().hex} for name in ['complete','missing','retry','human','callback']}
 q=lambda value:"'"+str(value).replace("'","''")+"'"
 def sql(query):
  nonlocal sequence
  sequence+=1;r=subprocess.run(['docker','exec','-i',PG,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=20)
  (out/(str(sequence).zfill(3)+'-sql-private.log')).write_text(r.stdout+r.stderr);assert r.returncode==0,'Owned aftermath SQL succeeds';return r.stdout.strip()
 def held(job,kind='orthomosaic',path=None):
  path=path or 'proof/original-'+job+'.tif'
  sql('INSERT INTO public.aerial_artifact_custody(workspace_id,mission_id,processing_job_id,kind,ordinal,state,source_host,source_expires_at,storage_bucket,storage_path,byte_size,checksum_sha256,content_type,held_at) VALUES ('+','.join(q(v) for v in [original['workspace_id'],original['mission_id'],jobs[job]['id'],kind,0,'held','example.invalid','2099-01-01T00:00:00Z','aerial-artifacts',path,3,hashlib.sha256(bytes([1,2,3])).hexdigest(),'image/tiff','2026-10-14T12:00:00Z'])+');')
 def payload(name):
  return {'schemaVersion':'natford-aerial-processing.v1','requestId':jobs[name]['request'],'callbackId':'held-callback-'+name+'-0001','jobReference':jobs[name]['reference'],'status':'succeeded','occurredAt':'2026-10-14T12:01:00Z','artifacts':[{'kind':kind,'downloadUrl':'https://example.invalid/proof.tif','expiresAt':'2099-01-01T00:00:00Z','sizeBytes':3,'contentType':'image/tiff'} for kind in (['orthomosaic'] if name=='callback' else ['orthomosaic','point_cloud'])]}
 try:
  subprocess.run(['docker','start',PG],check=True,stdout=subprocess.DEVNULL);started=True
  for _ in range(120):
   if subprocess.run(['docker','exec',PG,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
   time.sleep(.25)
  else:raise TimeoutError('Owned aftermath PostgreSQL readiness')
  for name,job in jobs.items():
   sql('INSERT INTO public.aerial_processing_jobs(id,workspace_id,mission_id,created_by,request_id,job_reference,status,imagery_url) VALUES ('+','.join(q(v) for v in [job['id'],original['workspace_id'],original['mission_id'],original['created_by'],job['request'],job['reference'],'succeeded','https://example.invalid/input.zip'])+');')
  for name in ['retry','human','callback']:
   for kind in (['orthomosaic'] if name=='callback' else ['orthomosaic','point_cloud']):held(name,kind,'proof/'+name+'-'+kind+'.tif')
   callback=payload(name)
   sql('INSERT INTO public.aerial_processing_callbacks(processing_job_id,workspace_id,callback_id,status,occurred_at,payload) VALUES ('+','.join(q(v) for v in [jobs[name]['id'],original['workspace_id'],callback['callbackId'],'succeeded',callback['occurredAt'],json.dumps(callback)])+');')
   sql('UPDATE public.aerial_processing_jobs SET last_callback_id='+q(callback['callbackId'])+',last_callback_at='+q(callback['occurredAt'])+' WHERE id='+q(jobs[name]['id'])+';')
   sql('INSERT INTO public.aerial_evidence_packages(id,workspace_id,mission_id,processing_job_id,title,package_type,status,verification_readiness,notes) VALUES ('+','.join(q(v) for v in [jobs[name]['id'],original['workspace_id'],original['mission_id'],jobs[name]['id'],'Preserve human title','measurable_output','ready','ready' if name=='human' else 'pending','Preserve human notes'])+');')
  envvalues={k:v for k,v in values.items() if k.startswith('PGRST_')};envvalues['PGRST_DB_URI']=values['PGRST_DB_URI'].removesuffix('/'+guard.SOURCE)+'/'+database
  command=['docker','create','--name',owned,'--network',network,'--memory','128m','--memory-swap','128m','--label','openplan.purpose=aerial-held-custody-aftermath-20261014']
  for k,v in envvalues.items():command+=['-e',k+'='+v]
  command+=[rest['Image']];subprocess.run(command,check=True,capture_output=True);created=True
  subprocess.run(['docker','start',owned],check=True,stdout=subprocess.DEVNULL)
  state=json.loads(subprocess.check_output(['docker','inspect',owned]))[0];upstream='http://'+state['NetworkSettings']['Networks'][network]['IPAddress']+':3000'
  class Proxy(BaseHTTPRequestHandler):
   def log_message(self,*_):pass
   def forward(self):
    with (out/'arrivals.jsonl').open('a') as arrivals:
     arrivals.write(json.dumps({'method':self.command,'length':self.headers.get('content-length'),'transfer':self.headers.get('transfer-encoding'),'expect':self.headers.get('expect')})+'\n')
    target=self.path.removeprefix('/rest/v1');parsed=urlsplit(target)
    if parsed.path not in ['/aerial_processing_jobs','/aerial_processing_callbacks','/aerial_artifact_custody','/aerial_evidence_packages','/aerial_missions']:
     self.send_response(404);self.end_headers();return
    self.connection.settimeout(5)
    remaining=int(self.headers.get('content-length','0'));parts=[]
    while remaining:
     part=self.rfile.read1(remaining)
     assert part,'Owned proxy receives its complete request body'
     parts.append(part);remaining-=len(part)
     with (out/'body-counts.jsonl').open('a') as counts:counts.write(json.dumps({'bytes':len(part),'remaining':remaining})+'\n')
    body=b''.join(parts)
    if self.command=='POST' and parsed.path=='/aerial_artifact_custody':
     values=json.loads(body)
     (out/'post-body-private.json').write_bytes(body)
     for name in ['complete','missing']:
      matching=any(v['processing_job_id']==jobs[name]['id'] for v in values)
      with (out/'matching.jsonl').open('a') as trace:trace.write(json.dumps({'case':name,'matching':matching})+'\n')
      if matching and name not in conflicts:held(name);conflicts.add(name)
    request=urllib.request.Request(upstream+target,data=body if self.command!='GET' else None,method=self.command,headers={k:v for k,v in self.headers.items() if k.lower() not in ['host','content-length','connection']})
    for attempt in range(80):
     try:
      with urllib.request.urlopen(request,timeout=5) as r:status=r.status;response=r.read()
      break
     except urllib.error.HTTPError as e:status=e.code;response=e.read();break
     except OSError:
      with (out/'upstream-timeouts.jsonl').open('a') as trace:trace.write(json.dumps({'method':self.command,'attempt':attempt})+'\n')
      if attempt==79:raise
      time.sleep(.1)
    events.append({'method':self.command,'table':parsed.path,'status':status,'code':json.loads(response).get('code') if status>=400 else None})
    (out/'events.json').write_text(json.dumps(events,indent=2)+'\n')
    self.send_response(status);self.send_header('content-type','application/json');self.send_header('content-length',str(len(response)));self.end_headers();self.wfile.write(response)
   do_GET=forward;do_POST=forward;do_PATCH=forward
  server=ThreadingHTTPServer(('127.0.0.1',0),Proxy);threading.Thread(target=server.serve_forever,daemon=True).start()
  encode=lambda v:base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=')
  raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':'service_role','exp':int(time.time())+3600})
  token=(raw+b'.'+base64.urlsafe_b64encode(hmac.new(values['PGRST_JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()
  def role_token(role):
   raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':role,'sub':original['created_by'],'exp':int(time.time())+3600})
   return (raw+b'.'+base64.urlsafe_b64encode(hmac.new(values['PGRST_JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()
  (out/'context-private.json').write_text(json.dumps({'jobs':jobs,'workspace':original['workspace_id'],'mission':original['mission_id'],'callback':payload('callback')}))
  env={**os.environ,'NODE_PATH':str(repo/'openplan/node_modules'),'NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:'+str(server.server_port),'SUPABASE_SERVICE_ROLE_KEY':token,'OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN':secrets.token_urlsafe(32),'OPENPLAN_HELD_OUT':str(out)}
  env.update(OPENPLAN_HELD_MEMBER_TOKEN=role_token('authenticated'),OPENPLAN_HELD_ANON_TOKEN=role_token('anon'))
  with (out/'application-private.log').open('w') as log, (out/'python-stack-private.log').open('w') as stack:
   def database_snapshot():
    r=subprocess.run(['docker','exec',PG,'psql','-XqAt','-U','postgres','-d','postgres','-c',"SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid),left(query,100) FROM pg_stat_activity WHERE datname="+q(database)+';'],capture_output=True,text=True,timeout=10)
    (out/'database-activity-private.log').write_text(r.stdout+r.stderr)
   timer=threading.Timer(8,database_snapshot);timer.start()
   faulthandler.dump_traceback_later(10,file=stack)
   try:
    r=subprocess.run(['node',str(Path(__file__).with_name('native_aftermath.mjs'))],cwd=repo/'openplan',env=env,stdout=log,stderr=log,text=True,timeout=30)
   finally:faulthandler.cancel_dump_traceback_later();timer.cancel();timer.join()
  assert r.returncode==0,'Actual native custody application aftermath succeeds'
  for name in ['retry','callback','human']:
   summary=json.loads(sql('SELECT json_build_object(\'readiness\',verification_readiness,\'title\',title,\'notes\',notes)::text FROM public.aerial_evidence_packages WHERE id='+q(jobs[name]['id'])+';'))
   assert summary=={'readiness':'ready' if name=='human' else 'partial','title':'Preserve human title','notes':'Preserve human notes'},'Native '+name+' readiness repairs while human edits remain'
  assert sql('SELECT count(*) FROM public.aerial_artifact_custody WHERE processing_job_id='+q(jobs['missing']['id'])+';')=='1','Native bulk conflict rolls back the missing second row'
  assert len([e for e in events if e['code']=='23514'])==2,'Actual PostgREST returns both row protection conflicts'
  report={'database':database,'sourceMigrations':409,'candidateDDL':'20261017000011','cases':json.loads((out/'application.json').read_text()),'actual23514':2,'scope':'actual compiled engine/routes, SDK and PostgREST; source and Storage synthetic, selected409 plus candidate DDL, no current-main restore/browser/hosted acceptance'}
  (out/'result.json').write_text(json.dumps(report,indent=2)+'\n');(out/'events.json').write_text(json.dumps(events,indent=2)+'\n');print(report)
 finally:
  if server:server.shutdown();server.server_close()
  if created:subprocess.run(['docker','rm','-f',owned],check=True,capture_output=True)
  if started:subprocess.run(['docker','stop','--time','120',PG],check=True,stdout=subprocess.DEVNULL)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--migration',type=Path);a=p.parse_args();run(a.repo.resolve(),a.out.resolve(),a.migration)
