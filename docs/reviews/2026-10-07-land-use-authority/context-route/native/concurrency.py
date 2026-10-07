"""Native concurrent writers with isolated private-schema function controls."""
import hashlib,json,subprocess,time,uuid
from pathlib import Path
app=Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan')
directory=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority')
source=json.loads((directory/'context-native-http-private.json').read_text())
assert source['state']=='verified'
container='supabase_db_openplan-restore-target-2026091050'
subprocess.run(['npm','exec','--','tsx','-e','import {requireContractVerificationStack} from "./src/test/helpers/contract-verification-stack"; requireContractVerificationStack(process.argv[1]);',container],cwd=app,check=True,capture_output=True)
base=['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def q(value):return 'NULL' if value is None else "'"+str(value).replace("'","''")+"'"
def sql(statement):
 r=subprocess.run(base,input=statement,text=True,capture_output=True,timeout=20)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
class Session:
 def __init__(self):self.process=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 def query(self,statement):
  self.process.stdin.write(statement+'\n');self.process.stdin.flush()
  line=self.process.stdout.readline()
  if not line:raise RuntimeError(self.process.stderr.read())
  return json.loads(line)
 def end(self,statement='ROLLBACK;'):
  if self.process.poll() is None:self.process.communicate(statement+'\n',timeout=10)
workspace=source['workspaceId'];actor=source['actor'];schema='openplan_context_probe_'+uuid.uuid4().hex[:12]
function=sql("SELECT pg_get_functiondef('public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure);")
original_hash=hashlib.sha256(function.encode()).hexdigest()
journal={'workspaceId':workspace,'actor':actor,'schema':schema,'originalFunctionSha256':original_hash,'cases':[]}
path=directory/'context-concurrency-private.json'
with path.open('x') as stream: stream.write(json.dumps(journal))
path.chmod(0o600)
def record():path.write_text(json.dumps(journal,indent=2)+'\n')
def command(plan,version,label,expected):
 data=json.loads(source['originalCommand']);data.update(commandId=str(uuid.uuid4()),versionId=version,expectedContextHash=expected)
 data['place']['label']=label
 prepared=json.loads(json.dumps(source['first']['context']));prepared['place']['label']=label
 return data,prepared

def call(name,plan,version,data,prepared):
 args=[plan,version,actor,data['commandId'],data['expectedContextHash'],json.dumps(data,separators=(',',':')),json.dumps(prepared,separators=(',',':')),'local-unconfigured','community']
 return 'SELECT '+name+'('+','.join(map(q,args))+');'

def create_plan(label):
 plan=str(uuid.uuid4());version=str(uuid.uuid4())
 sql("BEGIN; INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label) VALUES("+','.join(map(q,[plan,workspace,'SYNTHETIC concurrency '+label,'local-unconfigured','community','SYNTHETIC','SYNTHETIC']))+"); INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind) VALUES("+','.join(map(q,[version,workspace,plan]))+",1,'original'); UPDATE public.land_use_plans SET current_working_version_id="+q(version)+' WHERE id='+q(plan)+'; COMMIT;')
 data,prepared=command(plan,version,'SYNTHETIC initial',None)
 first=json.loads(sql('SET ROLE service_role; '+call('public.save_land_use_plan_context',plan,version,data,prepared)))
 return plan,version,first

sql('CREATE SCHEMA '+schema+'; REVOKE ALL ON SCHEMA '+schema+' FROM PUBLIC; GRANT USAGE ON SCHEMA '+schema+' TO service_role;')
try:
 for label,broken in [('baseline',False),('harmless',False),('missing-locks',True)]:
  name='public.save_land_use_plan_context'
  if label!='baseline':
   name=schema+'.save_land_use_plan_context'
   candidate=function.replace('public.save_land_use_plan_context(',name+'(',1)
   if broken:candidate=candidate.replace('FOR UPDATE NOWAIT','')
   else:candidate+='\n-- Harmless verification comment.\n'
   sql('BEGIN; '+candidate+'; REVOKE ALL ON FUNCTION '+name+'(uuid,uuid,uuid,uuid,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+name+'(uuid,uuid,uuid,uuid,text,text,jsonb,text,text) TO service_role; COMMIT;')
  plan,version,first=create_plan(label)
  case={'case':label,'planId':plan,'versionId':version,'expected':'stale writer accepted by the fault' if broken else 'busy then stale refusal'};journal['cases'].append(case);record()
  a=Session();b=None
  try:
   ac,ap=command(plan,version,'SYNTHETIC writer A',first['contextHash'])
   bc,bp=command(plan,version,'SYNTHETIC writer B',first['contextHash'])
   ar=a.query('BEGIN; SET LOCAL ROLE service_role; '+call('public.save_land_use_plan_context',plan,version,ac,ap))
   application='context_probe_'+uuid.uuid4().hex[:12]
   b=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   b.stdin.write('SET application_name='+q(application)+'; SET statement_timeout=\'10s\'; SET ROLE service_role; '+call(name,plan,version,bc,bp)+'\n');b.stdin.close();b.stdin=None
   observed=None
   deadline=time.monotonic()+5
   while time.monotonic()<deadline:
    if b.poll() is not None:observed='terminal';break
    if sql('SELECT count(*) FROM pg_stat_activity WHERE application_name='+q(application)+" AND wait_event_type='Lock';")=='1':observed='waiting_on_lock';break
    time.sleep(.03)
   if observed is None:raise RuntimeError('Second writer neither finished nor reached an observed lock wait')
   case['secondWriterBeforeCommit']=observed
   a.query("COMMIT; SELECT '{\"committed\":true}'::jsonb;")
   out,err=b.communicate(timeout=12);case['secondWriterExit']=b.returncode
   if broken:
    if b.returncode!=0:raise RuntimeError('Lock-removal fault did not expose stale overwrite: '+err)
    overwritten=json.loads(out.strip());case['staleWriteAccepted']=True;case['observedFault']='concurrent stale write accepted'
    current=json.loads(sql('SELECT jsonb_build_object(\'hash\',plan_context_hash,\'label\',plan_context#>>\'{place,label}\') FROM public.land_use_plans WHERE id='+q(plan)+';'))
    assert current['hash']==overwritten['contextHash'] and current['label']=='SYNTHETIC writer B'
   else:
    if b.returncode==0 or 'PT409' not in err or 'being changed' not in err:raise RuntimeError('Busy context was not refused: '+err)
    retry=subprocess.run(base,input='SET ROLE service_role; '+call(name,plan,version,bc,bp),text=True,capture_output=True,timeout=15)
    if retry.returncode==0 or 'PT409' not in retry.stderr or 'context changed' not in retry.stderr:raise RuntimeError('Stale retry was not refused: '+retry.stderr)
    retained=json.loads(sql('SELECT jsonb_build_object(\'hash\',plan_context_hash,\'label\',plan_context#>>\'{place,label}\') FROM public.land_use_plans WHERE id='+q(plan)+';'))
    assert retained['hash']==ar['contextHash'] and retained['label']=='SYNTHETIC writer A'
    case['busyRefused']=True;case['staleRetryRefused']=True;case['writerAPreserved']=True
   case['matched']=True;record()
  finally:
   a.end()
   if b is not None and b.poll() is None:b.communicate(timeout=12)
finally:
 sql('DROP SCHEMA '+schema+' CASCADE;')
 after=sql("SELECT pg_get_functiondef('public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure);")
 journal['originalFunctionUnchanged']=hashlib.sha256(after.encode()).hexdigest()==original_hash
 journal['privateProbeSchemaRemoved']=sql('SELECT to_regnamespace('+q(schema)+') IS NULL;')=='t'
 record()
assert journal['originalFunctionUnchanged'] and journal['privateProbeSchemaRemoved']
print(json.dumps({'cases':journal['cases'],'originalFunctionUnchanged':True,'privateProbeSchemaRemoved':True,'fixturesPreserved':True,'boundary':'Two real SQL sessions on isolated stack. Baseline and harmless save locks refuse a busy/stale second writer; private unexposed lock-removal copy reproduces stale overwrite. No HTTP simultaneous requests, freeze race, full M1 or human acceptance.'}))
