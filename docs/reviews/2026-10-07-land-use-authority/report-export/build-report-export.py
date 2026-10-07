from pathlib import Path
import json,os,subprocess,time
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007')
status=Path('/tmp/openplan-report-export-build-status.json')
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()
record={'commit':head,'startedEpoch':time.time(),'state':'running'}
status.write_text(json.dumps(record,indent=2))
try:
 with open('/tmp/openplan-report-export-build.log','w') as log:
  result=subprocess.run(['npm','run','build'],cwd=root/'openplan',env={**os.environ,'OPENPLAN_COMMIT_SHA':head,'NODE_OPTIONS':'--max-old-space-size=6144'},stdout=log,stderr=subprocess.STDOUT)
 record.update(exitCode=result.returncode,state='finished',finishedEpoch=time.time(),finalCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),checkoutUnchanged=not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip())
finally:
 status.write_text(json.dumps(record,indent=2)+'\n')
