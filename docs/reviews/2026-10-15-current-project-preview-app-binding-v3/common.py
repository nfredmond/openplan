"""Fixed preparation locations. No application operation runs from this module."""
import hashlib
import json
import os
from pathlib import Path

PUBLIC=Path(__file__).resolve().parent
REPO=PUBLIC.parents[2]
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
V2=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2')
V1=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
FROZEN=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OBS=Path('/home/nathaniel/.local/state/openplan/rest-recovery-parent-operation-20261015-01')
OLD_PUBLIC=PUBLIC.parent/'2026-10-15-current-project-preview-health-contract-fix'
HEAD='21510042e94bcaf80f262205ad156a7bb639e35c'
OLD_HEAD='67828c17c4c270529468eef1edd144e4a52b693a'
UNIT='openplan-current-project-preview-app-21510042e-v3-web.service'


def sha(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):result.update(block)
    return result.hexdigest()


def inventory(root):
    # lstat and readlink preserve symlinks without following dependency donors.
    result={'.':{'kind':'directory','mode':root.lstat().st_mode & 0o777}}
    for directory,dirs,files in os.walk(root,followlinks=False):
        for name in sorted(dirs+files):
            path=Path(directory)/name
            rel=str(path.relative_to(root));mode=path.lstat().st_mode & 0o777
            if path.is_symlink():result[rel]={'link':os.readlink(path),'mode':mode}
            elif path.is_file():result[rel]={'sha256':sha(path),'mode':mode}
            elif path.is_dir():result[rel]={'kind':'directory','mode':mode}
            else:raise AssertionError('unsupported-file-kind')
    return result


def write(path,value):
    with Path(path).open('x') as stream:json.dump(value,stream,indent=2);stream.write('\n')
    Path(path).chmod(0o600)


def read(path):return json.loads(Path(path).read_bytes())
