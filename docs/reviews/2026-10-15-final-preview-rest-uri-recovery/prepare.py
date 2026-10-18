"""Install new versioned files and capture read-only creation-time identities once."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'
PUBLIC = Path(__file__).resolve().parent
NAMES = ['rest_uri_recovery_01_launcher.py', 'rest_uri_recovery_01_policy.py', 'rest_uri_recovery_01_controller.py']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def put(path, data):
    with path.open('xb') as stream:
        stream.write(data)


def write(path, value):
    put(path, (json.dumps(value, indent=2) + '\n').encode())


def main():
    os.umask(0o077)
    for name in NAMES:
        put(ROOT / name, (PUBLIC / 'templates' / name).read_bytes())
    original = json.loads((ROOT / 'envs-private.json').read_text())
    active = json.loads(json.dumps(original))
    old = original['rest']['PGRST_DB_URI']
    assert old.count('options=-c+search_path%3Dpublic%2Cextensions') == 1
    new = old.replace('options=-c+search_path%3Dpublic%2Cextensions', 'options=-c%20search_path%3Dpublic%2Cextensions')
    active['rest']['PGRST_DB_URI'] = new
    write(PRIVATE / 'envs-v1-private.json', active)
    original_env = (ROOT / 'rest-private.env').read_bytes()
    assert original_env.count(old.encode()) == 1
    put(PRIVATE / 'rest-v1-private.env', original_env.replace(old.encode(), new.encode()))
    receipts = json.loads((ROOT / 'service-receipts-private.json').read_text())
    for kind, receipt in receipts.items():
        result = subprocess.run(['docker', 'inspect', receipt['id']], capture_output=True, timeout=15)
        if result.returncode:
            raise RuntimeError('read-only-inspect-failed')
        info = json.loads(result.stdout)[0]
        assert info['Id'] == receipt['id'] and info['State']['Running'] is True
        name = 'old-rest-inspect-private.json' if kind == 'rest' else kind + '-inspect-private.json'
        write(PRIVATE / name, info)
    original_files = ['template-binding.json', 'private-bindings.json', 'envs-private.json',
                      'rest-private.env', 'service-receipts-private.json', 'rest-receipt-private.json',
                      'target-identity.json', 'clone-ready.json', 'dump-result.json', 'app-env-binding.json']
    new_files = ['envs-v1-private.json', 'rest-v1-private.env', 'old-rest-inspect-private.json',
                 'auth-inspect-private.json', 'storage-inspect-private.json', 'gateway-inspect-private.json']
    inputs = {name: sha(ROOT / name) for name in original_files}
    inputs.update({'rest-uri-recovery-01/' + name: sha(PRIVATE / name) for name in new_files})
    write(PRIVATE / 'input-binding-v1.json', inputs)
    templates = {name: sha(ROOT / name) for name in NAMES}
    write(PRIVATE / 'template-binding-v1.json', templates)
    write(PUBLIC / 'manifest.json', {'base': '47a51fa9c7ced49d57216417a7dd9b34140c3296',
        'appHead': '06a108010ab39aa42eed4c2bcda3e1371b8aa813', 'templates': templates,
        'privateInputManifestSha256': sha(PRIVATE / 'input-binding-v1.json'),
        'templateManifestSha256': sha(PRIVATE / 'template-binding-v1.json'),
        'originalFiles': {name: inputs[name] for name in original_files},
        'newInputHashes': {name: inputs['rest-uri-recovery-01/' + name] for name in new_files},
        'uriChange': 'REST options=-c+search_path%3Dpublic%2Cextensions to options=-c%20search_path%3Dpublic%2Cextensions',
        'execution': 'Prepared only. No replacement, actual REST readiness, build or start.'})
    print(json.dumps({'installedTemplates': NAMES, 'environmentDifference': 'rest.PGRST_DB_URI only', 'readOnlyContainerInspections': 4}))


if __name__ == '__main__':
    main()
