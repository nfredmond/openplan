"""Run native assignment with and without its parent registration command."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent
proof=root/'verify_native_bound_assignment.py'
output=Path(os.environ['OPENPLAN_INITIAL_REGISTRATION_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
results=[]
for label,control in (('baseline','baseline'),('harmless','harmless'),('omit-registration','omit-initial-input-registration'),('restored','baseline')):
    env=dict(os.environ,OPENPLAN_BOUND_ASSIGNMENT_OUTPUT=str(output/label),OPENPLAN_BOUND_ASSIGNMENT_CONTROL=control,OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='1',AEQ_CORES='1')
    result=subprocess.run([sys.executable,'-B',str(proof)],env=env,capture_output=True,text=True,timeout=180)
    log=result.stdout+result.stderr;(output/(label+'.log')).write_text(log)
    matched=result.returncode==0 if label!='omit-registration' else result.returncode!=0 and 'Native assignment initial input registration missing' in log
    results.append({'control':label,'returncode':result.returncode,'matched':matched})
    if not matched:raise AssertionError(log)
report={'proof_sha256':hashlib.sha256(proof.read_bytes()).hexdigest(),'controls':results,
 'limits':'AequilibraE 1.6.2, two synthetic centroids and one link, real child-parent sockets and journals, injected database responses. No native database commit, independent preparation or scientific acceptance.'}
(output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
(root/'native-initial-registration-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
