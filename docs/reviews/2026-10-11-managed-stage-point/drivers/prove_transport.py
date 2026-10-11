"""Harmless, broken and isolated omitted-guard controls on copied bridge source."""
import ast,copy,hashlib,json
from pathlib import Path
from urllib.parse import urlencode
import transport as t
OUT=Path(__file__).parent;SOURCE=OUT/'transport.py';original=SOURCE.read_bytes()
bindings={'stage':{'run':'run','workspace':'workspace'}}
query={'id':'eq.stage','run_id':'eq.run','model_runs.workspace_id':'eq.workspace','select':t.PROJECTIONS[0]}
def path(changes=None):return '/rest/v1/model_run_stages?'+urlencode({**query,**(changes or {})})
post=('POST',t.POST_PATHS[0],100,True);read=('GET',path(),True,bindings)
cases=[('verify_post',('GET',*post[1:]),'stagepoint-post-method'),('verify_post',('POST','/foreign',100,True),'stagepoint-post-path'),('verify_post',('POST',post[1],True,True),'stagepoint-post-size'),('verify_post',('POST',post[1],0,True),'stagepoint-post-size'),('verify_post',('POST',post[1],4194305,True),'stagepoint-post-size'),('verify_post',(*post[:3],False),'stagepoint-authorization'),('verify_read',('POST',*read[1:]),'stagepoint-read-method'),('verify_read',('GET','x'*4097,True,bindings),'stagepoint-read-size'),('verify_read',('GET','/foreign?'+urlencode(query),True,bindings),'stagepoint-read-path'),('verify_read',('GET',path()+'&extra=one',True,bindings),'stagepoint-read-query'),('verify_read',('GET',path()+'&id=eq.stage',True,bindings),'stagepoint-read-query'),('verify_read',('GET','/rest/v1/model_run_stages?id',True,bindings),'stagepoint-read-query'),('verify_read',('GET',path({'id':'eq.foreign'}),True,bindings),'stagepoint-read-scope'),('verify_read',('GET',path({'run_id':'eq.foreign'}),True,bindings),'stagepoint-read-scope'),('verify_read',('GET',path({'model_runs.workspace_id':'eq.foreign'}),True,bindings),'stagepoint-read-scope'),('verify_read',('GET',path({'select':'*'}),True,bindings),'stagepoint-read-projection'),('verify_read',('GET',path(),False,bindings),'stagepoint-authorization'),('verify_body',(99,100),'stagepoint-body-length'),('verify_response',(1048577,),'stagepoint-response-size')]
def load(text):
 namespace={'__file__':str(SOURCE),'__name__':'controlled_bridge'};exec(compile(text,str(SOURCE),'exec'),namespace);return namespace
def refuse(namespace,name,args,reason):
 try:namespace[name](*args)
 except ValueError as error:
  if str(error)==reason:return
  raise AssertionError('Wrong refusal: '+str(error)) from error
 raise AssertionError('Missing refusal: '+reason)
def baseline(namespace):
 namespace['verify_post'](*post);namespace['verify_read'](*read);namespace['verify_read']('GET',path({'select':t.PROJECTIONS[1]}),True,bindings);namespace['verify_body'](100,100);namespace['verify_response'](1048576)
records=[]
for label,text in [('baseline',original.decode()),('harmless',original.decode()+'\n# Retained fixture scope.\n'),('restored',original.decode())]:baseline(load(text));records.append({'case':label,'passed':True})
namespace=load(original.decode())
for name,args,reason in cases:refuse(namespace,name,args,reason);records.append({'function':name,'reason':reason,'brokenRefused':True})
tree=ast.parse(original)
for function in tree.body:
 if not isinstance(function,ast.FunctionDef) or not function.name.startswith('verify_'):continue
 guards=[node for node in ast.walk(function) if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='require']
 for index,node in enumerate(guards):
  reason=node.args[1].value
  name,args,_=next(c for c in cases if c[0]==function.name and c[2]==reason)
  probe='same broken observation'
  if reason=='stagepoint-read-size':
   class LongObservation(str):
    def __len__(self):return 4097
   args=('GET',LongObservation(path()),True,bindings);probe='str subclass with over-limit length observation and unchanged valid decoded query; isolated from later query/scope guards'
  elif reason=='stagepoint-read-path':
   # A different valid path with the same correct query isolates the path guard.
   args=('GET','/foreign?'+urlencode(query),True,bindings)
  mutated=copy.deepcopy(tree);fn=next(n for n in mutated.body if isinstance(n,ast.FunctionDef) and n.name==function.name)
  selected=[n for n in ast.walk(fn) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='require'][index];selected.args[0]=ast.Constant(True)
  try:refuse(load(ast.unparse(ast.fix_missing_locations(mutated))),name,args,reason)
  except AssertionError as error:
   assert str(error)=='Missing refusal: '+reason
  else:raise AssertionError('Omitted guard survived its intended oracle')
  records.append({'function':name,'reason':reason,'omittedGuardFailsIntendedOracle':True,'omittedProbe':probe})
assert SOURCE.read_bytes()==original
(OUT/'transport-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original).hexdigest(),'records':records,'limits':'Pure request/size/projection predicates, copied AST mutations. No real HTTP, server commit, socket drop, redirect behavior, time bound or native ownership acceptance.'},indent=2)+'\n')
print(len(cases),'broken transport observations and',sum('omittedGuardFailsIntendedOracle' in r for r in records),'omitted checks pass')
