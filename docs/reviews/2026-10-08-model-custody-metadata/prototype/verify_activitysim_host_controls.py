"""Serial faults in the supervised ActivitySim host path; exact-byte restoration."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
WORKER=ROOT/'workers/activitysim_worker'
paths={name:WORKER/name for name in ('host_supervision.py','runtime.py','main.py')}
original={name:path.read_bytes() for name,path in paths.items()}
cases=[('harmless','host_supervision.py',None,None,None),
 ('no-owner-binding','host_supervision.py','owner_guard=guard','owner_guard=None','Owned runtime readiness or exit timed out'),
 ('ignore-descendants','host_supervision.py','empty = scope.require_empty()',"empty = {'observed_scope_empty': True}",'Runtime completed while detached child remained live'),
 ('accept-container','runtime.py','if container_image:\n            raise ValueError("Host supervision','if False:\n            raise ValueError("Host supervision','Host policy reached bundle access'),
 ('drop-operator-memory','main.py','host_memory_bytes=payload["host_memory_bytes"]','host_memory_bytes=None','None != 134217728'),
 ('restored','host_supervision.py',None,None,None)]
records=[]
try:
 for name,filename,before,after,expected in cases:
  for key,path in paths.items():path.write_bytes(original[key])
  text=original[filename].decode()
  if before:
   assert before in text
   text=text.replace(before,after)
  elif name=='harmless':text+='\n# Harmless host runtime control.\n'
  paths[filename].write_text(text)
  command=[sys.executable,'-B','-m','unittest','discover','-s','tests','-p','test_host_supervision.py','-v']
  if filename=='main.py':command=[sys.executable,'-B','-m','unittest','test_http_security','-v']
  result=subprocess.run(command,cwd=WORKER,env=dict(os.environ,OPENPLAN_LIVE_ENGINE_SCOPE='1'),capture_output=True,text=True,timeout=60)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and expected in output,output
  else:assert result.returncode==0,output
  records.append({'case':name,'verified':True,'returncode':result.returncode,'expected_failure':expected})
finally:
 for name,path in paths.items():path.write_bytes(original[name])
print(json.dumps({'cases':records,'source_sha256':{name:hashlib.sha256(value).hexdigest() for name,value in original.items()},'limits':['Synthetic CLI through actual ActivitySim runtime','Container workloads refused for host supervision','No native ActivitySim scientific or human acceptance']},indent=2))
