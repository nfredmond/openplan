"""Exact intended refusals and isolated omission probes for source seed records."""
import ast,copy,hashlib,json
from pathlib import Path
import seed_guards as g
OUT=Path(__file__).parent;SOURCE=OUT/'seed_guards.py';original=SOURCE.read_bytes()
claim={'request_id':'claim','operation':'claim_model_stage_attempt','arguments':{'run_id':'run','stage_id':'stage','worker_id':'fixture'}}
progress={'request_id':'progress','operation':'write_model_stage_attempt','arguments':{'run_id':'run','stage_id':'stage','attempt_id':'attempt','status':'running','log_tail':'fixture','error':None}}
server={'receipt':{'request_id':'progress','request_payload':{k:progress['arguments'][k] for k in ('attempt_id','status','log_tail','error')},'response_payload':{'attempt_id':'attempt'}},'stage':{'id':'stage','run_id':'run','active_attempt_id':'attempt','attempt_managed':True,'status':'running','log_tail':'fixture','error_message':None,'completed_at':None},'run':{'id':'run','workspace_id':'workspace','attempt_managed':True,'status':'running'},'attempt':{'id':'attempt','stage_id':'stage','run_id':'run','revoked_at':None}}
event=lambda path:{'method':'POST','path':path,'status':200,'dropped':True}
args={'verify_uncertainty':['DeliveryUnconfirmed',[event('/claim')],'/claim',0,0,[{'resolved':False,'response':None}]],'verify_progress':['DeliveryUnconfirmed',1,1,True,True,[event('/rest/v1/rpc/write_model_stage_attempt')],[{'resolved':False,'response':None,'command':progress}]],'verify_server':[progress,server,'workspace']}
expected={'public.model_runs':2,'public.model_run_stages':2,'public.model_execution_custody_enrollment':2,'public.model_stage_attempts':2,'public.model_stage_claim_receipts':2,'public.model_stage_write_receipts':1,'public.models':0,'public.model_stage_execution_starts':2}
before={'tables':[{'table':name,'count':10,'sha256':'a'} for name in [*expected,'public.unaffected']],'sequences':[1],'schemaSha256':'a'}
after=copy.deepcopy(before)
for row in after['tables']:
 if row['table'] in expected:row.update(count=10+expected[row['table']],sha256='b')
args['verify_native_delta']=[before,after]
args['verify_original_rows']=[{'count':10,'sha256':'a'},{'count':10,'sha256':'a'}]
args['verify_model_touch']=[[{'id':'model','updated_at':'before','name':'fixture'}],[{'id':'model','updated_at':'after','name':'fixture'}],'model','after']
args['verify_source']=['93b052a2ee3a8f8232510fbd478208722014fa7f',False,{'helper':'a'},{'helper':'a'}]
args['verify_starts']=[[{'stage_id':'stage','run_id':'run','boundary':'queued_to_running','observed_at':'fixture-time','after_stage_start':True}],[('stage','run')]]
cases=[]
def changed(name,path,value,reason):
 data=copy.deepcopy(args[name]);target=data
 for key in path[:-1]:target=target[key]
 target[path[-1]]=value;cases.append((name,data,reason))
