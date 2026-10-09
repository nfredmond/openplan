"""Native immutable-upload controls; each case owns a fresh database and store."""
import hashlib,json,os
from pathlib import Path
import subprocess,sys
HERE=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_STORAGE_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
for control in ('normal','harmless','upsert','restored'):
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_native_validation_storage.py')],
        env={**os.environ,'OPENPLAN_NATIVE_STORAGE_CONTROL':control,'OPENPLAN_NATIVE_STORAGE_PROOF_OUTPUT':str(output/control)},
        capture_output=True,text=True,timeout=90)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    if control=='upsert':
        assert result.returncode!=0 and 'AssertionError: Immutable upload replaced an existing object' in result.stderr,result.stderr
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'result.json').read_text())
        assert report['exact_bytes_downloaded'] and report['original_bytes_preserved'] and report['changed_upload_refused']
    cases.append({'control':control,'returncode':result.returncode,'expected_behavior_observed':True})
report={'cases':cases,'proof_sha256':hashlib.sha256((HERE/'verify_native_validation_storage.py').read_bytes()).hexdigest(),
 'limits':['Actual worker upload, prefix-only proxy and isolated native private Storage',
 'Fault changes x-upsert at transport; no custody RPC, full user RLS matrix, lost acknowledgement recovery, full source publication or scientific acceptance']}
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/'native-validation-storage-controls.json').write_text(content)
print(content)
