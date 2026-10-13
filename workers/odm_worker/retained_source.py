"""Retain already-complete private source bytes, without transport or engine use.

The trusted caller supplies original authority context. This disconnected
candidate does not verify live authority or grant processing permission.
Writers cooperate through one private lock; adversarial same-UID races are not
covered. Interrupted plans and partial files remain for diagnosis and recovery.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import time
import uuid

from admission_journal import encoded, private, synchronize

PLAN = 'openplan.odm-source-plan.v1'
MANIFEST = 'openplan.odm-source-set.v1'
CHUNK = 1024 * 1024
JSON_LIMIT = 64 * 1024 * 1024
PUBLICATION_LIMIT = 193 * 1024 * 1024


def identity(info):
    return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def absolute(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or any(item.is_symlink() for item in [path, *path.parents]):
        raise ValueError('Source custody requires absolute paths without aliases')
    return path


def finite_limit(value):
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError('Source byte limit must be a positive integer')


def check_time(deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError('Source custody deadline exceeded')


@contextmanager
def reader(root, name):
    parts = Path(name).parts
    if not isinstance(name, str) or not parts or Path(name).is_absolute() or any(part in ('.', '..') for part in parts) or str(Path(name)) != name:
        raise ValueError('Source relative path is unsafe')
    folder = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    file = None
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=folder)
            os.close(folder);folder = child
            info = os.fstat(folder)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
                raise ValueError('Source directory must be private and owned')
        file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
        info = os.fstat(file)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError('Source file must be private and owned without aliases')
        with os.fdopen(os.dup(file), 'rb') as stream:
            yield stream, info
        if identity(info) != identity(os.fstat(file)) or identity(info) != identity(os.stat(parts[-1], dir_fd=folder, follow_symlinks=False)):
            raise ValueError('Source file changed during custody')
    finally:
        if file is not None:
            os.close(file)
        os.close(folder)


def digest(root, name, limit, deadline, output=None):
    size, checksum = 0, hashlib.sha256()
    with reader(root, name) as (stream, before):
        if before.st_size > limit:
            raise ValueError('Source bytes exceed the declared limit')
        while chunk := stream.read(min(CHUNK, limit-size+1)):
            check_time(deadline)
            size += len(chunk)
            if size > limit:
                raise ValueError('Source bytes exceed the declared limit')
            checksum.update(chunk)
            if output is not None:
                output.write(chunk)
        if size != before.st_size:
            raise ValueError('Source byte size changed during custody')
        os.fsync(stream.fileno())
    return {'bytes': size, 'sha256': checksum.hexdigest()}


def json_bytes(value):
    return (encoded(value, canonical=True)+'\n').encode()


def read_json(root, name):
    with reader(root, name) as (stream, before):
        if before.st_size > JSON_LIMIT:
            raise ValueError('Source custody metadata exceeds the supported size')
        payload = stream.read(JSON_LIMIT+1)
    value = json.loads(payload)
    if payload != json_bytes(value):
        raise ValueError('Source custody metadata encoding differs')
    return value


def publish(root, name, payload, *, json_limit=None):
    bound = JSON_LIMIT if json_limit is None else json_limit
    if type(bound) is not int or not 0 < bound <= PUBLICATION_LIMIT:
        raise ValueError('Source custody publication limit must be a positive bounded integer')
    if len(payload) > bound:
        raise ValueError('Source custody metadata exceeds the supported size')
    target = root/name
    if target.exists() or target.is_symlink():
        with reader(root, name) as (stream, _info):
            if stream.read(len(payload)+1) != payload:
                raise ValueError('Existing source custody record differs')
        synchronize(root)
        return
    temporary = root/('.partial-'+uuid.uuid4().hex)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as stream:
        stream.write(payload);stream.flush();os.fsync(stream.fileno())
    temporary.rename(target)
    synchronize(root)


@contextmanager
def writer(root, deadline):
    path = root/'writer.lock'
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    locked = False
    try:
        private(path, False)
        while not locked:
            check_time(deadline)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB);locked = True
            except BlockingIOError:
                time.sleep(min(0.01, max(0, deadline-time.monotonic())))
        yield
    finally:
        if locked:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def binding(journal, request_id, reference, context):
    admission = journal.get(request_id)
    if admission is None or admission.job_reference != reference:
        raise ValueError('Source custody admission identity differs')
    fields = ('installationId', 'originalActorId', 'targetId', 'workspaceId', 'missionId', 'applicationJobId')
    if not isinstance(context, dict) or any(not isinstance(context.get(key), str) or not context[key].strip() for key in fields):
        raise ValueError('Original source authority context is required')
    external = admission.request.get('externalRef', {})
    if context['workspaceId'] != external.get('workspaceId') or context['missionId'] != external.get('missionId'):
        raise ValueError('Source authority geography/job scope differs')
    return json.loads(encoded({'requestId': request_id, 'jobReference': reference,
                               'originalRequest': admission.request, 'originalAdmission': admission.admission,
                               'originalContext': context}, canonical=True))


def imagery_sources(bound):
    imagery = bound['originalRequest'].get('imagery', {})
    if not isinstance(imagery, dict):
        raise ValueError('Original imagery source shape is unsupported')
    if imagery.get('type') == 'zip_url':
        return [imagery]
    if imagery.get('type') == 'photo_manifest' and isinstance(imagery.get('photos'), list) and imagery['photos'] and all(isinstance(item, dict) for item in imagery['photos']):
        return imagery['photos']
    raise ValueError('Original imagery source shape is unsupported')


def declared(record, observed):
    size, checksum = record.get('sizeBytes'), record.get('checksumSha256')
    if size is not None and (not isinstance(size, int) or isinstance(size, bool) or size < 0 or size != observed['bytes']):
        raise ValueError('Source bytes differ from declared size')
    if checksum is not None and (not isinstance(checksum, str) or not re.fullmatch('[0-9a-f]{64}', checksum) or checksum != observed['sha256']):
        raise ValueError('Source bytes differ from declared checksum')


def verify_plan(plan, bound, names, metadata, limit):
    if not isinstance(plan, dict) or set(plan) != {'format', 'binding', 'maxBytes', 'sources'} or plan['format'] != PLAN or encoded(plan['binding'], canonical=True) != encoded(bound, canonical=True) or type(plan['maxBytes']) is not int or plan['maxBytes'] != limit:
        raise ValueError('Saved source preparation identity differs')
    rows = plan['sources']
    if not isinstance(rows, list) or len(rows) != len(names):
        raise ValueError('Saved source preparation mapping differs')
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {'slot', 'sourceRelativePath', 'imageryMetadata', 'bytes', 'sha256'} or type(row['slot']) is not int or row['slot'] != index or row['sourceRelativePath'] != names[index] or encoded(row['imageryMetadata'], canonical=True) != encoded(metadata[index], canonical=True) or type(row['bytes']) is not int or row['bytes'] < 0 or not isinstance(row['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['sha256']):
            raise ValueError('Saved source preparation record differs')
        declared(metadata[index], row)
    if sum(row['bytes'] for row in rows) > limit:
        raise ValueError('Saved source preparation exceeds original limit')


def prepare(journal, request_id, reference, context, *, source_root, sources, destination, max_bytes, timeout=120):
    """Publish or recover one immutable local source set; never fetch a URL.

    Completed slots need no original source. Missing slots require their exact
    original planned bytes, even after relocation. Sources remain untouched.
    """
    finite_limit(max_bytes)
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Source custody timeout must be positive and finite')
    deadline = time.monotonic()+timeout
    bound = binding(journal, request_id, reference, context)
    metadata = imagery_sources(bound)
    if not isinstance(sources, list) or any(not isinstance(name, str) for name in sources) or len(sources) != len(metadata) or len(set(sources)) != len(sources):
        raise ValueError('Exact original source mapping is required')
    names = list(sources)
    for name in names:
        path = Path(name)
        if not path.parts or path.is_absolute() or any(part in ('.', '..') for part in path.parts) or str(path) != name:
            raise ValueError('Source relative path is unsafe')
    destination = absolute(destination);private(destination.parent, True)
    try:
        destination.mkdir(mode=0o700)
    except FileExistsError:
        pass
    else:
        synchronize(destination.parent)
    private(destination, True)
    with writer(destination, deadline):
        objects = destination/'objects'
        objects.mkdir(mode=0o700, exist_ok=True);private(objects, True)
        plan_path = destination/'plan.json'
        if plan_path.exists() or plan_path.is_symlink():
            plan = read_json(destination, 'plan.json')
        else:
            if (destination/'manifest.json').exists() or (destination/'manifest.json').is_symlink():
                raise ValueError('Completed source custody has no preparation plan')
            source_root = absolute(source_root);private(source_root, True)
            rows = [];remaining = max_bytes
            for index, name in enumerate(names):
                observed = digest(source_root, name, remaining, deadline)
                declared(metadata[index], observed);remaining -= observed['bytes']
                rows.append({'slot': index, 'sourceRelativePath': name, 'imageryMetadata': metadata[index], **observed})
            plan = {'format': PLAN, 'binding': bound, 'maxBytes': max_bytes, 'sources': rows}
            publish(destination, 'plan.json', json_bytes(plan))
        verify_plan(plan, bound, names, metadata, max_bytes)
        required = sum(row['bytes'] for row in plan['sources'] if not (objects/f"source-{row['slot']:05d}.bin").exists())
        if required and shutil.disk_usage(destination).free < required + 2*len(json_bytes(plan)) + CHUNK:
            raise ValueError('Insufficient free space for retained source bytes')
        entries = []
        for row in plan['sources']:
            check_time(deadline)
            name = f"source-{row['slot']:05d}.bin";target = objects/name
            if not target.exists() and not target.is_symlink():
                source_root = absolute(source_root);private(source_root, True)
                temporary = destination/('.partial-'+uuid.uuid4().hex)
                with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as output:
                    copied = digest(source_root, row['sourceRelativePath'], row['bytes'], deadline, output)
                    output.flush();os.fsync(output.fileno())
                if copied != {key: row[key] for key in ('bytes', 'sha256')}:
                    raise ValueError('Original planned source bytes differ')
                temporary.rename(target);synchronize(objects);synchronize(destination)
            actual = digest(objects, name, row['bytes'], deadline)
            if actual != {key: row[key] for key in ('bytes', 'sha256')}:
                raise ValueError('Retained source slot differs')
            entries.append({'slot': row['slot'], 'objectRelativePath': 'objects/'+name, **actual})
        if set(path.name for path in objects.iterdir()) != {Path(row['objectRelativePath']).name for row in entries}:
            raise ValueError('Retained source object mapping differs')
        manifest = {'format': MANIFEST, 'binding': bound, 'planSha256': hashlib.sha256(json_bytes(plan)).hexdigest(),
                    'sources': entries, 'state': 'retained_locally', 'authorityVerification': 'unassessed'}
        publish(destination, 'manifest.json', json_bytes(manifest))
        check_time(deadline)
        return {'manifestSha256': hashlib.sha256(json_bytes(manifest)).hexdigest(),
                'manifestBytes': len(json_bytes(manifest)), 'manifest': manifest}
