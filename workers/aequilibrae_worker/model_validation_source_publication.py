"""Publish a retained source set, with an unchanged manifest uploaded last."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

from model_storage_resumable import upload_file
from model_validation_source_catalog import DOCUMENTS, build_catalog, _artifact, _unique_object, _invalid_number
from model_validation_source_files import _logical


def _read(path, digest, size):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as reader:
        before = os.fstat(reader.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != size:
            raise ValueError('Retained document must be a private file of expected size')
        content = reader.read(size + 1)
        if len(content) != size or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('Retained document bytes differ')
    return content


def _intent(directory, value):
    try:
        descriptor = os.open('intent.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError:
        temporary = '.intent-' + uuid.uuid4().hex
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, 'w') as writer:
                json.dump(value, writer, sort_keys=True, separators=(',', ':'))
                writer.flush(); os.fsync(writer.fileno())
            os.link(temporary, 'intent.json', src_dir_fd=directory, dst_dir_fd=directory)
        finally:
            os.unlink(temporary, dir_fd=directory)
        os.fsync(directory)
    else:
        with os.fdopen(descriptor) as reader:
            if json.load(reader) != value:
                raise ValueError('Retained source publication identity differs')


def publish(*, retained, expected_context, state_dir, base_url, service_key, bucket='run-artifacts', request=None):
    """Verify declared roles and publish exact object bytes before the manifest.

    Caller admission establishes expected_context and retained manifest identity.
    Primary JSON documents are parsed in memory; large source objects use the
    bounded resumable uploader. This does not establish preparation independence.
    """
    if not _artifact({'path':retained.get('manifest_path'), 'sha256':retained.get('manifest_sha256'), 'bytes':retained.get('manifest_size_bytes')}):
        raise ValueError('Retained manifest identity required')
    manifest_path = Path(retained['manifest_path'])
    content = _read(manifest_path, retained['manifest_sha256'], retained['manifest_size_bytes'])
    manifest = json.loads(content, object_pairs_hook=_unique_object, parse_constant=_invalid_number)
    if not isinstance(manifest, dict) or manifest.get('context') != expected_context:
        raise ValueError('Publication context differs')
    entries = manifest.get('entries')
    if not isinstance(entries, list) or not entries:
        raise ValueError('Source catalog entries required')
    rows, objects = {}, {}
    object_directory = manifest_path.parent / 'sha256'
    if object_directory.is_symlink(): raise ValueError('Source object directory alias refused')
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('role'), str) or entry['role'] in rows or not _artifact(entry.get('artifact')):
            raise ValueError('Invalid or duplicate source role')
        record = entry['artifact']
        digest = record['sha256']
        if entry.get('object_name') != 'sha256/' + digest:
            raise ValueError('Portable source object identity differs')
        if digest in objects and objects[digest]['bytes'] != record['bytes']:
            raise ValueError('Duplicate source object sizes differ')
        objects[digest] = record
        rows[entry['role']] = entry
    if any('/'+role not in rows for role in DOCUMENTS):
        raise ValueError('Primary source documents missing')
    records = {role: rows['/'+role]['artifact'] for role in DOCUMENTS}
    documents = {role: _read(object_directory / record['sha256'], record['sha256'], record['bytes']) for role,record in records.items()}
    rebuilt = build_catalog(context=expected_context, documents=documents, document_records=records,
                            bindings={role:entry['artifact'] for role,entry in rows.items() if role not in {'/'+name for name in DOCUMENTS}})
    rebuilt.update(stored_source_bytes_verified=True, publication_state='retained_locally')
    if rebuilt != manifest:
        raise ValueError('Retained catalog differs from declared document dependencies')
    for entry in entries:
        if 'logical_source' in entry:
            _logical(object_directory / entry['artifact']['sha256'], entry['logical_source'])
    prefix = ('model-runs/' + expected_context['model_run_id'] + '/attempts/' + expected_context['attempt_id']
              + '/validation-sources/' + expected_context['method'] + '/' + retained['manifest_sha256'])
    state_dir = Path(state_dir)
    state_dir.mkdir(mode=0o700, exist_ok=True)
    directory = os.open(state_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock = None
    try:
        lock = os.open('publication.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _intent(directory, {'schema':'openplan.source-publication.v1', 'context':expected_context,
                            'manifest_sha256':retained['manifest_sha256'], 'manifest_size_bytes':retained['manifest_size_bytes'],
                            'base_url':base_url.rstrip('/'), 'bucket':bucket, 'prefix':prefix})
        for digest, record in sorted(objects.items()):
            upload_file(source=object_directory/digest, state_dir=state_dir/digest, base_url=base_url,
                        service_key=service_key, bucket=bucket, object_path=prefix+'/sha256/'+digest,
                        sha256=digest, size_bytes=record['bytes'], request=request)
        uri = upload_file(source=manifest_path, state_dir=state_dir/'manifest', base_url=base_url,
                          service_key=service_key, bucket=bucket, object_path=prefix+'/manifest.json',
                          sha256=retained['manifest_sha256'], size_bytes=retained['manifest_size_bytes'],
                          content_type='application/json', request=request)
        return {'manifest_uri':uri, 'manifest_sha256':retained['manifest_sha256'],
                'manifest_size_bytes':retained['manifest_size_bytes'], 'object_count':len(objects),
                'role_count':len(entries), 'context':expected_context, 'publication_state':'remote_verified',
                'scientific_acceptance':'unassessed'}
    finally:
        if lock is not None: os.close(lock)
        os.close(directory)
