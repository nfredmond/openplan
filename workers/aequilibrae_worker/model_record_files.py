"""Create missing retained record files atomically; never replace existing bytes.

The caller owns the directory and supplies previously retained bytes. This is
local file custody, not scientific authorization or a multi-file transaction.
"""
import os
from pathlib import Path
import re
import stat
import tempfile


def _verify(path, expected):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Retained record must be a regular file')
        actual = stream.read(len(expected) + 1)
        after = os.fstat(stream.fileno())
        current = os.stat(path, follow_symlinks=False)
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    snapshot = lambda value: tuple(getattr(value, field) for field in fields)
    if actual != expected or snapshot(before) != snapshot(after) or snapshot(after) != snapshot(current):
        raise ValueError('Existing retained record differs or changed during verification')


def materialize(directory, records):
    if not isinstance(records, dict) or not records:
        raise ValueError('Retained record mapping required')
    if any(not isinstance(name, str) or not re.fullmatch(r'[a-z][a-z0-9_]*\.json', name) or not isinstance(value, bytes) for name, value in records.items()):
        raise ValueError('Safe JSON filenames and retained bytes required')
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Owned record directory required')
    paths = {}
    for name, expected in records.items():
        target = directory / name
        # A complete private temporary file is linked into place only if absent.
        # A crash can leave the temporary file, but cannot expose a partial target.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix='.record-', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(expected)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, target, follow_symlinks=False)
            except FileExistsError:
                pass
            _verify(target, expected)
            paths[name] = str(target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return paths
