"""Serial database-backed assignment input registration and receipt-loss controls."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent
proof=root/'verify_native_assignment_http.py'
output=Path(os.environ['OPENPLAN_INITIAL_HTTP_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
results=[]
for label,control,reason in (
    ('baseline','baseline',None),('harmless','harmless',None),
    ('lost-initial-input','lost-initial-input',None),
    ('lost-initial-input-harmless','lost-initial-input-harmless',None),
    ('omit-initial-disconnect','omit-initial-disconnect','Native input reply loss did not stop assignment'),
    ('wrong-initial-request','wrong-initial-request','Initial input receipt recovery failed'),
    ('existing-progress-loss','lost-progress',None),('restored','lost-initial-input',None)):
    env=dict(os.environ,OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT=str(output/label),OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROL=control,
             OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='1',AEQ_CORES='1')
    result=subprocess.run([sys.executable,'-B',str(proof)],env=env,capture_output=True,text=True,timeout=180)
    log=result.stdout+result.stderr;(output/(label+'.log')).write_text(log)
    matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
    results.append({'control':label,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
    if not matched:raise AssertionError(f'{label}: {log[-4000:]}')
report={'source_sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('verify_native_assignment_http.py','verify_native_bound_assignment.py','verify_native_initial_input_recovery.py')},
        'controls':results,'limits':'Native AequilibraE and isolated database transactions over synthetic inputs. No ActivitySim behavioral execution, independent preparation, calibration, scientific acceptance or normal dispatch.'}
(output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
(root/'native-initial-http-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
