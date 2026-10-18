"""One-shot packet preparation only. Never calls a database, service or npm."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

os.umask(0o077)
PUBLIC = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
OLD = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
REPO = PUBLIC.parents[2]
DEPS = Path('/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan')
HEAD = '67828c17c4c270529468eef1edd144e4a52b693a'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def write(path, value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
    path.chmod(0o600)


def inventory():
    out = {}
    for f in sorted(OLD.rglob('*')):
        rel=str(f.relative_to(OLD))
        if f.is_symlink():out[rel]={'link':os.readlink(f),'mode':f.lstat().st_mode & 0o777}
        elif f.is_file():out[rel]={'sha256':sha(f),'mode':f.stat().st_mode & 0o777}
    return out

before=inventory()
write(ROOT/'frozen-before-private.json',before)
(ROOT/'execution').mkdir(mode=0o700)
shutil.copyfile(PUBLIC/'templates/app_binding_v1.py',ROOT/'app_binding_v1.py')
(ROOT/'app_binding_v1.py').chmod(0o600)
values=json.loads((OLD/'app-env-private.json').read_bytes())
assert values['OPENPLAN_COMMIT_SHA']=='06a108010ab39aa42eed4c2bcda3e1371b8aa813'
values['OPENPLAN_COMMIT_SHA']=HEAD
write(ROOT/'app-env-private.json',values)
with (ROOT/'app-v1.env').open('x') as f:
    f.write(''.join(key+'='+json.dumps(value)+'\n' for key,value in values.items()))
(ROOT/'app-v1.env').chmod(0o600)
expected=json.loads((OLD/'candidate-migrations.json').read_bytes())
actual={str(f.relative_to(REPO)):sha(f) for f in sorted((REPO/'openplan/supabase/migrations').glob('*.sql'))}
assert expected==actual and len(actual)==419
write(ROOT/'migrations.json',actual)
a=json.loads((REPO/'openplan/package-lock.json').read_bytes())['packages']
b=json.loads((DEPS/'package-lock.json').read_bytes())['packages']
assert len(a)==1144 and {k:v for k,v in a.items() if k}=={k:v for k,v in b.items() if k}
installed=json.loads((DEPS/'node_modules/.package-lock.json').read_bytes())['packages']
assert all(a[k]==v for k,v in installed.items())
metadata={}
for k,v in sorted(installed.items()):
    f=DEPS/k/'package.json'
    assert json.loads(f.read_bytes())['version']==v['version']
    metadata[k]=sha(f)
binding={'path':str(DEPS/'node_modules'),'installedEntries':len(installed),'installedManifestDigest':digest(metadata),
         'hashes':{name:sha(path) for name,path in {
             'candidateLock':REPO/'openplan/package-lock.json','candidateManifest':REPO/'openplan/package.json',
             'donorLock':DEPS/'package-lock.json','installedLock':DEPS/'node_modules/.package-lock.json'}.items()}}
write(ROOT/'dependency-binding.json',binding)
write(ROOT/'binding-private.json',{'schema':1,'appHead':HEAD,'helperHead':'06a108010ab39aa42eed4c2bcda3e1371b8aa813',
    'producer':'d71e0aa7aa1b2c3c945ee87a54ea49d6a5772378',
    'sourceAnchor':'82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547',
    'files':{name:sha(ROOT/name) for name in ['app_binding_v1.py','app-env-private.json','app-v1.env','migrations.json','dependency-binding.json']}})
after=inventory()
assert before==after
write(ROOT/'preparation-private.json',{'appHead':HEAD,'frozenFiles':len(before),'frozenUnchanged':before==after,
    'frozenInventoryDigest':digest(before),'privateFiles':{str(f.relative_to(ROOT)):sha(f) for f in ROOT.iterdir() if f.is_file()},
    'candidateExists':(ROOT/'candidate').exists(),'activeExists':(OLD/'rest-uri-recovery-01/active-service-receipts-private.json').exists(),
    'migrationCount':len(actual),'installedEntries':len(installed)})
print('Prepared own private packet. Frozen inventory unchanged. No runtime operation.')
