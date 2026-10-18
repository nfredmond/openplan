"""Fixed review locations. No operational entry point."""
import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / '2026-10-15-current-project-preview-health-contract-fix'
REPO = HERE.parents[2]
OUT = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-round2-20261015')
V2 = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2')
OLD = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
FROZEN = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OBS = Path('/home/nathaniel/.local/state/openplan/rest-recovery-parent-operation-20261015-01')

def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def write(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')
    Path(path).chmod(0o600)

def inventory(root):
    result = {'.': {'kind': 'directory', 'mode': root.stat().st_mode & 0o777}}
    for p in sorted(root.rglob('*')):
        rel = str(p.relative_to(root))
        mode = p.lstat().st_mode & 0o777
        if p.is_symlink():
            result[rel] = {'link': os.readlink(p), 'mode': mode}
        elif p.is_file():
            result[rel] = {'sha256': sha(p), 'mode': mode}
        elif p.is_dir():
            result[rel] = {'kind': 'directory', 'mode': mode}
        else:
            raise AssertionError('unexpected-file-kind')
    return result
