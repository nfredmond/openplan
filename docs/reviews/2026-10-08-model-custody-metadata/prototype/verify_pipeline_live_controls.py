"""Detect pipeline/CLI bypass of the actual supervised execution path."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];worker=ROOT/'scripts/modeling'
original={name:(worker/name).read_bytes() for name in ('run_behavioral_demand_prototype.py',)}
base=Path(os.environ['OPENPLAN_PIPELINE_LIVE_CONTROLS']);base.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[('harmless',None,None,None),
 ('drop-cli-socket','run_behavioral_demand_prototype.py','container_supervision_socket=args.container_supervision_socket','container_supervision_socket=None'),
 ('drop-runtime-socket','run_behavioral_demand_prototype.py','container_supervision_socket=container_supervision_socket','container_supervision_socket=None'),
 ('restored',None,None,None)]
results=[]
try:
 for name,file,before,after in cases:
  for target,content in original.items():(worker/target).write_bytes(content)
  if file:
   path=worker/file;source=path.read_text();assert before in source;path.write_text(source.replace(before,after))
  if name=='harmless':
   path=worker/'run_behavioral_demand_prototype.py';path.write_text(path.read_text()+'\n# Harmless runtime control.\n')
  result=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('verify_supervised_container_pipeline.py'))],env=dict(os.environ,OPENPLAN_SUPERVISED_PIPELINE_PROOF=str(base/name)),capture_output=True,text=True,timeout=90)
  (base/(name+'.log')).write_text(result.stdout+result.stderr)
  if file:assert result.returncode!=0 and ('AssertionError: Pipeline did not retain supervised creation' in result.stderr or 'AssertionError: Runtime did not reach supervised work:' in result.stderr),result.stderr
  else:assert result.returncode==0,result.stderr
  results.append({'case':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
 for name,content in original.items():(worker/name).write_bytes(content)
print(json.dumps({'cases':results,'sources':{name:hashlib.sha256(content).hexdigest() for name,content in original.items()},'limits':['Actual pipeline CLI with synthetic command, not native ActivitySim or scientific acceptance']},indent=2))
