"""Run actual app cleanup against late native uploads and deleted parent records."""
from pathlib import Path
import hashlib,http.client,json,os,re,subprocess,sys,time,uuid
from urllib.parse import urlsplit
import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json
import requests

here=Path(__file__).resolve().parent;root=here.parents[2]
sys.path.insert(0,str(here.parent/'2026-10-09-gtfs-ingest-recovery'))
sys.path.insert(0,str(here.parent/'2026-10-08-model-custody-metadata/prototype'))
from isolated_storage import storage
from isolated_postgrest import gateway
config=json.loads(Path(sys.argv[1]).read_text());container=config['container']
assert container=='supabase_db_openplan-restore-target-2026091050'
assert os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER')==container
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}',config['database'])
archive=Path(sys.argv[2]).read_bytes();assert 64_000<len(archive)<2_000_000
out=Path(sys.argv[3]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
state=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
settings=dict(v.split('=',1) for v in state['Config']['Env'] if '=' in v)
port=state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
def connect(database,service=False):
 c=psycopg2.connect(host='127.0.0.1',port=port,dbname=database,user='postgres',password=settings['POSTGRES_PASSWORD'],connect_timeout=5,options='-c statement_timeout=15000 -c lock_timeout=5000');c.autocommit=True
 if service:
  with c.cursor() as cur:cur.execute('SET ROLE service_role')
 return c
def query(c,statement,args=None):
 with c.cursor() as cur:
  cur.execute(statement,args)
  return cur.fetchone()[0] if cur.description else None
control=connect('postgres')
assert query(control,'SELECT count(*) FROM pg_stat_activity WHERE datname=%s',(config['database'],))==0
database='openplan_attempt_cli_'+uuid.uuid4().hex
query(control,sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database),sql.Identifier(config['database'])));control.close()
config={**config,'database':database};(out/'database.json').write_text(json.dumps(config)+'\n')
admin=connect(database)
migration=root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
assert query(admin,"SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs'")==0
query(admin,migration.read_text());service=connect(database,True)
def fixture():
 workspace,actor=str(uuid.uuid4()),str(uuid.uuid4())
 query(admin,'INSERT INTO auth.users(id,email) VALUES(%s,%s)',(actor,actor+'@example.invalid'))
 query(admin,'INSERT INTO public.workspaces(id,name,slug) VALUES(%s,%s,%s)',(workspace,'Synthetic archive reconciliation','archive-'+workspace))
 query(admin,"INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(%s,%s,'owner')",(workspace,actor))
 source={'kind':'upload','provisionalName':'Synthetic archive reconciliation','uploadSha256':hashlib.sha256(archive).hexdigest(),'uploadBytes':len(archive)}
 admitted=query(service,'SELECT public.admit_gtfs_ingest(%s,%s,%s,NULL,%s)',(str(uuid.uuid4()),workspace,actor,Json(source)))
 version,feed=admitted['versionId'],admitted['feedId']
 return workspace,actor,feed,version,f'{workspace}/{feed}/{version}.zip'

