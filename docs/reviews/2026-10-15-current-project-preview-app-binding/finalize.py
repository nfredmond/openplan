"""Bind root-completed recovery evidence. Never reacquire or edit old anchors."""
import hashlib
import json
import os
from pathlib import Path
import shutil

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
FROZEN=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OBS=Path('/home/nathaniel/.local/state/openplan/rest-recovery-parent-operation-20261015-01/observations.json')

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
    path.chmod(0o600)

# Retain the pre-readiness packet version, rather than rewriting its evidence.
shutil.copyfile(ROOT/'app_binding_v1.py',ROOT/'app_binding_prepared_01.py')
(ROOT/'app_binding_prepared_01.py').chmod(0o600)
shutil.copyfile(ROOT/'binding-private.json',ROOT/'binding-prepared-01-private.json')
(ROOT/'binding-prepared-01-private.json').chmod(0o600)
for name in ['app_binding_v1.py','attest_start_v1.py']:
    shutil.copyfile(PUBLIC/'templates'/name,ROOT/name);(ROOT/name).chmod(0o600)
active=FROZEN/'rest-uri-recovery-01'
identity=json.loads((active/'replacement-receipt-private.json').read_bytes())['id']
assert identity=='140c68675574a3705fa68aa46543d806d66d1f20739bf63273d6126108d5430d'
write(ROOT/'recovery-active-binding.json',{'producer':'d71e0aa7aa1b2c3c945ee87a54ea49d6a5772378','restId':identity,
    'files':{name:sha(active/name) for name in ['replacement-receipt-private.json','replacement-started-private.json',
        'active-service-receipts-private.json','active-binding-private.json']},'operationObservationSha256':sha(OBS)})
binding=json.loads((ROOT/'binding-private.json').read_bytes())
binding['files']={name:sha(ROOT/name) for name in [*binding['files'],'recovery-active-binding.json','attest_start_v1.py']}
(ROOT/'binding-private.json').write_text(json.dumps(binding,indent=2)+'\n')
write(ROOT/'final-binding-preparation-01.json',{'bindingSha256':sha(ROOT/'binding-private.json'),
    'launcherSha256':sha(ROOT/'app_binding_v1.py'),'attestorSha256':sha(ROOT/'attest_start_v1.py'),
    'activePinSha256':sha(ROOT/'recovery-active-binding.json'),
    'rootOperationObservationSha256':sha(OBS),'readiness':'Parent supplied completion; child pins files without service queries.',
    'candidateExists':(ROOT/'candidate').exists(),'executionFiles':sorted(p.name for p in (ROOT/'execution').iterdir())})
print('Bound root-produced completed receipts. No service, checkout, build or start.')
