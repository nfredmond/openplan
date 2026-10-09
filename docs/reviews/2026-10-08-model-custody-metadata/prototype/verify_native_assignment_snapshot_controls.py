"""Native snapshot readback controls; leave retained evidence bytes unchanged."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent
proof=root/'verify_native_assignment_snapshot.py'
output=Path(os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT'])
results=[]
for control in ('baseline','harmless','matrix-mismatch','restored'):
    env=dict(os.environ,OPENPLAN_SNAPSHOT_VERIFICATION_CONTROL=control)
    result=subprocess.run([sys.executable,'-B',str(proof)],env=env,capture_output=True,text=True,timeout=30)
    log=result.stdout+result.stderr
    (output/('snapshot-'+control+'.log')).write_text(log)
    matched=result.returncode==0 if control!='matrix-mismatch' else result.returncode!=0 and 'Arrays are not equal' in log
    results.append({'control':control,'returncode':result.returncode,'matched':matched})
    if not matched:raise AssertionError(log)
report={'proof_sha256':hashlib.sha256(proof.read_bytes()).hexdigest(),'controls':results,
        'limits':'Readback of one completed synthetic native assignment; deliberate mismatch changes only an in-memory expected array.'}
(root/'native-assignment-snapshot-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
