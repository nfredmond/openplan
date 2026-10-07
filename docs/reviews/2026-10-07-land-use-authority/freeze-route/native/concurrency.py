"""Actual isolated transactions. Private function copies never alter production code."""
import hashlib,json,subprocess,time,uuid
from pathlib import Path
app=Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');directory=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority')
source=json.loads((directory/'freeze-native-http-private.json').read_text());assert source['state']=='verified'
container='supabase_db_openplan-restore-target-2026091050'
subprocess.run(['npm','exec','--','tsx','-e','import {requireContractVerificationStack} from "./src/test/helpers/contract-verification-stack"; requireContractVerificationStack(process.argv[1]);',container],cwd=app,check=True,capture_output=True)
base=['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def q(v):return 'NULL' if v is None else "'"+str(v).replace("'","''")+"'"
def execute(statement,timeout=15):return subprocess.run(base,input=statement,text=True,capture_output=True,timeout=timeout)
def sql(statement):
 r=execute(statement)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
class Session:
 def __init__(self):self.process=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 def query(self,statement):
  self.process.stdin.write(statement+'\n');self.process.stdin.flush();line=self.process.stdout.readline()
  if not line:raise RuntimeError(self.process.stderr.read())
  return json.loads(line)
 def end(self):
  if self.process.poll() is None:self.process.communicate('ROLLBACK;\n',timeout=10)
plan=source['planId'];version=source['newerVersionId'];actor=source['actor'];workspace=source['workspaceId'];schema='openplan_freeze_cmd_'+uuid.uuid4().hex[:12]
signature='uuid,uuid,uuid,uuid,integer,text,text,text'
original=sql("SELECT pg_get_functiondef('public.freeze_land_use_plan_version("+signature+")'::regprocedure);")
original_hash=hashlib.sha256(original.encode()).hexdigest()
node=sql('SELECT id FROM public.land_use_plan_content_nodes WHERE version_id='+q(version)+" AND node_kind='policy' ORDER BY id LIMIT 1;");assert node
journal={'planId':plan,'versionId':version,'workspaceId':workspace,'actor':actor,'schema':schema,'originalFunctionSha256':original_hash,'cases':[]}
path=directory/'freeze-command-concurrency-private-v3.json'
with path.open('x') as stream:stream.write(json.dumps(journal))
path.chmod(0o600)
def record():path.write_text(json.dumps(journal,indent=2)+'\n')
def encoded(v):return json.dumps(v,separators=(',',':'),sort_keys=True)
rules=json.loads(sql("SELECT frozen_snapshot->'descriptorSnapshot' FROM public.land_use_plan_versions WHERE id="+q(source['versionId'])+';'))
def prepare(label,namespace='public'):
 content=json.loads(sql('SELECT jsonb_build_object(\'planContext\',p.plan_context,\'plan\',jsonb_build_object(\'id\',p.id,\'descriptorId\',p.descriptor_id,\'planKindKey\',p.plan_kind_key,\'title\',p.title,\'authorityLabel\',p.authority_label,\'geographyLabel\',p.geography_label),\'version\',jsonb_build_object(\'id\',v.id,\'versionNumber\',v.version_number,\'versionKind\',v.version_kind,\'basedOnVersionId\',v.based_on_version_id,\'applicableRequirementKeys\',v.applicable_requirement_keys,\'draftRevision\',v.draft_revision)) || public.land_use_plan_freeze_content(v.id) FROM public.land_use_plans p JOIN public.land_use_plan_versions v ON v.plan_id=p.id WHERE p.id='+q(plan)+' AND v.id='+q(version)+' AND v.state=\'working\';'))
 content['descriptorSnapshot']=rules;revision=content['version']['draftRevision'];command_id=str(uuid.uuid4())
 command={'state':'public_review','commandId':command_id,'versionId':version,'expectedDraftRevision':revision,'expectedDescriptorHash':hashlib.sha256(encoded(rules).encode()).hexdigest()}
 raw=encoded(command);call='SELECT '+namespace+'.freeze_land_use_plan_version('+','.join(map(q,[plan,version,actor,command_id,revision,raw,encoded(content),encoded(rules)]))+');'
 case={'case':label,'revision':revision,'commandId':command_id};journal['cases'].append(case);record()
 return case,call

def refused(result,state='PT409'):
 assert result.returncode!=0 and state in result.stderr,result.stderr

def child_first(namespace,label,broken=False):
 case,call=prepare(label,namespace);a=Session();b=None
 try:
  a.query('BEGIN; SET LOCAL ROLE service_role; UPDATE public.land_use_plan_content_nodes SET body=body||'+q(' SYNTHETIC '+label)+' WHERE id='+q(node)+"; SELECT '{\"edited\":true}'::jsonb;")
  appname='openplan_freeze_wait_'+uuid.uuid4().hex[:12]
  b=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  b.stdin.write('BEGIN; SET LOCAL statement_timeout=\'10s\'; SET LOCAL application_name='+q(appname)+'; SET LOCAL ROLE service_role; '+call+" SELECT jsonb_build_object('state',state,'revision',draft_revision,'snapshotRevision',frozen_snapshot->'version'->'draftRevision') FROM public.land_use_plan_versions WHERE id="+q(version)+'; ROLLBACK;\n');b.stdin.close();b.stdin=None
  observed=None;deadline=time.monotonic()+5
  while time.monotonic()<deadline:
   if b.poll() is not None:observed='terminal';break
   if sql('SELECT count(*) FROM pg_stat_activity WHERE application_name='+q(appname)+" AND wait_event_type='Lock';")=='1':observed='waiting_on_lock';break
   time.sleep(.025)
  assert observed is not None
  a.query("COMMIT; SELECT '{\"committed\":true}'::jsonb;")
  output,error=b.communicate(timeout=12);case['beforeEditCommit']=observed
  if broken:
   assert observed=='waiting_on_lock' and b.returncode==0,error
   data=json.loads(output.strip().splitlines()[-1]);assert data['state']=='public_review' and data['revision']!=data['snapshotRevision'],data
   case['detectedFault']='Without the version lock, stale snapshot freezes after a concurrent child edit.'
   case['staleRevision']=data['snapshotRevision'];case['currentRevision']=data['revision']
  else:
   assert observed=='terminal' and b.returncode!=0 and 'PT409' in error,error
   refused(execute('BEGIN; SET LOCAL ROLE service_role; '+call+' ROLLBACK;'))
   case['busyAndStaleFreezeRefused']=True
  case['matched']=True;record()
 finally:
  a.end()
  if b is not None and b.poll() is None:b.terminate();b.communicate(timeout=10)

def freeze_first(namespace,label):
 case,call=prepare(label,namespace);a=Session()
 try:
  result=a.query('BEGIN; SET LOCAL ROLE service_role; '+call);assert result['replayed'] is False
  refused(execute('BEGIN; SET LOCAL ROLE service_role; UPDATE public.land_use_plan_content_nodes SET body=body WHERE id='+q(node)+'; ROLLBACK;'))
  refused(execute('BEGIN; SET LOCAL ROLE service_role; '+call+' ROLLBACK;'))
  case['childWriteAndDuplicateRefusedWhileFreezePending']=True;case['matched']=True;record()
 finally:a.end()

def membership_first():
 case,call=prepare('permission-change-first');a=Session()
 sql('UPDATE public.workspace_members SET role=\'owner\' WHERE workspace_id='+q(workspace)+' AND user_id='+q(source['otherActor'])+';')
 try:
  a.query('BEGIN; UPDATE public.workspace_members SET role=\'viewer\' WHERE workspace_id='+q(workspace)+' AND user_id='+q(actor)+"; SELECT '{\"revoked\":true}'::jsonb;")
  refused(execute('BEGIN; SET LOCAL ROLE service_role; '+call+' ROLLBACK;'))
  a.query("COMMIT; SELECT '{\"committed\":true}'::jsonb;")
  refused(execute('BEGIN; SET LOCAL ROLE service_role; '+call+' ROLLBACK;'),'42501')
  case['busyThenRevokedFreezeRefused']=True;case['matched']=True;record()
 finally:
  a.end();sql('UPDATE public.workspace_members SET role=\'owner\' WHERE workspace_id='+q(workspace)+' AND user_id='+q(actor)+'; UPDATE public.workspace_members SET role=\'viewer\' WHERE workspace_id='+q(workspace)+' AND user_id='+q(source['otherActor'])+';')

def duplicate_commit():
 case,call=prepare('duplicate-command-commit-and-replay');a=Session()
 try:
  result=a.query('BEGIN; SET LOCAL ROLE service_role; '+call)
  refused(execute('BEGIN; SET LOCAL ROLE service_role; '+call+' ROLLBACK;'))
  a.query("COMMIT; SELECT '{\"committed\":true}'::jsonb;")
  replay=json.loads(sql('SET ROLE service_role; '+call));assert replay['replayed'] is True and {k:v for k,v in replay.items() if k!='replayed'}=={k:v for k,v in result.items() if k!='replayed'}
  assert sql('SELECT count(*) FROM public.land_use_plan_review_events WHERE version_id='+q(version)+" AND event_kind='public_draft';")=='1'
  case['oneCommittedFreezeAndExactReplay']=True;case['matched']=True;record()
 finally:a.end()

try:
 child_first('public','real-child-first');freeze_first('public','real-freeze-first');membership_first()
 sql('CREATE SCHEMA '+schema+'; REVOKE ALL ON SCHEMA '+schema+' FROM PUBLIC; GRANT USAGE ON SCHEMA '+schema+' TO service_role;')
 copy=original.replace('public.freeze_land_use_plan_version(',schema+'.freeze_land_use_plan_version(',1)
 sql(copy+';\n-- Harmless private function copy.\nREVOKE ALL ON FUNCTION '+schema+'.freeze_land_use_plan_version('+signature+') FROM PUBLIC; GRANT EXECUTE ON FUNCTION '+schema+'.freeze_land_use_plan_version('+signature+') TO service_role;')
 child_first(schema,'harmless-child-first');freeze_first(schema,'harmless-freeze-first')
 old='workspace_id=plan_row.workspace_id FOR UPDATE NOWAIT';assert copy.count(old)==1
 sql(copy.replace(old,'workspace_id=plan_row.workspace_id'))
 child_first(schema,'missing-version-lock',True)
 duplicate_commit()
finally:
 sql('DROP SCHEMA IF EXISTS '+schema+' CASCADE;')
 current=sql("SELECT pg_get_functiondef('public.freeze_land_use_plan_version("+signature+")'::regprocedure);")
 journal['publicFunctionUnchanged']=hashlib.sha256(current.encode()).hexdigest()==original_hash
 journal['privateSchemaRemoved']=sql('SELECT to_regnamespace('+q(schema)+') IS NULL;')=='t';record()
assert journal['publicFunctionUnchanged'] and journal['privateSchemaRemoved']
print(json.dumps({'cases':journal['cases'],'publicFunctionUnchanged':True,'privateSchemaRemoved':True,'fixturesPreserved':True,'boundary':'Synthetic native concurrent transactions on the owned HTTP fixture. Private copies demonstrate the missing-lock defect; their freeze writes roll back. No browser, practitioner, legal, accessibility or scientific acceptance.'},indent=2))
