"""Capture one private SQLite journal, including committed WAL records.

The operator quiesces writers first. This command does not coordinate a complete
installation cut, contact a server, reconcile receipts or resume computation.
Failed destination directories remain private and are never reused.
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


def private_path(path: Path, *, directory: bool) -> None:
    """Refuse aliases and accessible or foreign-owned source/destination paths."""
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError('Snapshot path contains a symlink')
    info = path.stat()
    valid_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not valid_type:
        raise ValueError('Snapshot path has the wrong file type')
    if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
        raise ValueError('Snapshot journal has a hard-link alias')
    if info.st_uid != os.getuid():
        raise ValueError('Snapshot path has another owner')
    if info.st_mode & 0o077:
        raise ValueError('Snapshot path is accessible to other users')


def sync_file(path: Path) -> None:
    with path.open('rb') as stream:
        os.fsync(stream.fileno())


def snapshot(source: Path, destination: Path, *, writers_quiesced: bool, timeout: float = 30) -> dict:
    """Publish a durable single-journal copy in a new private directory."""
    if writers_quiesced is not True:
        raise ValueError('Quiesce writers before taking a journal snapshot')
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Snapshot timeout must be positive and finite')
    source, destination = source.absolute(), destination.absolute()
    if source.name != 'model-commands.sqlite3':
        raise ValueError('Expected a model command journal')
    private_path(source, directory=False)
    private_path(source.parent, directory=True)
    private_path(destination.parent, directory=True)
    source = source.resolve(strict=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    if source.parent == destination or source.parent in destination.parents:
        raise ValueError('Snapshot destination must be outside the source journal directory')
    destination.mkdir(mode=0o700)
    private_path(destination, directory=True)
    target = destination / 'model-commands.sqlite3'
    with closing(os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')):
        pass
    deadline = time.monotonic() + timeout

    def progress(_status: int, _remaining: int, _total: int) -> None:
        if time.monotonic() >= deadline:
            raise TimeoutError('Journal backup exceeded its deadline')

    # Read-only SQLite still reads committed WAL pages. immutable=1 would ignore
    # that changing-file protocol and is deliberately absent here.
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=min(timeout, 0.1))) as original:
        with closing(sqlite3.connect(target, timeout=min(timeout, 0.1))) as copied:
            original.backup(copied, pages=128, progress=progress, sleep=0.05)
            copied.execute('PRAGMA journal_mode=DELETE')
            if copied.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('Copied journal integrity check failed')
            columns = [row[1] for row in copied.execute('PRAGMA table_info(commands)')]
            if columns != ['request_id', 'destination', 'request_json', 'response_json']:
                raise ValueError('Copied database is not a model command journal')
    private_path(target, directory=False)
    digest = hashlib.sha256()
    with target.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    sync_file(target)
    record = {
        'format': 'openplan-worker-journal-snapshot-v1',
        'journalFile': target.name,
        'sizeBytes': target.stat().st_size,
        'sha256': digest.hexdigest(),
        'integrity': 'ok',
        'quiescence': 'operator_declared',
        'consistency': 'single_sqlite_journal',
        'installationConsistency': 'unassessed',
    }
    receipt = destination / 'snapshot.json'
    partial = destination / '.snapshot.partial.json'
    with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(record, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.link(partial, receipt)
    partial.unlink()
    try:
        directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        parent_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    except OSError:
        receipt.unlink(missing_ok=True)
        raise
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--writers-quiesced', action='store_true')
    parser.add_argument('--timeout', type=float, default=30)
    args = parser.parse_args()
    try:
        record = snapshot(args.source, args.destination, writers_quiesced=args.writers_quiesced, timeout=args.timeout)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Journal snapshot refused ({type(error).__name__}). The private destination may be incomplete.\n')
    print(json.dumps(record, sort_keys=True))


if __name__ == '__main__':
    main()
