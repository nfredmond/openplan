"""Selected R1/R2/R3 controls only. All operational transports are stand-ins."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
rows=[]
RUN_ID=sys.argv[1] if len(sys.argv)==2 else '03'
assert RUN_ID.isdigit() and len(RUN_ID)==2
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
def require(ok,reason):
 if not ok:raise AssertionError(reason)
def expect(fn,reason):
 try:fn()
 except (ValueError,AssertionError) as e:
  require(reason in str(e),'wrong-refusal:'+str(e));return
 raise AssertionError('missing-refusal:'+reason)
def record(name,fn,reason=None):
 if reason:expect(fn,reason)
 else:fn()
 rows.append({'case':name,'outcome':'REFUSED' if reason else 'SURVIVED',**({'reason':reason} if reason else {})})
def copied(module,name):
 tree=ast.parse(Path(module.__file__).read_text());node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
 ns=module.__dict__.copy();exec(compile(ast.Module(body=[node],type_ignores=[]),'<copy:'+name+'>','exec'),ns);return ns[name],ns

def mutation(name,module,function,old,new,detector):
 # Every targeted code fault follows a harmless copy and restores in finally.
 original=getattr(module,function);text=Path(module.__file__).read_text()
 tree=ast.parse(text);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==function)
 segment=ast.get_source_segment(text,node)
 for label,source in [('harmless','# wording only\n'+segment),('fault',segment.replace(old,new))]:
  require(label=='harmless' or source!=segment,'mutation-not-applied')
  ns=module.__dict__.copy();exec(compile(source,'<mutation:'+name+'>','exec'),ns)
  try:
   setattr(module,function,ns[function])
   try:detector()
   except AssertionError as e:
    require(label=='fault','harmless-failed:'+str(e))
    require('missing-refusal:' in str(e),'wrong-codefault-failure:'+str(e))
    rows.append({'case':name,'mutation':label,'outcome':'KILLED','reason':str(e)})
   else:
    require(label=='harmless','codefault-survived:'+name)
    rows.append({'case':name,'mutation':label,'outcome':'SURVIVED'})
  finally:setattr(module,function,original)

def guard_mutation(name,module,function,reason,detector):
 original=getattr(module,function)
 tree=ast.parse(Path(module.__file__).read_text());node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==function)
 class Remove(ast.NodeTransformer):
  changed=0
  def visit_Expr(self,n):
   if isinstance(n.value,ast.Call) and n.value.args and isinstance(n.value.args[-1],ast.Constant) and n.value.args[-1].value==reason:
    self.changed+=1;return ast.copy_location(ast.Pass(),n)
   return self.generic_visit(n)
 # Harmless comment copy first.
 f,ns=copied(module,function)
 try:
  setattr(module,function,f);detector();rows.append({'case':name,'mutation':'harmless','outcome':'SURVIVED'})
 finally:setattr(module,function,original)
 transform=Remove();bad=transform.visit(copy.deepcopy(node));require(transform.changed==1,'guard-removal-count')
 ns=module.__dict__.copy();exec(compile(ast.fix_missing_locations(ast.Module(body=[bad],type_ignores=[])),'<guard-fault:'+name+'>','exec'),ns)
 try:
  setattr(module,function,ns[function])
  try:detector()
  except AssertionError as e:
   require('missing-refusal:' in str(e),'guard-fault-wrong-failure:'+str(e))
   rows.append({'case':name,'mutation':'fault','outcome':'KILLED','reason':str(e)})
  else:raise AssertionError('guard-codefault-survived:'+name)
 finally:setattr(module,function,original)

def main():
 sys.path.insert(0,str(ROOT))
 try:h=load('helper',ROOT/'helper.py');tr=load('transport_delta',ROOT/'observer_transport.py');ob=load('observer_delta',ROOT/'observer.py')
 finally:sys.path.pop(0)
 before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir() if p.is_file()}
 saved_read=h.read
 try:
  # Trap all real DB, Docker, HTTP and process transport. Individual R1 spies stay local.
  with patch.object(h,'sql',lambda *a:(_ for _ in ()).throw(AssertionError('REAL-DB-FORBIDDEN'))),patch.object(h,'run',lambda *a,**kw:(_ for _ in ()).throw(AssertionError('REAL-PROCESS-FORBIDDEN'))):
   record('new-sealed-pure-inputs',h.pinned_files)
   e=h.read('upgrade-expectations.json');checks=h.read('expected-checks.json')['constraints']
   require(all(v.count('(')==v.count(')') for v in checks.values()),'expected-check-parentheses')
   state={'database':h.TARGET,'historyCount':420,'latest':'20261017000017','versions':sorted(e['versions']+['20261017000017']),
    'body':e['newBody'],'priorHistoryDigest':e['history']['digest'],'historySQL':[(ROOT/'candidate17.sql').read_text()],**checks}
   record('R3-harmless-note',lambda:h.upgraded({**state,'note':'harmless'}))
   faults=[]
   for key in checks:
    for label,value in [('same-phrase-OR-true',"CHECK ((decision <> 'create'::text) OR true)"),('allowlist',checks[key].replace("'complete'::text","'invalid'::text")),('operator',checks[key].replace("decision <>","decision =")),('null',None),('normalization',checks[key]+' '),('missing',None)]:
     bad={**state,key:value}
     if label=='missing':del bad[key]
     faults.append((key,label,bad))
     record('R3-'+key+'-'+label,lambda b=bad:h.upgraded(b),'upgrade-checks:'+key)
   weak={**state,'statusConstraint':"CHECK ((decision <> 'create'::text) OR true)"}
   mutation('R3-remove-full-definition-guard',h,'upgraded',"p.exact(expected_checks['constraints'],actual,'upgrade-checks')",'pass',lambda:expect(lambda:h.upgraded(weak),'upgrade-checks:statusConstraint'))
   # A matching wrong initial receipt cannot establish the oracle.
   ready,ns=copied(h,'upgrade_ready');ns.update(upgrade_state=lambda:weak,read=lambda n:{'target':h.TARGET,'migrationSHA256':h.MIG_SHA,'state':weak})
   record('R3-weak-first-receipt-refuses',ready,'upgrade-checks:statusConstraint')
   # R1 fixed transport consumes an actual saved old-web observation, but no unit runs here.
   value=json.loads((ROOT/'context-tests/actual-app-01.json').read_text())['oldWebObservation']
   nonce='a'*64;value={**value,'request':nonce}
   record('R1-transport-harmless',lambda:tr.validate({**value},nonce))
   for key,bad,reason in [('request','b'*64,'transport-result-freshness'),('observerSHA256','0'*64,'transport-observer-identity'),('observerUserNamespace','user:[wrong]','transport-observer-identity'),('listenerPid','123','transport-old-pid'),('cwd','/wrong','transport-old-process'),('processEnvironmentDigest','0'*64,'transport-old-environment')]:
    record('R1-'+key,lambda k=key,v=bad:tr.validate({**value,k:v},nonce),reason)
   mutation('R1-remove-fresh-result-guard',tr,'validate',"require(type(value['schema']) is int and value['schema']==1 and value['request']==nonce,'transport-result-freshness')",'pass',lambda:expect(lambda:tr.validate({**value,'request':'b'*64},nonce),'transport-result-freshness'))
   def bus_spy(argv,**kw):
    require(argv==tr.argv(nonce),'fixed-observer-command')
    require(kw.get('env')==tr.ENV and kw['env'].get('XDG_RUNTIME_DIR')=='/run/user/1000' and kw['env'].get('DBUS_SESSION_BUS_ADDRESS')=='unix:path=/run/user/1000/bus','fixed-user-bus-environment')
    return SimpleNamespace(returncode=0,stdout=json.dumps(value).encode(),stderr=b'')
   with patch.object(tr.subprocess,'run',bus_spy),patch.object(tr,'write_once',lambda *a:None):
    record('R1-fixed-bus-spy',lambda:tr.observe(nonce))
    # This code fault must be detected by the transport-boundary spy.
    original=tr.ENV
    try:
     tr.ENV={k:v for k,v in original.items() if k not in ['XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS']}
     record('R1-missing-bus-codefault',lambda:tr.observe(nonce),'fixed-user-bus-environment')
    finally:tr.ENV=original
   for key,bad,reason in [('memory.max','-1','observer-memory'),('memory.swap.max','1','observer-memory'),('memory.swap.current','1','observer-memory'),('cpu.max','max 100000','observer-cpu'),('memory.events','low 0\nhigh 0\nmax 0\noom 1\noom_kill 0\noom_group_kill 0','observer-memory-events')]:
    record('R1-resource-'+key,lambda k=key,v=bad:ob.resource_check({**value['resources'],k:v}),reason)
   for key,bad,reason in [('memory.max','-1','observer-memory'),('cpu.max','max 100000','observer-cpu'),('memory.events','low 0\nhigh 0\nmax 0\noom 1\noom_kill 0\noom_group_kill 0','observer-memory-events')]:
    guard_mutation('R1-remove-'+reason,ob,'resource_check',reason,lambda k=key,v=bad,r=reason:expect(lambda:ob.resource_check({**value['resources'],k:v}),r))
   # Hash guard is tested before any subprocess dispatch. No file is changed.
   with patch.object(h,'sha',lambda path:'0'*64),patch.object(h.subprocess,'run',lambda argv,**kw:SimpleNamespace(returncode=0,stdout=json.dumps({**value,'request':argv[-1]}).encode(),stderr=b'')),patch.object(h,'write',lambda *args:None):
    guard_mutation('R1-remove-transport-file-seal',h,'protected_web','old-web-transport-seal',lambda:expect(h.protected_web,'old-web-transport-seal:sha256'))
   # R2 real final function, with future transport observations replaced.
   post,pns=copied(h,'post_journey');trace=[];writes=[];drift={'source':False,'protected':False}
   fixture=ROOT/'context-tests'/('post-standin-'+RUN_ID);fixture.mkdir(mode=0o700)
   baseline=fixture/'protected-runtime-before.json';baseline.write_text('{}\n');baseline.chmod(0o600)
   protected=saved_read('protected-databases.json');preservation={'databases':{k:'observed-fixture' for k in protected}}
   def source():
    trace.append('source')
    if drift['source']:raise ValueError('source-drift')
    return []
   def unchanged():
    trace.append('preservation')
    if drift['protected']:raise ValueError('protected-drift')
    return preservation
   pns.update(OUT=fixture,pinned_files=lambda:None,db_check=lambda:None,target_check=lambda:None,upgrade_ready=lambda:None,
    verify_services=lambda:trace.append('helpers') or {},source_check=source,unchanged_inputs=unchanged,
    read=lambda n:protected if n=='protected-databases.json' else {} if n=='target-identity.json' else {},
    sha=lambda p:'0'*64,write=lambda n,v:(trace.append('write'),writes.append((n,v))),
    print=lambda *args:None,snapshot=lambda target:(_ for _ in ()).throw(AssertionError('new-preview-data-snapshot-forbidden')))
   record('R2-post-harmless',post);require(trace==['helpers','source','preservation','write'],'post-call-order')
   require(writes[-1][0]=='post-journey-result.json' and writes[-1][1]['newPreviewDataComparedToRestore'] is False,'post-result-contract')
   for key,reason in [('source','source-drift'),('protected','protected-drift')]:
    previous=len(writes)
    try:drift[key]=True;record('R2-'+key+'-drift',post,reason)
    finally:drift[key]=False
    require(len(writes)==previous,'failed-post-published-success')
   # Code faults omit each required oracle. The original detector must fail.
   node=next(n for n in ast.parse(Path(h.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='post_journey')
   source_text=ast.get_source_segment(Path(h.__file__).read_text(),node)
   for key,old,new,reason in [('source','current_source=source_check()','current_source=[]','source-drift'),('protected','preservation=unchanged_inputs()','preservation=fake_preservation','protected-drift')]:
    ns=pns.copy();ns['fake_preservation']=preservation;exec(compile(source_text.replace(old,new),'<post-fault:'+key+'>','exec'),ns)
    try:
     drift[key]=True
     try:expect(ns['post_journey'],reason)
     except AssertionError as error:require(str(error)=='missing-refusal:'+reason,'post-fault-wrong-failure');rows.append({'case':'R2-omit-'+key,'outcome':'KILLED','reason':str(error)})
     else:raise AssertionError('post-codefault-survived')
    finally:drift[key]=False
   invroot=fixture/'inventory';invroot.mkdir(mode=0o700)
   specimen=invroot/'bytes.txt';specimen.write_text('original\n');specimen.chmod(0o600)
   expected_inventory=h.packet_inventory(invroot)
   record('V4-inventory-harmless-read',lambda:h.p.files(expected_inventory,h.packet_inventory(invroot)))
   for label in ['bytes','mode']:
    try:
     if label=='bytes':specimen.write_text('changed\n')
     else:invroot.chmod(0o750)
     record('V4-inventory-'+label,lambda:h.p.files(expected_inventory,h.packet_inventory(invroot)),'files:')
    finally:specimen.write_text('original\n');specimen.chmod(0o600);invroot.chmod(0o700)
   require(h.packet_inventory(invroot)==expected_inventory,'inventory-restoration')
   # The actual preservation function must consume both complete V4 inventories.
   preserve,cns=copied(h,'preserve')
   empty=fixture/'preserve-empty';empty.mkdir(mode=0o700)
   v4_names=['/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4',
    '/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation']
   cns.update(OUT=empty,read=lambda n:{} if n=='preservation-files.json' else {name:expected_inventory for name in v4_names},
    packet_inventory=lambda path:h.packet_inventory(invroot),protected_web=lambda:{'context':'stand-in'})
   record('V4-full-preserve-consumer-harmless',preserve)
   try:
    specimen.write_text('changed\n')
    record('V4-full-preserve-consumes-drift',preserve,'files:')
    node=next(n for n in ast.parse(Path(h.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='preserve')
    source=ast.get_source_segment(Path(h.__file__).read_text(),node)
    bad=source.replace('p.files(frozen[name],packet_inventory(Path(name)))','pass')
    require(source!=bad,'V4-guard-fault-not-applied')
    exec(compile(bad,'<V4-inventory-codefault>','exec'),cns)
    try:expect(cns['preserve'],'files:')
    except AssertionError as error:
     require(str(error)=='missing-refusal:files:','V4-guard-wrong-failure');rows.append({'case':'V4-remove-complete-inventory-guard','outcome':'KILLED','reason':str(error)})
    else:raise AssertionError('V4-guard-codefault-survived')
   finally:specimen.write_text('original\n');specimen.chmod(0o600)
   # Durable writer is the unchanged real x-create/fsync writer in a private stand-in.
   writer,wns=copied(h,'write');wns['OUT']=fixture
   record('R2-durable-writer-harmless',lambda:writer('append-only-result.json',{'note':'harmless'}))
   try:writer('append-only-result.json',{'bad':'overwrite'})
   except FileExistsError:rows.append({'case':'R2-duplicate-result-refuses','outcome':'REFUSED','reason':'FileExistsError'})
   else:raise AssertionError('append-only-overwrite')
   require(json.loads((fixture/'append-only-result.json').read_text())=={'note':'harmless'},'append-only-bytes')
   # New preview database must stay outside the protected comparison set.
   actual_read=pns['read']
   try:
    pns['read']=lambda n:protected+[h.TARGET] if n=='protected-databases.json' else actual_read(n)
    record('R2-new-preview-data-exclusion',post,'post-new-database-excluded:excluded')
   finally:pns['read']=actual_read
  after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir() if p.is_file() and p.name in before}
  require(after==before,'sealed-input-not-restored')
  require(not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir()),'operating-stage-dispatched')
 finally:h.read=saved_read
 result={'scope':'Selected R1/R2/R3 in-memory/code-fault and future-observation stand-ins. No DB, Docker, HTTP, helper, build or browser transport. Actual R1 context tests have separate records.',
  'cases':rows,'count':len(rows),'finallyRestored':True,'sealedFilesUnchanged':True,'noOperatingStage':True,
  'blindCategories':['No PostgreSQL parsing or target normalization verified. Fixed expected definitions fail closed.','Future post-journey DB/helper/Storage acquisitions are stand-ins.','User-manager, host tools and same-user code custody remain trust assumptions.']}
 (ROOT/('delta-controls-'+RUN_ID+'.json')).write_text(json.dumps(result,indent=2)+'\n');(HERE/'controls.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'cases':len(rows),'outcomes':{k:sum(x['outcome']==k for x in rows) for k in ['SURVIVED','REFUSED','KILLED']},'operatingStages':0}))
if __name__=='__main__':main()
