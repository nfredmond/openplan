"""N1-only copied full final composition and preflight fixtures. No live transport."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
rows=[]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def require(value,reason):
 if not value:raise AssertionError(reason)
def function(name,ns,text=None):
 source=(ROOT/'helper.py').read_text() if text is None else text
 node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name==name)
 exec(compile(ast.Module(body=[node],type_ignores=[]),'<N1:'+name+'>','exec'),ns);return ns[name]
def ok(name,fn):fn();rows.append({'case':name,'outcome':'SURVIVED'})
def refused(name,fn,reason):
 try:fn()
 except (ValueError,RuntimeError,AssertionError) as error:
  require(str(error).startswith(reason),'wrong-refusal:'+name+':'+str(error))
  rows.append({'case':name,'outcome':'REFUSED','reason':str(error)});return
 raise AssertionError('missing-refusal:'+name)
def denied(*args,**kwargs):raise AssertionError('REAL-TRANSPORT-FORBIDDEN')

def main():
 os.umask(0o077)
 policy={};exec(compile((ROOT/'policy.py').read_text(),'<pure-policy>','exec'),policy);p=SimpleNamespace(**policy)
 before={name:sha(ROOT/name) for name in json.loads((HERE/'manifest.json').read_text())['files']}
 fixture=ROOT/'controls/full-final-01';fixture.mkdir(mode=0o700)
 marker=fixture/'protected-runtime-before.json';marker.write_text('{}\n');marker.chmod(0o600)
 identity_binding=json.loads((ROOT/'active-helper-identities.json').read_text());ids=identity_binding['ids'];active=list(ids.values())
 helper_keys=['Id','Name','Image','Config','HostConfig','Mounts']
 descriptors={identity:{'Id':identity,'Name':'/fixture-'+role,'Image':'fixture-image','Config':{},'HostConfig':{},'Mounts':[],
  'State':{'Running':True,'Paused':False,'Restarting':False,'Pid':123,'StartedAt':'fixture-only'}} for role,identity in ids.items()}
 # Literal historical IDs are copied from the unchanged source globals, never required active.
 tree=ast.parse((ROOT/'helper.py').read_text());legacy_node=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='OLD_IDS' for t in n.targets));retired=ast.literal_eval(legacy_node.value)
 require(not set(retired.values()).intersection(active),'fixture-retired-overlap')
 for role,identity in retired.items():descriptors[identity]={'Id':identity,'Name':'/retired-'+role,'Image':'retired-image','Config':{},'HostConfig':{},'Mounts':[],'State':{'Running':False,'Paused':True,'Restarting':True}}
 hashes=lambda: {identity:p.digest({k:descriptors[identity][k] for k in helper_keys}) for identity in active}
 legacy_hashes={role:p.digest({k:descriptors[identity][k] for k in helper_keys}) for role,identity in retired.items()}
 protected=json.loads((ROOT/'protected-databases.json').read_text());snapshots={name:[{'database':name,'fixture':True}] for name in protected}
 baseline={'activeHelperIds':copy.deepcopy(ids),'helpers':hashes(),'helperStates':{identity:{'Running':True,'Paused':False,'Restarting':False} for identity in active},'databases':snapshots}
 original_baseline=copy.deepcopy(baseline)
 v4_names=['/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4','/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation']
 v5_names=['/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5','/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v5-corrections']
 plan=json.loads((ROOT/'plan-private.json').read_text());new_receipts={kind:{'id':'NEW-fixture-'+kind,'name':plan['names'][kind],'database':plan['target']} for kind in p.IMAGES}
 writes=[];trace=[];drift={'source':False,'database':False,'inspect':None,'wrongId':None};late={};counts={}
 def read(name):
  values={'active-helper-identities.json':identity_binding,'input-bindings-private.json':{},'old-helper-bindings-private.json':legacy_hashes,
   'storage-binding-private.json':{},'preservation-files.json':{},'v4-full-inventory-before.json':{name:{} for name in v4_names},
   'v5-packet-inventory-before.json':{name:{} for name in v5_names},'protected-runtime-before.json':baseline,'protected-databases.json':protected,
   'target-identity.json':{'database':plan['target']},'service-receipts-private.json':new_receipts,'envs-private.json':{kind:{} for kind in p.IMAGES}}
  return copy.deepcopy(values[name])
 def inspect(identity):
  trace.append(('inspect',identity));counts[identity]=counts.get(identity,0)+1
  if identity==drift['inspect']:raise RuntimeError('inspect-unreadable')
  if identity not in descriptors:raise RuntimeError('inspect-unknown')
  value=copy.deepcopy(descriptors[identity])
  if identity==drift['wrongId']:value['Id']='f'*64
  if identity in late and counts[identity]>=2:value['State'].update(late[identity])
  return value
 def snapshot(name):
  trace.append(('snapshot',name))
  if drift['database']:return [{'database':name,'fixture':'changed'}]
  return copy.deepcopy(snapshots[name])
 def source_check():
  trace.append(('source',None))
  if drift['source']:raise ValueError('source-drift')
  return []
 ns={'p':p,'Path':Path,'json':json,'os':os,'OUT':fixture,'FROZEN':Path(identity_binding['source']).parents[1],
  'read':read,'sha':lambda path:sha(path) if Path(path).is_file() else 'fixture-digest',
  'OLD_IDS':retired,'OLD_STORAGE':fixture,'inventory':lambda root:{},'inspect':inspect,'snapshot':snapshot,
  'packet_inventory':lambda root:{},'protected_web':lambda:{'invocation':'old-web-stand-in'},
  'pinned_files':lambda:plan,'db_check':lambda:None,'target_check':lambda:None,'upgrade_ready':lambda:None,
  'expected_service':lambda *a:{},'observed_service':lambda *a:{},'health':lambda:trace.append(('NEW-health',None)),
  'source_check':source_check,'TARGET':plan['target'],'__file__':str(ROOT/'helper.py'),
  'write':lambda name,value:writes.append((name,copy.deepcopy(value))),'print':lambda *args:None,
  'sql':denied,'run':denied,'retained_dump':lambda:None,'free_ports':lambda:None,'fresh_target':lambda:None,
  'shutil':SimpleNamespace(disk_usage=lambda root:SimpleNamespace(free=16*1024**3)),'DUMP_SHA':'retained-fixture'}
 for name in ['active_helper_identities','require_active_helper','preserve','unchanged_inputs','verify_services','post_journey','preflight']:function(name,ns)
 def post():return ns['post_journey']()
 def refusal(name,reason):
  count=len(writes);refused(name,post,reason);require(len(writes)==count,'failure-reached-writer:'+name)
 ok('full-final-healthy-harmless-with-retired-inactive',post)
 require(writes[-1][0]=='post-journey-result.json','final-writer-not-reached')
 result=writes[-1][1]['preservation'];require(set(result['helpers'])==set(active) and set(result['helperStates'])==set(active),'observed-active-id-set')
 require(all(v=={'Running':True,'Paused':False,'Restarting':False} for v in result['helperStates'].values()),'observed-typed-states')
 for role,identity in ids.items():
  for key,bad in [('Running',False),('Paused',True),('Restarting',True)]:
   saved=copy.deepcopy(descriptors[identity])
   try:descriptors[identity]['State'][key]=bad;refusal(role+'-'+key,'protected-active-state:'+key)
   finally:descriptors[identity]=saved
 first=active[0]
 for key in ['Running','Paused','Restarting']:
  for label,value in [('null',None),('number',1 if key=='Running' else 0),('text','true' if key=='Running' else 'false'),('missing',None)]:
   saved=copy.deepcopy(descriptors[first])
   try:
    if label=='missing':del descriptors[first]['State'][key]
    else:descriptors[first]['State'][key]=value
    refusal('state-'+key+'-'+label,'protected-active-state:'+key)
   finally:descriptors[first]=saved
 for label,value in [('null',None),('list',[]),('text','running'),('missing',None)]:
  saved=copy.deepcopy(descriptors[first])
  try:
   if label=='missing':del descriptors[first]['State']
   else:descriptors[first]['State']=value
   refusal('State-'+label,'protected-active-state:mapping')
  finally:descriptors[first]=saved
 for key in ['source','database']:
  try:drift[key]=True;refusal(key+'-drift','source-drift' if key=='source' else 'protected-database:snapshot')
  finally:drift[key]=False
 saved=descriptors[first]['Image']
 try:descriptors[first]['Image']='changed';refusal('configuration-drift-retained','protected-helper:sha256')
 finally:descriptors[first]['Image']=saved
 old_identity=next(iter(retired.values()));saved=descriptors[old_identity]['Image']
 try:descriptors[old_identity]['Image']='changed';refusal('retired-configuration-drift-retained','prior-helper:sha256')
 finally:descriptors[old_identity]['Image']=saved
 for field in ['inspect','wrongId']:
  try:drift[field]=first;refusal('active-'+field,'inspect-unreadable' if field=='inspect' else 'protected-active-identity:Id')
  finally:drift[field]=None
 for label in ['missing','extra','substitute']:
  saved=copy.deepcopy(baseline)
  try:
   if label in ['missing','substitute']:baseline['helpers'].pop(first)
   if label in ['extra','substitute']:baseline['helpers']['f'*64]='untrusted-baseline'
   refusal('baseline-id-set-'+label,'protected-active-set:ids')
  finally:baseline.clear();baseline.update(saved)
 saved=copy.deepcopy(baseline)
 try:
  roles=list(ids);baseline['activeHelperIds'][roles[0]],baseline['activeHelperIds'][roles[1]]=baseline['activeHelperIds'][roles[1]],baseline['activeHelperIds'][roles[0]]
  refusal('baseline-role-id-swap','files:')
 finally:baseline.clear();baseline.update(saved)
 saved=copy.deepcopy(identity_binding)
 try:
  identity_binding['sourceSHA256']='0'*64;refusal('active-receipt-source-drift','active-helper-source:sha256')
 finally:identity_binding.clear();identity_binding.update(saved)
 # Before a baseline exists the same typed checks still run.
 marker.unlink()
 try:
  ok('prebaseline-healthy-acquisition',ns['preserve'])
  saved=copy.deepcopy(descriptors[first])
  try:descriptors[first]['State']['Paused']=True;refused('prebaseline-paused-refuses',ns['preserve'],'protected-active-state:Paused')
  finally:descriptors[first]=saved
 finally:marker.write_text('{}\n');marker.chmod(0o600)
 # Full preflight. A late bad observation follows a healthy initial preservation read.
 pre=ROOT/'controls/preflight-01';pre.mkdir(mode=0o700);oldout=ns['OUT'];ns['OUT']=pre
 try:
  counts.clear();start=len(writes);ns['preflight']();capture=writes[start][1]
  require(writes[start][0]=='protected-runtime-before.json' and capture['activeHelperIds']==ids,'preflight-fixed-id-baseline')
  require(set(capture['helpers'])==set(active) and all(v=={'Running':True,'Paused':False,'Restarting':False} for v in capture['helperStates'].values()),'preflight-states-not-typed')
  rows.append({'case':'preflight-healthy-exact-baseline','outcome':'SURVIVED'})
  for role,identity in ids.items():
   for key,bad in [('Running',False),('Paused',True),('Restarting',True)]:
    try:
     counts.clear();late[identity]={key:bad};start=len(writes)
     refused('preflight-late-'+role+'-'+key,ns['preflight'],'protected-active-state:'+key)
     require(len(writes)==start,'bad-preflight-observation-promoted')
    finally:late.clear()
 finally:ns['OUT']=oldout;counts.clear()
 # Targeted code faults with harmless copies and exact finally restoration.
 source=(ROOT/'helper.py').read_text()
 def codefault(label,name,old,new,detector):
  original=ns[name]
  for kind,text in [('harmless','# harmless wording\n'+source),('fault',source.replace(old,new))]:
   require(kind=='harmless' or text!=source,'codefault-not-applied')
   try:
    function(name,ns,text)
    try:detector()
    except AssertionError as error:
     require(kind=='fault' and str(error).startswith('missing-refusal:'),'wrong-codefault-failure:'+str(error))
     rows.append({'case':label,'mutation':kind,'outcome':'KILLED','reason':str(error)})
    else:
     require(kind=='harmless','codefault-survived:'+label);rows.append({'case':label,'mutation':kind,'outcome':'SURVIVED'})
   finally:ns[name]=original
 for key,bad,old,new in [
  ('Running',False,"{'Running':True,'Paused':False,'Restarting':False},state","{'Paused':False,'Restarting':False},state"),
  ('Paused',True,"{'Running':True,'Paused':False,'Restarting':False},state","{'Running':True,'Restarting':False},state"),
  ('Restarting',True,"{'Running':True,'Paused':False,'Restarting':False},state","{'Running':True,'Paused':False},state")]:
  saved=copy.deepcopy(descriptors[first])
  try:
   descriptors[first]['State'][key]=bad
   codefault('remove-'+key+'-guard','require_active_helper',old,new,lambda k=key:refusal('codefault-'+k,'protected-active-state:'+k))
  finally:descriptors[first]=saved
 saved=copy.deepcopy(descriptors[first])
 try:
  descriptors[first]['State']['Paused']=True
  codefault('omit-protected-acquisition-state-check','preserve','state=require_active_helper(identity,i)',"state={'Running':True,'Paused':False,'Restarting':False}",lambda:refusal('codefault-acquisition','protected-active-state:Paused'))
 finally:descriptors[first]=saved
 # Removal of the explicit preflight check must not publish a late bad observation.
 ns['OUT']=pre
 try:
  def preflight_detector():
   counts.clear();start=len(writes)
   try:refused('codefault-preflight',ns['preflight'],'protected-active-state:Paused')
   finally:counts.clear()
   require(len(writes)==start,'failed-preflight-published')
  late[first]={'Paused':True}
  codefault('omit-preflight-state-check','preflight','states[identity]=require_active_helper(identity,i)',"states[identity]={'Running':True,'Paused':False,'Restarting':False}",preflight_detector)
 finally:late.clear();ns['OUT']=oldout
 require(baseline==original_baseline,'baseline-not-restored')
 require({name:sha(ROOT/name) for name in before}==before,'sealed-inputs-changed')
 require(not list((ROOT/'execution').iterdir()) and not (ROOT/'candidate').exists(),'operating-stage-dispatched')
 result={'scope':'N1 selected full final/preflight composition only. All Docker/DB/HTTP/old-web observations are synthetic. No operating transport or stage.',
  'cases':rows,'counts':{kind:sum(row['outcome']==kind for row in rows) for kind in ['SURVIVED','REFUSED','KILLED']},
  'exactActiveIds':ids,'preflightAndEveryAcquisitionTypedState':True,'retiredStateNotRequired':True,'configurationGuardRetained':True,
  'noFailedObservationReachesWriter':True,'specimensAndCodeRestoreInFinally':True,'sealedInputsUnchanged':True,
  'blindCategories':['Point-in-time state cannot establish continuous availability or unchanged process identity.','Synthetic inspect/DB/source/health observations do not establish current live preservation.','No actual new stage, PostgreSQL normalization, build, context unit or journey.']}
 with (ROOT/'controls/n1-controls-01.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
 (HERE/'controls.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'counts':result['counts'],'operatingStages':0}))
if __name__=='__main__':main()
