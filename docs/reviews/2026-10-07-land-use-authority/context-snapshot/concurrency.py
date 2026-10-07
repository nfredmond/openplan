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
workspace=source['workspaceId'];actor=source['actor'];schema='openplan_freeze_probe_'+uuid.uuid4().hex[:12]
def definition(name,signature):return sql("SELECT pg_get_functiondef('public."+name+"("+signature+")'::regprocedure);")
save_signature='uuid,uuid,uuid,uuid,text,text,jsonb,text,text'
save_original=definition('save_land_use_plan_context',save_signature)
freeze_original=definition('check_land_use_plan_context_at_freeze','')
hashes={name:hashlib.sha256(value.encode()).hexdigest() for name,value in [('save',save_original),('freeze',freeze_original)]}
path=directory/'context-freeze-concurrency-private.json'
journal={'workspaceId':workspace,'actor':actor,'schema':schema,'originalFunctionSha256':hashes,'cases':[]}
with path.open('x') as stream:stream.write(json.dumps(journal))
path.chmod(0o600)
def record():path.write_text(json.dumps(journal,indent=2)+'\n')
def command(version,label,expected):
 data=json.loads(source['originalCommand']);data.update(commandId=str(uuid.uuid4()),versionId=version,expectedContextHash=expected)
 data['place']['label']=label
 prepared=json.loads(json.dumps(source['first']['context']));prepared['place']['label']=label
 return data,prepared

def save(namespace,plan,version,data,prepared):
 args=[plan,version,actor,data['commandId'],data['expectedContextHash'],json.dumps(data,separators=(',',':')),json.dumps(prepared,separators=(',',':')),'local-unconfigured','community']
 return 'SELECT '+namespace+'.save_land_use_plan_context('+','.join(map(q,args))+');'
def freeze(namespace,version,context):
 return 'UPDATE '+namespace+'.land_use_plan_versions SET state=\'public_review\',content_hash='+q('f'*64)+',frozen_snapshot='+q(json.dumps({'planContext':context}))+',frozen_at=clock_timestamp(),frozen_by='+q(actor)+' WHERE id='+q(version)+"; SELECT '{\"frozen\":true}'::jsonb;"
def run(statement):return subprocess.run(base,input='SET ROLE service_role; '+statement,text=True,capture_output=True,timeout=15)
def refused(result,fragment):
 assert result.returncode!=0 and 'PT409' in result.stderr and fragment in result.stderr,result.stderr
def create_plan(namespace,label):
 plan=str(uuid.uuid4());version=str(uuid.uuid4())
 case={'case':label,'namespace':'real' if namespace=='public' else 'private-control','planId':plan,'versionId':version}
 journal['cases'].append(case);record()
 sql('BEGIN; INSERT INTO '+namespace+'.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label) VALUES('+','.join(map(q,[plan,workspace,'SYNTHETIC freeze concurrency '+label,'local-unconfigured','community','SYNTHETIC','SYNTHETIC']))+'); INSERT INTO '+namespace+'.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind) VALUES('+','.join(map(q,[version,workspace,plan]))+",1,'original'); UPDATE "+namespace+'.land_use_plans SET current_working_version_id='+q(version)+' WHERE id='+q(plan)+'; COMMIT;')
 data,prepared=command(version,'SYNTHETIC initial',None)
 first=json.loads(sql('SET ROLE service_role; '+save(namespace,plan,version,data,prepared)))
 return case,plan,version,first

def mirror(broken=False):
 for table in ['land_use_plans','land_use_plan_versions','land_use_plan_context_commands']:
  sql('CREATE TABLE '+schema+'.'+table+' (LIKE public.'+table+' INCLUDING ALL); GRANT SELECT,INSERT,UPDATE ON '+schema+'.'+table+' TO service_role;')
 save_copy=save_original.replace('public.save_land_use_plan_context(',schema+'.save_land_use_plan_context(',1)
 freeze_copy=freeze_original.replace('public.check_land_use_plan_context_at_freeze()',schema+'.check_land_use_plan_context_at_freeze()',1)
 for table in ['land_use_plans','land_use_plan_versions','land_use_plan_context_commands']:
  save_copy=save_copy.replace('public.'+table,schema+'.'+table)
  freeze_copy=freeze_copy.replace('public.'+table,schema+'.'+table)
 if broken:
  freeze_copy=freeze_copy.replace('FOR SHARE NOWAIT','')
  save_copy=save_copy.replace('workspace_id = plan_row.workspace_id FOR UPDATE NOWAIT','workspace_id = plan_row.workspace_id')
 else:freeze_copy+='\n-- Harmless concurrency-control comment.\n'
 sql(save_copy+'; '+freeze_copy+'; REVOKE ALL ON FUNCTION '+schema+'.save_land_use_plan_context('+save_signature+') FROM PUBLIC; GRANT EXECUTE ON FUNCTION '+schema+'.save_land_use_plan_context('+save_signature+') TO service_role; CREATE TRIGGER context_consistency BEFORE INSERT OR UPDATE ON '+schema+'.land_use_plan_versions FOR EACH ROW EXECUTE FUNCTION '+schema+'.check_land_use_plan_context_at_freeze();')

