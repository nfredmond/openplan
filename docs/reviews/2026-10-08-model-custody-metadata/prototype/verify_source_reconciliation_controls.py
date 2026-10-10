"""Recovery must retain original scope and ownership without execution reentry."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_source_publication_recovery.py'
original=source.read_text()
mutations=[
 ('local-artifact-scope',"if local_command['operation']!='write_model_attempt_artifact' or any(local_command['arguments'].get(key)!=value for key,value in scope.items()):",'if False:'),
 ('admission',"if admitted is None or admitted[1]!=1:", 'if False:'),
 ('attempt-owner',"if owner!={'schema':'openplan.attempt-workspace.v1',**asdict(context)}:", 'if False:'),
 ('saved-manifest'," or recovery.get('retained')!=retained", ''),
 ('other-pending',"if any(row['command']['request_id']!=remote_id for row in pending):", 'if False:'),
 ('ownership-before',"    owns()\n    published=", '    published='),
 ('ownership-after',"    owns()\n    payload=", '    payload='),
 ('model-resume-claim',"'model_resumed':False,'stage_status_changed':False", "'model_resumed':True,'stage_status_changed':False"),
]
variants=[('harmless',original+'\n# Harmless formatting control.\n')]
for name,before,after in mutations:
    assert original.count(before)==1,name
    variants.append((name,original.replace(before,after)))
variants.append(('restored',original))
cases=[]
try:
    for name,content in variants:
        source.write_text(content)
        result=subprocess.run([sys.executable,'-B','workers/aequilibrae_worker/test_model_source_publication_recovery.py'],cwd=ROOT,capture_output=True,text=True,timeout=30)
        detail=result.stdout+result.stderr
        if name in ('harmless','restored'):assert result.returncode==0,detail
        else:assert result.returncode!=0 and 'AssertionError' in detail,detail
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_text(original)
report={'source_sha256':hashlib.sha256(original.encode()).hexdigest(),'cases':cases,
        'limits':'Actual files, journals, saved admission and publisher with injected ownership/database responses and synthetic TUS peer. No native whole-source reconciliation or fresh-process CLI proof.'}
Path(__file__).with_name('source-reconciliation-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
