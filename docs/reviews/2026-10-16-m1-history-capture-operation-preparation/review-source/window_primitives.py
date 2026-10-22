"""Prepared PURE I/O and guard primitives. No authority or runtime entry."""
import hashlib
import json
import os
from pathlib import Path
import stat
import time
import traceback

CAPS = {'memory.max': '536870912', 'memory.swap.max': '0', 'cpu.max': '50000 100000', 'pids.max': '64'}
WRITTEN = 0
TOTAL_LIMIT = 8388608


def need(value, reason):
    if not value:
        raise RuntimeError(reason)


class RootFinalizationError(RuntimeError):
    """Failed root receipt finalization, never an accepted subject result."""
    def __init__(self, terminal):
        super().__init__('root-finalization-failed-stop-no-retry')
        self.terminal = terminal


def error_detail(error):
    return {'class': type(error).__name__,
            'fullClass': type(error).__module__ + '.' + type(error).__qualname__,
            'message': str(error),
            'traceback': ''.join(traceback.format_exception(type(error), error, error.__traceback__))}


def attempt_finalization(issues, operation, action):
    try:
        return action()
    except BaseException as error:
        issues.append(dict(operation=operation, **error_detail(error)))
        return None


def propagate(primary, primary_traceback, terminal):
    issues = terminal['cleanupIssues']
    if primary is not None:
        if issues:
            secondary = RootFinalizationError(terminal)
            secondary.original_primary_cause = primary.__cause__
            secondary.original_primary_context = primary.__context__
            raise BaseException.with_traceback(primary, primary_traceback) from secondary
        raise BaseException.with_traceback(primary, primary_traceback)
    if issues:
        raise RootFinalizationError(terminal)


def resource_policy(values):
    need(values == CAPS, 'root-actual-resource-limits')


def budget_policy(used, size, maximum):
    need(type(used) is int and type(size) is int and 0 <= size <= 1048576
         and used >= 0 and used + size <= maximum, 'pure-write-budget')


def runtime_policy(requested, manifest, receipt):
    need(requested['status'] == 'ROOT_ACCEPTED_SELECTED_STATIC_PYTHON_FOOTPRINT'
         and requested['manifestSHA256'] is not None and requested['reviewReceiptSHA256'] is not None
         and receipt['decision'] == 'ACCEPT_EXACT_STATIC_FOOTPRINT_FOR_SOURCE_ONLY_TRIAL03_PREPARATION'
         and receipt['runtimeExecuted'] is False and receipt['sourceClosureComplete'] is False
         and manifest['wholeUsrBind'] is False and manifest['selectedStaticNeededAliasPathsReviewed'] is True
         and manifest['dynamicABIProved'] is False
         and manifest['unresolvedNeeded'] == [] and manifest['unresolvedAliases'] == []
         and len(manifest['files']) > 0, 'pure-runtime-closure-unresolved')


def mount_policy(mounts, rw_paths, ro_paths):
    need(all('ro' in row['options'] or row['path'] in rw_paths for row in mounts), 'pure-unexpected-rw-mount')
    for name in ro_paths:
        candidates = [row for row in mounts if name == row['path'] or name.startswith(row['path'].rstrip('/') + '/')]
        need(candidates and 'ro' in max(candidates, key=lambda row: len(row['path']))['options'], 'pure-named-readonly')
    need(all(any(row['path'] == name and 'rw' in row['options'] for row in mounts) for name in rw_paths), 'pure-owned-writable')


def null_setup_policy(argv):
    initial = [i for i in range(len(argv) - 2) if argv[i:i + 3] == ['--ro-bind', '/dev/null', '/dev/null']]
    final = [i for i in range(len(argv) - 2) if argv[i:i + 3] == ['--dev-bind', '/dev/null', '/dev/null']]
    root_ro = [i for i in range(len(argv) - 1) if argv[i:i + 2] == ['--remount-ro', '/']]
    need(len(initial) == len(final) == len(root_ro) == 1 and argv.count('--clearenv') == 1
         and initial[0] < root_ro[0] < final[0] < argv.index('--clearenv'), 'pure-null-target-before-root-ro')


def read_blob(path, maximum, deadline=lambda: None):
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    primary = saved = None
    issues = []
    raw = b''
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode), 'pure-read-regular')
        while True:
            deadline()
            part = os.read(fd, min(65536, maximum - len(raw) + 1))
            if not part:
                break
            raw += part
            need(len(raw) <= maximum, 'pure-read-cap')
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
             == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'pure-read-stable')
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        attempt_finalization(issues, 'read-fd-close', lambda: os.close(fd))
    propagate(primary, saved, {'cleanupIssues': issues})
    return raw


def write_blob(path, raw):
    global WRITTEN
    budget_policy(WRITTEN, len(raw), TOTAL_LIMIT)
    WRITTEN += len(raw)
    fd = directory_fd = None
    primary = saved = None
    issues = []
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:])
            need(count > 0, 'pure-short-write')
            offset += count
        os.fsync(fd)
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        if fd is not None:
            attempt_finalization(issues, 'write-fd-close', lambda: os.close(fd))
        try:
            directory_fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        except BaseException as error:
            issues.append(dict(operation='record-directory-open', **error_detail(error)))
        if directory_fd is not None:
            attempt_finalization(issues, 'record-directory-fsync', lambda: os.fsync(directory_fd))
            attempt_finalization(issues, 'record-directory-close', lambda: os.close(directory_fd))
    propagate(primary, saved, {'cleanupIssues': issues})


def record(path, value):
    write_blob(path, (json.dumps(value, indent=2, sort_keys=True) + '\n').encode())


def descriptor(path, expected, namespace=False, deadline=lambda: None):
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    primary = saved = None
    issues = []
    result = None
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size == expected['bytes'], 'pure-input-regular-size')
        digest = hashlib.sha256()
        size = 0
        while True:
            deadline()
            raw = os.read(fd, 65536)
            if not raw:
                break
            size += len(raw)
            need(size <= expected['bytes'], 'pure-input-length-cap')
            digest.update(raw)
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid, before.st_size,
              before.st_mtime_ns, before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_mode,
              after.st_uid, after.st_gid, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'pure-input-stable')
        result = {'bytes': size, 'sha256': digest.hexdigest(), 'mode': stat.S_IMODE(after.st_mode),
                  'uid': after.st_uid, 'gid': after.st_gid}
        keys = ('bytes', 'sha256', 'mode') if namespace else tuple(expected)
        need(all(result[key] == expected[key] for key in keys), 'pure-input-pin')
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        attempt_finalization(issues, 'input-fd-close', lambda: os.close(fd))
    propagate(primary, saved, {'cleanupIssues': issues})
    return result
