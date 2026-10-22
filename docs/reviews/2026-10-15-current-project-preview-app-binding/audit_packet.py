"""Final read-only input audit and sanitized packet receipts. No live services."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
FROZEN=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def write(path,value):
    with path.open('x') as stream:json.dump(value,stream,indent=2);stream.write('\n')

spec=importlib.util.spec_from_file_location('packet_readonly_audit',ROOT/'app_binding_v1.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
binding=a.bindings();r=a.load_recovery()
# Actual original fixed-path file/configuration consumers only, no acquisition.
values=a.app_values(r);active=r.active_receipts()
assert active['rest']['id']==a.ACTIVE_REST_ID
pin=json.loads((ROOT/'recovery-active-binding.json').read_bytes())
assert {name:sha(a.ACTIVE.parent/name) for name in pin['files']}==pin['files']
assert sha(a.OPERATION_OBSERVATION)==pin['operationObservationSha256']
for name in ['app_binding_v1.py','attest_start_v1.py']:
    assert sha(PUBLIC/'templates'/name)==sha(ROOT/name)
for path in PUBLIC.rglob('*.py'):ast.parse(path.read_bytes(),filename=str(path))
# Preserve every file present before the parent's authorized transition.
before=json.loads((ROOT/'frozen-before-private.json').read_bytes())
changed=[]
for name,expected in before.items():
    path=FROZEN/name
    if 'link' in expected:
        actual={'link':os.readlink(path),'mode':path.lstat().st_mode & 0o777} if path.is_symlink() else None
    else:
        actual={'sha256':sha(path),'mode':path.stat().st_mode & 0o777} if path.is_file() and not path.is_symlink() else None
    if actual!=expected:changed.append(name)
assert not changed,changed
current={str(p.relative_to(FROZEN)) for p in FROZEN.rglob('*') if p.is_file() or p.is_symlink()}
added=sorted(current-set(before))
# Parent may add recovery evidence, but no child may rebind those original files.
assert all(name.startswith('rest-uri-recovery-01/') for name in added),added
write(ROOT/'frozen-final-audit-private.json',{'preexistingFiles':len(before),'changed':changed,
    'parentRecoveryAdditions':added,'doesNotProve':'Logical source/global/Storage preservation; no database queried.'})
assert not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir())
# Known configured secrets and full URIs, including optional credentials.
secrets=[]
for key in ['CENSUS_API_KEY','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','OPENPLAN_INTEGRATION_KEY_SECRET',
            'SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']:
    if key in values and len(values[key])>=8:secrets.append(values[key].encode())
for env in json.loads((FROZEN/'envs-private.json').read_bytes()).values():
    for key,value in env.items():
        if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):
            secrets.append(value.encode())
secrets=list(set(secrets))
aggregate=b'\n'.join(p.read_bytes() for p in PUBLIC.rglob('*') if p.is_file())
def scan(data):return any(value in data for value in secrets)
assert not scan(aggregate) and not scan(aggregate+b'\nHarmless note.\n')
assert all(scan(aggregate+b'\n'+value) for value in secrets)
controls=json.loads((ROOT/'controls-baseline-05.json').read_bytes())
assert controls==json.loads((ROOT/'controls-restored-05.json').read_bytes())
mutations=json.loads((ROOT/'mutations-05.json').read_bytes())
attest=json.loads((ROOT/'attestation-controls-01.json').read_bytes())
boundary=json.loads((ROOT/'boundary-controls-02.json').read_bytes())
small=json.loads((ROOT/'small-guard-controls-01.json').read_bytes())
units=['direction-01','direction-02','direction-03','prepare-01','prepare-02','final-bind-01',
       'controls-01','controls-02','controls-03','controls-04','controls-05','boundary-01','boundary-02',
       'attestation-controls-01','small-guards-01']
execution=[]
for short in units:
    unit='openplan-app-binding-'+short+'.service'
    result=subprocess.run(['/usr/bin/journalctl','--user','-u',unit,'--no-pager','-o','json'],capture_output=True,check=True)
    write(ROOT/('journal-'+short+'-private.json'),[json.loads(line) for line in result.stdout.splitlines()])
    summaries=[json.loads(line).get('MESSAGE','') for line in result.stdout.splitlines()]
    execution.append({'unit':unit,'enforced':{'MemoryMax':'512M','MemorySwapMax':'0','CPUQuota':'50%'},
        'managerMessages':summaries})
write(PUBLIC/'execution.json',execution)
manifest={'schema':1,'appHead':a.APP_HEAD,'helperHead':a.HELPER_HEAD,'recoveryProducer':a.RECOVERY_PRODUCER,
    'sourceAnchor':a.SOURCE_ANCHOR,'privateRoot':str(ROOT),'frozenRoot':str(FROZEN),
    'templates':{name:sha(PUBLIC/'templates'/name) for name in ['app_binding_v1.py','attest_start_v1.py']},
    'bindingSha256':sha(ROOT/'binding-private.json'),'privateInputs':binding['files'],'helperModules':a.HELPERS,
    'activeBinding':pin,'migrationCount':419,'nonRootLockEntries':1143,'installedLockEntries':969,
    'applicationEnvironmentDelta':['OPENPLAN_COMMIT_SHA'],'candidateExists':False,'executionFiles':[]}
write(PUBLIC/'manifest.json',manifest)
evidence={'preparedOnly':True,'appHead':a.APP_HEAD,'frozenPreexistingFiles':len(before),'frozenChanged':0,
    'parentRecoveryAddedFiles':len(added),'consumerControls':controls,'consumerMutations':mutations,
    'attestation':attest,'boundary':boundary,'smallGuards':small,
    'privacy':{'knownSecrets':len(secrets),'harmlessSurvives':True,'allKnownValueInjectionsDetected':True,
        'blindCategory':'Unknown secrets, short shared identifiers, external files and uncommitted future artifacts.'},
    'scriptHashes':{str(p.relative_to(PUBLIC)):sha(p) for p in sorted(PUBLIC.rglob('*.py'))},
    'privateArtifactHashes':{name:sha(ROOT/name) for name in ['controls-baseline-05.json','controls-restored-05.json',
        'mutations-05.json','attestation-controls-01.json','boundary-controls-02.json','small-guard-controls-01.json',
        'verify_controls-tested-04.py','preparation-private.json','final-binding-preparation-01.json','frozen-final-audit-private.json']},
    'headroomObservation':{'freeDisk':shutil.disk_usage(ROOT).free,'availableRAM':int(next(line.split()[1] for line in
        Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024},
    'limits':['No actual application checkout/build/start','No new live HTTP/Docker/SQL acquisition by child',
              'No browser/desktop/390px/console/native/human acceptance','Independent review required before execution',
              'Old 06a full QA does not cover current app','Fixture provenance is not hostile same-user tamper resistance']}
write(PUBLIC/'evidence.json',evidence)
print(json.dumps({'frozenPreexistingFiles':len(before),'unchanged':True,'parentRecoveryAdditions':len(added),
    'privacyKnownValueControls':len(secrets),'candidateExists':False,'executionFiles':0}))
