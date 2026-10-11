"""Observe admission and cancellation contention with two actual connections."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib,json,os,re,subprocess,sys,time,uuid
import psycopg2
from psycopg2.extras import Json
from psycopg2 import sql
here=Path(__file__).resolve().parent;root=here.parents[2]
source=json.loads(Path(sys.argv[1]).read_text());assert source['container']=='supabase_db_openplan-restore-target-2026091050';assert os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER')==source['container'];assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
out=Path(sys.argv[2]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
state=json.loads(subprocess.check_output(['docker','inspect',source['container']],text=True))[0];settings=dict(value.split('=',1) for value in state['Config']['Env'] if '=' in value);port=state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
config={**source,'database':'openplan_attempt_cli_'+uuid.uuid4().hex};(out/'database.json').write_text(json.dumps(config)+'\n');(out/'database.json').chmod(0o600)
connections=[]
def connect(database,service=False):
 conn=psycopg2.connect(host='127.0.0.1',port=port,dbname=database,user='postgres',password=settings['POSTGRES_PASSWORD'],connect_timeout=5,application_name='openplan-request-order-'+uuid.uuid4().hex,options='-c statement_timeout=8000 -c lock_timeout=6000');conn.autocommit=True;connections.append(conn)
 if service:query(conn,'SET ROLE service_role')
 return conn
def query(conn,statement,args=()):
 with conn.cursor() as cur:
  if args:cur.execute(statement,args)
  else:cur.execute(statement)
  return cur.fetchone()[0] if cur.description else None
def rpc(conn,name,*args):
 try:return {'receipt':query(conn,sql.SQL('SELECT public.{}({})').format(sql.Identifier(name),sql.SQL(',').join(sql.Placeholder() for _ in args)),[Json(v) if isinstance(v,dict) else v for v in args]),'code':None}
 except psycopg2.Error as error:return {'receipt':None,'code':error.pgcode}
source_admin=connect('postgres');assert query(source_admin,'SELECT count(*) FROM pg_stat_activity WHERE datname=%s',(source['database'],))==0
assert query(source_admin,'SELECT pg_database_size(%s)',(source['database'],))<1024**3,'Proof clone exceeds its disk budget'
query(source_admin,sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(config['database']),sql.Identifier(source['database'])));source_admin.close()
admin=connect(config['database']);first=connect(config['database'],True);second=connect(config['database'],True)
path=root/'openplan/supabase/migrations/20261016000031_gtfs_request_cancellation.sql';original=path.read_text();query(admin,original)
start=original.index('CREATE FUNCTION public.cancel_gtfs_submission');end=original.index('END $$;',start)+len('END $$;');function=original[start:end].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
lock=" PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-admission:'||p_request::text,0));";assert function.count(lock)==1
def contention(future):
 deadline=time.monotonic()+3
 while time.monotonic()<deadline:
  state=query(admin,"SELECT jsonb_build_object('wait',wait_event_type,'blockers',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid=%s",(second.get_backend_pid(),))
  if state and state['wait']=='Lock' and first.get_backend_pid() in state['blockers']:return True
  if future.done():return False
  time.sleep(.02)
 return False
def case(order):
 workspace,actor,request,command=[str(uuid.uuid4()) for _ in range(4)]
 query(admin,'INSERT INTO auth.users(id,email) VALUES(%s,%s)',(actor,actor+'@example.invalid'));query(admin,'INSERT INTO public.workspaces(id,name,slug) VALUES(%s,%s,%s)',(workspace,'Synthetic request ordering','order-'+workspace));query(admin,"INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(%s,%s,'owner')",(workspace,actor))
 url='https://example.invalid/'+request+'.zip';metadata={'kind':'url','provisionalName':'Synthetic request ordering','sourceUrl':url,'normalizedSourceUrl':url}
 admission=('admit_gtfs_ingest',request,workspace,actor,None,metadata);cancellation=('cancel_gtfs_submission',workspace,request,actor,command,'Planner cancelled')
 first.autocommit=False
 try:
  initial=rpc(first,*(cancellation if order=='cancel-first' else admission));assert initial['code'] is None,initial
  with ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(rpc,second,*(admission if order=='cancel-first' else cancellation))
   try:blocked=contention(future)
   finally:first.commit();first.autocommit=True
   later=future.result(timeout=9)
  rows=query(admin,"SELECT jsonb_build_object('submissions',(SELECT count(*) FROM openplan_gtfs.submissions WHERE request_id=%s),'cancellations',(SELECT count(*) FROM openplan_gtfs.request_cancellations WHERE request_id=%s),'state',(SELECT j.state FROM openplan_gtfs.executions j JOIN openplan_gtfs.submissions s ON s.version_id=j.version_id WHERE s.request_id=%s))",(request,request,request))
  assert blocked,'contending request bypassed admission lock'
  if order=='cancel-first':assert later['code']=='55000' and rows=={'submissions':0,'cancellations':1,'state':None},'cancellation-first produced an admitted version'
  else:assert later['code'] is None and later['receipt']['versionId']==initial['receipt']['versionId'] and rows=={'submissions':1,'cancellations':1,'state':'cancelled'},'admission-first was not closed by cancellation'
  return {'order':order,'blockingObserved':blocked,'laterCode':later['code'],'rows':rows}
 finally:
  if not first.autocommit:first.rollback();first.autocommit=True
records=[]
try:
 for name,ddl,broken in [('baseline',function,False),('harmless',function+'\n-- Harmless request ordering control.\n',False),('missing-request-lock',function.replace(lock,''),True),('restored',function,False)]:
  query(admin,ddl);cases=[]
  for order in ['cancel-first','admit-first']:
   try:cases.append(case(order))
   except AssertionError as error:
    assert broken and str(error)=='contending request bypassed admission lock',(name,str(error));cases.append({'order':order,'intendedAssertion':str(error)})
   else:assert not broken,(name,'missing request lock passed')
  records.append({'variant':name,'result':'expected assertion failures' if broken else 'pass','cases':cases});print(name,records[-1]['result'],flush=True)
finally:
 query(admin,function)
 for conn in connections:
  if not conn.closed:conn.close()
(out/'result.json').write_text(json.dumps({'records':records,'migrationSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'boundary':'Actual service-role commands in both transaction orders, with pg_blocking_pids observing the expected owner before commit. Retained clone and synthetic URL metadata. No upload, HTTP/session, official CLI migration, restore or browser acceptance.'},indent=2)+'\n')
