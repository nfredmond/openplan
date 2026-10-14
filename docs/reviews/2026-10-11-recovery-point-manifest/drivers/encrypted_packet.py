"""Encrypt and restore a sealed copy of the accepted point plus its five-root set."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import subprocess
import sys
import time

OUT = Path(__file__).parent
BASE = OUT.parents[1]
REPO = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
SOURCE = BASE / 'managed-stage-point-20261011-01/source-seed-03'
BUNDLE = SOURCE / 'point-private'
WORKER_SET = BASE / 'worker-root-set-20261011/native-01/set-private'
RESTIC = BASE / 'worker-backup-tool-20261011/restic'
RESTIC_SHA = '20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def directory_modes(path):
    """Read retained original directory modes after the existing file census rejects aliases."""
    return {'.': stat.S_IMODE(path.stat().st_mode),
            **{item.relative_to(path).as_posix(): stat.S_IMODE(item.stat().st_mode)
               for item in path.rglob('*') if item.is_dir()}}


def main():
    os.umask(0o077)
    started = time.monotonic()
    helper = BASE / 'probe_worker_file_backup.py'
    root_path = REPO / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py'
    operator = REPO / 'openplan/scripts/ops/recovery_point_manifest.py'
    files = load('packet_files', helper)
    root = load('packet_roots', root_path)
    dependencies = [Path(__file__), helper, root_path, operator,
                    operator.with_name('worker_root_set_snapshot.py'),
                    operator.with_name('worker_root_snapshot.py'), operator.with_name('worker_journal_snapshot.py'), RESTIC]
    binding = {str(path): files.digest(path) for path in dependencies}
    if files.digest(RESTIC) != RESTIC_SHA:
        raise ValueError('Verified Restic binary changed')
    (OUT / 'pre-execution-source-private.json').write_text(json.dumps(binding, indent=2) + '\n')
    archived = OUT / 'executed-source-private'
    archived.mkdir(mode=0o700)
    for index, path in enumerate(dependencies[:-1]):
        (archived / (str(index) + '-' + path.name)).write_bytes(path.read_bytes())
    expected = json.loads((SOURCE / 'point-file-inventory-private.json').read_text())
    files.equal(expected, files.inventory(BUNDLE))
    observation_controls = files.controls(expected)
    # The previously accepted point protects backend objects through its private
    # outer root. Preserve its original modes without weakening the new strict
    # packet check or altering that accepted source.
    root.privacy.private_path(BUNDLE, directory=True)
    source_directories = directory_modes(BUNDLE)
    worker_before = root.inventory(WORKER_SET)
    point = OUT / 'packet-private'
    shutil.copytree(BUNDLE, point)
    files.equal(expected, files.inventory(point))
    root.equal_root(source_directories, directory_modes(point))
    normalization = []
    for item in [point, *point.rglob('*')]:
        original_mode = stat.S_IMODE(item.stat().st_mode)
        private_mode = original_mode & 0o700
        if original_mode != private_mode:
            normalization.append({'path': item.relative_to(point).as_posix(),
                                  'originalMode': original_mode, 'packetMode': private_mode})
            item.chmod(private_mode)
    normalized_expected = {name: {**row, 'mode': row['mode'] & 0o700} for name, row in expected.items()}
    files.equal(normalized_expected, files.inventory(point))
    root.equal_root({name: mode & 0o700 for name, mode in source_directories.items()}, directory_modes(point))
    # Exact original file/directory metadata travels privately with the packet.
    (point / 'configuration-private/original-point-modes-private.json').write_text(json.dumps(
        {'files': expected, 'directories': source_directories, 'privatePacketNormalization': normalization}, indent=2) + '\n')
    shutil.copytree(WORKER_SET, point / 'worker-root-set')
    root.equal_root(worker_before, root.inventory(point / 'worker-root-set'))
    artifacts = {'databaseArchive': {'kind': 'file', 'path': 'postgres.dump'},
                 'storage': {'kind': 'directory', 'path': 'storage-objects'},
                 'clusterRoles': {'kind': 'file', 'path': 'configuration-private/roles-private.sql'},
                 'databaseRootKey': {'kind': 'file', 'path': 'configuration-private/pgsodium-root-private.key'},
                 'configuration': {'kind': 'directory', 'path': 'configuration-private'},
                 'workerRootSet': {'kind': 'directory', 'path': 'worker-root-set'}}
    (point / 'point-inventory.json').write_text(json.dumps({'format': 'openplan-recovery-packet-inventory-v1',
        'sourceSnapshotId': '679c4c31d435042f1712c8f8b43e1e05e2baf700aa39c027a9f86b911de5e3c6',
        'scope': 'Copies of previously retained artifacts, not a new live cut',
        'originalModeMetadata': 'configuration-private/original-point-modes-private.json',
        'artifacts': artifacts}, indent=4) + '\n')
    commands = []

    def command(args, label, expected_exit=0, expected_message=None, timeout=300):
        result = subprocess.run(args, cwd=REPO / 'openplan', capture_output=True, timeout=timeout,
                                env={**{key: value for key, value in os.environ.items() if not key.startswith('RESTIC_')},
                                     'GOMAXPROCS': '1', 'GOMEMLIMIT': '128MiB'})
        (OUT / (label + '-private.log')).write_bytes(result.stdout + result.stderr)
        if result.returncode != expected_exit:
            raise AssertionError(label + ': command outcome differs')
        if expected_message and expected_message.encode() not in result.stdout + result.stderr:
            raise AssertionError(label + ': expected refusal differs')
        commands.append({'label': label, 'exitCode': result.returncode})
        return result.stdout

    def verify(path, label, expected_exit=0):
        return command([sys.executable, '-B', str(operator), '--point', str(path), '--verify', '--timeout', '120'],
                       label, expected_exit, 'ValueError' if expected_exit else None, timeout=150)

    summary = json.loads(command([sys.executable, '-B', str(operator), '--point', str(point), '--seal',
                                  '--writers-quiesced', '--timeout', '120'], 'seal', timeout=150))
    verify(point, 'verify-sealed-packet')
    packet_before = root.inventory(point)
    (OUT / 'packet-before-private.json').write_text(json.dumps(packet_before, indent=2) + '\n')
    password = OUT / 'password-private'
    password.write_text(secrets.token_urlsafe(48) + '\n')
    password.chmod(0o600)
    repository = OUT / 'repository-private'

    def restic(args, label, expected_exit=0, key=password, expected_message=None):
        return command([str(RESTIC), '--no-cache', '--repo', str(repository), '--password-file', str(key), *args],
                       label, expected_exit, expected_message)

    restic(['init', '--repository-version', '2'], 'repository-init')
    raw = restic(['backup', '--json', str(point)], 'encrypted-packet-backup')
    records = [json.loads(line) for line in raw.decode().splitlines() if line.startswith('{')]
    snapshot = next(row['snapshot_id'] for row in records if row.get('message_type') == 'summary')
    restic(['check', '--read-data'], 'complete-encrypted-read-check')
    target = OUT / 'restored-private'
    restic(['restore', snapshot, '--target', str(target), '--verify'], 'encrypted-packet-restore')
    restored = target / point.relative_to('/')
    root.equal_root(packet_before, root.inventory(restored))
    verify(restored, 'verify-restored-packet')
    journals = [relative for relative, row in packet_before.items() if row['kind'] == 'file'
                and Path(relative).name == 'model-commands.sqlite3']
    for relative in journals:
        root.equal_journal(root.sqlite_image(point / relative), root.sqlite_image(restored / relative))
    wrong = OUT / 'wrong-password-private'
    wrong.write_text(secrets.token_urlsafe(48) + '\n')
    wrong.chmod(0o600)
    restic(['snapshots', '--json'], 'wrong-password-refused', expected_exit=12, key=wrong,
           expected_message='wrong password')
    receipt = restored / 'recovery-point.json'
    held = OUT / 'held-receipt-private'
    try:
        receipt.rename(held)
        command([sys.executable, '-B', str(operator), '--point', str(restored), '--verify'],
                'missing-receipt-refused', expected_exit=1, expected_message='FileNotFoundError')
    finally:
        held.rename(receipt)
    archive = next(restored.rglob('archive.zip'))
    with archive.open('rb') as stream:
        original = stream.read(1)
    try:
        with archive.open('r+b') as stream:
            stream.write(bytes([original[0] ^ 255]));stream.flush();os.fsync(stream.fileno())
        verify(restored, 'changed-restored-archive-refused', expected_exit=1)
    finally:
        with archive.open('r+b') as stream:
            stream.write(original);stream.flush();os.fsync(stream.fileno())
    verify(restored, 'restored-after-controls')
    root.equal_root(packet_before, root.inventory(restored))
    root.equal_root(packet_before, root.inventory(point))
    root.equal_root(source_directories, directory_modes(BUNDLE))
    root.equal_root(worker_before, root.inventory(WORKER_SET))
    files.equal(expected, files.inventory(BUNDLE))
    files.equal(binding, {str(path): files.digest(path) for path in dependencies})
    result = {'state': 'passed-encrypted-retained-packet-transport', 'snapshotId': snapshot,
              'packetFiles': sum(row['kind'] == 'file' for row in packet_before.values()),
              'packetDirectories': sum(row['kind'] == 'directory' for row in packet_before.values()),
              'packetBytes': sum(row.get('bytes', 0) for row in packet_before.values()),
              'originalPointFiles': len(expected), 'sourcePointAndWorkerSetUnchanged': True,
              'allPacketPathsModesAndBytesRestored': True, 'nativeJournalsCompared': len(journals),
              'allJournalSchemasAndRowsEqual': True, 'immutablePacketUnchanged': True,
              'allDependenciesUnchanged': True, 'observationControls': observation_controls,
              'sourceFileModesAndDirectoryModesUnchanged': True,
              'originalModeMetadataRetained': True, 'privateModeNormalizationCount': len(normalization),
              'privateModeNormalizationFileCount': sum(name['path'] in expected for name in normalization),
              'sealSummary': summary, 'commands': commands, 'wallSeconds': round(time.monotonic() - started, 3),
              'limits': 'Offline packaging/transport of a previously accepted full point plus five known roots. No new live database/Storage cut, writer fence, installation-wide discovery, database restart/native restore repeat, worker callback, physical-host independence, browser, agency or scientific acceptance. Same host and disk.'}
    (OUT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ('state', 'packetFiles', 'packetBytes', 'nativeJournalsCompared', 'wallSeconds')}))


if __name__ == '__main__':
    main()
