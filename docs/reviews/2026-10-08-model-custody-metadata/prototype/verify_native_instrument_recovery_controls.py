"""Both method receipts recover independently after native commit and reply loss."""
import hashlib,json,os
from pathlib import Path
import subprocess,sys
HERE=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_INSTRUMENT_RECOVERY_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
for method in ('aequilibrae','activitysim'):
 for control in ('normal','harmless','bypass-stop','wrong-request','restored'):
    name=method+'-'+control
    env={**os.environ,'OPENPLAN_NATIVE_STORAGE_JOIN':'1','OPENPLAN_NATIVE_INSTRUMENT_CONTENT':'worker-assessed-fixture',
         'OPENPLAN_NATIVE_STORAGE_PROOF_OUTPUT':str(output/name),'OPENPLAN_INSTRUMENT_REPLY_LOSS':'1',
         'OPENPLAN_INSTRUMENT_LOSS_METHOD':method,'OPENPLAN_INSTRUMENT_RECOVERY_CONTROL':control,
         'OPENPLAN_NATIVE_STORAGE_CONTROL':'harmless' if control=='harmless' else 'normal',
         'OPENPLAN_NATIVE_INSTRUMENT_CONTROL':'harmless' if control=='harmless' else 'normal'}
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_native_validation_storage.py')],env=env,capture_output=True,text=True,timeout=120)
    (output/(name+'.log')).write_text(result.stdout+result.stderr)
    if control in ('bypass-stop','wrong-request'):
        reason='Stopped writer accepted later stage completion' if control=='bypass-stop' else 'Fresh instrument recovery failed'
        assert result.returncode!=0 and 'AssertionError: '+reason in result.stderr,result.stderr
        if control=='wrong-request':
            assert json.loads((output/name/'instrument-recovery.log').read_text()) == {'outcome':'request_refused','model_resumed':False}
    else:
        assert result.returncode==0,result.stderr
        joined=json.loads((output/name/'result.json').read_text())['joined_custody']
        record=joined['instrument']
        assert joined['native_objects_verified']==(6 if method=='aequilibrae' else 12)
        assert record['loss_method']==method and record['fresh_process_receipt_recovered']
        assert record['later_completion_refused'] and record['native_tables_unchanged']==9 and not record['execution_resumed']
    cases.append({'method':method,'control':control,'returncode':result.returncode,'expected_behavior_observed':True})
report={'cases':cases,'recovery_proof_sha256':hashlib.sha256((HERE/'verify_native_instrument_recovery.py').read_bytes()).hexdigest(),
 'limits':['Native object bytes and exact method receipt recovery through the actual recovery CLI in a fresh process',
 'Authored synthetic facts; no computation resumption, independent preparation, full source publication, full RLS matrix or scientific acceptance']}
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/'native-instrument-recovery-controls.json').write_text(content)
print(content)
