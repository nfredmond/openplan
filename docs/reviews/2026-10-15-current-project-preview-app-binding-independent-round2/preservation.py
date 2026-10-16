"""Snapshot existing files without following dependency symlinks."""
import json
import os
import sys
from common import OUT, V2, OLD, FROZEN, OBS, PUBLIC, inventory, write

os.umask(0o077)
roots = [V2, OLD, FROZEN, OBS, PUBLIC, PUBLIC.parent/'2026-10-15-current-project-preview-app-binding']
if sys.argv[1] == 'before':
    write(OUT/'preservation-before-private.json', {str(p): inventory(p) for p in roots})
else:
    before = json.loads((OUT/'preservation-before-private.json').read_bytes())
    after = {str(p): inventory(p) for p in roots}
    write(OUT/'preservation-after-private.json', after)
    assert after == before, 'existing-packet-changed'
    historical = json.loads((OLD/'frozen-before-private.json').read_bytes())
    assert all(after[str(FROZEN)].get(k) == v for k, v in historical.items()), 'historical-original-changed'
    write(OUT/'preservation-result.json', {
        'roots': {k: {'entries': len(v), 'filesAndLinks': sum('sha256' in x or 'link' in x for x in v.values())} for k, v in before.items()},
        'unchanged': True, 'historicalOriginalEntries': len(historical),
        'blindCategory': 'File bytes, modes and symlink text. No logical database or Storage comparison. Symlinks are not followed.'})
print(json.dumps({'stage': sys.argv[1], 'roots': len(roots)}))
