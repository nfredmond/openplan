"""Join native object bytes and database custody with adverse controls."""
import hashlib,json,os
from pathlib import Path
import subprocess,sys
HERE=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_STORAGE_CUSTODY_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
errors={'drop-write':'Native instrument records missing',
        'changed-output':'Evaluated bytes differ from publication bytes',
        'wrong-reference':'Custody object bytes differ'}
for control in ('normal','harmless','drop-write','changed-output','wrong-reference','restored'):
    env={**os.environ,'OPENPLAN_NATIVE_STORAGE_JOIN':'1','OPENPLAN_NATIVE_INSTRUMENT_CONTENT':'worker-assessed-fixture',
         'OPENPLAN_NATIVE_STORAGE_PROOF_OUTPUT':str(output/control),
         'OPENPLAN_NATIVE_STORAGE_CONTROL':'harmless' if control=='harmless' else 'normal',
         'OPENPLAN_NATIVE_INSTRUMENT_CONTROL':'normal' if control=='wrong-reference' else control,
         'OPENPLAN_STORAGE_CUSTODY_FAULT':'wrong-reference' if control=='wrong-reference' else ''}
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_native_validation_storage.py')],env=env,capture_output=True,text=True,timeout=120)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    if control in errors:
        assert result.returncode!=0 and 'AssertionError: '+errors[control] in result.stderr,result.stderr
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'result.json').read_text())['joined_custody']
        assert report['same_database'] and report['native_objects_verified']==12
        assert report['instrument']['separate_methods']==2 and report['instrument']['exact_receipts_reused']
        assert report['postgrest_gateway_removed_on_exit']
    cases.append({'control':control,'returncode':result.returncode,'expected_behavior_observed':True})
report={'cases':cases,'proof_sha256':hashlib.sha256((HERE/'verify_native_validation_storage.py').read_bytes()).hexdigest(),
 'limits':['Actual worker wrapper/evaluator, native object readback and native database custody for two synthetic method fixtures',
 'Wrong-reference control is detected by the proof, not rejected by the custody RPC itself',
 'No independent preparation, real model run, full source publication, normal dispatcher, full RLS matrix or scientific acceptance']}
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/'native-storage-custody-controls.json').write_text(content)
print(content)
