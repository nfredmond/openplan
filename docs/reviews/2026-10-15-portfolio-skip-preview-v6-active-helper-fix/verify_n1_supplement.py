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
 fixture=ROOT/'controls/supplement-01';fixture.mkdir(mode=0o700)
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
 ok('supplement-healthy-harmless',post)
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
 saved_inspect=ns['inspect']
 try:
  def unknown(identity):
   if identity==active[0]:raise RuntimeError('inspect-unknown')
   return saved_inspect(identity)
  ns['inspect']=unknown;refusal('unknown-active-inspect','inspect-unknown')
 finally:ns['inspect']=saved_inspect
 for label,value in [('null',None),('list',[]),('text','unknown')]:
  try:
   ns['inspect']=lambda identity,v=value: v if identity==active[0] else saved_inspect(identity)
   refusal('descriptor-'+label,'protected-active-descriptor:mapping')
  finally:ns['inspect']=saved_inspect
 saved=copy.deepcopy(baseline)
 try:
  baseline['helpers']['f'*64]='untrusted-extra'
  codefault('remove-baseline-exact-id-set','preserve',
   "p.exact({'ids':sorted(ids.values())},{'ids':sorted(baseline['helpers'])},'protected-active-set')",'pass',
   lambda:refusal('codefault-exact-id-set','protected-active-set:ids'))
 finally:baseline.clear();baseline.update(saved)
 saved=copy.deepcopy(baseline)
 try:
  roles=list(ids);baseline['activeHelperIds'][roles[0]],baseline['activeHelperIds'][roles[1]]=baseline['activeHelperIds'][roles[1]],baseline['activeHelperIds'][roles[0]]
  codefault('remove-baseline-role-id-identity','preserve',"p.files(ids,baseline['activeHelperIds'])",'pass',
   lambda:refusal('codefault-role-id-identity','files:'))
 finally:baseline.clear();baseline.update(saved)
 saved_inventory=ns['packet_inventory']
 try:
  ns['packet_inventory']=lambda root:{'changed':{'mode':0o600}} if str(root) in v5_names else {}
  refusal('V5-packet-inventory-drift','file-set:keys')
  codefault('remove-V5-packet-preservation','preserve',"p.files(expected,packet_inventory(Path(name)))",'pass',
   lambda:refusal('codefault-V5-packet','file-set:keys'))
 finally:ns['packet_inventory']=saved_inventory
 require(baseline==original_baseline,'baseline-not-restored')
 require({name:sha(ROOT/name) for name in before}==before,'sealed-inputs-changed')
 require(not list((ROOT/'execution').iterdir()) and not (ROOT/'candidate').exists(),'operating-stage-dispatched')
 result={'scope':'N1 additional exact identity, unknown inspection and new V5 preservation guards only. Copied full final composition, synthetic observations.',
  'cases':rows,'counts':{kind:sum(row['outcome']==kind for row in rows) for kind in ['SURVIVED','REFUSED','KILLED']},
  'finallyRestored':True,'sealedInputsUnchanged':True,'operatingStages':0}
 with (ROOT/'controls/n1-supplement-01.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
 (HERE/'supplement.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['counts']))
if __name__=='__main__':main()