def save_first(namespace,label,broken=False):
 case,plan,version,first=create_plan(namespace,label)
 data,prepared=command(version,'SYNTHETIC later context',first['contextHash']);a=Session()
 try:
  later=a.query('BEGIN; SET LOCAL ROLE service_role; '+save(namespace,plan,version,data,prepared))
  application='freeze_probe_'+uuid.uuid4().hex[:12]
  b=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  b.stdin.write('SET application_name='+q(application)+"; SET statement_timeout='10s'; SET ROLE service_role; "+freeze(namespace,version,first['context'])+'\n');b.stdin.close();b.stdin=None
  observed=None;deadline=time.monotonic()+5
  while time.monotonic()<deadline:
   if b.poll() is not None:observed='terminal';break
   if sql('SELECT count(*) FROM pg_stat_activity WHERE application_name='+q(application)+" AND wait_event_type='Lock';")=='1':observed='waiting_on_lock';break
   time.sleep(.03)
  assert observed is not None
  case['freezeBeforeSaveCommit']=observed
  a.query("COMMIT; SELECT '{\"committed\":true}'::jsonb;")
  out,err=b.communicate(timeout=12)
  if broken:
   assert observed=='terminal' and b.returncode==0,err
   mismatch=sql('SELECT p.plan_context IS DISTINCT FROM v.frozen_snapshot->\'planContext\' FROM '+namespace+'.land_use_plans p JOIN '+namespace+'.land_use_plan_versions v ON v.plan_id=p.id WHERE p.id='+q(plan)+';')
   assert mismatch=='t';case['observedFault']='stale context frozen concurrently with a committed save'
  else:
   assert observed=='waiting_on_lock' and b.returncode!=0 and 'PT409' in err and 'changed before freeze' in err,err
   case['racingStaleFreezeRefused']=True
   refused(run(freeze(namespace,version,first['context'])),'changed before freeze');case['staleFreezeRefused']=True
   current=run(freeze(namespace,version,later['context']));assert current.returncode==0,current.stderr
   case['currentContextFrozen']=True
  case['matched']=True;record()
 finally:a.end()

def freeze_first(namespace,label):
 case,plan,version,first=create_plan(namespace,label);a=Session()
 try:
  a.query('BEGIN; SET LOCAL ROLE service_role; '+freeze(namespace,version,first['context']))
  data,prepared=command(version,'SYNTHETIC later context',first['contextHash'])
  refused(run(save(namespace,plan,version,data,prepared)),'being changed');case['busySaveRefused']=True
  a.query("COMMIT; SELECT '{\"committed\":true}'::jsonb;")
  refused(run(save(namespace,plan,version,data,prepared)),'no longer current');case['postFreezeSaveRefused']=True
  exact=sql('SELECT p.plan_context = v.frozen_snapshot->\'planContext\' FROM '+namespace+'.land_use_plans p JOIN '+namespace+'.land_use_plan_versions v ON v.plan_id=p.id WHERE p.id='+q(plan)+';')
  assert exact=='t';case['frozenContextUnchanged']=True;case['matched']=True;record()
 finally:a.end()

try:
 save_first('public','real-save-first');freeze_first('public','real-freeze-first')
 sql('CREATE SCHEMA '+schema+'; REVOKE ALL ON SCHEMA '+schema+' FROM PUBLIC; GRANT USAGE ON SCHEMA '+schema+' TO service_role;')
 mirror();save_first(schema,'harmless-save-first');freeze_first(schema,'harmless-freeze-first')
 for table in ['land_use_plan_context_commands','land_use_plan_versions','land_use_plans']:sql('DROP TABLE '+schema+'.'+table+' CASCADE;')
 mirror(True);save_first(schema,'missing-version-and-freeze-locks',True)
finally:
 sql('DROP SCHEMA IF EXISTS '+schema+' CASCADE;')
 current={'save':definition('save_land_use_plan_context',save_signature),'freeze':definition('check_land_use_plan_context_at_freeze','')}
 journal['originalFunctionsUnchanged']=all(hashlib.sha256(value.encode()).hexdigest()==hashes[name] for name,value in current.items())
 journal['privateProbeSchemaRemoved']=sql('SELECT to_regnamespace('+q(schema)+') IS NULL;')=='t';record()
assert journal['originalFunctionsUnchanged'] and journal['privateProbeSchemaRemoved']
print(json.dumps({'cases':journal['cases'],'originalFunctionsUnchanged':True,'privateProbeSchemaRemoved':True,
 'boundary':'Synthetic direct database transactions only. This does not exercise route readiness, full snapshot contents, atomic pointer/event updates, real human freeze, publication or browser behavior.'},indent=2))
