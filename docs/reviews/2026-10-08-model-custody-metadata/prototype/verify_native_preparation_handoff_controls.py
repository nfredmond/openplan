"""Serial native handoff controls, each with a fresh retained database clone."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
proof=ROOT/'verify_native_preparation_handoff.py'
output=Path(os.environ['OPENPLAN_PREPARATION_HANDOFF_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
results=[]
for control, failure in (
        ('normal',None),('harmless',None),
        ('drop-registration','Native consumption registration missing'),
        ('wrong-producer','Named predecessor stage must be unique'),('restored',None)):
    env=dict(os.environ,OPENPLAN_PREPARATION_HANDOFF_CONTROL=control,
             OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT=str(output/control))
    result=subprocess.run([sys.executable,'-B',str(proof)],env=env,capture_output=True,text=True,timeout=180)
    log=result.stdout+result.stderr
    (output/(control+'.log')).write_text(log)
    passed=result.returncode==0 if failure is None else result.returncode!=0 and failure in log
    results.append({'control':control,'returncode':result.returncode,'expected_failure':failure,'matched':passed})
    if not passed:raise AssertionError(f'Control {control} did not match: {log[-3000:]}')
report={'proof_sha256':hashlib.sha256(proof.read_bytes()).hexdigest(),'controls':results,
        'limits':'Synthetic preparation files, native stage claims, completed producer and artifact commands. No engines, normal dispatch, concurrent revocation, receipt-loss recovery or scientific acceptance.'}
(output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'native-preparation-handoff-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
