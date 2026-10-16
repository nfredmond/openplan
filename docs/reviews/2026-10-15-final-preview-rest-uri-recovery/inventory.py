"""Stream hashes and modes without following packet symlinks."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'


def inventory():
    result = {}
    for directory, dirs, files in os.walk(ROOT, followlinks=False):
        dirs[:] = sorted(d for d in dirs if Path(directory) / d != PRIVATE)
        for name in sorted(dirs + files):
            path = Path(directory) / name
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                continue
            row = {'mode': stat.S_IMODE(info.st_mode)}
            if path.is_symlink():
                row['link'] = os.readlink(path)
            elif path.is_file():
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
                row.update(bytes=info.st_size, sha256=digest.hexdigest())
            else:
                raise ValueError('inventory-special-file')
            result[str(path.relative_to(ROOT))] = row
    return result


if __name__ == '__main__':
    os.umask(0o077)
    current = inventory()
    if sys.argv[1] == 'before':
        with (PRIVATE / 'packet-before-private.json').open('x') as stream:
            json.dump(current, stream, indent=2)
        print(json.dumps({'beforeCount': len(current)}))
    else:
        before = json.loads((PRIVATE / 'packet-before-private.json').read_text())
        delta = dict(initialCount=len(before), finalCount=len(current),
                     changed=[k for k in before if k in current and before[k] != current[k]],
                     removed=sorted(set(before) - set(current)), added=sorted(set(current) - set(before)))
        with (PRIVATE / ('packet-' + sys.argv[1] + '-private.json')).open('x') as stream:
            json.dump({'inventory': current, 'delta': delta}, stream, indent=2)
        print(json.dumps(delta))
