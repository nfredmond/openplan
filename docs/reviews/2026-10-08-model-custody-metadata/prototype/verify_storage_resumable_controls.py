"""Fault controls for retained resumable upload identity and byte custody."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_storage_resumable.py'
original=source.read_text()
mutations=[
 ('protocol-version', " or response.headers.get('Tus-Resumable') != '1.0.0'", ''),
 ('state-lock', '        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)', '        pass'),
 ('source-hash','if digest.hexdigest() != sha256:', 'if False:'),
 ('retained-identity'," or state.get('intent') != intent", ''),
 ('upload-origin',"(actual.scheme, actual.netloc) != (expected.scheme, expected.netloc)", 'False'),
 ('server-offset',"offset = _number(response.headers, 'Upload-Offset')", "offset = state['offset']"),
 ('patch-offset',"if _number(response.headers, 'Upload-Offset') != offset + len(chunk):", 'if False:'),
 ('final-readback',"            if not verified(): raise UploadUnconfirmed('Completed upload object is missing')", '            pass'),
 ('upsert',"'x-upsert':'false'", "'x-upsert':'true'"),
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
        result=subprocess.run([sys.executable,'-B','workers/aequilibrae_worker/test_model_storage_resumable.py'],cwd=ROOT,capture_output=True,text=True,timeout=30)
        detail=result.stdout+result.stderr
        if name in ('harmless','restored'):assert result.returncode==0,detail
        else:assert result.returncode!=0 and 'AssertionError' in detail,detail
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_text(original)
report={'source_sha256':hashlib.sha256(original.encode()).hexdigest(),'cases':cases,
        'limits':'Synthetic TUS peer and local retained state. No native Storage, fresh process restart, publisher integration or scientific acceptance.'}
Path(__file__).with_name('storage-resumable-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
