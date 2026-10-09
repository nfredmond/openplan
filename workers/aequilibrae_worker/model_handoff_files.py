"""Copy registered same-run bytes through pinned local directory descriptors.

Callers verify producer completion and ownership separately. This protects the
copy operation, not database authorization or arbitrary model-engine writes.
The configured root and destination parent belong to the local administrator.
"""
import hashlib
import os
from pathlib import Path
import re
import stat
import uuid

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _snapshot(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def copy_registered(root, run_id, source, destination, *, sha256, size_bytes):
    """Retain a complete verified file without following mutable path aliases."""
    if not isinstance(run_id, str) or str(uuid.UUID(run_id)) != run_id:
        raise ValueError('Canonical handoff run identity required')
    if not isinstance(sha256, str) or not re.fullmatch('[0-9a-f]{64}', sha256):
        raise ValueError('Registered handoff hash required')
    if type(size_bytes) is not int or size_bytes < 0:
        raise ValueError('Registered handoff byte size required')
    root = Path(root).resolve(strict=True)
    resolved = Path(source).resolve(strict=True)
    relative = resolved.relative_to(root / 'runs' / run_id)
    destination = Path(destination)
    if not relative.parts or destination.name in ('', '.', '..'):
        raise ValueError('Handoff source and destination filenames required')
    source_directory = os.open(root, DIRECTORY_FLAGS)
    target_directory = None
    source_file = None
    temporary = None
    try:
        for component in ('runs', run_id, *relative.parts[:-1]):
            child = os.open(component, DIRECTORY_FLAGS, dir_fd=source_directory)
            os.close(source_directory)
            source_directory = child
        source_file = os.open(relative.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                              dir_fd=source_directory)
        before = os.fstat(source_file)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ValueError('Handoff source must be a private regular file')
        if before.st_size != size_bytes:
            raise ValueError('Handoff source byte size differs')
        target_directory = os.open(destination.parent, DIRECTORY_FLAGS)
        target_identity = os.fstat(target_directory)
        name = '.handoff-' + uuid.uuid4().hex
        output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=target_directory)
        temporary = name
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(output, 'wb') as writer:
            # dup keeps the original descriptor available for final identity checks.
            with os.fdopen(os.dup(source_file), 'rb') as reader:
                while chunk := reader.read(min(1024 * 1024, size_bytes - size + 1)):
                    size += len(chunk)
                    if size > size_bytes:
                        raise ValueError('Handoff source grew during copy')
                    digest.update(chunk)
                    writer.write(chunk)
            if size != size_bytes or digest.hexdigest() != sha256:
                raise ValueError('Handoff bytes differ from registered artifact')
            after = os.fstat(source_file)
            named = os.stat(relative.name, dir_fd=source_directory, follow_symlinks=False)
            if _snapshot(before) != _snapshot(after) or _snapshot(after) != _snapshot(named):
                raise ValueError('Handoff source changed during copy')
            writer.flush()
            os.fsync(writer.fileno())
            written = os.fstat(writer.fileno())
        os.link(name, destination.name, src_dir_fd=target_directory,
                dst_dir_fd=target_directory, follow_symlinks=False)
        published = os.stat(destination.name, dir_fd=target_directory, follow_symlinks=False)
        if (published.st_dev, published.st_ino) != (written.st_dev, written.st_ino):
            raise ValueError('Handoff publication no longer names the verified copy')
        os.unlink(name, dir_fd=target_directory)
        temporary = None
        os.fsync(target_directory)
        current_target = os.stat(destination.parent, follow_symlinks=False)
        if (target_identity.st_dev, target_identity.st_ino) != (current_target.st_dev, current_target.st_ino):
            raise ValueError('Handoff destination directory changed')
        return str(destination)
    finally:
        if temporary is not None:
            os.unlink(temporary, dir_fd=target_directory)
        if source_file is not None:
            os.close(source_file)
        if target_directory is not None:
            os.close(target_directory)
        os.close(source_directory)
