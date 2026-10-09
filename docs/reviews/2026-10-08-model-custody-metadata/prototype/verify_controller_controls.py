"""Live production-controller faults, restored without touching other work."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
worker=ROOT/'workers/activitysim_worker'
original={name:(worker/name).read_bytes() for name in ('container_supervision.py','container_bootstrap.py','container_peer.py')}
base=Path(os.environ['OPENPLAN_CONTROLLER_CONTROLS']);base.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[('harmless',None,[],None),
 ('skip-artifact','changed-artifact',[('container_supervision.py','if hashlib.sha256(artifact.read_bytes()).hexdigest() != bootstrap_hash:','if False:')],'Rejected startup reached workload'),
 ('skip-peer','wrong-peer',[('container_peer.py',"if credentials[0] != pid or credentials[1] != expected_uid or int(info['Pid']) != pid:",'if False:'),('container_peer.py',"if Path(f'/proc/{pid}/cgroup').read_text() != f'0::/system.slice/docker-{expected_id}.scope\\n':",'if False:')],'Wrong controller refusal reason'),
 ('skip-owner-watch','owner-loss',[('container_bootstrap.py','if poller.poll(20):','if False:')],'Owner loss did not stop container'),
 ('early-completion','normal',[('container_bootstrap.py','            child.returncode = command_code','            child.returncode = command_code\n            return command_code')],'Controller ended before child readiness'),
 ('omit-log','normal',[('container_bootstrap.py','stdout=log,','stdout=subprocess.DEVNULL,')],'Command log missing'),
 ('restored',None,[],None)]
records=[]
try:
 for name,selected,changes,expected in cases:
  for file,content in original.items():(worker/file).write_bytes(content)
  for file,before,after in changes:
   path=worker/file;source=path.read_text();assert before in source;path.write_text(source.replace(before,after))
  if name=='harmless':
   path=worker/'container_supervision.py';path.write_text(path.read_text()+'\n# Harmless controller control.\n')
  env=dict(os.environ,OPENPLAN_CONTROLLER_PROOF=str(base/name))
  if selected:env['OPENPLAN_CONTROLLER_CASE']=selected
  result=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('verify_container_controller.py'))],env=env,capture_output=True,text=True,timeout=100)
  (base/(name+'.log')).write_text(result.stdout+result.stderr)
  if expected:assert result.returncode!=0 and 'AssertionError: '+expected in result.stderr,result.stderr
  else:assert result.returncode==0,result.stderr
  records.append({'case':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
 for name,content in original.items():(worker/name).write_bytes(content)
print(json.dumps({'cases':records,'sources':{name:hashlib.sha256(content).hexdigest() for name,content in original.items()},'limits':['Actual controller, synthetic command, local Docker only','Not runtime dispatch, database recovery or scientific acceptance']},indent=2))
