"""Seal and verify already retained private local recovery artifacts.

This does not capture a live database, discover omitted installation state,
fence writers, encrypt a packet, restore services or authorize computation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import time

import worker_root_set_snapshot as workers

FORMAT = 'openplan-retained-recovery-packet-v1'
DECLARATION_FORMAT = 'openplan-recovery-packet-inventory-v1'
DECLARATION = 'point-inventory.json'
RECEIPT = 'recovery-point.json'
PARTIAL = '.recovery-point.partial.json'
KINDS = {'databaseArchive': {'file'}, 'storage': {'file', 'directory'},
         'clusterRoles': {'file'}, 'databaseRootKey': {'file'},
         'configuration': {'directory'}, 'workerRootSet': {'directory'}}


def unique_object(pairs):
    """Refuse ambiguous JSON bindings instead of silently selecting the last key."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Recovery packet JSON has duplicate keys')
        result[key] = value
    return result


def declaration(payload):
    """Validate retained artifact paths without consulting original installation paths."""
    record = json.loads(payload, object_pairs_hook=unique_object)
    if not isinstance(record, dict) or record.get('format') != DECLARATION_FORMAT:
        raise ValueError('Recovery packet declaration format differs')
    artifacts = record.get('artifacts')
    if not isinstance(artifacts, dict) or set(artifacts) != set(KINDS):
        raise ValueError('Recovery packet artifact categories differ')
    paths = set()
    for name, item in artifacts.items():
        if not isinstance(item, dict) or not isinstance(item.get('kind'), str) or item['kind'] not in KINDS[name]:
            raise ValueError('Recovery packet declared artifact kind differs')
        value = item.get('path')
        if not isinstance(value, str) or not value or '\x00' in value:
            raise ValueError('Recovery packet artifact path is unsafe')
        path = PurePosixPath(value)
        if path.is_absolute() or '..' in path.parts or value != path.as_posix() or value in {'.', DECLARATION, RECEIPT, PARTIAL}:
            raise ValueError('Recovery packet artifact path is unsafe')
        if value in paths:
            raise ValueError('Recovery packet declared artifact paths are duplicated')
        paths.add(value)
    return record


def read_declaration(point, deadline):
    path = point / DECLARATION
    before = workers.root.entry(path, deadline)
    payload = path.read_bytes()
    if before.get('kind') != 'file' or before.get('sha256') != hashlib.sha256(payload).hexdigest():
        raise ValueError('Recovery packet declaration changed while reading')
    return declaration(payload), before


def require_artifacts(record, entries):
    """Require the declared files and directories, without claiming semantic restoration."""
    for item in record['artifacts'].values():
        row = entries.get(item['path'])
        if row is None or row.get('kind') != item['kind']:
            raise ValueError('Recovery packet declared artifact is missing or differs')
        if item['kind'] == 'file' and row.get('sizeBytes', 0) == 0:
            raise ValueError('Recovery packet declared artifact file is empty')


def validate_worker_set(point, record, deadline):
    item = record['artifacts']['workerRootSet']
    return workers.verify(point / item['path'], timeout=deadline - time.monotonic())


def publish(point, record, deadline):
    """Publish after retained files are synced, preserving failed state for diagnosis."""
    partial, receipt = point / PARTIAL, point / RECEIPT
    with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(record, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    workers.root.check_deadline(deadline)
    os.link(partial, receipt)
    partial.unlink()
    try:
        workers.root.sync_directory(point)
        workers.root.sync_directory(point.parent)
    except OSError:
        receipt.unlink(missing_ok=True)
        raise


def seal(point, *, writers_quiesced, timeout=120):
    """Bind one already captured packet after operator-declared writer quiescence."""
    if writers_quiesced is not True:
        raise ValueError('Quiesce writers before sealing a recovery packet')
    deadline = workers.deadline_for(timeout)
    point = Path(point).absolute()
    workers.root.journal.private_path(point, directory=True)
    workers.root.journal.private_path(point.parent, directory=True)
    if (point / RECEIPT).exists() or (point / PARTIAL).exists():
        raise ValueError('Recovery packet publication state already exists')
    declared, original = read_declaration(point, deadline)
    before = workers.root.inventory(point, deadline)
    if before.get(DECLARATION) != original:
        raise ValueError('Recovery packet declaration changed before inventory')
    require_artifacts(declared, before)
    validate_worker_set(point, declared, deadline)
    for name, row in before.items():
        workers.root.check_deadline(deadline)
        if row['kind'] == 'file':
            workers.root.journal.sync_file(point / name)
    directories = [name for name, row in before.items() if row['kind'] == 'directory']
    for name in sorted(directories, key=lambda value: (value.count('/'), value), reverse=True):
        workers.root.check_deadline(deadline)
        workers.root.sync_directory(point if name == '.' else point / name)
    validate_worker_set(point, declared, deadline)
    if workers.root.inventory(point, deadline) != before:
        raise ValueError('Recovery packet changed during sealing')
    record = {'format': FORMAT, 'scope': 'declared_retained_artifacts',
              'installationConsistency': 'unassessed', 'quiescence': 'operator_declared',
              'entries': before}
    publish(point, record, deadline)
    return record


def verify(point, *, timeout=120):
    """Use only the retained packet and refuse extra, missing or altered artifacts."""
    deadline = workers.deadline_for(timeout)
    point = Path(point).absolute()
    workers.root.journal.private_path(point, directory=True)
    receipt = point / RECEIPT
    workers.root.journal.private_path(receipt, directory=False)
    record = json.loads(receipt.read_bytes(), object_pairs_hook=unique_object)
    if not isinstance(record, dict) or record.get('format') != FORMAT or record.get('scope') != 'declared_retained_artifacts' or record.get('installationConsistency') != 'unassessed' or record.get('quiescence') != 'operator_declared':
        raise ValueError('Recovery packet manifest format differs')
    entries = workers.root.inventory(point, deadline)
    entries.pop(RECEIPT)
    if entries != record.get('entries'):
        raise ValueError('Recovery packet retained entries differ')
    declared, _original = read_declaration(point, deadline)
    require_artifacts(declared, entries)
    validate_worker_set(point, declared, deadline)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--point', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--seal', action='store_true')
    mode.add_argument('--verify', action='store_true')
    parser.add_argument('--writers-quiesced', action='store_true')
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    if args.verify and args.writers_quiesced:
        parser.error('Verification accepts only the retained point and timeout')
    try:
        record = verify(args.point, timeout=args.timeout) if args.verify else seal(
            args.point, writers_quiesced=args.writers_quiesced, timeout=args.timeout)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Recovery packet refused ({type(error).__name__}). Retain incomplete private state for diagnosis.\n')
    print(json.dumps({'format': FORMAT, 'verified': args.verify,
                      'files': sum(row['kind'] == 'file' for row in record['entries'].values()),
                      'installationConsistency': 'unassessed',
                      'manifestSha256': hashlib.sha256((args.point / RECEIPT).read_bytes()).hexdigest()}, sort_keys=True))


if __name__ == '__main__':
    main()
