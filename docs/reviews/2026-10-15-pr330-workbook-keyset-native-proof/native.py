"""Serial, bounded native proof. Credentials and SQL originals stay private.
Run only through the documented flock/systemd/bwrap wrapper. No source dump,
role/global mutation, existing-target write, migration, or borrowed-service stop.
"""
import contextlib, datetime as dt, hashlib, json, os, socket, subprocess, sys, time, urllib.parse, uuid
from pathlib import Path
import psycopg2
from psycopg2.extras import RealDictCursor
BASE=Path('/home/nathaniel/.local/state/openplan/pr330-workbook-keyset-native-proof-20261015')
REPO=Path(__file__).resolve().parents[3]
CLUSTER='a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
NAME='supabase_db_openplan-restore-target-2026091050'
SOURCE='openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up'
NETWORK='supabase_network_openplan-restore-target-2026091050'
IMAGE='sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'
HOST,PORT='127.74.19.12',29950
V6=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
OLD=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015')
DUMP=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump')
PROTECTED=[json.loads((OLD/'plan.json').read_text())['target'],SOURCE,'openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90']+json.loads((V6/'protected-databases.json').read_text())
def write(p,v):
 p.write_text(json.dumps(v,indent=2,default=str)+'\n');p.chmod(0o600)
def sha(v):
 if not isinstance(v,bytes):v=json.dumps(v,sort_keys=True,default=str).encode()
 return hashlib.sha256(v).hexdigest()
def command(a,**kw):
 p=subprocess.run(a,capture_output=True,timeout=180,**kw)
 if p.returncode:raise RuntimeError('command failed '+a[0]+' (private logs only)')
 return p.stdout
def ident(v):return '"'+v.replace('"','""')+'"'
def guard_helper(v,identity,name,target,uri):
 assert v['Id']==identity and v['Name']=='/'+name and v['Image']==IMAGE
 h=v['HostConfig'];assert h['Memory']==536870912 and h['MemorySwap']==536870912 and h['NanoCpus']==500000000 and h['PidsLimit']==128
 assert v['Config']['Labels']['openplan.proof.database']==target and not v['Mounts']
 assert h['PortBindings']=={'3000/tcp':[{'HostIp':HOST,'HostPort':str(PORT)}]}
 assert dict(x.split('=',1) for x in v['Config']['Env'] if '=' in x)['PGRST_DB_URI']==uri
