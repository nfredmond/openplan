"""Upgrade a populated retained fixture to selected main and restore its outputs.

Uses new logical databases on the verified owned cluster. No hosted, login,
physical-host, global-role or whole-installation recovery acceptance is implied.
"""
import base64,hashlib,hmac,importlib.util,json,os,re,shutil,subprocess,sys,time,uuid
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,quote
from unittest.mock import patch
os.umask(0o077)
import argparse
parser=argparse.ArgumentParser(description=__doc__)
for name in ['repo','proof','out']:parser.add_argument('--'+name,type=Path,required=True)
parser.add_argument('--variant',choices=['baseline','harmless','missing-migration','restored'],required=True)
args=parser.parse_args();repo=args.repo.resolve();base=args.proof.resolve()
variant=args.variant;out=args.out.resolve();out.mkdir(mode=0o700)
assert variant in ('baseline','harmless','missing-migration','restored')
fixture=base.parent/'odm-private-dispatch-producer-20261011/rpc-cli-09';capture=base/'capture-01';saved=json.loads((capture/'result.json').read_bytes())
assert saved['schemaSourceMain']=='dae9d2457c8a9ba843049d236539ee42b7fe6110'
sys.path.insert(0,str(repo/'workers/odm_worker'))
from application_dispatch_http import Transport
from application_dispatch_reader import Reader
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody
from runtime_observation import Observer
from runtime_output_intake import Intake
from retained_source import digest
spec=importlib.util.spec_from_file_location('owned_rpc',repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
pg=(fixture/'create-private-database-private.log').read_text().strip();oldrest=(fixture/'baseline-create-rest-private.log').read_text().strip()
def inspect(identity):return json.loads(subprocess.check_output(['docker','inspect',identity]))[0]
pv=inspect(pg);rv=inspect(oldrest)
for identity,v,image,memory in [(pg,pv,h.PG_IMAGE,1073741824),(oldrest,rv,h.REST_IMAGE,134217728)]:
 assert v['Id']==identity and v['Image']==image and v['Config']['Labels']['openplan.purpose']==h.PURPOSE
 assert v['HostConfig']['Memory']==v['HostConfig']['MemorySwap']==memory and not v['HostConfig']['PortBindings'] and not v['State']['Running']
network=next(iter(pv['NetworkSettings']['Networks']));net=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0];assert net['Internal'] and net['Labels']['openplan.purpose']==h.PURPOSE
oldenv=dict(x.split('=',1) for x in rv['Config']['Env'] if '=' in x);uri=urlsplit(oldenv['PGRST_DB_URI']);assert uri.username=='authenticator' and re.fullmatch('rpc_dispatch_[0-9a-f]{32}',uri.path[1:]);password=uri.password
project=out/'cli-project';migrations=project/'supabase/migrations';migrations.mkdir(mode=0o700,parents=True)
for name,checksum in saved['migrationBindings'].items():
 p=repo/'openplan/supabase/migrations'/name;assert hashlib.sha256(p.read_bytes()).hexdigest()==checksum
 if variant=='missing-migration' and name.startswith('20261017000005_'):continue
 data=p.read_bytes()
 if variant=='harmless' and name.startswith('20261017000005_'):data=b'-- Harmless leading migration comment.\n'+data
 (migrations/name).write_bytes(data)
(project/'supabase/config.toml').write_bytes((repo/'openplan/supabase/config.toml').read_bytes())
assert digest(capture,'source-before-upgrade.dump',16*1024**2,time.monotonic()+30)==saved['sourceDump']
useful=base.parent/'odm-useful-output-native-20261013/processing-05';original=json.loads(next((useful/'runtime').glob('original-dispatch-*/receipt.json')).read_bytes());expected=json.loads((useful/'retained-output.json').read_bytes());job=original['applicationJob'];binding=original['binding'];request=json.loads(original['payloadText']);observation=expected['archive']['observationSha256']
source_dump=capture/'source-before-upgrade.dump';rests=[];databases=[];sequence=0

