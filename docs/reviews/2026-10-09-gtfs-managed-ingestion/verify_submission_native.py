"""Native admission, ZIP custody, process interruption and original-actor replay."""
from pathlib import Path
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
import requests
here=Path(__file__).resolve().parent;root=here.parents[2]
sys.path.insert(0,str(here.parent/'2026-10-09-gtfs-ingest-recovery'));sys.path.insert(0,str(here.parent/'2026-10-08-model-custody-metadata/prototype'))
from isolated_storage import storage
from isolated_postgrest import gateway
source=json.loads(Path(sys.argv[1]).read_text());assert source['container']=='supabase_db_openplan-restore-target-2026091050';assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
archive=Path(sys.argv[2]).resolve(strict=True);out=Path(sys.argv[3]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
config={**source,'database':'openplan_attempt_cli_'+uuid.uuid4().hex};(out/'database.json').write_text(json.dumps(config)+'\n');(out/'database.json').chmod(0o600)
def sql(query,database=None):
 r=subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',database or config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[:1500])
 return r.stdout.strip()
assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();',source['database'])=='0';sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source["database"]};','postgres')
migration=root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
sql('-- UUID pagination rotates eligible discovery'+migration.read_text().split('-- UUID pagination rotates eligible discovery')[1].split('-- Retained tokens can inspect')[0])
workspace,actor=str(uuid.uuid4()),str(uuid.uuid4());sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'); INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic admission recovery','proof-{workspace}'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');")
custodian=str(uuid.uuid4());sql(f"INSERT INTO auth.users(id,email) VALUES('{custodian}','{custodian}@example.invalid'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{custodian}','owner');")
records=[]
with storage(config) as native,gateway('public',database=config['database'],subjects=(actor,)) as rest:
 env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=512','OPENPLAN_PROOF_HTTP_URL':rest['url'],'OPENPLAN_PROOF_HTTP_TOKEN':rest['service_token'],'OPENPLAN_PROOF_STORAGE_URL':native['url'],'OPENPLAN_PROOF_STORAGE_TOKEN':native['token'],'OPENPLAN_PROOF_WORKSPACE':workspace,'OPENPLAN_PROOF_ACTOR':actor,'OPENPLAN_PROOF_PARSER_BUILD':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()}
 try:
  for kind,boundary in [('upload','local'),('upload','admit'),('upload','upload'),('upload','confirm'),('url','admit'),('catalog','admit')]:
   directory=out/f'{kind}-{boundary}'
   def run(mode):
    child=subprocess.Popen(['node','--import',str(root/'openplan/node_modules/tsx/dist/loader.mjs'),str(here/'verify_submission_native.mts'),str(directory),mode,str(archive),kind],cwd=root/'openplan',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
    try:
     if mode.startswith('interrupt-'):
      deadline=time.monotonic()+40
      while not (directory/'interrupted.json').exists() and child.poll() is None and time.monotonic()<deadline:time.sleep(.05)
      assert (directory/'interrupted.json').exists(),'Submission did not reach declared boundary';os.killpg(child.pid,signal.SIGKILL)
     stdout,stderr=child.communicate(timeout=60);(directory/f'{mode}.log').write_text(stdout+stderr)
     assert child.returncode==(-signal.SIGKILL if mode.startswith('interrupt-') else 0),(mode,stderr[:1500]);return json.loads(stdout.strip().splitlines()[-1]) if stdout.strip() else None
    finally:
     if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.communicate(timeout=5)
   run('seed');run('interrupt-'+boundary)
   identity=json.loads((directory/'identity.json').read_text());request=identity['requestId']
   interrupted=json.loads((directory/'interrupted.json').read_text());assert interrupted['resolutions']==1
   if kind=='upload':assert hashlib.sha256((directory/'submissions'/request/'archive.zip').read_bytes()).hexdigest()==hashlib.sha256(archive.read_bytes()).hexdigest(),'Private bytes differ at interruption'
   before=int(sql(f"SELECT count(*) FROM openplan_gtfs.submissions WHERE request_id='{request}';"));assert before==(0 if boundary=='local' else 1)
   resumed=run('resume-'+boundary);retained=run('retained')
   assert resumed['registration']==retained['registration'],'Replay changed admission identity'
   assert int(sql(f"SELECT count(*) FROM openplan_gtfs.submissions WHERE request_id='{request}';"))==1,'Replay duplicated submission'
   version=resumed['registration']['versionId']
   state=json.loads(sql(f"SELECT jsonb_build_object('status',v.status,'current',v.is_current,'state',j.state,'archiveConfirmed',j.archive_available,'routes',(SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id),'stops',(SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id),'completion',(SELECT count(*) FROM openplan_gtfs.completion_receipts WHERE version_id=v.id)) FROM public.gtfs_feed_versions v JOIN openplan_gtfs.executions j ON j.version_id=v.id WHERE v.id='{version}';"))
   assert state==({'status':'ready','state':'ready','current':False,'archiveConfirmed':True,'routes':95,'stops':717,'completion':1} if kind=='upload' else {'status':'pending','state':'queued','current':False,'archiveConfirmed':False,'routes':0,'stops':0,'completion':0}),'Native submission state differs'
   saved=json.loads((directory/'submissions'/request/'pending.json').read_text());args={'p_request':request,'p_workspace':workspace,'p_actor':actor,'p_feed':saved['resolved']['feedId'],'p_source':saved['resolved']['source']}
   sql(f"UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='{workspace}' AND user_id='{actor}';")
   try:
    denied=requests.post(rest['url']+'/rpc/admit_gtfs_ingest',headers={'Authorization':'Bearer '+rest['service_token']},json=args,timeout=10);assert denied.status_code==403 and denied.json().get('code')=='42501','Retained admission bypassed current original-actor access'
   finally:sql(f"UPDATE public.workspace_members SET role='owner' WHERE workspace_id='{workspace}' AND user_id='{actor}';")
   records.append({'kind':kind,'boundary':boundary,'beforeCommittedSubmissions':before,'interrupted':interrupted,'resumed':resumed,'retained':retained,'database':state,'originalActorReplayDenied':True});print(kind,boundary,'native submission recovery pass',flush=True)
 finally:
  paths=[]
  for path in out.glob('*/identity.json'):
   identity=json.loads(path.read_text())
   if identity.get('versionId'):paths.append(f'{workspace}/{identity["feedId"]}/{identity["versionId"]}.zip')
  if paths:
   deleted=requests.delete(native['url']+'/object/gtfs-uploads',headers={'Authorization':'Bearer '+native['token']},json={'prefixes':paths},timeout=10);assert deleted.status_code==200,'Synthetic object cleanup failed'
summary={'records':records,'sourceSha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'openplan/src/lib/gtfs/managed-submission-recovery.ts',root/'openplan/src/lib/gtfs/managed-source.ts',root/'openplan/src/lib/gtfs/managed-admission.ts',root/'openplan/src/lib/gtfs/managed-worker-queue.ts',root/'openplan/src/lib/gtfs/managed-worker-service.ts',migration,here/'verify_submission_native.mts',Path(__file__).resolve()]},'boundary':'Native PostgreSQL/PostgREST/Storage, retained ZIP process recovery and full ZIP parser publication. URL/catalog prove saved resolution and identity only. No application route, actual catalog request, public network, full CLI upgrade/restore, capacity, adoption or browser acceptance.'}
(out/'result.json').write_text(json.dumps(summary,indent=2)+'\n')
