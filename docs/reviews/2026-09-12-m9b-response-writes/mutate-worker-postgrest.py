"""Native worker restart fault injection against the named disposable PostgREST."""
import hashlib
import json
import os
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
app=root.parents[2]/'openplan'
worker=app/'scripts/workers/engagement-email.ts'
original=worker.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/worker-postgrest-mutations')
private.mkdir(mode=0o700,exist_ok=True)
target='await journal.recover(outcome => finishResponseEmail(client, outcome))'
assert original.count(target)==1
cases=[('baseline',original,None),('harmless-comment',original+'\n// Harmless live restart control.\n',None),('missing-recovery',original.replace(target,'{ unreadable: 0, pending: 0 }'),'Restart did not replay its retained acknowledgement')]
results=[]
try:
 for name,source,expected in cases:
  worker.write_text(source)
  report=private/(name+'.json')
  env={**os.environ,'OPENPLAN_WORKER_PROBE_REPORT':str(report)}
  run=subprocess.run(['node',str(root/'prove-worker-postgrest.mjs')],env=env,capture_output=True,text=True,timeout=75)
  (private/(name+'.log')).write_text(run.stdout+'\n'+run.stderr)
  matched=run.returncode==0 if expected is None else run.returncode!=0 and expected in run.stderr
  results.append({'name':name,'matched':matched,'outcome':'survived' if run.returncode==0 else 'killed','expected':expected,'workerSha256':hashlib.sha256(source.encode()).hexdigest(),'evidence':json.loads(report.read_text()) if run.returncode==0 else None})
  worker.write_text(original)
  (root/'worker-postgrest-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
  print(name,results[-1]['outcome'],matched,flush=True)
  assert matched,'Inspect private worker test output'
finally:
 worker.write_text(original)
 assert hashlib.sha256(worker.read_bytes()).hexdigest()==hashlib.sha256(original.encode()).hexdigest()
