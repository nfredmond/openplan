"""Retain one declared-quiescent private worker root and verify its package.

This does not discover an installation, stop writers, align database/Storage,
encrypt data, reconcile commands or authorize computation. Failed destinations
remain private and must not be reused. Success requires an exit-zero command.
"""
import argparse
from contextlib import closing
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import stat
import time

import worker_journal_snapshot as journal

MAGIC = b'SQLite format 3\x00'
FORMAT = 'openplan-worker-root-snapshot-v1'


def check_deadline(deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError('Worker-root capture exceeded its deadline')


def entry(path, deadline):
    """Read every private byte; do not follow aliases or accept special files."""
    check_deadline(deadline)
    directory = path.is_dir()
    journal.private_path(path, directory=directory)
    info = path.stat()
    result = {'kind': 'directory' if directory else 'file',
              'mode': stat.S_IMODE(info.st_mode)}
    if not directory:
        digest = hashlib.sha256()
        header = b''
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                check_deadline(deadline)
                if not header:
                    header = chunk[:16]
                digest.update(chunk)
        result.update(sizeBytes=info.st_size, sha256=digest.hexdigest(), sqlite=header == MAGIC)
    return result


def inventory(root, deadline):
    """Include empty directories and relative names as well as file bytes."""
    records = {}
    def visit(path):
        key = '.' if path == root else path.relative_to(root).as_posix()
        records[key] = entry(path, deadline)
        if records[key]['kind'] == 'directory':
            for child in sorted(path.iterdir()):
                visit(child)
    visit(root)
    return records


def sqlite_paths(records):
    mains = {name for name, row in records.items() if row.get('sqlite')}
    sidecars = set()
    for name, row in records.items():
        if row['kind'] == 'file' and name.endswith(('-wal', '-shm')):
            if name[:-4] not in mains:
                raise ValueError('Worker root has an orphan SQLite sidecar')
            sidecars.add(name)
        if row['kind'] == 'file' and Path(name).name == 'model-commands.sqlite3' and name not in mains:
            raise ValueError('Model command journal has no SQLite header')
    return mains, sidecars


def stable_source(before, after, mains):
    """Ignore only recognized transient SHM bytes, never durable WAL records."""
    transient = {name + '-shm' for name in mains}
    # A read-only client may create an empty WAL when a closed WAL-mode main has
    # none. Ignore only that new empty file, never an original or populated WAL.
    created_empty_wal = set()
    for main in mains:
        name = main + '-wal'
        row = after.get(name)
        if name not in before and row is not None and row.get('kind') == 'file' and row.get('sizeBytes') == 0 and row.get('sha256') == hashlib.sha256(b'').hexdigest():
            created_empty_wal.add(name)
    left = {name: row for name, row in before.items() if name not in transient}
    right = {name: row for name, row in after.items() if name not in transient | created_empty_wal}
    if left != right:
        raise ValueError('Worker source changed during capture')
    return left, sorted(created_empty_wal)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_database(source, target, deadline):
    """Use native backup for all SQLite records, including BLOBs and committed WAL."""
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb'):
        pass
    def progress(_status, _remaining, _total):
        check_deadline(deadline)
    remaining = max(0.001, min(0.1, deadline - time.monotonic()))
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=remaining)) as original:
        with closing(sqlite3.connect(target, timeout=remaining)) as copied:
            original.backup(copied, pages=128, progress=progress, sleep=0.05)
            if copied.execute('PRAGMA journal_mode=DELETE').fetchone() != ('delete',):
                raise ValueError('Retained SQLite mode is not DELETE')
            if copied.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('Retained SQLite integrity check failed')
            if source.name == 'model-commands.sqlite3':
                columns = [row[1] for row in copied.execute('PRAGMA table_info(commands)')]
                if columns != ['request_id', 'destination', 'request_json', 'response_json']:
                    raise ValueError('Retained model command schema differs')
    check_deadline(deadline)


def copy_file(source, target, deadline):
    with source.open('rb') as original, target.open('xb') as copied:
        while chunk := original.read(1024 * 1024):
            check_deadline(deadline)
            copied.write(chunk)


