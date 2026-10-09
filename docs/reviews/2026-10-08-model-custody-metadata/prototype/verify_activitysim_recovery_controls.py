"""Mutate ActivitySim inspection policy serially and restore original bytes."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
paths={'recovery':ROOT/'workers/activitysim_worker/host_recovery.py',
       'reader':ROOT/'workers/aequilibrae_worker/model_engine_recovery.py'}
original={key:path.read_bytes() for key,path in paths.items()}
cases=[('harmless','recovery',None,None,None),
 ('promote-continuation','recovery','"continuation_authorized": False','"continuation_authorized": True','test_absence_does_not_authorize_restart_or_infer_cause'),
 ('accept-changed-startup','recovery','if not same_json_value({k: v for k, v in started.items() if k != "scope"}, launch):','if False:','test_changed_startup_is_refused_before_observation'),
 ('accept-boolean-exit','recovery','type(exit_record.get("returncode")) is not int','not isinstance(exit_record.get("returncode"), int)','test_inconsistent_exit_is_refused'),
 ('ignore-record-change','recovery','if current != expected:','if False:','test_change_during_live_observation_is_refused'),
 ('invent-startup-observation','recovery','"scope_startup_unconfirmed"','"scope_absent_observed"','test_missing_startup_remains_unconfirmed'),
 ('accept-public-record','reader',' or before.st_mode&0o077','', 'test_nonprivate_file_is_refused'),
 ('restored','recovery',None,None,None)]
records=[]
try:
 for name,key,before,after,expected in cases:
  for item,path in paths.items():path.write_bytes(original[item])
  text=original[key].decode()
  if before:
   assert before in text
   text=text.replace(before,after)
  elif name=='harmless':text+='\n# Harmless recovery inspection control.\n'
  paths[key].write_text(text)
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_host_recovery.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f"FAIL: {expected} (" in output or f"ERROR: {expected} (" in output),output
  else:assert result.returncode==0,output
  records.append({'case':name,'verified':True,'returncode':result.returncode,'expected_failure':expected})
finally:
 for key,path in paths.items():path.write_bytes(original[key])
print(json.dumps({'cases':records,'source_sha256':{key:hashlib.sha256(value).hexdigest() for key,value in original.items()},'limits':['Synthetic retained identities with mocked live observations','Separate native retained-record CLI checks establish the local systemd observation boundary','No restart, signal, database reconciliation or scientific acceptance']},indent=2))
