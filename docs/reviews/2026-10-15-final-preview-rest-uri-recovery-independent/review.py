"""Independent, bounded review. Frozen packet reads; new private output only."""
from collections import Counter
from contextlib import ExitStack
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OUT = Path('/home/nathaniel/.local/state/openplan/rest-uri-recovery-independent-20261015')
IMPL = HERE.parent / '2026-10-15-final-preview-rest-uri-recovery'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def put(name, value):
    if (OUT / name).exists():
        assert json.loads((OUT / name).read_text()) == value
        return
    with (OUT / name).open('x') as stream:
        json.dump(value, stream, indent=2)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def blocked(*args, **kwargs):
    raise AssertionError('unexpected-external-command-or-socket')


def inventory():
    values = {}
    for directory, dirs, files in os.walk(ROOT, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                values[str(path.relative_to(ROOT))] = {'mode': path.lstat().st_mode, 'link': os.readlink(path)}
            elif path.is_file():
                values[str(path.relative_to(ROOT))] = {'mode': path.stat().st_mode, 'sha256': digest(path)}
    return values


def bindings():
    sys.path.insert(0, str(ROOT))
    import rest_uri_recovery_01_launcher as l
    manifest = json.loads((IMPL / 'manifest.json').read_text())
    for name, expected in manifest['templates'].items():
        assert digest(ROOT / name) == digest(IMPL / 'templates' / name) == expected
        assert (ROOT / name).stat().st_mode & 0o777 == 0o600
    r = ROOT / 'rest-uri-recovery-01'
    assert digest(r / 'input-binding-v1.json') == l.INPUT_MANIFEST_SHA256 == manifest['privateInputManifestSha256']
    assert digest(r / 'template-binding-v1.json') == manifest['templateManifestSha256']
    for name, expected in json.loads((r / 'input-binding-v1.json').read_text()).items():
        assert digest(ROOT / name) == expected
    for name, expected in manifest['originalFiles'].items():
        assert digest(ROOT / name) == expected
    for name, expected in manifest['newInputHashes'].items():
        assert digest(r / name) == expected
    with patch.object(l.subprocess, 'run', blocked), patch.object(l.socket, 'socket', blocked):
        l.pinned_files()
    original = l.read('envs-private.json')
    active = l.read('rest-uri-recovery-01/envs-v1-private.json')
    changes = [(kind, key) for kind in original for key in original[kind] if original[kind][key] != active[kind][key]]
    assert changes == [('rest', 'PGRST_DB_URI')]
    before = (ROOT / 'rest-private.env').read_bytes()
    after = (r / 'rest-v1-private.env').read_bytes()
    assert after == before.replace(original['rest']['PGRST_DB_URI'].encode(), active['rest']['PGRST_DB_URI'].encode())
    parsed = dict(line.split('=', 1) for line in after.decode().splitlines())
    assert parsed == active['rest']
    dep = ROOT / 'candidate/openplan/node_modules'
    put('bindings.json', {'templates': manifest['templates'], 'inputManifest': l.INPUT_MANIFEST_SHA256,
                         'pinnedConsumer': 'accepted', 'changedValues': changes, 'envFileEqualsJson': True,
                         'dependencyLink': os.readlink(dep) if dep.is_symlink() else None,
                         'buildIdExists': (ROOT / 'candidate/openplan/.next/BUILD_ID').exists()})


def replay():
    copied = OUT / 'supplied-source-copy'
    shutil.copytree(IMPL, copied)
    module = load('independent_supplied_controls', copied / 'verify_controls.py')
    module.TRIAL = OUT / 'supplied-controls'
    module.main()
    result = json.loads((module.TRIAL / 'result-private.json').read_text())
    first = next(i for i, row in enumerate(result['controls']) if i and row['control'] == 'pinned-baseline')
    put('replay-summary.json', {
        'baselineCount': first, 'baselineOutcomes': dict(Counter(x['outcome'] for x in result['controls'][:first])),
        'allObservations': len(result['controls']), 'mutations': result['mutations'],
        'historicalCount': len(result['historical']['controls']['controls']),
        'historicalOutcomes': dict(Counter(x['outcome'] for x in result['historical']['controls']['controls'])),
        'historicalMutations': result['historical']['mutations'], 'templateHashes': result['templateHashes']})


def inspect_live():
    sys.path.insert(0, str(ROOT))
    import rest_uri_recovery_01_launcher as l
    import rest_uri_recovery_01_controller as c
    rows = {}
    for kind, receipt in l.read('service-receipts-private.json').items():
        result = subprocess.run(['docker', 'inspect', receipt['id']], capture_output=True, timeout=15)
        assert result.returncode == 0
        actual = json.loads(result.stdout)[0]
        baseline = l.read('rest-uri-recovery-01/' + ('old-rest' if kind == 'rest' else kind) + '-inspect-private.json')
        assert c.projection(actual) == c.projection(baseline)
        assert actual['State']['Running'] is True
        assert actual['State']['StartedAt'] == baseline['State']['StartedAt']
        assert actual['RestartCount'] == baseline['RestartCount'] == 0
        put('live-' + kind + '-private.json', actual)
        rows[kind] = {'exactId': receipt['id'], 'creationProjectionUnchanged': True,
                      'sameStartedAt': True, 'zeroRestarts': True}
    put('live-summary.json', rows)


def native():
    # Copy the supplied replay. Only its output directory changes.
    source = OUT / 'native-source-copy-02.py'
    shutil.copyfile(IMPL / 'native_replay.py', source)
    module = load('independent_native_replay', source)
    module.PRIVATE = OUT / 'native-02'
    module.PRIVATE.mkdir(mode=0o700)
    shutil.copyfile(ROOT / 'rest-uri-recovery-01/envs-v1-private.json', module.PRIVATE / 'envs-v1-private.json')
    module.main()


def config_parity():
    recovery = ROOT / 'rest-uri-recovery-01'
    old = json.loads((recovery / 'old-rest-inspect-private.json').read_text())
    image = json.loads((recovery / 'rest-image-inspect-private.json').read_text())
    fields = ['User', 'WorkingDir', 'Entrypoint', 'Cmd', 'Healthcheck', 'StopSignal', 'Volumes', 'ExposedPorts']
    mismatches = {k: {'old': old['Config'].get(k), 'image': image['Config'].get(k)} for k in fields if old['Config'].get(k) != image['Config'].get(k)}
    put('config-parity-normalizations-03.json', mismatches)
    assert {k: old['Config'].get(k) or None for k in fields} == {k: image['Config'].get(k) or None for k in fields}
    host = old['HostConfig']
    assert host['RestartPolicy'] == {'Name': 'no', 'MaximumRetryCount': 0}
    assert host['AutoRemove'] is False and host['Privileged'] is False
    assert host['ReadonlyRootfs'] is False and host['PortBindings'] == {}
    assert host['Binds'] is None and host['CapAdd'] is None and host['CapDrop'] is None
    put('config-parity-empty-host-values.json', {k: host[k] for k in ['SecurityOpt', 'Dns', 'DnsOptions', 'DnsSearch']})
    assert all(not host[k] for k in ['SecurityOpt', 'Dns', 'DnsOptions', 'DnsSearch'])
    assert old['Mounts'] == []
    env = json.loads((ROOT / 'envs-private.json').read_text())
    fixed = json.loads((recovery / 'envs-v1-private.json').read_text())
    assert {k: v for k, v in env.items() if k != 'rest'} == {k: v for k, v in fixed.items() if k != 'rest'}
    plan = json.loads((ROOT / 'plan-private.json').read_text())
    kong = json.loads((ROOT / 'kong-private.json').read_text())
    service = next(x for x in kong['services'] if x['name'] == 'rest')
    assert service['url'] == 'http://' + plan['names']['rest'] + ':3000/'
    put('config-parity.json', {'imageCreationFieldsMatch': fields, 'oldRestHasNoMountsOrPublication': True,
                              'oldRestartPolicy': 'no', 'otherEnvironmentMapsUnchanged': True,
                              'kongUsesOriginalRestName': True, 'storageDriverEnvironmentUnchanged': True})


def host_boundary():
    path = ROOT / 'candidate/openplan/node_modules'
    assert path.is_symlink()
    resolved = path.resolve()
    # Metadata only. Do not attempt a write to any dependency path.
    writable = os.access(resolved, os.W_OK)
    readonly = bool(os.statvfs(resolved).f_flag & os.ST_RDONLY)
    assert writable and not readonly
    put('host-dependency-boundary.json', {'symlinkTarget': str(resolved), 'directoryWritableForUser': writable,
                                        'mountReadOnly': readonly, 'writeAttempted': False})


if __name__ == '__main__':
    os.umask(0o077)
    command = sys.argv[1]
    if command == 'inventory-before': put('packet-before.json', inventory())
    elif command == 'inventory-after':
        before = json.loads((OUT / 'packet-before.json').read_text())
        after = inventory()
        put('packet-after.json', after)
        put('preservation.json', {'beforeCount': len(before), 'afterCount': len(after),
            'changed': [k for k in before if k in after and before[k] != after[k]],
            'removed': sorted(set(before) - set(after)), 'added': sorted(set(after) - set(before))})
        assert before == after
    elif command == 'bindings': bindings()
    elif command == 'replay': replay()
    elif command == 'inspect-live': inspect_live()
    elif command == 'native': native()
    elif command == 'config-parity': config_parity()
    elif command == 'host-boundary': host_boundary()
    else: raise ValueError('unknown-review-command')
