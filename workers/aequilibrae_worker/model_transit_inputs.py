"""Retained transit archive, metadata and settings using package byte custody.

The caller establishes run/attempt authority. This is not an execution receipt
or a sandbox against other writers with the same operating-system identity.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

import gtfs_skim
import model_package_inputs as packages

SCHEMA = 'openplan.transit-inputs.v1'


def _validate(raw, payload):
    if not isinstance(payload, dict) or set(payload) != {'schema', 'feed', 'skim_settings'} or payload['schema'] != SCHEMA:
        raise ValueError('Invalid transit input payload')
    feed = payload['feed']
    if not isinstance(feed, dict) or feed.get('feed_checksum_sha256') != hashlib.sha256(raw).hexdigest():
        raise ValueError('Transit archive differs from feed metadata checksum')
    gtfs_skim.TransitSkimSettings.from_record(payload['skim_settings'])


def retain(raw: bytes, metadata: dict, settings: gtfs_skim.TransitSkimSettings, destination):
    """Retain exactly the already selected archive; never fetch a substitute."""
    if not isinstance(raw, bytes):
        raise ValueError('Transit retention requires archive bytes')
    payload = {'schema': SCHEMA, 'feed': metadata, 'skim_settings': settings.to_record()}
    _validate(raw, payload)
    content = (json.dumps(payload, sort_keys=True, allow_nan=False) + '\n').encode()
    destination = Path(destination).absolute()
    with tempfile.TemporaryDirectory(prefix='.transit-source-', dir=destination.parent) as source:
        for name, value in [('feed.zip', raw), ('transit.json', content)]:
            descriptor = os.open(Path(source)/name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(value);stream.flush();os.fsync(stream.fileno())
        return packages.retain(source, destination)


def _read_verified(path, size, digest):
    descriptor = os.open(path, packages.FILE_FLAGS)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != size:
            raise ValueError('Transit input is not its recorded private regular file')
        with os.fdopen(os.dup(descriptor), 'rb') as stream:
            raw = stream.read(size + 1)
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('Transit input bytes differ from the retained inventory')
        if packages.identity(before) != packages.identity(os.fstat(descriptor)) or packages.identity(before) != packages.identity(os.stat(path, follow_symlinks=False)):
            raise ValueError('Transit input changed during read')
        return raw
    finally:
        os.close(descriptor)


def consume(record, destination):
    """Verify a separate copy and return its in-memory bytes and assumptions."""
    copied = packages.consume(record, destination)
    manifest = json.loads(_read_verified(copied['manifest_path'], copied['manifest_size_bytes'], copied['manifest_sha256']))
    entries = manifest['entries']
    if set(entries) != {'feed.zip', 'transit.json'} or any(e['kind'] != 'file' for e in entries.values()):
        raise ValueError('Transit input inventory differs')
    values = {name: _read_verified(Path(copied['package_directory'])/name, entry['size_bytes'], entry['sha256'])
              for name, entry in entries.items()}
    payload = json.loads(values['transit.json'])
    _validate(values['feed.zip'], payload)
    return copied, values['feed.zip'], payload['feed'], gtfs_skim.TransitSkimSettings.from_record(payload['skim_settings'])
