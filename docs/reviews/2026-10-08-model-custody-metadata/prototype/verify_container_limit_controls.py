"""Check operator container-limit regressions and restore exact source bytes."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
WORKER=ROOT/'workers/activitysim_worker'
paths={name:WORKER/name for name in ('runtime.py','main.py')}
original={name:path.read_bytes() for name,path in paths.items()}
cases=[('harmless','runtime.py',None,None,None),
 ('allow-swap','runtime.py','"--memory-swap", str(memory_bytes)','"--memory-swap", str(memory_bytes * 2)','test_explicit_memory_has_zero_swap_and_task_limit'),
 ('invalid-policy','runtime.py','if type(value) is not int or value <= 0:','if False:','test_partial_or_invalid_limits_fail'),
 ('ignore-backend','runtime.py','if container_memory_bytes is not None and not container_image:','if False:','test_limits_cannot_be_silently_used_for_host_execution'),
 ('drop-operator-limit','main.py','container_memory_bytes=payload["container_memory_bytes"]','container_memory_bytes=None','test_operator_selects_container_limits'),
 ('accept-request-limit','main.py','{"bundlePath", "manifestPath", "runLabel"}','{"bundlePath", "manifestPath", "runLabel", "container_memory_bytes"}','test_request_cannot_choose_executable_or_replace_unrelated_directory'),
 ('restored','runtime.py',None,None,None)]
records=[]
try:
 for name,key,before,after,expected in cases:
  for item,path in paths.items():path.write_bytes(original[item])
  text=original[key].decode()
  if before:
   assert before in text
   text=text.replace(before,after)
  elif name=='harmless':text+='\n# Harmless container limit control.\n'
  paths[key].write_text(text)
  command=[sys.executable,'-B','-m','unittest','discover','-s','tests','-p','test_container_limits.py','-v']
  if key=='main.py':command=[sys.executable,'-B','-m','unittest','test_http_security','-v']
  result=subprocess.run(command,cwd=WORKER,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f'FAIL: {expected} (' in output or f'ERROR: {expected} (' in output),output
  else:assert result.returncode==0,output
  records.append({'case':name,'verified':True,'returncode':result.returncode,'expected_failure':expected})
finally:
 for name,path in paths.items():path.write_bytes(original[name])
print(json.dumps({'cases':records,'source_sha256':{name:hashlib.sha256(value).hexdigest() for name,value in original.items()},
 'limits':['Command construction and operator/request configuration tests','Separate live container proof checks effective limits','No memory exhaustion or daemon lifecycle acceptance']},indent=2))
