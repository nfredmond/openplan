"""Actual worker processes, SDK transport interception, PostgREST and PostgreSQL.

Only the named schema-only worker proof database receives synthetic fixtures. No
real provider call is allowed by the child transport. Kill only a child started
here after observing its barrier and persisted journal phase.
"""
from pathlib import Path
import base64,hashlib,hmac,json,os,select,subprocess,time,urllib.error,urllib.parse,urllib.request
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
base=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-worker-live')
private=base/time.strftime('%Y%m%dT%H%M%S');private.mkdir(mode=0o700)
database='openplan_translation_worker_proof_20260913';container='supabase_db_openplan-restore-target-2731143'
assert json.loads((base/'database.json').read_text())['database']==database
name='openplan_translation_worker_rest_20260913';target='http://127.0.0.1:38962'
config=json.loads(subprocess.check_output(['docker','inspect','supabase_rest_openplan-restore-target-2731143'],text=True))[0]
env=dict(item.split('=',1) for item in config['Config']['Env'] if '=' in item and item.startswith('PGRST_'))
uri=urllib.parse.urlsplit(env['PGRST_DB_URI'])
env['PGRST_DB_URI']=urllib.parse.urlunsplit((uri.scheme,uri.netloc.rsplit('@',1)[0]+'@'+container+':5432','/'+database,uri.query,''))
env.update(PGRST_DB_MAX_ROWS='1000',PGRST_DB_SCHEMAS='public',PGRST_SERVER_PORT='3000',PGRST_SERVER_HOST='0.0.0.0',PGRST_DB_ANON_ROLE='anon')
env_path=base/'http.env'
fd=os.open(env_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as stream:stream.write(''.join(k+'='+v+'\n' for k,v in env.items()))
def enc(value):return base64.urlsafe_b64encode(value).decode().rstrip('=')
secret=env['PGRST_JWT_SECRET']
if secret.startswith('{'):
 keys=json.loads(secret);key=next(k for k in keys.get('keys',[keys]) if k['kty']=='oct');secret_bytes=base64.urlsafe_b64decode(key['k']+'='*((-len(key['k']))%4))
else:secret_bytes=base64.b64decode(secret) if env.get('PGRST_JWT_SECRET_IS_BASE64')=='true' else secret.encode()
content=enc(b'{"alg":"HS256","typ":"JWT"}')+'.'+enc(json.dumps({'role':'service_role','iat':int(time.time()),'exp':int(time.time())+1800}).encode())
token=content+'.'+enc(hmac.new(secret_bytes,content.encode(),hashlib.sha256).digest())
client_path=private/'client.json';fd=os.open(client_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as stream:json.dump({'token':token,'target':target},stream)
def http(path,body=None):
 req=urllib.request.Request(target+'/'+path,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
 try:
  with urllib.request.urlopen(req,timeout=15) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as error:return error.code,json.load(error)
def sql(statement):
 r=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=15)
 assert r.returncode==0,r.stderr
 return r.stdout.strip()
def literal(v):return "'"+str(v).replace("'","''")+"'"
def fixture(label):
 g=subprocess.run(['npm','exec','--','tsx',str(review/'generation-queue-fixture.ts')],cwd=app,text=True,capture_output=True,timeout=15)
 assert g.returncode==0,g.stderr
 f=json.loads(g.stdout);f['fields']=f['fields'][:1]
 a,w,c=f['actorId'],f['workspaceId'],f['campaignId']
 sql('BEGIN;'+f"INSERT INTO auth.users(id,aud,role,email) VALUES({literal(a)},'authenticated','authenticated',{literal(a+'@worker-proof.invalid')});"+
 f"INSERT INTO workspaces(id,name,slug) VALUES({literal(w)},'SYNTHETIC worker proof',{literal(w)});"+
 f"INSERT INTO workspace_members(workspace_id,user_id,role) VALUES({literal(w)},{literal(a)},'owner');"+
 f"INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by,default_content_locale) VALUES({literal(c)},{literal(w)},{literal(f['source'])},{literal(f['source'])},{literal(a)},NULL);"+
 f"INSERT INTO workspace_integration_keys(workspace_id,provider,key_ciphertext,key_last4,configured_by) VALUES({literal(w)},'anthropic',{literal(f['keyCiphertext'])},'-KEY',{literal(a)});COMMIT;")
 status,value=http('rpc/create_translation_generation_request',{'p_request':f['requestId'],'p_actor':a,'p_campaign':c,'p_locale':'es','p_fields':f['fields'],'p_credential':f['credential'],'p_selected_hash':f['selectedKeyHash']})
 assert status==200 and value['created'],(status,value)
 (private/(label+'-fixture.json')).write_text(json.dumps(f))
 return f
def child(directory,mode,barrier=None):
 command=['node','--conditions=react-server','--import','tsx',str(review/'translation-worker-live-child.ts'),str(client_path),str(directory),mode]
 p=subprocess.Popen(command,cwd=app,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if barrier:
  observed=b'';deadline=time.monotonic()+15
  try:
   while barrier.encode() not in observed:
    assert p.poll() is None,('Child ended before barrier',p.stdout.read(),p.stderr.read())
    assert time.monotonic()<deadline,'Child barrier timeout'
    readable,_,_=select.select([p.stdout],[],[],.2)
    if readable:observed+=os.read(p.stdout.fileno(),65536)
   saved=json.loads((directory/'pending.json').read_text())
   assert saved['phase']==('running' if mode=='running-crash' else 'completed'),saved['phase']
   p.kill();out,err=p.communicate(timeout=10)
   assert p.returncode==-9,'Owned child did not terminate at barrier'
   (directory/(mode+'.log')).write_bytes(observed+out+err)
   return {'killedAtBarrier':barrier,'phase':saved['phase']}
  finally:
   if p.poll() is None:p.kill();p.communicate(timeout=10)
 out,err=p.communicate(timeout=20)
 (directory/(mode+'.log')).write_bytes(out+err)
 lines=[json.loads(line) for line in out.decode().splitlines() if line.startswith('{')]
 assert lines,('Child did not report',p.returncode,err.decode())
 return {'exit':p.returncode,**lines[-1]}
started=False;results=[]
try:
 names=subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'],text=True).splitlines()
 if name in names:
  existing=json.loads(subprocess.check_output(['docker','inspect',name],text=True))[0]
  oldenv=dict(item.split('=',1) for item in existing['Config']['Env'] if '=' in item)
  assert existing['State']['Status']=='exited' and not existing['State']['Running'],'Existing proof HTTP process is not terminal'
  assert oldenv.get('PGRST_DB_URI')==env['PGRST_DB_URI'] and existing['Config']['Image']==config['Config']['Image']
  assert existing['HostConfig']['PortBindings'].get('3000/tcp')==[{'HostIp':'127.0.0.1','HostPort':'38962'}]
  subprocess.check_output(['docker','start',name])
 else:subprocess.check_output(['docker','run','-d','--name',name,'--network',next(iter(config['NetworkSettings']['Networks'])),'--publish','127.0.0.1:38962:3000','--env-file',str(env_path),config['Config']['Image']])
 started=True;deadline=time.monotonic()+20
 while True:
  try:
   status,data=http('engagement_translation_generation_fields?select=id&limit=1')
   if status==503 and data.get('code')=='PGRST002':raise ConnectionError()
   assert status==200,(status,data);break
  except (urllib.error.URLError,ConnectionError):
   assert time.monotonic()<deadline,'Proof HTTP startup timeout';time.sleep(.2)
 assert sql("SELECT count(*) FROM engagement_translation_generation_fields WHERE state IN ('queued','reserved','running')")=='0','Unfinished proof jobs require inspection, not reset'
 for mode in ['normal','dispatch-loss','output-loss','running-crash','completed-crash']:
  directory=private/mode;directory.mkdir(mode=0o700);f=fixture(mode)
  first=child(directory,mode,{'running-crash':'provider-awaiting-response','completed-crash':'completion-before-delivery'}.get(mode))
  if mode=='output-loss':assert first.get('exit')==1 and first.get('error')=='translation_worker_database_failed',first
  elif mode in ['normal','dispatch-loss']:assert first.get('exit')==0,first
  before=json.loads((directory/'pending.json').read_text())
  if mode=='completed-crash':
   # Source rotation after durable completion must not discard late evidence.
   sql('UPDATE engagement_campaigns SET title=\'SYNTHETIC changed source\' WHERE id='+literal(f['campaignId'])+';')
  second=child(directory,'resume')
  assert second.get('exit')==0,('Worker recovery must succeed',second)
  saved=json.loads((directory/'pending.json').read_text());assert saved['phase']=='delivered'
  expected='interrupted' if mode in ['dispatch-loss','running-crash','completed-crash'] else 'completed'
  assert saved['acknowledgedState']==expected,(mode,saved['acknowledgedState'])
  events_path=directory/'provider-events.jsonl';calls=len(events_path.read_text().splitlines()) if events_path.exists() else 0
  assert calls==(0 if mode=='dispatch-loss' else 1),(mode,calls)
  field=f['fields'][0]['id'];usage=int(sql('SELECT count(*) FROM usage_events WHERE workspace_id='+literal(f['workspaceId'])))
  assert usage==1,(mode,usage)
  status,rows=http('engagement_translation_generation_outputs?field_id=eq.'+field+'&select=*');assert status==200
  if mode in ['normal','output-loss','completed-crash']:
   assert len(rows)==1 and rows[0]['output_json']==saved['delivery']['value']['outputJson']
   assert rows[0]['delivery_digest']==saved['delivery']['value']['digest']
   assert rows[0]['binding_canonical']==saved['delivery']['value']['bindingCanonical']
   assert rows[0]['provider_metadata_json']==saved['delivery']['value']['providerMetadataJson']
   assert json.loads(rows[0]['provider_metadata_json'])=={'responseId':'SYNTHETIC\0response','reportedModel':'synthetic\ud800model'}
   assert rows[0]['accepted_state']==expected
   if mode in ['output-loss','completed-crash']:assert before['delivery']==saved['delivery'],'Recovered bytes changed'
  else:assert rows==[]
  assert f['credential']['credentialCiphertext'] not in (directory/'pending.json').read_text()
  results.append({'case':mode,'first':first,'second':second,'fieldId':field,'providerCallsIntercepted':calls,'dispatchEvents':usage,'state':expected,'retainedOutputs':len(rows),'journalPrivate':(directory/'pending.json').stat().st_mode&0o777==0o600})
  print(mode,'passed',flush=True)
 report={'database':database,'container':name,'target':target,'privateEvidence':str(private),'workerSha256':hashlib.sha256((app/'src/lib/engagement/translation-generation-worker.ts').read_bytes()).hexdigest(),'results':results,'limits':__doc__}
 (review/'translation-worker-live-results.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
 if started:subprocess.run(['docker','stop','--time','5',name],capture_output=True,check=True,timeout=15)