changed('verify_uncertainty',[0],'other','stagepoint-delivery-uncertain')
changed('verify_uncertainty',[1,0,'status'],500,'stagepoint-native-committed-drop')
changed('verify_uncertainty',[1,0,'dropped'],False,'stagepoint-native-committed-drop')
changed('verify_uncertainty',[3],1,'stagepoint-uncertain-claim-no-callback')
changed('verify_uncertainty',[3],False,'stagepoint-uncertain-claim-no-callback')
changed('verify_uncertainty',[4],1,'stagepoint-uncertain-admission-unconsumed')
changed('verify_uncertainty',[5,0,'resolved'],True,'stagepoint-original-claim-pending')
changed('verify_progress',[0],'other','stagepoint-progress-delivery-uncertain')
changed('verify_progress',[1],2,'stagepoint-progress-admission-consumed-once')
changed('verify_progress',[2],0,'stagepoint-progress-admission-consumed-once')
changed('verify_progress',[3],False,'stagepoint-progress-writer-stopped')
changed('verify_progress',[4],False,'stagepoint-progress-writer-stopped')
changed('verify_progress',[5,0,'dropped'],False,'stagepoint-progress-committed-drop')
changed('verify_progress',[6,0,'response'],{},'stagepoint-original-progress-pending')
changed('verify_native_delta',[1,'sequences'],[2],'stagepoint-native-structure')
changed('verify_native_delta',[1,'tables',8,'sha256'],'b','stagepoint-native-changed-tables')
changed('verify_native_delta',[1,'tables',0,'count'],13,'stagepoint-native-new-row-counts')
changed('verify_server',[1,'receipt'],None,'stagepoint-native-command-pair-missing')
changed('verify_server',[1,'receipt','request_id'],'other','stagepoint-native-request-identity')
changed('verify_server',[1,'receipt','request_payload'],{},'stagepoint-native-request-payload')
changed('verify_server',[1,'receipt','response_payload'],None,'stagepoint-native-response-payload')
changed('verify_server',[1,'attempt','id'],'other','stagepoint-native-attempt-identity')
changed('verify_server',[1,'attempt','revoked_at'],'time','stagepoint-native-attempt-identity')
changed('verify_server',[1,'stage','active_attempt_id'],'other','stagepoint-native-stage-owned')
changed('verify_server',[1,'stage','attempt_managed'],False,'stagepoint-native-stage-owned')
changed('verify_server',[1,'run','workspace_id'],'other','stagepoint-native-parent-owned')
changed('verify_server',[1,'run','status'],'cancelled','stagepoint-native-parent-owned')
changed('verify_server',[1,'stage','log_tail'],'other','stagepoint-native-progress-effect')
changed('verify_original_rows',[1,'sha256'],'other','stagepoint-original-row-images')
changed('verify_model_touch',[1,0,'name'],'other','stagepoint-selected-model-timestamp-only')
changed('verify_source',[0],'foreign','stagepoint-production-source')
changed('verify_source',[1],True,'stagepoint-production-source')
changed('verify_source',[2],{},'stagepoint-production-helpers')
changed('verify_starts',[0,0,'boundary'],'inserted_running','stagepoint-native-execution-starts')
changed('verify_starts',[0,0,'run_id'],'other','stagepoint-native-execution-starts')
changed('verify_starts',[0,0,'after_stage_start'],False,'stagepoint-native-execution-starts')
def load(text):
 namespace={'__file__':str(SOURCE)};exec(compile(text,str(SOURCE),'exec'),namespace);return namespace
def refused(namespace,name,data,reason):
 try:namespace[name](*data)
 except ValueError as error:
  if str(error)==reason:return
  raise AssertionError('Wrong refusal: '+str(error)) from error
 raise AssertionError('Missing refusal: '+reason)
records=[]
for label,text in [('baseline',original.decode()),('harmless',original.decode()+'\n# Fixed synthetic point.\n'),('restored',original.decode())]:
 ns=load(text)
 for name,data in args.items():ns[name](*copy.deepcopy(data))
 # The claim branch uses its distinct native request payload.
 claim_server=copy.deepcopy(server);claim_server['receipt'].update(request_id='claim',request_payload={'stage_id':'stage','worker_id':'fixture'})
 ns['verify_server'](claim,claim_server,'workspace')
 records.append({'case':label,'passed':True})
ns=load(original.decode())
for name,data,reason in cases:refused(ns,name,data,reason);records.append({'function':name,'reason':reason,'brokenRefused':True})
class MappingProbe:
 def __init__(self,value):self.value=value
 def get(self,key,default=None):return self.value.get(key,default)
tree=ast.parse(original)
for function in tree.body:
 if not isinstance(function,ast.FunctionDef) or not function.name.startswith('verify_'):continue
 guards=[n for n in ast.walk(function) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='require']
 for index,node in enumerate(guards):
  reason=node.args[1].value;name,data,_=next(c for c in cases if c[0]==function.name and c[2]==reason);data=copy.deepcopy(data);probe='same broken observation'
  if reason=='stagepoint-native-command-pair-missing':
   data=copy.deepcopy(args[name]);data[1]['receipt']=MappingProbe(data[1]['receipt']);probe='non-dict getter-compatible receipt isolates the missing native row type check from later content checks'
  elif reason=='stagepoint-native-response-payload':
   data=copy.deepcopy(args[name]);data[1]['receipt']['response_payload']=MappingProbe(data[1]['receipt']['response_payload']);probe='non-dict getter-compatible response isolates the response type check from later attempt checks'
  mutated=copy.deepcopy(tree);fn=next(n for n in mutated.body if isinstance(n,ast.FunctionDef) and n.name==function.name);selected=[n for n in ast.walk(fn) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='require'][index];selected.args[0]=ast.Constant(True)
  try:refused(load(ast.unparse(ast.fix_missing_locations(mutated))),name,data,reason)
  except AssertionError as error:assert str(error)=='Missing refusal: '+reason
  else:raise AssertionError('Omitted guard survived its intended oracle')
  records.append({'function':name,'reason':reason,'omittedGuardFailsIntendedOracle':True,'omittedProbe':probe})
assert SOURCE.read_bytes()==original
(OUT/'seed-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original).hexdigest(),'records':records,'limits':'Pure synthetic observation predicates and isolated in-memory AST omissions. No native claim/admission, writer behavior, server commit, full row retention or recovery acceptance.'},indent=2)+'\n')
print(len(cases),'broken observations and',sum('omittedGuardFailsIntendedOracle' in r for r in records),'omitted guards pass')
