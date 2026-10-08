"""Snapshot a completed package tree, including generated files and empty folders.

Parents are administrator-owned. This detects changed source entries during
capture; it does not freeze arbitrary host writers or establish SQLite consistency.
Failed exclusive destinations remain available for reconciliation.
"""
import hashlib
import json
import os
from pathlib import Path
import stat

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def retain(source, destination):
    source, destination = Path(source).absolute(), Path(destination).absolute()
    if destination.resolve().is_relative_to(source.resolve()):
        raise ValueError('Package snapshot cannot be inside its source')
    source_fd = os.open(source, DIRECTORY_FLAGS)
    source_identity = identity(os.fstat(source_fd))
    opened = [source_fd]
    checks, inventory = [], {}
    try:
        destination.mkdir(mode=0o700, exist_ok=False)
        target_fd = os.open(destination, DIRECTORY_FLAGS)
        opened.append(target_fd)
        target_identity = identity(os.fstat(target_fd))[:2]
        os.mkdir('files', mode=0o700, dir_fd=target_fd)
        files_fd = os.open('files', DIRECTORY_FLAGS, dir_fd=target_fd)
        opened.append(files_fd)

        def copy_tree(parent, target, prefix):
            before_directory = identity(os.fstat(parent))
            names = sorted(os.listdir(parent))
            for name in names:
                relative = prefix + name
                before = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if stat.S_ISDIR(before.st_mode):
                    child = os.open(name, DIRECTORY_FLAGS, dir_fd=parent)
                    opened.append(child)
                    if identity(os.fstat(child)) != identity(before):
                        raise ValueError('Package directory changed before capture')
                    os.mkdir(name, mode=0o700, dir_fd=target)
                    child_target = os.open(name, DIRECTORY_FLAGS, dir_fd=target)
                    opened.append(child_target)
                    inventory[relative] = {'kind': 'directory'}
                    copy_tree(child, child_target, relative + '/')
                else:
                    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                        raise ValueError('Package input must be a private regular file or directory')
                    descriptor = os.open(name, FILE_FLAGS, dir_fd=parent)
                    try:
                        if identity(os.fstat(descriptor)) != identity(before):
                            raise ValueError('Package file changed before capture')
                        output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                         0o600, dir_fd=target)
                        digest, size = hashlib.sha256(), 0
                        with os.fdopen(output, 'wb') as writer, os.fdopen(os.dup(descriptor), 'rb') as reader:
                            while chunk := reader.read(min(1024 * 1024, before.st_size - size + 1)):
                                size += len(chunk)
                                if size > before.st_size:
                                    raise ValueError('Package file grew during capture')
                                writer.write(chunk)
                                digest.update(chunk)
                            writer.flush()
                            os.fsync(writer.fileno())
                        if size != before.st_size or identity(os.fstat(descriptor)) != identity(before):
                            raise ValueError('Package file changed during capture')
                        inventory[relative] = {'kind': 'file', 'sha256': digest.hexdigest(), 'size_bytes': size}
                    finally:
                        os.close(descriptor)
                checks.append((parent, name, identity(before)))
            if sorted(os.listdir(parent)) != names or identity(os.fstat(parent)) != before_directory:
                raise ValueError('Package directory changed during capture')
            os.fsync(target)

        copy_tree(source_fd, files_fd, '')
        # Recheck all earlier files after the final copy, not only each file's
        # own read interval. Directory identity also detects added/removed names.
        for parent, name, before in checks:
            if identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != before:
                raise ValueError('Package entry changed before manifest publication')
        if identity(os.stat(source, follow_symlinks=False)) != source_identity:
            raise ValueError('Package source root changed during capture')
        if identity(os.stat(destination, follow_symlinks=False))[:2] != target_identity:
            raise ValueError('Package destination changed during capture')
        manifest = {'schema': 'openplan.package-inputs.v1', 'source_directory': str(source),
                    'entries': inventory, 'scientific_acceptance': 'unassessed',
                    'database_consistency': 'unassessed'}
        content = (json.dumps(manifest, sort_keys=True, allow_nan=False) + '\n').encode()
        marker = os.open('manifest.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=target_fd)
        with os.fdopen(marker, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(target_fd)
        return {'package_directory': str(destination / 'files'),
                'manifest_path': str(destination / 'manifest.json'),
                'manifest_sha256': hashlib.sha256(content).hexdigest(), 'manifest_size_bytes': len(content)}
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def consume(record, destination):
    """Return a new package only when its full inventory matches the recorded one.

    The caller must establish producer/run/attempt authority before calling this
    byte-custody helper. A local manifest is not execution authorization.
    """
    manifest_path = Path(record['manifest_path'])
    if not manifest_path.is_absolute() or manifest_path.name != 'manifest.json' or record['package_directory'] != str(manifest_path.parent / 'files'):
        raise ValueError('Package record paths disagree')
    size, digest = record['manifest_size_bytes'], record['manifest_sha256']
    if type(size) is not int or not 0 < size <= 16 * 1024 * 1024:
        raise ValueError('Invalid package manifest size')
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('Invalid package manifest hash')
    descriptor = os.open(manifest_path, FILE_FLAGS)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != size:
            raise ValueError('Package manifest must match its recorded regular file')
        with os.fdopen(os.dup(descriptor), 'rb') as reader:
            content = reader.read(size + 1)
        if len(content) != size or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('Package manifest bytes differ from recorded identity')
        if identity(before) != identity(os.fstat(descriptor)) or identity(before) != identity(os.stat(manifest_path, follow_symlinks=False)):
            raise ValueError('Package manifest changed during verification')
    finally:
        os.close(descriptor)

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate package manifest key')
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError('Nonfinite package manifest value')

    manifest = json.loads(content, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    if not isinstance(manifest, dict) or manifest.get('schema') != 'openplan.package-inputs.v1' or not isinstance(manifest.get('entries'), dict):
        raise ValueError('Invalid package manifest schema')
    for name, entry in manifest['entries'].items():
        parts = name.split('/')
        if any(part in ('', '.', '..') for part in parts) or not isinstance(entry, dict):
            raise ValueError('Invalid package inventory path or entry')
        if entry.get('kind') == 'directory':
            if set(entry) != {'kind'}:
                raise ValueError('Invalid package directory inventory')
        elif entry.get('kind') == 'file':
            file_hash, file_size = entry.get('sha256'), entry.get('size_bytes')
            if set(entry) != {'kind', 'sha256', 'size_bytes'} or type(file_size) is not int or file_size < 0 or not isinstance(file_hash, str) or len(file_hash) != 64 or any(c not in '0123456789abcdef' for c in file_hash):
                raise ValueError('Invalid package file inventory')
        else:
            raise ValueError('Invalid package inventory kind')
    if not isinstance(manifest.get('source_directory'), str) or not Path(manifest['source_directory']).is_absolute():
        raise ValueError('Package manifest requires its original source directory')
    copied = retain(record['package_directory'], destination)
    actual = json.loads(Path(copied['manifest_path']).read_bytes())
    if actual['entries'] != manifest['entries']:
        raise ValueError('Package copy differs from recorded inventory')
    copied['source_package_directory'] = manifest['source_directory']
    return copied
