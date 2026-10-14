"""Challenge the actual execute function's positive and named-case time budgets."""
import argparse,ast,copy,json,os,subprocess,sys
from pathlib import Path
from types import SimpleNamespace
p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();os.umask(0o077);a.out.mkdir(mode=0o700)
source=a.repo/'docs/reviews/2026-10-13-odm-runtime-output-intake/verify_controls.py';original=source.read_bytes();text=original.decode();rows=[]
def check(label,data):
 tree=ast.parse(data);nodes=[n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='execute'];assert len(nodes)==1
 calls=[]
 def spy(argv,**kwargs):
  named='test_runtime_output_intake.Checks.test_named_fault' in argv
  assert kwargs['timeout']==(30 if named else 90),'Named fault retains30s; full cohort needs90s'
  assert kwargs['capture_output'] is True and kwargs['text'] is True
  calls.append({'named':named,'seconds':kwargs['timeout']})
  return SimpleNamespace(returncode=0,stdout='Retained control stdout',stderr='\nRetained control stderr')
 namespace={'subprocess':SimpleNamespace(run=spy),'sys':sys,'os':os,'module':a.repo/'workers/odm_worker/runtime_output_intake.py','out':a.out}
 exec(compile(ast.Module(body=[copy.deepcopy(nodes[0])],type_ignores=[]),str(source),'exec'),namespace)
 for suffix,test in [('full',None),('named','test_named_fault')]:
  code,output=namespace['execute'](label+'-'+suffix,test);assert code==0 and output=='Retained control stdout\nRetained control stderr'
 assert len(calls)==2 and calls[0]['named'] is False and calls[1]['named'] is True
 return calls
for label,data in [('baseline',original),('harmless',original+b'\n# Harmless harness policy comment.\n'),('restored',original)]:rows.append({'case':label,'outcome':'survived','calls':check(label,data)})
binding='timeout=30 if test else 90';assert text.count(binding)==1
for label,replacement in [('full-cohort-shortened','timeout=30'),('named-fault-widened','timeout=90')]:
 try:check(label,text.replace(binding,replacement))
 except AssertionError as e:assert str(e)=='Named fault retains30s; full cohort needs90s';rows.append({'case':label,'outcome':'intended_failure','diagnostic':str(e)})
 else:raise AssertionError('Harness policy fault survived: '+label)
assert source.read_bytes()==original;(a.out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');print(rows)
