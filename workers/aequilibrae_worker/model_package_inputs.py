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