def capture(source, destination, *, writers_quiesced, timeout=120):
    """Publish the manifest after complete root copying and preservation checks."""
    if writers_quiesced is not True:
        raise ValueError('Quiesce writers before capturing a worker root')
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Worker-root timeout must be positive and finite')
    deadline = time.monotonic() + timeout
    source, destination = Path(source).absolute(), Path(destination).absolute()
    journal.private_path(source, directory=True)
    journal.private_path(destination.parent, directory=True)
    source = source.resolve(strict=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Worker-root destination must be outside the source')
    before = inventory(source, deadline)
    mains, sidecars = sqlite_paths(before)
    destination.mkdir(mode=0o700)
    journal.private_path(destination, directory=True)
    retained = destination / 'root'
    retained.mkdir(mode=0o700)
    directories = [name for name, row in before.items() if row['kind'] == 'directory']
    for name in sorted(directories, key=lambda value: (value.count('/'), value)):
        if name != '.':
            (retained / name).mkdir(mode=0o700)
    databases = []
    for name, row in sorted(before.items()):
        if row['kind'] != 'file' or name in sidecars:
            continue
        original, target = source / name, retained / name
        if name in mains:
            copy_database(original, target, deadline)
            databases.append({'sourceRelativePath': name, 'retainedRelativePath': name,
                              'method': 'sqlite_backup_api', 'mode': 'DELETE', 'integrity': 'ok'})
        else:
            copy_file(original, target, deadline)
        target.chmod(row['mode'])
        journal.private_path(target, directory=False)
        journal.sync_file(target)
    after = inventory(source, deadline)
    source_records, reader_empty_wal = stable_source(before, after, mains)
    for name in sorted(directories, key=lambda value: (value.count('/'), value), reverse=True):
        target = retained if name == '.' else retained / name
        target.chmod(before[name]['mode'])
        sync_directory(target)
    retained_records = inventory(retained, deadline)
    expected_names = set(before) - sidecars
    if set(retained_records) != expected_names:
        raise ValueError('Retained worker-root paths differ')
    for name in expected_names:
        expected, actual = before[name], retained_records[name]
        if name in mains:
            if actual['mode'] != expected['mode'] or actual.get('sqlite') is not True:
                raise ValueError('Retained SQLite file mode or type differs')
        elif expected != actual:
            raise ValueError('Retained ordinary bytes or directories differ')
    record = {'format': FORMAT, 'quiescence': 'operator_declared',
              'consistency': 'selected_worker_root', 'installationConsistency': 'unassessed',
              'sourceDirectory': str(source), 'sourceEntries': source_records,
              'retainedEntries': retained_records, 'sqliteCopies': databases,
              'excludedSidecars': sorted(sidecars), 'readerCreatedEmptyWalPaths': reader_empty_wal,
              'transientShmObservation': 'recognized SHM bytes excluded from stable-source comparison'}
    partial = destination / '.snapshot.partial.json'
    receipt = destination / 'snapshot.json'
    with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(record, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    check_deadline(deadline)
    os.link(partial, receipt)
    partial.unlink()
    try:
        sync_directory(destination)
        sync_directory(destination.parent)
    except OSError:
        receipt.unlink(missing_ok=True)
        raise
    return record


def verify(destination, *, timeout=120):
    """Verify private package contents; authenticity needs the protected point hash."""
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Worker-root timeout must be positive and finite')
    destination = Path(destination).absolute()
    journal.private_path(destination, directory=True)
    receipt = destination / 'snapshot.json'
    journal.private_path(receipt, directory=False)
    with receipt.open() as stream:
        record = json.load(stream)
    if not isinstance(record, dict) or record.get('format') != FORMAT or record.get('consistency') != 'selected_worker_root':
        raise ValueError('Worker-root manifest format differs')
    if set(path.name for path in destination.iterdir()) != {'root', 'snapshot.json'}:
        raise ValueError('Worker-root package has extra or incomplete entries')
    actual = inventory(destination / 'root', time.monotonic() + timeout)
    if actual != record.get('retainedEntries'):
        raise ValueError('Worker-root package content differs from its manifest')
    expected_copies = [
        {'sourceRelativePath': name, 'retainedRelativePath': name,
         'method': 'sqlite_backup_api', 'mode': 'DELETE', 'integrity': 'ok'}
        for name, row in sorted(actual.items()) if row.get('sqlite')
    ]
    if record.get('sqliteCopies') != expected_copies:
        raise ValueError('Worker-root SQLite mappings differ')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--writers-quiesced', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    if args.verify and (args.source is not None or args.writers_quiesced):
        parser.error('Verification accepts only the destination and timeout')
    if not args.verify and args.source is None:
        parser.error('Capture requires --source')
    try:
        record = verify(args.destination, timeout=args.timeout) if args.verify else capture(
            args.source, args.destination, writers_quiesced=args.writers_quiesced, timeout=args.timeout)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Worker-root snapshot refused ({type(error).__name__}). The private destination may be incomplete.\n')
    print(json.dumps({'format': FORMAT, 'verified': args.verify,
                      'files': sum(row['kind'] == 'file' for row in record['retainedEntries'].values()),
                      'directories': sum(row['kind'] == 'directory' for row in record['retainedEntries'].values()),
                      'sqliteCopies': len(record['sqliteCopies']),
                      'installationConsistency': 'unassessed',
                      'manifestSha256': hashlib.sha256((args.destination / 'snapshot.json').read_bytes()).hexdigest()}, sort_keys=True))


if __name__ == '__main__':
    main()
