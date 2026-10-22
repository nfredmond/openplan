"""Retain an explicitly selected private root set after declared quiescence.

This does not discover omitted roots, stop writers, coordinate database/Storage,
encrypt data or authorize computation. A set requires exit-zero publication and
verification; nested component receipts do not establish complete set capture.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time

import worker_root_snapshot as root

FORMAT = 'openplan-worker-root-set-snapshot-v1'
INVENTORY_FORMAT = 'openplan-worker-root-inventory-v1'


def read_inventory(payload):
    """Validate selection syntax without consulting original source paths."""
    record = json.loads(payload)
    if not isinstance(record, dict) or record.get('format') != INVENTORY_FORMAT or not isinstance(record.get('roots'), list):
        raise ValueError('Worker-root inventory format differs')
    ids = set()
    for item in record['roots']:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', item['id']):
            raise ValueError('Worker-root inventory ID is unsafe')
        if item['id'] in ids:
            raise ValueError('Worker-root inventory has duplicate IDs')
        ids.add(item['id'])
        if not isinstance(item.get('path'), str) or not Path(item['path']).is_absolute():
            raise ValueError('Worker-root inventory source path is not absolute')
    return record


def deadline_for(timeout):
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Worker-root set timeout must be positive and finite')
    return time.monotonic() + timeout


def component_binding(item, packet, copied):
    """Bind declared selection to the component's retained original source identity."""
    identity = copied.get('sourceDirectory')
    declared = '/' + os.path.normpath(item['path']).lstrip('/')
    if not isinstance(identity, str) or identity != declared:
        raise ValueError('Worker-root set component source identity differs')
    return {'id': item['id'], 'declaredSourcePath': item['path'],
            'sourceDirectory': identity,
            'manifestSha256': hashlib.sha256((packet / 'snapshot.json').read_bytes()).hexdigest()}


def publish(destination, record, deadline):
    """Publish only the complete set, after durable component and inventory checks."""
    partial = destination / '.snapshot.partial.json'
    receipt = destination / 'snapshot.json'
    with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(record, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    root.check_deadline(deadline)
    os.link(partial, receipt)
    partial.unlink()
    try:
        root.sync_directory(destination)
        root.sync_directory(destination.parent)
    except OSError:
        receipt.unlink(missing_ok=True)
        raise


def capture(inventory_path, destination, *, writers_quiesced, timeout=120):
    """Bind exact selection bytes and observe stability over every selected root."""
    if writers_quiesced is not True:
        raise ValueError('Quiesce writers before capturing a worker-root set')
    deadline = deadline_for(timeout)
    inventory_path, destination = Path(inventory_path).absolute(), Path(destination).absolute()
    root.journal.private_path(inventory_path, directory=False)
    original_inventory = root.entry(inventory_path, deadline)
    payload = inventory_path.read_bytes()
    selected = read_inventory(payload)
    root.journal.private_path(destination.parent, directory=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    sources = {}
    for item in selected['roots']:
        path = Path(item['path'])
        root.journal.private_path(path, directory=True)
        path = path.resolve(strict=True)
        if path == destination or path in destination.parents or destination in path.parents:
            raise ValueError('Worker-root set destination is inside or above a source')
        if any(path == previous or path in previous.parents or previous in path.parents for previous in sources.values()):
            raise ValueError('Worker-root set sources overlap')
        sources[item['id']] = path
    before = {name: root.inventory(path, deadline) for name, path in sources.items()}
    mains = {name: root.sqlite_paths(rows)[0] for name, rows in before.items()}
    destination.mkdir(mode=0o700)
    root.journal.private_path(destination, directory=True)
    retained_inventory = destination / 'inventory.json'
    with os.fdopen(os.open(retained_inventory, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    retained_inventory.chmod(original_inventory['mode'])
    root.journal.sync_file(retained_inventory)
    if root.entry(retained_inventory, deadline) != original_inventory:
        raise ValueError('Retained worker-root inventory bytes differ')
    root.sync_directory(destination)
    root.sync_directory(destination.parent)
    components = destination / 'roots'
    components.mkdir(mode=0o700)
    records = []
    for item in selected['roots']:
        name = item['id']
        root.check_deadline(deadline)
        packet = components / name
        copied = root.capture(sources[name], packet, writers_quiesced=True,
                              timeout=deadline - time.monotonic())
        root.stable_source(before[name], copied['sourceEntries'], mains[name])
        root.verify(packet, timeout=deadline - time.monotonic())
        records.append(component_binding(item, packet, copied))
    for name, path in sources.items():
        root.stable_source(before[name], root.inventory(path, deadline), mains[name])
    if root.entry(inventory_path, deadline) != original_inventory:
        raise ValueError('Worker-root selection changed during capture')
    root.sync_directory(components)
    record = {'format': FORMAT, 'consistency': 'selected_worker_root_set',
              'installationConsistency': 'unassessed', 'quiescence': 'operator_declared',
              'inventoryEntry': original_inventory, 'roots': records}
    publish(destination, record, deadline)
    return record


def verify(destination, *, timeout=120):
    """Verify the selected set without reading or requiring original source paths."""
    deadline = deadline_for(timeout)
    destination = Path(destination).absolute()
    root.journal.private_path(destination, directory=True)
    receipt = destination / 'snapshot.json'
    root.journal.private_path(receipt, directory=False)
    record = json.loads(receipt.read_bytes())
    if not isinstance(record, dict) or record.get('format') != FORMAT or record.get('consistency') != 'selected_worker_root_set' or record.get('installationConsistency') != 'unassessed' or record.get('quiescence') != 'operator_declared':
        raise ValueError('Worker-root set manifest format differs')
    if {path.name for path in destination.iterdir()} != {'roots', 'inventory.json', 'snapshot.json'}:
        raise ValueError('Worker-root set has extra or incomplete entries')
    inventory_path = destination / 'inventory.json'
    if root.entry(inventory_path, deadline) != record.get('inventoryEntry'):
        raise ValueError('Worker-root set retained inventory differs')
    selected = read_inventory(inventory_path.read_bytes())
    components = destination / 'roots'
    root.journal.private_path(components, directory=True)
    ids = [item['id'] for item in selected['roots']]
    if {path.name for path in components.iterdir()} != set(ids):
        raise ValueError('Worker-root set component paths differ')
    expected = []
    for item in selected['roots']:
        packet = components / item['id']
        copied = root.verify(packet, timeout=deadline - time.monotonic())
        expected.append(component_binding(item, packet, copied))
    if record.get('roots') != expected:
        raise ValueError('Worker-root set component bindings differ')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--writers-quiesced', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    if args.verify and (args.inventory is not None or args.writers_quiesced):
        parser.error('Verification accepts only the destination and timeout')
    if not args.verify and args.inventory is None:
        parser.error('Capture requires --inventory')
    try:
        record = verify(args.destination, timeout=args.timeout) if args.verify else capture(
            args.inventory, args.destination, writers_quiesced=args.writers_quiesced, timeout=args.timeout)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Worker-root set refused ({type(error).__name__}). The private destination may be incomplete.\n')
    print(json.dumps({'format': FORMAT, 'verified': args.verify, 'selectedRoots': len(record['roots']),
                      'installationConsistency': 'unassessed',
                      'manifestSha256': hashlib.sha256((args.destination / 'snapshot.json').read_bytes()).hexdigest()}, sort_keys=True))


if __name__ == '__main__':
    main()
