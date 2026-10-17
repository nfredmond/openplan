"""Future supplied-only adapter. Never operating authority or a process launcher."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import traceback
import types

AUTHORITY = 'SUPPLIED_BOUNDARY_AND_OWNED_REAL_FDS_ONLY'
ENTRY_ANCHOR = ('def capture_after_separate_root_admission(boundary):\n'
                '    """Future SOURCE-bound ROOT supplies verified modules and narrow callbacks."""\n'
                '    if OPERATION_SOURCE_APPROVAL is None:\n'
                "        raise OperationHeld('history-operation:admission-source-absent')\n")
ENTRY_REPLACEMENT = ('def supplied_fixture_entry(boundary):\n'
                     '    """SUPPLIED_BOUNDARY_AND_OWNED_REAL_FDS_ONLY, never ROOT admission."""\n'
                     "    if boundary.authority != 'SUPPLIED_BOUNDARY_AND_OWNED_REAL_FDS_ONLY':\n"
                     "        raise OperationHeld('operation-control:supplied-boundary-only')\n")


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def detail(error):
    return {'fullClass': type(error).__module__ + '.' + type(error).__qualname__,
            'message': str(error), 'traceback': ''.join(traceback.format_exception(error))}


def metadata(path):
    s = path.stat()
    return [s.st_size, s.st_mode, s.st_uid, s.st_gid, s.st_dev, s.st_ino, s.st_mtime_ns, s.st_ctime_ns]


def define(raw, identity, progress):
    require(hashlib.sha256(raw).hexdigest() == identity['sourceSHA256'], 'operation-adapter:definition-pin')
    progress({'event': 'definition-intent', **identity})
    module = types.ModuleType(identity['moduleName'])
    module.__file__ = identity['virtualFile']
    exec(compile(raw, identity['virtualFile'], 'exec'), module.__dict__)
    return module


class OwnedOS:
    """Module-local calls reach only the one owned fixture FD, with saved delegates."""
    O_RDONLY, O_CLOEXEC, O_NOFOLLOW, O_NONBLOCK = os.O_RDONLY, os.O_CLOEXEC, os.O_NOFOLLOW, os.O_NONBLOCK
    SEEK_SET = os.SEEK_SET

    def __init__(self, boundary):
        self.boundary, self.live, self.uncertain = boundary, set(), set()
        self.opens = self.closes = self.reads = self.read_bytes = 0
        self.real_open, self.real_close = os.open, os.close
        self.real_fstat, self.real_read, self.real_lseek = os.fstat, os.read, os.lseek

    def open(self, path, flags):
        b = self.boundary
        require(path == str(b.fixture) and flags == self.O_RDONLY | self.O_CLOEXEC | self.O_NOFOLLOW | self.O_NONBLOCK,
                'operation-adapter:owned-open-only')
        fd = self.real_open(path, flags)
        self.live.add(fd)
        self.opens += 1
        b.operations.append('archive.open')
        return fd

    def fstat(self, fd):
        require(fd in self.live, 'operation-adapter:fstat-owned-fd')
        return self.real_fstat(fd)

    def read(self, fd, maximum):
        require(fd in self.live, 'operation-adapter:read-owned-fd')
        raw = self.real_read(fd, maximum)
        self.reads += 1
        self.read_bytes += len(raw)
        return raw

    def lseek(self, fd, offset, origin):
        require(fd in self.live, 'operation-adapter:seek-owned-fd')
        return self.real_lseek(fd, offset, origin)

    def close(self, fd):
        b = self.boundary
        require(fd in self.live, 'operation-adapter:close-once-owned-fd')
        self.live.remove(fd)
        try:
            self.real_close(fd)
        except BaseException:
            self.uncertain.add(fd)
            raise
        self.closes += 1
        b.operations.append('archive.close')
        if b.scenario in ('primary', 'close'):
            raise OSError('supplied:archive-close')

    def restore(self):
        forced = len(self.live)
        for fd in tuple(self.live):
            self.live.remove(fd)
            try:
                self.real_close(fd)
            except BaseException:
                self.uncertain.add(fd)
        require(not self.uncertain, 'operation-adapter:uncertain-close-stop-no-retry')
        return forced


class ArchiveBoundary:
    """Actual comparison/hash definitions read the actual supplied fixture only."""
    def __init__(self, boundary, actual):
        self.boundary, self.actual = boundary, actual
        self.saved_path, self.saved_os = actual.ARCHIVE_PATH, actual.os
        self.ARCHIVE_PATH = str(boundary.fixture)
        actual.ARCHIVE_PATH = self.ARCHIVE_PATH
        actual.os = boundary.owned
        require(actual.binary_readback.__globals__ is actual.__dict__
                and actual.binary_readback.__globals__['ARCHIVE_PATH'] == self.ARCHIVE_PATH,
                'operation-adapter:actual-archive-globals')

    def restore(self):
        self.actual.ARCHIVE_PATH, self.actual.os = self.saved_path, self.saved_os

    def path_metadata(self, expected):
        self.boundary.operations.append('archive.path')
        return self.actual.path_metadata(expected)

    def compare(self, found, expected):
        b = self.boundary
        b.operations.append('archive.compare')
        return self.actual.compare(found, expected)

    def binary_readback(self, fd, expected, wanted_sha, deadline):
        b = self.boundary
        b.hash_calls += 1
        phase = 'post' if b.capture_calls else 'pre'
        b.operations.append('archive.hash.' + phase)
        require(fd in b.owned.live, 'operation-adapter:hash-before-close')
        if b.scenario == 'prehash' and phase == 'pre':
            raise ValueError('supplied:preparse-hash')
        value = self.actual.binary_readback(fd, expected, wanted_sha, deadline)
        if b.scenario == 'primary' and phase == 'post':
            raise OSError('supplied:postparse-readback')
        return value


class CoreBoundary:
    """Initial selection/argv are declared mocks; absent-oracle assessment is actual."""
    PRODUCTION_ORACLE_APPROVAL = None

    def __init__(self, boundary, actual):
        self.boundary = boundary
        self.FIXED_ARGV = ('SUPPLIED_LITERAL_NEVER_EXECUTABLE', str(boundary.fixture))
        self.HistoryUnassessed = actual.HistoryUnassessed
        self.assess_production = actual.assess_production
        require(self.assess_production.__globals__ is actual.__dict__
                and actual.PRODUCTION_ORACLE_APPROVAL is None, 'operation-adapter:actual-core-globals')

    def validate_selection(self, selection, toc):
        self.boundary.operations.append('mock.selection')
        require(selection == b'SUPPLIED_SELECTION_METADATA' and toc == b'SUPPLIED_TOC_METADATA',
                'operation-adapter:declared-source-data')

    def validate_argv(self, argv):
        self.boundary.operations.append('mock.argv')
        require(argv == self.FIXED_ARGV, 'operation-adapter:inert-argv')


class Boundary:
    authority = AUTHORITY
    selection, saved_toc = b'SUPPLIED_SELECTION_METADATA', b'SUPPLIED_TOC_METADATA'
    environment = {'SUPPLIED_ONLY': '1'}

    def __init__(self, scenario, fixture, directory, actual_core, actual_archive, writer):
        self.scenario, self.fixture, self.directory, self.writer = scenario, Path(fixture), Path(directory), writer
        self.operations, self.prewrite, self.record_files = [], {}, {}
        self.capture_calls = self.hash_calls = 0
        self.primary = self.primary_trace = self.primary_cause = self.primary_context = None
        self.terminal = None
        self.owned = OwnedOS(self)
        self.core = CoreBoundary(self, actual_core)
        self.archive = ArchiveBoundary(self, actual_archive)
        self.capture = self

    def deadline(self):
        if self.scenario == 'post-expiry' and self.capture_calls:
            raise RuntimeError('supplied:postparse-expired')

    def verify_initial_admission(self):
        self.operations.append('mock.admission.initial')
        if self.scenario == 'initial-expiry':
            raise RuntimeError('supplied:admission-expired')

    def verify_before_tool(self):
        self.operations.append('mock.before-tool')

    def final_source_readback(self):
        self.operations.append('mock.final.source')
        if self.scenario == 'primary':
            raise OSError('supplied:final-source')

    def final_mount_security_readback(self):
        self.operations.append('mock.final.mount')
        if self.scenario == 'primary':
            raise OSError('supplied:final-mount')

    def record(self, name, value):
        allowed = ('archive.preparse.json', 'archive.postparse.json', 'history.terminal.json',
                   'history.assessment.json', 'operation.terminal.json')
        require(name in allowed and name not in self.prewrite, 'operation-adapter:record-name-once')
        self.prewrite[name] = copy.deepcopy(value)
        if name == 'operation.terminal.json':
            self.operations.append('record.operation-terminal')
            self.terminal = value
        raw = (json.dumps(value, indent=2) + '\n').encode()
        if name == 'operation.terminal.json' and self.scenario in ('primary', 'terminal'):
            partial = raw[:37]
            self.writer(self.directory / (name + '.partial'), partial)
            self.record_files[name] = {'partialBytes': len(partial), 'partialSHA256': hashlib.sha256(partial).hexdigest()}
            raise OSError('supplied:operation-terminal-record')
        self.writer(self.directory / name, raw)
        self.record_files[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}

    def capture_once(self, argv, environment, deadline, record, chunk_size):
        require(argv == list(self.core.FIXED_ARGV) and environment is self.environment,
                'operation-adapter:intercepted-capture-only')
        self.capture_calls += 1
        self.operations.append('mock.capture')
        terminal = {'returncode': 7 if self.scenario == 'primary' else 0,
                    'status': 'FAILED' if self.scenario in ('primary', 'invalid-status') else 'CAPTURED',
                    'partialFailure': None, 'cleanupIssues': [], 'terminalRecordFailure': None,
                    'retainedBytes': {'stderr': 0}, 'observedBytes': {'stderr': 0},
                    'streams': {'stdout': {'path': 'SUPPLIED_NO_CAPTURED_BODY', 'sha256': 'SUPPLIED_ONLY'}}}
        record('history.terminal.json', terminal)
        if self.scenario == 'primary':
            try:
                raise RuntimeError('supplied:operation-primary') from ValueError('supplied:original-cause')
            except RuntimeError as error:
                self.primary, self.primary_trace = error, error.__traceback__
                self.primary_cause, self.primary_context = error.__cause__, error.__context__
                raise
        return terminal

    def fixture_globals(self, caller):
        values = self.archive.actual.values(self.fixture.stat())
        expected = {'path': str(self.fixture), 'resolvedPath': str(self.fixture), **values}
        caller.ARCHIVE_METADATA = tuple(expected.items())
        caller.ARCHIVE_SHA256 = hashlib.sha256(self.fixture.read_bytes()).hexdigest()
        caller.os = self.owned
        require(caller.OPERATION_SOURCE_APPROVAL is None
                and caller.supplied_fixture_entry.__globals__ is caller.__dict__
                and caller.supplied_fixture_entry.__globals__['os'] is self.owned,
                'operation-adapter:actual-supplied-entry-globals')
