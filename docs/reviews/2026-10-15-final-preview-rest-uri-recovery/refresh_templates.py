"""Refresh only this child's three new files, refusing drift from its last binding."""
import hashlib
import json
import os
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'
NAMES = ['rest_uri_recovery_01_launcher.py', 'rest_uri_recovery_01_policy.py', 'rest_uri_recovery_01_controller.py']


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    os.umask(0o077)
    manifest = json.loads((PUBLIC / 'manifest.json').read_text())
    assert set(manifest['templates']) == set(NAMES)
    for name in NAMES:
        path = ROOT / name
        assert not path.is_symlink() and sha(path) == manifest['templates'][name]
    previous = PRIVATE / ('template-binding-history-' + sha(PRIVATE / 'template-binding-v1.json') + '.json')
    with previous.open('xb') as stream: stream.write((PRIVATE / 'template-binding-v1.json').read_bytes())
    for name in NAMES:
        (ROOT / name).write_bytes((PUBLIC / 'templates' / name).read_bytes())
    binding = {name: sha(ROOT / name) for name in NAMES}
    (PRIVATE / 'template-binding-v1.json').write_text(json.dumps(binding, indent=2) + '\n')
    manifest['templates'] = binding
    manifest['templateManifestSha256'] = sha(PRIVATE / 'template-binding-v1.json')
    (PUBLIC / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'refreshedOnlyChildOwnedNewTemplates': True}))


if __name__ == '__main__': main()
