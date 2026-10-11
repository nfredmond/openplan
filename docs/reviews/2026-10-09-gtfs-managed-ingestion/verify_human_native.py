"""Recover human decisions after real committed HTTP replies are interrupted."""
from pathlib import Path
import hashlib,json,os,re,signal,subprocess,sys,time,uuid
import requests
here=Path(__file__).resolve().parent;root=here.parents[2]
sys.path.insert(0,str(here.parent/'2026-10-08-model-custody-metadata/prototype'));from isolated_postgrest import gateway
source=json.loads(Path(sys.argv[1]).read_text());assert source['container']=='supabase_db_openplan-restore-target-2026091050';assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
out=Path(sys.argv[2]);out.mkdir(mode=0o700,parents=True,exist_ok=False);config={**source,'database':'openplan_attempt_cli_'+uuid.uuid4().hex};(out/'database.json').write_text(json.dumps(config)+'\n');(out/'database.json').chmod(0o600)
def sql(statement,database=None):
 r=subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',database or config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[:2000])
 return r.stdout.strip()
assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();',source['database'])=='0';assert int(sql('SELECT pg_database_size(current_database());',source['database']))<1024**3
sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source["database"]};','postgres')
for number in ['29','30']:sql(next((root/'openplan/supabase/migrations').glob('202610160000'+number+'*.sql')).read_text())
fixture=(here/'adoption-checks.sql').read_text().split('DO $proof$')[0]
workspace,other,actor,delegate,viewer,outsider=[str(uuid.uuid4()) for _ in range(6)]
sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'),('{delegate}','{delegate}@example.invalid'),('{viewer}','{viewer}@example.invalid'),('{outsider}','{outsider}@example.invalid'); INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic human HTTP recovery','human-{workspace}'),('{other}','Synthetic foreign human scope','human-{other}'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner'),('{workspace}','{delegate}','owner'),('{workspace}','{viewer}','viewer'),('{other}','{actor}','owner');")
records=[]
with gateway('public',database=config['database'],subjects=(actor,viewer)) as rest:
 env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=256','OPENPLAN_PROOF_HTTP_URL':rest['url'],'OPENPLAN_PROOF_HTTP_TOKEN':rest['service_token']}
 def rpc(name,args,token=None):
  r=requests.post(rest['url']+'/rpc/'+name,headers={'Authorization':'Bearer '+(token or rest['service_token'])},json=args,timeout=10);return r.status_code,r.json()
 for kind in ['early_cancel','unfinished_cancel','adopt','material_adopt']:
  directory=out/kind;directory.mkdir(mode=0o700);request,command,installation=[str(uuid.uuid4()) for _ in range(3)];version=None
  if kind=='unfinished_cancel':
   url='https://example.invalid/'+request+'.zip';status,admitted=rpc('admit_gtfs_ingest',{'p_request':request,'p_workspace':workspace,'p_actor':actor,'p_feed':None,'p_source':{'kind':'url','provisionalName':'Synthetic unfinished command','sourceUrl':url,'normalizedSourceUrl':url}});assert status==200;version=admitted['versionId']
  if 'adopt' in kind:
   previous=None
   if kind=='material_adopt':
    admitted=json.loads(sql('BEGIN;\n'+fixture+f"\nSET LOCAL ROLE service_role; SELECT pg_temp.ready_gtfs('{workspace}','{actor}',NULL,10,10); COMMIT;"));status,decision=rpc('adopt_gtfs_ingest',{'p_workspace':workspace,'p_version':admitted['versionId'],'p_command':str(uuid.uuid4()),'p_actor':actor});assert status==200 and decision['adopted'];previous=admitted['feedId']
   admitted=json.loads(sql('BEGIN;\n'+fixture+f"\nSET LOCAL ROLE service_role; SELECT pg_temp.ready_gtfs('{workspace}','{actor}',"+("'"+previous+"'" if previous else 'NULL')+f",{6 if previous else 14},{7 if previous else 287}); COMMIT;"));version=admitted['versionId'];request=admitted['requestId']
   status,review=rpc('read_gtfs_adoption_review',{'p_workspace':workspace,'p_version':version,'p_actor':viewer});assert status==200 and review['materialShrinkage']==(previous is not None) and not review['isCurrent']
   identity={'kind':'adopt','installationId':installation,'scope':{'workspaceId':workspace,'versionId':version,'actorId':actor},'command':{'operation':'adopt','commandId':command,'basis':review['basis'],'acceptMaterialShrinkage':previous is not None}}
  else:identity={'kind':'cancel_request','installationId':installation,'scope':{'workspaceId':workspace,'requestId':request,'actorId':actor},'command':{'commandId':command,'reason':'Planner cancelled this synthetic request'}}
  (directory/'identity.json').write_text(json.dumps(identity)+'\n');(directory/'identity.json').chmod(0o600)
  def run(mode):
   child=subprocess.Popen(['node','--import',str(root/'openplan/node_modules/tsx/dist/loader.mjs'),str(here/'verify_human_native.mts'),str(directory),mode],cwd=root/'openplan',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
   try:
    if mode=='interrupt':
     deadline=time.monotonic()+15
     while not (directory/'interrupted.json').exists() and child.poll() is None and time.monotonic()<deadline:time.sleep(.02)
     assert (directory/'interrupted.json').exists(),'Human command did not reach committed HTTP reply';os.killpg(child.pid,signal.SIGKILL)
    stdout,stderr=child.communicate(timeout=20);(directory/f'{mode}.log').write_text(stdout+stderr);assert child.returncode==(-signal.SIGKILL if mode=='interrupt' else 0),(mode,stderr[:2000]);return json.loads(stdout.strip().splitlines()[-1]) if stdout.strip() else None
   finally:
    if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.communicate(timeout=5)
  run('interrupt');pending=json.loads((directory/'command/pending.json').read_text());assert pending['receipt'] is None and pending['binding']['command']==identity['command']
  resumed=run('resume');retained=run('retained');assert resumed['receipt']==retained['receipt']
  if 'adopt' in kind:
   assert sql(f"SELECT current_version_id FROM public.gtfs_feeds WHERE id='{admitted['feedId']}';")==version
   name='adopt_reviewed_gtfs_ingest';args={'p_workspace':workspace,'p_version':version,'p_actor':viewer,'p_command':str(uuid.uuid4()),'p_basis':review['basis'],'p_accept_shrinkage':True}
   read_name='read_gtfs_adoption_review';read_args={'p_workspace':workspace,'p_version':version,'p_actor':viewer}
  else:
   assert resumed['receipt']['versionId']==version
   if version:assert sql(f"SELECT state FROM openplan_gtfs.executions WHERE version_id='{version}';")=='cancelled'
   assert sql(f"SELECT count(*) FROM openplan_gtfs.request_cancellations WHERE request_id='{request}' AND command_id='{command}';")=='1'
   name='cancel_gtfs_submission';args={'p_workspace':workspace,'p_request':request,'p_actor':viewer,'p_command':str(uuid.uuid4()),'p_reason':'Planner cancelled'}
   read_name='read_gtfs_submission_cancellation';read_args={'p_workspace':workspace,'p_request':request,'p_actor':viewer}
  assert rpc(name,args)[0]==403,'Viewer wrote human decision'
  assert rpc(read_name,read_args)[0]==200,'Viewer could not read human decision'
  for token in [rest['anon_token'],rest['authenticated_tokens'][actor],rest['authenticated_tokens'][viewer]]:
   assert rpc(name,{**args,'p_actor':actor},token)[0] in [401,403],'Untrusted role impersonated a human command'
   assert rpc(read_name,read_args,token)[0] in [401,403],'Untrusted role impersonated a read actor'
  foreign={**read_args,'p_workspace':other,'p_actor':actor};assert rpc(read_name,foreign)==(200,None) if 'cancel' in kind else rpc(read_name,foreign)[0]==403,'Foreign decision disclosed'
  sql(f"UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='{workspace}' AND user_id='{actor}';")
  try:denied=run('denied')
  finally:sql(f"UPDATE public.workspace_members SET role='owner' WHERE workspace_id='{workspace}' AND user_id='{actor}';")
  records.append({'kind':kind,'pendingReceiptAtInterruption':None,'resumed':resumed,'retained':retained,'revokedActor':denied,'viewerWriteDenied':True,'untrustedRolesDenied':True});print(kind,'native HTTP/process recovery pass',flush=True)
paths=[root/'openplan/src/lib/gtfs/managed-human-command.ts',root/'openplan/src/lib/gtfs/managed-request-cancellation.ts',*list((root/'openplan/supabase/migrations').glob('2026101600003[01]*.sql')),here/'verify_human_native.mts',Path(__file__).resolve()]
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},'boundary':'Actual PostgreSQL/PostgREST service, viewer, anon/authenticated roles and real committed-reply process interruption through private human journals. Synthetic completed counts and archive confirmation identities do not establish actual Storage custody, parser publication, scheduled or observed service, application session authorization, official CLI migration/restore or browser acceptance.'},indent=2)+'\n')
