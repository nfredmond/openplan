"""Copy sealed v1 inputs into a new root; snapshot old files, never recapture data."""
import hashlib
import json
import os
from pathlib import Path
import shutil

PUBLIC=Path(__file__).resolve().parent
OLD_PUBLIC=PUBLIC.parent/'2026-10-15-current-project-preview-app-binding'
OLD=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
ROOT=Path(str(OLD)+'-v2')
FROZEN=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OBS=Path('/home/nathaniel/.local/state/openplan/rest-recovery-parent-operation-20261015-01')

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def inventory(root):
    out={'.':{'mode':root.stat().st_mode & 0o777,'kind':'directory'}}
    for p in sorted(root.rglob('*')):
        rel=str(p.relative_to(root));mode=p.lstat().st_mode & 0o777
        if p.is_symlink():out[rel]={'link':os.readlink(p),'mode':mode}
        elif p.is_file():out[rel]={'sha256':sha(p),'mode':mode}
        elif p.is_dir():out[rel]={'mode':mode,'kind':'directory'}
        else:raise AssertionError('unsupported old file kind')
    return out

def write(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
    path.chmod(0o600)

if __name__=='__main__':
    os.umask(0o077)
    assert not (OLD/'candidate').exists() and not list((OLD/'execution').iterdir())
    snapshots={str(p):inventory(p) for p in [OLD,OLD_PUBLIC,FROZEN,OBS]}
    write(ROOT/'old-roots-before-private.json',snapshots)
    for name in ['app-env-private.json','app-v1.env','migrations.json','dependency-binding.json','recovery-active-binding.json']:
        shutil.copyfile(OLD/name,ROOT/name);(ROOT/name).chmod(0o600)
    for name in ['app_binding_v1.py','attest_start_v1.py']:
        shutil.copyfile(PUBLIC/'templates'/name,ROOT/name);(ROOT/name).chmod(0o600)
    binding=json.loads((OLD/'binding-private.json').read_bytes())
    binding['files']={name:sha(ROOT/name) for name in binding['files']}
    write(ROOT/'binding-private.json',binding)
    assert all(inventory(Path(p))==value for p,value in snapshots.items())
    write(ROOT/'preparation-private.json',{'oldRootsUnchanged':True,'oldRootEntries':{p:len(v) for p,v in snapshots.items()},
        'copiedInputs':{name:sha(ROOT/name) for name in binding['files']},'bindingSha256':sha(ROOT/'binding-private.json'),
        'candidateExists':False,'executionFiles':[]})
    print('Prepared v2; old bytes, links and modes match. No runtime operation.')
