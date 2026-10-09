"""Harmless and targeted faulty controls for streamed object readback."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'workers/aequilibrae_worker/model_storage_readback.py'
original = source.read_text()
mutations = [
    ('native-error-code', "error.get('code') == 'NoSuchKey'", 'True'),
    ('native-error-status', " and str(error.get('statusCode')) == '404'", ''),
    ('hash', ' or digest.hexdigest() != sha256', ''),
    ('size', "if received > size_bytes:", 'if False:'),
    ('status', "if response.status_code != 200:", 'if False:'),
    ('absence', 'if response.status_code == 404:\n                return False', 'if response.status_code == 404:\n                return True'),
    ('encoding', "if response.headers.get('Content-Encoding', 'identity').lower() != 'identity':", 'if False:'),
    ('redirect', 'allow_redirects=False', 'allow_redirects=True'),
    ('stream', 'stream=True', 'stream=False'),
]
variants = [('harmless', original+'\n# Harmless formatting control.\n')]
for name,before,after in mutations:
    assert original.count(before)==1,name
    variants.append((name,original.replace(before,after)))
variants.append(('restored',original))
cases=[]
try:
    for name,content in variants:
        source.write_text(content)
        result=subprocess.run([sys.executable,'-B','workers/aequilibrae_worker/test_model_storage_readback.py'],cwd=ROOT,capture_output=True,text=True,timeout=30)
        detail=result.stdout+result.stderr
        if name in ('harmless','restored'): assert result.returncode==0,detail
        else: assert result.returncode!=0 and 'AssertionError' in detail,detail
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally: source.write_text(original)
report={'source_sha256':hashlib.sha256(original.encode()).hexdigest(),'cases':cases,
        'limits':'Bounded raw read tests and a loopback HTTP server. No native Storage, resumable upload, publication or scientific acceptance.'}
Path(__file__).with_name('storage-readback-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