class Native:
 def __init__(self):
  os.umask(0o077)
  self.info=json.loads(command(['docker','inspect',CLUSTER]))[0]
  assert self.info['Id']==CLUSTER and self.info['Name']=='/'+NAME and self.info['State']['Running'],'cluster identity'
  e=dict(x.split('=',1) for x in self.info['Config']['Env'] if '=' in x)
  self.args=dict(host=self.info['NetworkSettings']['Networks'][NETWORK]['IPAddress'],port=5432,user='supabase_admin',password=e['POSTGRES_PASSWORD'],connect_timeout=5)
  self.plan=json.loads((BASE/'plan.json').read_text()) if (BASE/'plan.json').exists() else {}
  self.cg=Path('/sys/fs/cgroup'+Path('/proc/self/cgroup').read_text().strip().split('::')[1])
  assert (self.cg/'memory.max').read_text().strip()=='1073741824' and (self.cg/'memory.swap.max').read_text().strip()=='0','check service 1GiB/zero swap'
 def connect(self,db,readonly=False):
  assert (db in PROTECTED and readonly) or (db==self.plan.get('target') and db.startswith('openplan_pr330_native_')),'database allowlist'
  c=psycopg2.connect(dbname=db,**self.args);c.autocommit=True
  self.query(c,"set work_mem='16MB';set statement_timeout='30s';set lock_timeout='3s';set idle_in_transaction_session_timeout='30s';set application_name='pr330-workbook-native-proof'")
  if readonly:self.query(c,'set default_transaction_read_only=on')
  return c
 def query(self,c,sql,args=()):
  with c.cursor(cursor_factory=RealDictCursor) as cur:
   cur.execute(sql,args or None)
   return [dict(x) for x in cur.fetchall()] if cur.description else []
 def snapshot(self,db):
  with contextlib.closing(self.connect(db,True)) as c:
   self.query(c,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
   tables=self.query(c,"select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not like 'pg_%' and n.nspname<>'information_schema' order by 1,2")
   result={}
   for t in tables:
    name=t['nspname']+'.'+t['relname'];result[name]=self.query(c,"select count(*) count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from ONLY "+ident(t['nspname'])+'.'+ident(t['relname'])+' t')[0]
   for name in ['pg_class','pg_attribute','pg_proc','pg_constraint','pg_namespace','pg_policy','pg_trigger','pg_rewrite','pg_depend','pg_default_acl','pg_extension','pg_authid','pg_auth_members','pg_sequences']:
    result['catalog.'+name]=self.query(c,"select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from pg_catalog."+name+' t')[0]
   result['settings']=self.query(c,'select * from pg_db_role_setting where setdatabase=0 or setdatabase=(select oid from pg_database where datname=current_database()) order by setdatabase,setrole')
   result['database']=self.query(c,'select oid,datname,datdba,datcollate,datctype,datacl,datconfig from (select d.*,null::text[] datconfig from pg_database d) t where datname=current_database()')[0]
   self.query(c,'COMMIT');return result
 def files(self):
  result={}
  for root in [V6,OLD]:
   for p in sorted(root.rglob('*')):
    if p.is_file() and not p.is_symlink():result[str(p)]={'sha256':sha(p.read_bytes()),'mode':p.stat().st_mode&0o777}
  # Include the canonical three unrelated paths without reading or publishing their contents.
  for rel in ['.directory','COORDINATION.md','supabase']:
   p=Path('/home/nathaniel/code/openplan')/rel
   paths=[p] if p.is_file() else sorted(p.rglob('*'))
   for x in paths:
    if x.is_file() and not x.is_symlink():result[str(x)]={'sha256':sha(x.read_bytes()),'mode':x.stat().st_mode&0o777}
  return result
 def setup(self):
  assert not self.plan,'exclusive setup once'
  free=os.statvfs(BASE);free=free.f_bavail*free.f_frsize
  available=int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024
  assert free>2*1024**3 and available>3*1024**3,'capacity safe floor'
  assert DUMP.stat().st_size==16232305 and sha(DUMP.read_bytes())=='181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398','fixed dump identity'
  snapshots={db:self.snapshot(db) for db in PROTECTED};write(BASE/'protected-before-private.json',snapshots)
  write(BASE/'files-before-private.json',self.files())
  self.plan={'target':'openplan_pr330_native_'+uuid.uuid4().hex[:24],'cluster':CLUSTER,'source':SOURCE,'dump':{'path':str(DUMP),'bytes':DUMP.stat().st_size,'sha256':sha(DUMP.read_bytes())},'freeDiskBytes':free,'availableMemoryBytes':available,'createdAt':dt.datetime.now(dt.timezone.utc).isoformat()}
  write(BASE/'plan.json',self.plan) # reserve exact name before checking absence and creating
  with contextlib.closing(self.connect(SOURCE,True)) as c:
   assert not self.query(c,'select 1 from pg_database where datname=%s',(self.plan['target'],)),'new reserved database absent'
   size=self.query(c,'select pg_database_size(current_database()) bytes')[0]['bytes'];assert free>size*4,'restore size headroom'
   self.plan['sourceBytes']=size;self.plan['server']=self.query(c,'select version() version')[0]['version']
  command(['docker','exec',CLUSTER,'createdb','-U','supabase_admin','-T','template0','-O','postgres',self.plan['target']])
  with DUMP.open('rb') as f:
   p=subprocess.run(['docker','exec','-i','-e','PGOPTIONS=-c work_mem=16MB -c statement_timeout=120000 -c lock_timeout=3000',CLUSTER,'pg_restore','-U','supabase_admin','-d',self.plan['target'],'--single-transaction','--exit-on-error'],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
  (BASE/'restore-private.log').write_bytes(p.stdout+p.stderr);assert p.returncode==0,'single restore'
  with contextlib.closing(self.connect(self.plan['target'],True)) as c:
   versions=self.query(c,'select version from supabase_migrations.schema_migrations order by version')
   assert len(versions)==419 and versions[-1]['version']=='20261017000016','419/latest16 only'
   self.plan['history']={'count':419,'latest':'20261017000016','sha256':sha(self.query(c,'select * from supabase_migrations.schema_migrations order by version'))}
   self.plan['catalog']=self.query(c,'select oid,datname,datdba::regrole::text from pg_database where datname=current_database()')[0]
  write(BASE/'plan.json',self.plan)
  self.fixtures()
 def fixtures(self):
  assert not (BASE/'fixtures-private.json').exists(),'fixtures once'
  f={'actor':str(uuid.uuid4()),'portfolios':[]}
  with contextlib.closing(self.connect(self.plan['target'])) as c:
   self.query(c,'BEGIN');self.query(c,'SET LOCAL ROLE postgres')
   try:
    self.query(c,"insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(%s,'authenticated','authenticated',%s,'{}','{}',now(),now())",(f['actor'],'synthetic-'+f['actor']+'@workbook.invalid'))
    for n in [0,2000,2001,7,3,4]:
     ws=str(uuid.uuid4());name='Synthetic portfolio '+str(n)
     self.query(c,'insert into public.workspaces(id,name,slug) values(%s,%s,%s)',(ws,name,'pr330-'+ws))
     if n!=3:self.query(c,"insert into public.workspace_members(workspace_id,user_id,role) values(%s,%s,'viewer')",(ws,f['actor']))
     for i in reversed(range(n)):
      self.query(c,"""insert into public.projects(id,workspace_id,name,summary,created_by,estimated_cost_amount,estimated_cost_currency,estimated_cost_basis_year,estimated_cost_recorded_at) values(%s,%s,%s,%s,%s,%s,'USD',%s,'2026-10-01T01:02:03Z')""",(str(uuid.uuid5(uuid.UUID(ws),str(i))),ws,'=Literal '+str(i),'Synthetic source '+str(i),f['actor'],'123456789.12' if i%2 else '42.01',2025 if i%2 else None))
     self.query(c,'alter table public.projects disable trigger user')
     # Native timestamp literals include equal milliseconds with distinct microseconds.
     self.query(c,"update public.projects set created_at='2026-10-01T01:02:03Z',updated_at=case when right(name,1) in ('0','2','4','6','8') then '2026-10-03T01:02:03.000999Z'::timestamptz else '2026-10-03T01:02:03.000111Z'::timestamptz end where workspace_id=%s",(ws,))
     if n==4:
      self.query(c,"with ranked as (select id,row_number() over(order by id) n from public.projects where workspace_id=%s) update public.projects p set updated_at='2026-10-04T00:00:00Z'::timestamptz-ranked.n*interval '1 second' from ranked where p.id=ranked.id",(ws,))
     self.query(c,'alter table public.projects enable trigger user')
     rows=self.query(c,'select * from public.projects where workspace_id=%s order by updated_at desc,id asc',(ws,))
     f['portfolios'].append({'count':n,'workspace':ws,'name':name,'rows':rows})
    self.query(c,'COMMIT')
   except BaseException:self.query(c,'ROLLBACK');raise
  write(BASE/'fixtures-private.json',f)
  write(BASE/'target-before-private.json',self.snapshot(self.plan['target']))
 def concurrent(self,action):
  f=json.loads((BASE/'fixtures-private.json').read_text());p=next(x for x in f['portfolios'] if x['count']==4)
  third=sorted(p['rows'],key=lambda r:r['id'])[2]
  with contextlib.closing(self.connect(self.plan['target'])) as c:
   self.query(c,'BEGIN');self.query(c,'SET LOCAL ROLE postgres');self.query(c,'alter table public.projects disable trigger user')
   self.query(c,'update public.projects set updated_at=%s where id=%s and workspace_id=%s',('2026-10-05T00:00:00.123456Z' if action=='edit' else third['updated_at'],third['id'],p['workspace']))
   self.query(c,'alter table public.projects enable trigger user');self.query(c,'COMMIT')
   rows=self.query(c,'select * from public.projects where workspace_id=%s order by updated_at desc,id asc',(p['workspace'],))
  write(BASE/('concurrent-'+action+'-private.json'),{'id':third['id'],'rows':rows})
 def helper(self,cap):
  out=BASE/f'cap-{cap}';out.mkdir(mode=0o700)
  with socket.socket() as s:s.bind((HOST,PORT))
  old=json.loads(command(['docker','inspect','e743ca20ff99bb6db5dd7152850a0f81dd1454e90a095ba5b88b767cc51bd9c2']))[0];assert old['Image']==IMAGE
  env=dict(x.split('=',1) for x in old['Config']['Env'] if '=' in x);uri=urllib.parse.urlsplit(env['PGRST_DB_URI']);assert uri.hostname==NAME and uri.username=='authenticator'
  uri=urllib.parse.urlunsplit(uri._replace(path='/'+self.plan['target'],query=urllib.parse.urlencode({'options':'-c work_mem=16MB -c statement_timeout=10000 -c lock_timeout=3000'},quote_via=urllib.parse.quote)))
  secret=uuid.uuid4().hex+uuid.uuid4().hex
  env={'PGRST_DB_URI':uri,'PGRST_JWT_SECRET':secret,'PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_OPENAPI_MODE':'disabled','PGRST_DB_POOL':'1','PGRST_DB_POOL_ACQUISITION_TIMEOUT':'5','PGRST_SERVER_PORT':'3000','PGRST_DB_MAX_ROWS':str(cap)}
  ep=out/'runtime-private.env';ep.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');ep.chmod(0o600)
  write(out/'client-private.json',{'url':f'http://{HOST}:{PORT}','secret':secret,'cap':cap})
  name='openplan-pr330-native-rest-'+uuid.uuid4().hex[:12]
  identity=command(['docker','run','--detach','--pull','never','--name',name,'--network',NETWORK,'--publish',f'{HOST}:{PORT}:3000','--memory','536870912','--memory-swap','536870912','--cpus','0.5','--pids-limit','128','--label','openplan.purpose=pr330-workbook-keyset-native-proof-20261015','--label','openplan.proof.database='+self.plan['target'],'--env-file',str(ep),IMAGE]).decode().strip()
  receipt={'id':identity,'name':name,'database':self.plan['target'],'image':IMAGE,'cap':cap,'publish':f'{HOST}:{PORT}'};write(out/'receipt.json',receipt)
  def inspect():
   v=json.loads(command(['docker','inspect',identity]))[0]
   guard_helper(v,identity,name,self.plan['target'],uri)
   return v
  try:
   inspect();time.sleep(1);receipt['version']=command(['docker','exec',identity,'postgrest','--version']).decode().strip();assert '14.15' in receipt['version'];write(out/'receipt.json',receipt)
   p=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('controls.py')),str(cap)],capture_output=True,timeout=240)
   (out/'controller-private.log').write_bytes(p.stdout+p.stderr);assert p.returncode==0,'native controller (private log retained)'
  finally:
   v=inspect();logs=subprocess.run(['docker','logs',identity],capture_output=True,timeout=10);(out/'postgrest-private.log').write_bytes(logs.stdout+logs.stderr)
   if v['State']['Running']:command(['docker','stop','--time','5',identity])
   v=inspect();write(out/'stopped.json',{'id':identity,'running':v['State']['Running'],'oomKilled':v['State']['OOMKilled'],'exitCode':v['State']['ExitCode']});assert not v['State']['Running']
   self.resource(out/'resources.json')
 def resource(self,p):write(p,{'memoryMax':(self.cg/'memory.max').read_text().strip(),'swapMax':(self.cg/'memory.swap.max').read_text().strip(),'peak':(self.cg/'memory.peak').read_text().strip(),'events':(self.cg/'memory.events').read_text().strip(),'dbMemory':self.info['HostConfig']['Memory'],'dbMemorySwap':self.info['HostConfig']['MemorySwap']})
 def final(self):
  before=json.loads((BASE/'protected-before-private.json').read_text());after={db:self.snapshot(db) for db in PROTECTED};write(BASE/'protected-after-private.json',after);assert before==after,'protected full data/catalog/roles unchanged'
  files=self.files();write(BASE/'files-after-private.json',files);assert files==json.loads((BASE/'files-before-private.json').read_text()),'frozen files/canonical unrelated unchanged'
  target=self.snapshot(self.plan['target']);write(BASE/'target-after-private.json',target);assert target==json.loads((BASE/'target-before-private.json').read_text()),'fixture target exact restoration'
  pins=json.loads((BASE/'source-bindings.json').read_text())
  for rel,v in pins['files'].items():assert sha((REPO/'openplan'/rel).read_bytes())==v['sha256'],'checkout exact'
  # In-memory receipt control: harmless copy survives, changed fingerprint refuses, exact input restored.
  assert sha(json.loads(json.dumps(before)))==sha(before)
  broken=json.loads(json.dumps(before));broken[SOURCE]['public.projects']['digest']='fault';assert sha(broken)!=sha(before)
  write(BASE/'preservation.json',{'protected':{db:sha(v) for db,v in after.items()},'filesCount':len(files),'filesSha256':sha(files),'targetSha256':sha(target),'sourceFiles':len(pins['files']),'harmless':'survived','alteredFingerprint':'refused','restored':True,'blind':'readback receipts do not prove crash recovery, filesystem metadata beyond mode, or external processes'});self.resource(BASE/'resources-final.json')
if __name__=='__main__':
 n=Native()
 try:
  if sys.argv[1]=='setup':n.setup()
  elif sys.argv[1]=='checkpoint':
   before=json.loads((BASE/'protected-before-private.json').read_text())
   for db in PROTECTED:
    if db not in before:before[db]=n.snapshot(db)
   write(BASE/'protected-before-private.json',before)
  elif sys.argv[1]=='helper':n.helper(int(sys.argv[2]))
  elif sys.argv[1]=='concurrent':n.concurrent(sys.argv[2])
  elif sys.argv[1]=='final':n.final()
 except BaseException as e:
  write(BASE/('failed-'+uuid.uuid4().hex[:10]+'.json'),{'type':type(e).__name__,'message':str(e)});raise