records=[]
try:
 with storage(config) as native,gateway('public',database=database) as rest:
  headers={'Authorization':'Bearer '+native['token']}
  upload_headers={**headers,'Content-Type':'application/zip','x-upsert':'false'}
  env={**os.environ,'OPENPLAN_PROOF_HTTP_URL':rest['url'],'OPENPLAN_PROOF_HTTP_TOKEN':rest['service_token'],
       'OPENPLAN_PROOF_STORAGE_URL':native['url'],'OPENPLAN_PROOF_STORAGE_TOKEN':native['token'],'NODE_OPTIONS':'--max-old-space-size=256'}
  def sweep():
   r=subprocess.run(['node','--import',str(root/'openplan/node_modules/tsx/dist/loader.mjs'),str(here/'verify_archive_reconciliation.mts')],cwd=root/'openplan',env=env,text=True,capture_output=True,timeout=30)
   assert r.returncode==0,('Native app cleanup failed',r.stderr[-2000:])
   return json.loads(r.stdout)
  def count(table,version):
   return query(admin,sql.SQL('SELECT count(*) FROM {} WHERE version_id=%s').format(sql.Identifier(*table.split('.'))),(version,))
  def download(path):
   return requests.get(native['url']+'/object/authenticated/gtfs-uploads/'+path,headers=headers,timeout=10)
  # Drain predecessor fixtures without counting them as the new case's effects.
  sweep()
  for mode in ['cancel','delete-feed','delete-workspace','legacy-reap']:
   workspace,actor,feed,version,path=fixture()
   if mode=='legacy-reap':
    version=str(uuid.uuid4());path=f'{workspace}/{feed}/{version}.zip'
    query(admin,"INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status) VALUES(%s,%s,%s,'upload','pending')",(version,workspace,feed))
   target=urlsplit(native['url']);connection=http.client.HTTPConnection(target.hostname,target.port,timeout=10)
   try:
    connection.putrequest('POST','/object/gtfs-uploads/'+path)
    for key,value in upload_headers.items():connection.putheader(key,value)
    connection.putheader('Content-Length',str(len(archive)));connection.endheaders()
    split=len(archive)//2;connection.send(archive[:split]);deadline=time.monotonic()+4
    while time.monotonic()<deadline:
     staged=[p for p in Path(native['object_directory']).rglob('*') if p.is_file() and version in str(p) and p.stat().st_size>0]
     if staged:break
     time.sleep(.02)
    assert staged,'Held request did not reach Storage'
    if mode=='cancel':
     closed=query(service,'SELECT public.cancel_gtfs_ingest(%s,%s,%s,%s,%s)',(workspace,version,str(uuid.uuid4()),actor,'Synthetic cancellation'))
     assert closed['state']=='cancelled'
    elif mode=='legacy-reap':
     assert query(service,"SELECT public.reap_gtfs_feed_version(%s,clock_timestamp()+interval '1 day')",(version,)) is True
    elif mode=='delete-feed':query(service,'DELETE FROM public.gtfs_feeds WHERE id=%s',(feed,))
    else:query(service,'DELETE FROM public.workspaces WHERE id=%s',(workspace,))
    assert count('openplan_gtfs.retired_archives',version)==1,'Deletion authority missing'
    first=sweep();assert first['removals']==(0 if mode=='legacy-reap' else 1),'Initial absent-object cleanup differs'
    assert count('public.gtfs_ingest_storage_cleanup',version)==0,'Initial cleanup request remains'
    connection.send(archive[split:]);response=connection.getresponse();response.read()
    assert response.status==200,'Expected native late upload'
    before=download(path);assert before.status_code==200 and hashlib.sha256(before.content).digest()==hashlib.sha256(archive).digest()
    second=sweep();assert second['removals']==1,'Late object was not rediscovered'
    after=download(path);assert after.status_code==400 and str(after.json().get('statusCode'))=='404','Late object remains downloadable'
    assert count('openplan_gtfs.retired_archives',version)==1,'Acknowledgment erased recurring authority'
    assert count('public.gtfs_ingest_storage_cleanup',version)==0
    third=sweep();assert third['removals']==0,'Absent retired object caused an unnecessary API removal'
    records.append({'case':mode,'first':first,'late':second,'absent':third,'retirementSurvives':True})
   finally:
    connection.close()
    removed=requests.delete(native['url']+'/object/gtfs-uploads',headers=headers,json={'prefixes':[path]},timeout=10)
    assert removed.status_code==200
  # Real files without a retired key, and live versions with an erroneous queue
  # request, must remain untouched. Ready is a synthetic legacy database fixture.
  for status in ['pending','ready','unknown-key']:
   workspace,actor,feed,version,path=fixture()
   if status=='ready':
    version=str(uuid.uuid4());path=f'{workspace}/{feed}/{version}.zip'
    query(admin,"INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,route_count,stop_count,route_service_level_rows,stop_service_level_rows) VALUES(%s,%s,%s,'upload','ready',1,1,1,1)",(version,workspace,feed))
   if status!='unknown-key':query(service,'INSERT INTO public.gtfs_ingest_storage_cleanup(version_id,storage_path) VALUES(%s,%s)',(version,path))
   else:path=f'{uuid.uuid4()}/{uuid.uuid4()}/{uuid.uuid4()}.zip'
   try:
    uploaded=requests.post(native['url']+'/object/gtfs-uploads/'+path,headers=upload_headers,data=archive,timeout=10);assert uploaded.status_code==200
    checked=sweep();assert checked['removals']==0,'Protected archive was selected'
    kept=download(path);assert kept.status_code==200 and hashlib.sha256(kept.content).digest()==hashlib.sha256(archive).digest()
    records.append({'case':status,'retainedExactBytes':True,'sweep':checked})
   finally:
    removed=requests.delete(native['url']+'/object/gtfs-uploads',headers=headers,json={'prefixes':[path]},timeout=10);assert removed.status_code==200
  result={'storageImage':native['image'],'postgres':query(admin,'SHOW server_version'),'cases':records,
          'hashes':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [migration,Path(__file__),here/'verify_archive_reconciliation.mts',root/'openplan/src/lib/gtfs/persist.ts']}}
finally:
 service.close();admin.close()
assert not Path(native['object_directory']).exists()
result['temporaryResourcesRemoved']=True
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
