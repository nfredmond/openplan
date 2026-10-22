"""Read-only image default capture, adding new inputs to the owned manifests."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

PUBLIC = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'


def main():
    os.umask(0o077)
    inputs = json.loads((PRIVATE / 'input-binding-v1.json').read_text())
    receipts = json.loads((ROOT / 'service-receipts-private.json').read_text())
    for kind in receipts:
        source = 'old-rest' if kind == 'rest' else kind
        info = json.loads((PRIVATE / (source + '-inspect-private.json')).read_text())
        result = subprocess.run(['docker', 'image', 'inspect', info['Image']], capture_output=True, timeout=15)
        if result.returncode: raise RuntimeError('image-inspect-failed')
        image = json.loads(result.stdout)[0]
        name = kind + '-image-inspect-private.json'
        with (PRIVATE / name).open('x') as stream: json.dump(image, stream, indent=2)
        inputs['rest-uri-recovery-01/' + name] = hashlib.sha256((PRIVATE / name).read_bytes()).hexdigest()
    (PRIVATE / 'input-binding-v1.json').write_text(json.dumps(inputs, indent=2) + '\n')
    manifest = json.loads((PUBLIC / 'manifest.json').read_text())
    manifest['privateInputManifestSha256'] = hashlib.sha256((PRIVATE / 'input-binding-v1.json').read_bytes()).hexdigest()
    for kind in receipts:
        name = kind + '-image-inspect-private.json'
        manifest['newInputHashes'][name] = inputs['rest-uri-recovery-01/' + name]
    (PUBLIC / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'readOnlyImageInspections': len(receipts)}))


if __name__ == '__main__': main()
