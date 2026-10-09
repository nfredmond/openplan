"""Retain declared validation files locally; publication and authority stay separate."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil

from model_handoff_files import copy_registered
from model_validation_source_catalog import build_catalog


def _logical(path, record):
    digest, size = hashlib.sha256(), 0
    opener = gzip.open if record['compression'] == 'gzip' else open
    with opener(path, 'rb') as source:
        while chunk := source.read(min(1024 * 1024, record['bytes'] - size + 1)):
            size += len(chunk)
            if size > record['bytes']:
                raise ValueError('Logical source exceeds declared byte count')
            digest.update(chunk)
    if size != record['bytes'] or digest.hexdigest() != record['sha256']:
        raise ValueError('Logical source bytes differ')


def retain(*, root, destination, expected_context, source_paths, catalog_arguments):
    """Copy every explicit role, then write a portable manifest last.

    The administrator owns root and destination parent. The caller establishes
    producer completion and attempt authority separately. Partial destinations
    remain for reconciliation and are never overwritten by a retry.
    """
    catalog = build_catalog(**catalog_arguments)
    if catalog['context'] != expected_context:
        raise ValueError('Source retention context differs')
    entries = catalog['entries']
    if set(source_paths) != {entry['role'] for entry in entries}:
        raise ValueError('Exact source role mapping required')
    paths = {role: Path(path).resolve(strict=True) for role, path in source_paths.items()}
    output = paths['/comparison_basis/model_output_artifact']
    for entry in entries:
        if entry['phase'] == 'preparation' and paths[entry['role']].samefile(output):
            raise ValueError('Preparation source aliases model output file')
    destination = Path(destination)
    unique = {entry['artifact']['sha256']: entry['artifact']['bytes'] for entry in entries}
    required = sum(unique.values()) + max(unique.values()) + 1024 * 1024
    if shutil.disk_usage(destination.parent).free < required:
        raise ValueError('Insufficient free space for retained sources')
    destination.mkdir(mode=0o700)
    objects = destination / 'sha256'
    objects.mkdir(mode=0o700)
    for index, entry in enumerate(entries):
        record = entry['artifact']
        temporary = destination / ('source-' + str(index))
        # Verify each physical role even if its hash already has a retained object.
        copy_registered(root, expected_context['model_run_id'], paths[entry['role']], temporary,
                        sha256=record['sha256'], size_bytes=record['bytes'])
        if 'logical_source' in entry:
            _logical(temporary, entry['logical_source'])
        target = objects / record['sha256']
        if target.exists():
            temporary.unlink()
        else:
            temporary.rename(target)
    catalog['stored_source_bytes_verified'] = True
    catalog['publication_state'] = 'retained_locally'
    payload = (json.dumps(catalog, sort_keys=True, separators=(',', ':')) + '\n').encode()
    manifest = destination / 'manifest.json'
    # Exclusive manifest creation is the local completion marker, not an upload receipt.
    pending = destination / 'manifest.pending'
    with pending.open('xb') as writer:
        os.chmod(pending, 0o600)
        writer.write(payload)
        writer.flush()
        os.fsync(writer.fileno())
    os.link(pending, manifest)
    pending.unlink()
    for directory in (objects, destination, destination.parent):
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    return {'manifest_path': str(manifest), 'manifest_sha256': hashlib.sha256(payload).hexdigest(),
            'manifest_size_bytes': len(payload)}
