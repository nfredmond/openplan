"""Exclusive durable files and finite streamed subprocess custody, adapted from A0 R6."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

import policy as p


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private(path, directory=False):
    info = path.lstat()
    p.require(not path.is_symlink() and info.st_uid == os.getuid() and
              info.st_mode & 0o777 == (0o700 if directory else 0o600) and
              (path.is_dir() if directory else path.is_file()), 'private-path')


def write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def record(path, value):
    write(path, p.canonical(value))


def begin(parent, name, value):
    path = parent/name
    path.mkdir(mode=0o700)
    sync(parent)
    record(path/'intent.json', value)
    return path


def read(path):
    private(path)
    return json.loads(path.read_bytes())


class Transport:
    """Popen is the only inert replacement in controls. No replay or automatic kill."""

    def __init__(self, root):
        self.root = root
        self.index = 0

    def run(self, argv, data=b'', *, timeout=30, limit=16777216, input_file=None, purpose='native'):
        environment = p.ENV
        if purpose == 'manager-self':
            p.require(argv in [p.manager_argv(p.CAPTURE_UNIT), p.manager_argv(p.OBSERVE_UNIT)]
                      and data == b'' and input_file is None and timeout == 5 and limit == 16384,
                      'manager-fixed-purpose')
            environment = p.manager_env()
        else:
            p.same('native', purpose, 'transport-purpose')
        self.index += 1
        path = begin(self.root, f'request-{self.index:03}', {
            'argv': argv, 'environment': environment, 'purpose': purpose, 'timeout': timeout, 'streamByteLimit': limit,
            'inputSHA256': p.digest(data), 'inputFile': str(input_file) if input_file else None,
            'uid': os.getuid(), 'controllerPID': os.getpid(), 'retry': 'FORBIDDEN'})
        self.last_path = path
        write(path/'input.bin', data)
        out = open(path/'stdout.bin', 'xb', buffering=0)
        err = open(path/'stderr.bin', 'xb', buffering=0)
        os.fchmod(out.fileno(), 0o600)
        os.fchmod(err.fileno(), 0o600)
        proc = None
        code = None
        failure = None
        start = time.monotonic()
        counts = {'stdout': 0, 'stderr': 0}
        try:
            # File input is pinned by the controller before/after rendering. Its
            # exact descriptor remains open across Popen, with no inherited env.
            stream = input_file.open('rb') if input_file else None
            try:
                proc = subprocess.Popen(argv, stdin=stream if stream else subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, close_fds=True)
            finally:
                if stream:
                    stream.close()
            p.positive(proc.pid, 'transport-pid')
            record(path/'returned-process.json', {'pid': proc.pid, 'ack': 'process-returned-only'})
            with selectors.DefaultSelector() as selector:
                for pipe, label in ((proc.stdout, 'stdout'), (proc.stderr, 'stderr')):
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, label)
                pending = memoryview(data)
                if not input_file:
                    os.set_blocking(proc.stdin.fileno(), False)
                    if pending:
                        selector.register(proc.stdin, selectors.EVENT_WRITE, 'input')
                    else:
                        proc.stdin.close()
                while selector.get_map():
                    p.require(time.monotonic()-start < timeout, 'transport-deadline')
                    for key, _ in selector.select(min(0.1, timeout)):
                        if key.data == 'input':
                            written = os.write(key.fd, pending[:65536])
                            pending = pending[written:]
                            if not pending:
                                selector.unregister(key.fileobj)
                                key.fileobj.close()
                            continue
                        bound = limit if key.data == 'stdout' else min(limit,1048576)
                        chunk = os.read(key.fd, min(65536, bound-counts[key.data]+1))
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        counts[key.data] += len(chunk)
                        allowed = len(chunk)-max(0, counts[key.data]-bound)
                        (out if key.data == 'stdout' else err).write(chunk[:allowed])
                        p.require(counts[key.data] <= bound, 'transport-output-bound')
            code = proc.wait(timeout=max(0.001, timeout-(time.monotonic()-start)))
            p.require(time.monotonic()-start < timeout, 'transport-late-terminal')
            p.same(0,counts['stderr'],'transport-unknown-stderr')
        except BaseException as error:
            failure = type(error).__name__
            # Close only our descriptors. Never infer rollback/backend death or
            # terminate another process. A surviving process remains UNKNOWN.
            if proc:
                for pipe in (proc.stdin, proc.stdout, proc.stderr):
                    if pipe and not pipe.closed:
                        pipe.close()
            raise
        finally:
            for stream in (out, err):
                os.fsync(stream.fileno())
                stream.close()
            sync(path)
            record(path/'terminal.json', {'returncode': code, 'errorType': failure,
                'elapsedSeconds': time.monotonic()-start, 'timeoutSeconds': timeout,
                'classification': 'terminal' if code is not None and failure is None else 'UNKNOWN_NO_REPLAY',
                'backend': 'unassessed', 'commitACK': 'unassessed',
                'observedStdoutBytes': counts['stdout'], 'observedStderrBytes': counts['stderr'],
                'stdoutBytes': (path/'stdout.bin').stat().st_size,
                'stderrBytes': (path/'stderr.bin').stat().st_size,
                'stdoutSHA256': p.digest((path/'stdout.bin').read_bytes()),
                'stderrSHA256': p.digest((path/'stderr.bin').read_bytes())})
        p.same(0, code, 'transport-nonzero')
        return (path/'stdout.bin').read_bytes()


def self_identity():
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines()
                  if ':' in line)
    uids = [int(value) for value in status['Uid'].split()]
    groups = [line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines()
              if line.startswith('0::')]
    p.same(1, len(groups), 'manager-unified-cgroup')
    base = Path('/sys/fs/cgroup')/groups[0].lstrip('/')
    return {'pid': os.getpid(), 'uid': os.getuid(), 'uids': uids,
            'invocation': os.environ.get('INVOCATION_ID', ''), 'controlGroup': groups[0],
            'resources': {'memoryMax': int((base/'memory.max').read_text()),
                'swapMax': int((base/'memory.swap.max').read_text()),
                'cpuMax': (base/'cpu.max').read_text().strip(),
                'tasksMax': int((base/'pids.max').read_text())}}


def request_custody(path):
    private(path, True)
    names = ('intent.json', 'input.bin', 'returned-process.json', 'stdout.bin', 'stderr.bin', 'terminal.json')
    values = {}
    for name in names:
        private(path/name)
        values[name] = p.digest((path/name).read_bytes())
    return values


def verify_manager_ack(attempt, unit, entry, runtime):
    ack = read(attempt/'manager-ack.json')
    p.same({'unitName', 'entry', 'runtimeSeconds', 'properties', 'request', 'custody'},
           set(ack), 'manager-ack-fields')
    p.same(unit, ack['unitName'], 'manager-ack-unit')
    p.same(entry, ack['entry'], 'manager-ack-entry')
    p.same(runtime, ack['runtimeSeconds'], 'manager-ack-runtime')
    p.same('request-001', ack['request'], 'manager-first-request')
    path = attempt/'request-001'
    p.same(request_custody(path), ack['custody'], 'manager-request-custody')
    intent, returned, terminal = read(path/'intent.json'), read(path/'returned-process.json'), read(path/'terminal.json')
    p.same(p.manager_argv(unit), intent.get('argv'), 'manager-custody-argv')
    p.same(p.manager_env(), intent.get('environment'), 'manager-custody-environment')
    p.same('manager-self', intent.get('purpose'), 'manager-custody-purpose')
    p.same(5, intent.get('timeout'), 'manager-custody-time')
    p.same(16384, intent.get('streamByteLimit'), 'manager-custody-bound')
    p.same(p.digest(b''), intent.get('inputSHA256'), 'manager-custody-input')
    p.same(b'', (path/'input.bin').read_bytes(), 'manager-empty-input')
    p.same(entry['pid'], intent.get('controllerPID'), 'manager-custody-entry-pid')
    p.same(entry['uid'], intent.get('uid'), 'manager-custody-entry-uid')
    p.positive(returned.get('pid'), 'manager-returned-helper-pid')
    p.same('process-returned-only', returned.get('ack'), 'manager-returned-helper-ack')
    p.same(0, terminal.get('returncode'), 'manager-custody-exit')
    p.same(None, terminal.get('errorType'), 'manager-custody-error')
    p.same('terminal', terminal.get('classification'), 'manager-custody-terminal')
    for label in ('stdout', 'stderr'):
        raw = (path/(label+'.bin')).read_bytes()
        p.same(len(raw), terminal.get(label+'Bytes'), 'manager-custody-bytes')
        p.same(len(raw), terminal.get('observed'+label.title()+'Bytes'), 'manager-custody-observed')
        p.same(p.digest(raw), terminal.get(label+'SHA256'), 'manager-custody-stream-hash')
    p.same(b'', (path/'stderr.bin').read_bytes(), 'manager-custody-stderr')
    properties = p.manager_properties((path/'stdout.bin').read_bytes())
    p.same(properties, ack['properties'], 'manager-ack-properties')
    p.manager_binding(ack['properties'], entry, unit, runtime)
    p.manager_binding(properties, entry, unit, runtime)
    return ack


def manager_ack(transport, attempt, unit, uid, runtime):
    p.same(0, transport.index, 'manager-before-native')
    entry = self_identity()
    p.same(uid, entry['uid'], 'manager-granted-uid')
    raw = transport.run(p.manager_argv(unit), timeout=5, limit=16384, purpose='manager-self')
    properties = p.manager_properties(raw)
    p.manager_binding(properties, entry, unit, runtime)
    record(attempt/'manager-ack.json', {'unitName': unit, 'entry': entry,
        'runtimeSeconds': runtime, 'properties': properties,
        'request': 'request-001', 'custody': request_custody(transport.last_path)})
    verify_manager_ack(attempt, unit, entry, runtime)
    return entry


def credential_absence(transport):
    raw = transport.run(p.absence_argv(), timeout=5, limit=4096)
    p.same(b'', raw, 'credential-directory-must-be-absent')