def command(args,label,*,input_path=None,timeout=120):
 global sequence
 sequence+=1
 with (out/(f'{sequence:03d}-'+label+'-private.log')).open('wb') as log:
  try:
   if input_path:
    with input_path.open('rb') as stream:r=subprocess.run(args,stdin=stream,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
   else:r=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
  except subprocess.TimeoutExpired:
   raise TimeoutError('Owned schema command timed out: '+label) from None
 assert r.returncode==0,'Owned schema command failed: '+label

def sql(database,query,label):
 global sequence
 sequence+=1;r=subprocess.run(['docker','exec','-i',pg,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=query.encode(),capture_output=True,timeout=35);(out/(f'{sequence:03d}-'+label+'-private.log')).write_bytes(r.stdout+r.stderr);assert r.returncode==0,'Owned schema SQL failed: '+label;return r.stdout.decode().strip()

def fresh(label,dump):
 database='odm_output_'+uuid.uuid4().hex;databases.append(database)
 sql('postgres','CREATE DATABASE '+database+" TEMPLATE template0 OWNER postgres ENCODING 'UTF8';",label+'-create')
 command(['docker','exec','-i',pg,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--single-transaction'],label+'-restore',input_path=dump)
 return database

def history(database):return json.loads(sql(database,'SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;','history'))

def token():
 encode=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=')
 raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':'service_role','exp':int(time.time())+3600})
 return (raw+b'.'+base64.urlsafe_b64encode(hmac.new(oldenv['PGRST_JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()

def api(database,label):
 env={k:v for k,v in oldenv.items() if k.startswith('PGRST_')};env['PGRST_DB_URI']=urlunsplit((uri.scheme,uri.netloc,'/'+database,uri.query,uri.fragment));env['PGRST_DB_POOL']='2'
 path=out/(label+'-postgrest-private.env');path.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
 for value in env.values():assert '\n' not in value
 result=subprocess.run(['docker','create','--pull=never','--name','openplan-odm-output-schema-'+uuid.uuid4().hex[:12],'--network',network,'--memory=128m','--memory-swap=128m','--cpus=1','--pids-limit=128','--label','openplan.proof='+str(out),'--env-file',str(path),h.REST_IMAGE],capture_output=True,timeout=35);assert result.returncode==0,'Owned schema REST creation failed';identity=result.stdout.decode().strip();rests.append(identity);command(['docker','start',identity],label+'-start-rest')
 v=inspect(identity);assert v['Image']==h.REST_IMAGE and v['Config']['Labels']['openplan.proof']==str(out) and v['HostConfig']['Memory']==v['HostConfig']['MemorySwap']==134217728 and not v['HostConfig']['PortBindings']
 actual_env=dict(x.split('=',1) for x in v['Config']['Env'] if '=' in x);assert urlsplit(actual_env['PGRST_DB_URI']).path=='/'+database, 'Owned schema REST must use its selected restored database'
 endpoint='http://'+v['NetworkSettings']['Networks'][network]['IPAddress']+':3000';auth=token();transport=Transport(endpoint,'owned-current-schema',lambda ref:{'apiKey':auth,'bearerToken':auth},allow_http=True)
 args={'p_request':request['requestId'],'p_installation':binding['installationId'],'p_target':binding['targetId']}
 for _ in range(120):
  try:value=json.loads(transport(args,time.monotonic()+2,owned=lambda:True));assert value['authorizedNow'] is True;break
  except (OSError,ValueError,TimeoutError):time.sleep(.25)
 else:raise TimeoutError('Owned current schema RPC readiness')
 return identity,transport

def recover(database,label):
 identity,transport=api(database,label);root=out/(label+'-runtime');shutil.copytree(useful/'runtime',root)
 runtime=Runtime(root,binding['installationId'],max_queued=2,pipeline=lambda job:None);custody=Custody(runtime,binding['targetId'],timeout=30);calls=[];children=[]
 def rpc(args,end,*,owned):calls.append(args);return transport(args,end,owned=owned)
 def refuse(*args,**kwargs):raise AssertionError('Current schema output recovery cannot query an engine or fetch input')
 observer=Observer(Reader(custody,rpc,timeout=10),refuse,refuse,timeout=30);intake=Intake(observer,max_archive_bytes=256*1024**2,max_expanded_bytes=1024**3,max_entries=10000,max_directory_bytes=4*1024**2,timeout=120)
 original_spawn=subprocess.Popen
 def spawn(args,**kwargs):
  process=original_spawn(args,**kwargs)
  if len(args)>=3 and args[:2]==[sys.executable,'-B']:children.append(Path(args[2]).name)
  return process
 with runtime.owner(),patch.object(subprocess,'Popen',side_effect=spawn):result=intake.advance(request['requestId'],observation)
 assert len(calls)==children.count('application_dispatch_http.py')==3 and children.count('url_transport.py')==0,'Current schema saved output must use three actual access reads and no archive GET'
 assert result['archive']==expected['archive'] and result['callbackPermission'] is False and result['publicationPermission'] is False,'Current schema recovery must preserve exact output custody and claim tiers'
 archive=next(root.glob('preparation-*/output-archive'));assert digest(archive,'archive.zip',256*1024**2,time.monotonic()+30)=={k:expected['archive']['archive'][k] for k in ('bytes','sha256')},'Current schema physical output bytes differ'
 where='workspace_id='+h.quote(job['workspace_id'])+' AND user_id='+h.quote(job['created_by']);before=next(root.glob('preparation-*/output-intake/completed.json')).read_bytes()
 try:
  sql(database,"UPDATE public.workspace_members SET role='viewer' WHERE "+where+';',label+'-revoke')
  with runtime.owner():
   try:intake.advance(request['requestId'],observation)
   except PermissionError as e:assert str(e)=='Runtime observation current application access refused'
   else:raise AssertionError('Current schema recovery must refuse revoked actor access')
  assert next(root.glob('preparation-*/output-intake/completed.json')).read_bytes()==before,'Current schema revoked access cannot change its original receipt'
 finally:sql(database,"UPDATE public.workspace_members SET role='member' WHERE "+where+';',label+'-restore-actor')
 command(['docker','stop','--time','120',identity],label+'-stop-rest')
 return {'applicationReads':3,'archiveGets':0,'exactCustody':True,'physicalBytesMatch':True,'revokedRefused':True,'receiptUnchanged':True}

try:
 command(['docker','start',pg],'start-pg')
 for _ in range(120):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','supabase_admin'],capture_output=True).returncode==0:break
  time.sleep(.25)
 else:raise TimeoutError('Owned current schema database readiness')
 database=fresh('upgrade',source_dump);before=history(database);assert len(before)==saved['sourceHistoryCount']
 address=inspect(pg)['NetworkSettings']['Networks'][network]['IPAddress'];url='postgresql://postgres:'+quote(password,safe='')+'@'+address+':5432/'+database+'?sslmode=disable';cli=repo/'openplan/node_modules/.bin/supabase'
 command([str(cli),'migration','up','--db-url',url,'--workdir',str(project),'--include-all','--yes'],'cli-upgrade')
 current=history(database);expected_versions=sorted(name.split('_',1)[0] for name in saved['migrationBindings']);assert current==expected_versions,'Current schema upgrade must install the exact main migration set'
 command([str(cli),'migration','up','--db-url',url,'--workdir',str(project),'--include-all','--yes'],'cli-no-op');assert history(database)==current,'Current schema no-op cannot change migration history'
 first=recover(database,'upgraded')
 dump=out/'upgraded.dump'
 with dump.open('xb') as stream,(out/'upgraded-dump-private.log').open('wb') as errors:
  p=subprocess.run(['docker','exec',pg,'pg_dump','-U','supabase_admin','-d',database,'--format=custom'],stdout=stream,stderr=errors,timeout=120);assert p.returncode==0,'Current schema output capture failed';stream.flush();os.fsync(stream.fileno())
 restored=fresh('restored',dump);assert history(restored)==current,'Current schema restored migration history differs';second=recover(restored,'restored')
 (out/'result.json').write_text(json.dumps({'schemaSourceMain':saved['schemaSourceMain'],'variant':variant,'historyBefore':len(before),'historyAfter':len(current),'upgradedRecovery':first,'restoredRecovery':second,'sourceDumpSha256':saved['sourceDump']['sha256'],'newDatabases':databases,'scope':'same_cluster_populated_fixture_upgrade_and_restore','globalRoleRecovery':'unassessed','hostedRestore':'unassessed','physicalHostRecovery':'unassessed','processingQualityVerification':'unassessed'},indent=2)+'\n');print(json.dumps({'variant':variant,'historyBefore':len(before),'historyAfter':len(current),'upgradedRecovery':first,'restoredRecovery':second}),flush=True)
finally:
 stops=[]
 for identity in [*reversed(rests),pg]:
  v=inspect(identity)
  if v['State']['Running']:command(['docker','stop','--time','120',identity],'finally-stop')
  v=inspect(identity);assert not v['State']['Running'] and not v['State']['OOMKilled'];stops.append({'id':identity,'running':False,'oomKilled':False,'memory':v['HostConfig']['Memory'],'memorySwap':v['HostConfig']['MemorySwap']})
 (out/'stopped.json').write_text(json.dumps(stops,indent=2)+'\n');group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/');(out/'resources.json').write_text(json.dumps({k:(group/k).read_text().strip() for k in ['memory.max','memory.peak','memory.swap.max','memory.swap.peak','memory.events']},indent=2)+'\n')
