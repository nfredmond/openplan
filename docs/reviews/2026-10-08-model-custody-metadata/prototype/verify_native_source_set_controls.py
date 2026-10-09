"""Native complete-source publication controls in isolated database/Storage pairs."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_SOURCE_SET_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
for control in ('normal','harmless','drop-registration','wrong-reference','omit-object','lost-reply','lost-reply-wrong-request','source-interruption','source-wrong-claim','restored'):
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_native_validation_storage.py')],
        env={**os.environ,'OPENPLAN_NATIVE_STORAGE_JOIN':'1','OPENPLAN_NATIVE_SOURCE_SET':'1','OPENPLAN_SOURCE_SET_CONTROL':control,
             'OPENPLAN_NATIVE_STORAGE_PROOF_OUTPUT':str(output/control)},capture_output=True,text=True,timeout=180)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    reason={'drop-registration':'Native source artifact inventory differs','wrong-reference':'Registered source manifest URI differs',
            'omit-object':'Declared native source object unavailable','source-wrong-claim':'Native source reconciliation CLI failed','lost-reply-wrong-request':'Remote artifact receipt recovery failed'}.get(control)
    if reason:
        assert result.returncode!=0 and 'AssertionError: '+reason in result.stderr,result.stderr
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'result.json').read_text())
        assert report['methods']==2 and report['native_artifacts']==4 and report['native_objects_verified']==32
        assert report['unchanged_manifests'] and report['manifest_last'] and report['postgrest_gateway_removed']
        assert report['fresh_process_receipt_recovered'] is (control=='lost-reply')
        assert report['fresh_process_source_recovered'] is (control=='source-interruption')
    assert json.loads((output/control/'cleanup.json').read_text())['storage_container_removed'] is True
    cases.append({'control':control,'returncode':result.returncode,'expected_behavior_observed':True,'storage_container_removed':True})
report={'cases':cases,'proof_sha256':hashlib.sha256((HERE/'verify_native_source_set_publication.py').read_bytes()).hexdigest(),
        'recovery_proof_sha256':hashlib.sha256((HERE/'verify_native_source_reconciliation.py').read_bytes()).hexdigest(),
        'limits':'Joined native source sets and exact final-registration receipt recovery over synthetic files. Fresh-process recovery between verified source objects; no joined mid-object interruption or process kill, normal dispatch, independent preparation, browser, human or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/'native-source-set-controls.json').write_text(content)
print(content)
