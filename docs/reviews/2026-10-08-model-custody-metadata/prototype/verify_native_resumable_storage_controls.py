"""Native TUS recovery controls, one owned database and file backend per case."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_TUS_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
for control in ('normal','harmless','wrong-identity','skip-head','skip-readback','restored'):
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_native_validation_storage.py')],
        env={**os.environ,'OPENPLAN_NATIVE_TUS_PROOF':'1','OPENPLAN_NATIVE_TUS_CONTROL':control,
             'OPENPLAN_NATIVE_STORAGE_PROOF_OUTPUT':str(output/control)},capture_output=True,text=True,timeout=120)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    reason={'wrong-identity':'Fresh native uploader did not recover','skip-head':'Fresh native uploader did not recover',
            'skip-readback':'First native uploader did not exit after committed chunk'}.get(control)
    if reason:
        assert result.returncode!=0 and 'AssertionError: '+reason in result.stderr,result.stderr
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'result.json').read_text())
        assert report['fresh_process_recovery'] and report['retained_upload_url_reused'] and report['exact_native_bytes_verified']
        assert report['committed_offset']==6*1024*1024
    assert json.loads((output/control/'cleanup.json').read_text())['storage_container_removed'] is True
    cases.append({'control':control,'returncode':result.returncode,'expected_behavior_observed':True,'storage_container_removed':True})
report={'cases':cases,'proof_sha256':hashlib.sha256((HERE/'verify_native_resumable_storage.py').read_bytes()).hexdigest(),
        'limits':'Actual Storage v1.67.20 TUS and separate process recovery over a two-chunk synthetic file. No service restart, session expiration, complete source-set publication, worker dispatch or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/'native-resumable-storage-controls.json').write_text(content)
print(content)
