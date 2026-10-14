"""Join declared configuration inventory to five historical fixture roots offline."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

OUT = Path(__file__).parent
BASE = OUT.parents[1]
REPO = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
SOURCE = BASE / 'managed-stage-point-20261011-01/source-seed-03'
BUNDLE = SOURCE / 'point-private'
ROOTS = {'managed-stage': 'managed-stage-worker-private', 'legacy-model': 'model-worker-private',
         'transit-configured': 'gtfs-configured', 'transit-replacement': 'gtfs-replacement',
         'transit-capacity': 'gtfs-capacity'}


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    os.umask(0o077)
    started = time.monotonic()
    helper = BASE / 'probe_worker_file_backup.py'
    root_path = REPO / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py'
    operator = REPO / 'openplan/scripts/ops/worker_root_set_snapshot.py'
    files = load('set_files', helper)
    root = load('set_roots', root_path)
    dependencies = [Path(__file__), helper, root_path, operator,
                    operator.with_name('worker_root_snapshot.py'), operator.with_name('worker_journal_snapshot.py'),
                    operator.with_name('installation_worker_inventory.py'), REPO / 'openplan/package.json']
    sys.path.insert(0, str(operator.parent))
    import installation_worker_inventory as installed
    dependencies += [REPO / relative for relative, _ in installed.FAMILIES.values()]
    dependencies += [REPO / relative for relative in installed.LAUNCHERS.values()]
    binding = {str(path): files.digest(path) for path in dependencies}
    (OUT / 'pre-execution-source-private.json').write_text(json.dumps(binding, indent=2) + '\n')
    archive = OUT / 'executed-source-private'
    archive.mkdir(mode=0o700)
    for index, path in enumerate(dependencies):
        (archive / (str(index) + '-' + path.name)).write_bytes(path.read_bytes())
    expected = json.loads((SOURCE / 'point-file-inventory-private.json').read_text())
    files.equal(expected, files.inventory(BUNDLE))
    observation_controls = files.controls(expected)
    before = {name: root.inventory(BUNDLE / name) for name in ROOTS.values()}
    logical = {name: {path: root.sqlite_image(BUNDLE / name / path)
                     for path, row in rows.items()
                     if row['kind'] == 'file' and Path(path).name == 'model-commands.sqlite3'}
               for name, rows in before.items()}
    profile = {'format': installed.PROFILE_FORMAT, 'installationId': 'historical-synthetic-point',
               'roots': [{'id': key, 'path': str(BUNDLE / name)} for key, name in ROOTS.items()],
               'configuration': [{'id': key, 'path': str(BUNDLE / 'configuration-private' / name)}
                                 for key, name in {'app-env': 'app-runtime-private.env',
                                                  'managed-scope': 'managed-stage-source-scope-private.json',
                                                  'legacy-scope': 'model-worker-source-scope-private.json',
                                                  'root-mapping': 'runtime-root-mapping-private.json'}.items()],
               'workers': {name: {'state': 'unassessed', 'custody': 'unassessed', 'rootIds': [],
                                  'configurationIds': [], 'notes': 'Historical fixture only. Installed-service coverage is unassessed.'}
                           for name in installed.FAMILIES}}
    profile['workers']['aequilibrae'].update(rootIds=['managed-stage', 'legacy-model'],
        configurationIds=['app-env', 'managed-scope', 'legacy-scope'])
    profile['workers']['gtfs-ingestion'].update(rootIds=['transit-configured', 'transit-replacement', 'transit-capacity'],
        configurationIds=['app-env', 'root-mapping'])
    profile_path = OUT / 'operator-profile-private.json'
    original_profile = (json.dumps(profile, indent=3) + '\n').encode()
    profile_path.write_bytes(original_profile)
    profile_path.chmod(0o400)
    inventory_package = OUT / 'inventory-private'
    inventory_operator = operator.with_name('installation_worker_inventory.py')
    inventory_commands = []
    def inventory_cli(label, arguments):
        result = subprocess.run([sys.executable, '-B', str(inventory_operator), *arguments],
                                cwd=REPO / 'openplan', capture_output=True, timeout=150, check=True)
        (OUT / (label + '-private.log')).write_bytes(result.stdout + result.stderr)
        inventory_commands.append({'label': label, 'exitCode': result.returncode,
                                   'summary': json.loads(result.stdout)})
    inventory_cli('inventory-capture', ['--profile', str(profile_path), '--destination', str(inventory_package),
                                      '--writers-quiesced', '--timeout', '120'])
    inventory_cli('inventory-verify', ['--verify', str(inventory_package)])
    files.equal({'profile': {'bytes': len(original_profile), 'sha256': files.digest(profile_path), 'mode': 0o400}},
                {'profile': {'bytes': (inventory_package / 'profile.json').stat().st_size,
                             'sha256': files.digest(inventory_package / 'profile.json'),
                             'mode': (inventory_package / 'profile.json').stat().st_mode & 0o777}})
    expected_configuration = {item['id']: expected[Path(item['path']).relative_to(BUNDLE).as_posix()]
                              for item in profile['configuration']}
    files.equal(expected_configuration, files.inventory(inventory_package / 'configuration'))
    selection = inventory_package / 'inventory.json'
    payload = selection.read_bytes()
    immutable_inventory = root.inventory(inventory_package)
    destination = OUT / 'set-private'
    commands = []

    def cli(path, label, capture=False, expected_exit=0, reason=None):
        args = ['--inventory', str(selection), '--writers-quiesced'] if capture else ['--verify']
        result = subprocess.run([sys.executable, '-B', str(operator), '--destination', str(path),
                                 '--timeout', '120', *args], cwd=REPO / 'openplan',
                                capture_output=True, timeout=150)
        (OUT / (label + '-private.log')).write_bytes(result.stdout + result.stderr)
        if result.returncode != expected_exit:
            raise AssertionError(label + ': unexpected command outcome')
        if reason and reason.encode() not in result.stderr:
            raise AssertionError(label + ': refusal category differs')
        commands.append({'label': label, 'exitCode': result.returncode,
                         'summary': json.loads(result.stdout) if result.returncode == 0 else None})

    cli(destination, 'capture', capture=True)
    cli(destination, 'verify')
    files.equal({'selection': {'bytes': len(payload), 'sha256': files.digest(selection), 'mode': 0o600}},
                {'selection': {'bytes': (destination / 'inventory.json').stat().st_size,
                               'sha256': files.digest(destination / 'inventory.json'),
                               'mode': (destination / 'inventory.json').stat().st_mode & 0o777}})
    records = []
    for key, name in ROOTS.items():
        retained = root.inventory(destination / 'roots' / key / 'root')
        left, right = copy.deepcopy(before[name]), copy.deepcopy(retained)
        for relative, image in logical[name].items():
            for rows in (left, right):
                rows[relative].pop('bytes')
                rows[relative].pop('sha256')
            root.equal_journal(image, root.sqlite_image(destination / 'roots' / key / 'root' / relative))
        root.equal_root(left, right)
        record = json.loads((destination / 'roots' / key / 'snapshot.json').read_text())
        records.append({'id': key, 'files': sum(row['kind'] == 'file' for row in retained.values()),
                        'directories': sum(row['kind'] == 'directory' for row in retained.values()),
                        'bytes': sum(row.get('bytes', 0) for row in retained.values()),
                        'sqliteCopies': len(record['sqliteCopies']),
                        'completeOrdinaryCensusAndAllLogicalRecordsEqual': True})
    immutable_before = root.inventory(destination)
    relocated = OUT / 'relocated-private'
    shutil.copytree(destination, relocated)
    root.equal_root(immutable_before, root.inventory(relocated))
    cli(relocated, 'relocated-verify')
    # Change only the disposable relocated selection; restore bytes in finally.
    retained_selection = relocated / 'inventory.json'
    try:
        retained_selection.chmod(0o600)
        retained_selection.write_bytes(payload + b' ')
        cli(relocated, 'changed-selection-refused', expected_exit=1, reason='ValueError')
    finally:
        retained_selection.write_bytes(payload)
        retained_selection.chmod(0o600)
    # A harmless JSON key-order change preserves a valid manifest; a dropped
    # component binding must fail while component files remain present.
    receipt = relocated / 'snapshot.json'
    original = receipt.read_bytes()
    try:
        record = json.loads(original)
        receipt.write_text(json.dumps(dict(reversed(list(record.items()))), indent=4) + '\n')
        cli(relocated, 'harmless-manifest-order')
        record['roots'].pop()
        receipt.write_text(json.dumps(record) + '\n')
        cli(relocated, 'missing-component-binding-refused', expected_exit=1, reason='ValueError')
    finally:
        receipt.write_bytes(original)
    cli(relocated, 'restored-verify')
    root.equal_root(immutable_before, root.inventory(relocated))
    root.equal_root(immutable_before, root.inventory(destination))
    files.equal(expected, files.inventory(BUNDLE))
    for name in ROOTS.values():
        root.equal_root(before[name], root.inventory(BUNDLE / name))
    root.equal_root(immutable_inventory, root.inventory(inventory_package))
    files.equal(expected_configuration, files.inventory(inventory_package / 'configuration'))
    files.equal(binding, {str(path): files.digest(path) for path in dependencies})
    result = {'state': 'passed-declared-inventory-and-five-historical-roots', 'roots': records,
              'sourcePointFiles': len(expected), 'sourcePointUnchanged': True,
              'exactSelectionBytesAndModeRetained': True, 'relocatedSetVerified': True,
              'immutableSetUnchanged': True, 'allDependenciesUnchanged': True,
              'observationControls': observation_controls, 'commands': commands, 'inventoryCommands': inventory_commands,
              'knownFamiliesAssessed': len(profile['workers']), 'unassessedFamilies': len(profile['workers']),
              'retainedConfigurationFiles': len(expected_configuration),
              'exactProfileConfigurationAndSelectionRetained': True, 'inventoryPackageUnchanged': True,
              'wallSeconds': round(time.monotonic() - started, 3),
              'limits': 'Fifteen operator declarations remain unassessed; four exact historical configuration files and five known retained roots on this host. No live writer fence, installation-wide discovery, new database/Storage cut, encryption, worker continuation, physical host-loss, scientific, browser or agency acceptance. Native source journals are already normalized; populated WAL is tested separately.'}
    (OUT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ('state', 'sourcePointFiles', 'sourcePointUnchanged', 'relocatedSetVerified', 'wallSeconds')}))


if __name__ == '__main__':
    main()
