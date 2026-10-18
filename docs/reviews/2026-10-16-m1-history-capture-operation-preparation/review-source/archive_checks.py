"""Future binary archive readback only. No text decoding or archive parser."""
import hashlib
import os
from pathlib import Path
import stat

ARCHIVE_PATH = '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump'

class Refusal(RuntimeError):
    pass


def require(value, reason):
    if not value:
        raise Refusal(reason)


def values(found):
    return {'bytes': found.st_size, 'mode': stat.S_IMODE(found.st_mode), 'uid': found.st_uid,
            'gid': found.st_gid, 'device': found.st_dev, 'inode': found.st_ino,
            'mtimeNs': found.st_mtime_ns, 'ctimeNs': found.st_ctime_ns,
            'regularFile': stat.S_ISREG(found.st_mode)}


def compare(found, expected):
    observed = values(found)
    require(observed == {key: expected[key] for key in observed}, 'archive-exact-metadata')
    return observed


def path_metadata(expected):
    require(expected['path'] == expected['resolvedPath'] == ARCHIVE_PATH, 'archive-fixed-path')
    path = Path(expected['path'])
    entry = path.lstat()
    require(not stat.S_ISLNK(entry.st_mode) and stat.S_ISREG(entry.st_mode), 'archive-entry-not-regular-nosymlink')
    require(str(path.resolve(strict=True)) == expected['resolvedPath'] == expected['path'], 'archive-resolved-path')
    found = path.stat()
    require((entry.st_dev, entry.st_ino) == (found.st_dev, found.st_ino), 'archive-entry-identity')
    compare(entry, expected)
    return compare(found, expected)


def open_binary(expected):
    path_metadata(expected)
    fd = os.open(expected['path'], os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        compare(os.fstat(fd), expected)
    except BaseException:
        os.close(fd)
        raise
    return fd


def binary_readback(fd, expected, expected_sha, deadline):
    before = compare(os.fstat(fd), expected)
    path_metadata(expected)
    os.lseek(fd, 0, os.SEEK_SET)
    size = 0
    value = hashlib.sha256()
    while True:
        deadline()
        raw = os.read(fd, min(1048576, expected['bytes'] - size + 1))
        if not raw:
            break
        size += len(raw)
        require(size <= expected['bytes'], 'archive-binary-length-overflow')
        value.update(raw)
    require(size == expected['bytes'], 'archive-binary-length')
    actual_sha = value.hexdigest()
    require(actual_sha == expected_sha, 'archive-binary-sha256')
    require(compare(os.fstat(fd), expected) == before, 'archive-metadata-changed-during-hash')
    path_metadata(expected)
    return {'metadata': before, 'binaryBytesRead': size, 'binarySHA256': actual_sha,
            'archiveTextDecoded': False, 'descriptorHeldForPlannedTool': True}
