"""Inspect retained native host cases twice without changing record bytes."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
script=ROOT/'workers/activitysim_worker/host_recovery.py'
proof=Path(os.environ['OPENPLAN_ACTIVITYSIM_NATIVE_PROOF'])
results=[]
for name in ('baseline','harmless','omit-owner-loss','restored'):
 directory=proof/name/'runtime/stages/030-run-activitysim/host_supervision'
 before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir() if p.is_file()}
 observed=[]
 for attempt in range(2):
  result=subprocess.run([sys.executable,'-B',str(script),'--records',str(directory)],capture_output=True,text=True,timeout=15)
  assert result.returncode==0,result.stderr+result.stdout
  record=json.loads(result.stdout)
  assert record['scope_has_live_processes'] is False
  assert record['owner_guard']['guard_has_live_processes'] is False
  for key in ('model_resumed','signal_sent','continuation_authorized','database_status_changed','server_ownership_checked'):
   assert record[key] is False
  assert record['termination_cause']=='unconfirmed'
  assert record['completion_record_present'] is (name=='omit-owner-loss')
  assert record['record_sha256']==before
  observed.append(record)
 after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir() if p.is_file()}
 assert before==after
 assert observed[0]==observed[1]
 results.append({'case':name,'repeated_inspections_equal':observed[0]==observed[1],'record_bytes_unchanged':True,'inspection':observed[0]})
print(json.dumps({'cases':results,'inspector_sha256':hashlib.sha256(script.read_bytes()).hexdigest(),
 'limits':['Retained native scopes observed absent on the same host boot','No termination-cause inference, restart, signaling, database authority or scientific acceptance']},indent=2))
