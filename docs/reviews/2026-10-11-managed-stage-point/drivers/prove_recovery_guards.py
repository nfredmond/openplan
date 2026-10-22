"""Use harmless, changed observation and omitted guard controls in memory."""
import ast,copy,hashlib,json
from pathlib import Path
import recovery_guards as g
source=Path(g.__file__);raw=source.read_bytes();records=[]
request='request';workspace='workspace';run='run';stage='stage';attempt='attempt'
response={'request_id':request,'outcome':'command_receipt_retained','model_resumed':False}
event={'method':'POST','path':'/rpc/claim','requestSha256':'original','responseSha256':'native','status':200,'dropped':False}
ownership={'request_id':request,'workspace_id':workspace,'run_id':run,'stage_id':stage,'ownership':{'owns_stage':True,'active_attempt_id':attempt,'stage_status':'running','run_status':'running','stage_managed':True,'run_managed':True},'point_in_time_only':True,'continuation_authorized':False,'model_resumed':False}
fixtures={
 'verify_cli':([0,response,request],'stage-recovery-cli-receipt',lambda a:a[1].update(model_resumed=True)),
 'verify_wrong':([3,{'outcome':'request_refused','model_resumed':False},[]],'stage-recovery-wrong-installation',lambda a:a[2].append(event)),
 'verify_exchange':([event,[event]],'stage-recovery-original-exchange',lambda a:a[1][0].update(requestSha256='changed')),
 'verify_cached':([1,1],'stage-recovery-cached-no-http',lambda a:a.__setitem__(1,2)),
 'verify_admission':([[[request,workspace,1]],request,workspace,1],'stage-recovery-admission-retained',lambda a:a[0].clear()),
 'verify_no_reentry':([True,[]],'stage-recovery-no-reentry',lambda a:a[1].append('unexpected callback')),
 'verify_ownership':([0,ownership,request,workspace,run,stage,attempt],'stage-recovery-ownership-read-only',lambda a:a[1].update(continuation_authorized=True)),
 'verify_changed_files':([{'journal':1,'owner':1},{'journal':2,'owner':1},['journal']],'stage-recovery-local-file-delta',lambda a:a[1].update(owner=2)),
}
def load(omit=None,harmless=False):
 tree=ast.parse((b'# Harmless comment\n' if harmless else b'')+raw);found=0
 for node in ast.walk(tree):
  if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='require' and len(node.args)==2 and isinstance(node.args[1],ast.Constant) and node.args[1].value==omit:node.args[0]=ast.Constant(True);found+=1
 if omit:assert found==1
 space={};exec(compile(ast.fix_missing_locations(tree),str(source),'exec'),space);return space
for name,(args,reason,change) in fixtures.items():
 for label in ('baseline','harmless','restored'):load(harmless=label=='harmless')[name](*copy.deepcopy(args))
 # Keep the source and target exchange objects independent for the mutation.
 broken=copy.deepcopy(args)
 if name=='verify_exchange':broken[1]=copy.deepcopy(broken[1])
 change(broken)
 try:load()[name](*broken)
 except ValueError as e:assert str(e)==reason
 else:raise AssertionError('Broken observation accepted: '+reason)
 try:load(omit=reason)[name](*broken);raise AssertionError('Broken observation accepted: '+reason)
 except AssertionError as e:assert str(e)=='Broken observation accepted: '+reason
 records.append({'guard':reason,'baselineHarmlessRestored':True,'brokenRefused':True,'omittedGuardFailsOracle':True})
assert source.read_bytes()==raw
(source.parent/'recovery-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(raw).hexdigest(),'cases':records,'scope':'In-memory observations only. No native receipt, CLI, callback, file, admission, ownership lease or service acceptance.'},indent=2)+'\n')
print(len(records),'recovery guard groups pass')
