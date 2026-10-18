"""DISABLED source proposal. ROOT must supply complete runtime closure and exact authority."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import runpy
import selectors
import signal
import stat
import struct
import subprocess
import sys
import time

HERE = Path('/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-window-preparation-r1')
ROOT = Path('/home/nathaniel/.local/state/openplan/m1-history-operation-pure-root-decision-20261016')
ATTEMPT = ROOT / 'attempt-01'
OUTPUT = HERE / 'pure-output-01'
LOCK = ROOT.parent / 'compiler-repair-checks-20261015.lock'
HOST_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'HOME': '/nonexistent',
            'XDG_RUNTIME_DIR': '/run/user/1000', 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/1000/bus'}


def load_api():
    spec = importlib.util.spec_from_file_location('_m1_operation_window_api', HERE / 'window_primitives.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def authority(api, expected, namespace=False):
    raw = api.read_blob(HERE / 'PURE_REQUEST.json', 1048576)
    api.need(hashlib.sha256(raw).hexdigest() == expected, 'pure-request-pin')
    request = json.loads(raw)
    # This source footprint is not dynamic ABI acceptance or a grant.
    closure = request['runtimeClosure']
    api.need(closure['status'] == 'ROOT_ACCEPTED_SELECTED_STATIC_PYTHON_FOOTPRINT',
             'pure-runtime-closure-unresolved')
    manifest_raw = api.read_blob(closure['manifestPath'], 1048576)
    receipt_raw = api.read_blob(closure['reviewReceiptPath'], 1048576)
    api.need(hashlib.sha256(manifest_raw).hexdigest() == closure['manifestSHA256']
             and hashlib.sha256(receipt_raw).hexdigest() == closure['reviewReceiptSHA256'], 'pure-runtime-authority-pins')
    runtime, receipt = json.loads(manifest_raw), json.loads(receipt_raw)
    api.runtime_policy(closure, runtime, receipt)
    grant = json.loads(api.read_blob(ROOT / 'GRANT.json', 1048576))
    api.need(grant['status'] == 'GRANTED_ONE_M1_HISTORY_OPERATION_PURE23_WINDOW'
             and grant['requestSHA256'] == expected
             and grant['sourceInputsSHA256'] == request['sourceInputsSHA256']
             and grant['runtimeManifestSHA256'] == closure['manifestSHA256']
             and grant['runtimeReviewReceiptSHA256'] == closure['reviewReceiptSHA256']
             and grant['subjectSysArgv'] == [str(HERE / 'pure_main.py'), expected]
             and grant['executionModel'] == 'GUARDED_SAME_PROCESS_RUNPY'
             and grant['unit'] == request['proposedUnit']
             and grant['native'] is False and grant['archive'] is False and grant['retry'] is False
             and grant['limits'] == request['limits'], 'pure-exact-root-grant')
    api.need(closure['manifestPath'] == str(HERE / 'RUNTIME_MANIFEST.json')
             and closure['reviewReceiptPath'] == '/home/nathaniel/.local/state/openplan/a0-python-elf-root-static-audit-20261016/ROOT_SOURCE_DISPOSITION_02.json'
             and closure['reviewReceiptSHA256'] == 'db6c8a9a72e8a4be88b9eac89a0983fa8c12a914d8976f19dacc3285f7ef6f0b',
             'pure-fixed-closure-authority-paths')
    api.need(type(grant['issuedUnixNs']) is int and type(grant['expiresUnixNs']) is int
             and grant['issuedUnixNs'] <= time.time_ns() < grant['expiresUnixNs']
             and 0 < grant['expiresUnixNs'] - grant['issuedUnixNs'] <= 60000000000, 'pure-root-grant-time')
    source_raw = api.read_blob(HERE / 'SOURCE_INPUTS.json', 1048576)
    api.need(hashlib.sha256(source_raw).hexdigest() == request['sourceInputsSHA256'], 'pure-source-input-manifest')
    sources = json.loads(source_raw)
    for path, pin in sources['mountInputs'].items():
        api.descriptor(path, pin, namespace)
    # No path is an implicit tree mount. Runtime aliases must have separately pinned targets.
    api.need(all(path.startswith('/usr/') and not Path(path).is_symlink() for path in runtime['files'])
             and runtime['pythonResolved'] in runtime['files'] and runtime['python'] in runtime['aliases']
             and runtime['topAliases'] == {'/bin': 'usr/bin', '/sbin': 'usr/sbin', '/lib': 'usr/lib', '/lib64': 'usr/lib64'},
             'pure-fixed-runtime-files')
    if not namespace:
        for path, pin in runtime['hostTools'].items():
            api.descriptor(path, pin)
    for path, pin in runtime['files'].items():
        api.descriptor(path, pin, namespace)
    for path, target in runtime['aliases'].items():
        api.need(path.startswith('/usr/') and Path(path).is_symlink() and os.readlink(path) == target
                 and str(Path(path).resolve(strict=True)) in runtime['files'], 'pure-runtime-alias-target')
        info = os.lstat(path)
        wanted = runtime['aliasMetadata'][path]
        keys = ['mode'] if namespace else ['mode', 'uid', 'gid']
        actual = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
        api.need(all(actual[key] == wanted[key] for key in keys), 'pure-runtime-alias-metadata')
    return request, runtime, sources, grant


def environment():
    return {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC',
            'HOME': str(ATTEMPT / 'home'), 'TMPDIR': '/tmp', 'PWD': str(OUTPUT),
            'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONHASHSEED': '0'}


def seccomp_fd():
    code = [(0x20, 0, 0, 4), (0x15, 1, 0, 0xc000003e), (0x06, 0, 0, 0x80000000),
            (0x20, 0, 0, 0), (0x35, 0, 1, 0x40000000), (0x06, 0, 0, 0x80000000)]
    for number in [41, 42, 43, 44, 45, 46, 47, 49, 50, 51, 52, 53, 54, 55, 288, 299, 307, 425, 426, 427]:
        code.extend([(0x15, 0, 1, number), (0x06, 0, 0, 0x00050001)])
    code.append((0x06, 0, 0, 0x7fff0000))
    fd = os.memfd_create('m1-operation-pure-no-sockets', 0)
    raw = b''.join(struct.pack('<HBBI', *row) for row in code)
    offset = 0
    while offset < len(raw):
        count = os.write(fd, raw[offset:])
        if count <= 0:
            raise RuntimeError('pure-seccomp-short-write')
        offset += count
    os.lseek(fd, 0, 0)
    os.set_inheritable(fd, True)
    return fd


def namespace_argv(api, runtime, sources, expected, policy_fd):
    argv = [runtime['bwrap'], '--die-with-parent', '--unshare-net', '--unshare-pid',
            '--cap-drop', 'ALL', '--tmpfs', '/', '--tmpfs', '/usr']
    paths = set(runtime['files']) | set(runtime['aliases']) | set(sources['mountInputs'])
    paths |= {str(HERE / 'PURE_REQUEST.json'), str(HERE / 'SOURCE_INPUTS.json'), str(ROOT / 'GRANT.json'),
              str(ROOT / 'attempt-01'), str(OUTPUT), '/dev/null', '/sys/fs/cgroup', '/proc/self'}
    closure = json.loads(api.read_blob(HERE / 'PURE_REQUEST.json', 1048576))['runtimeClosure']
    paths |= {closure['manifestPath'], closure['reviewReceiptPath']}
    paths |= {str(Path(x).parent) for x in paths}
    directories = {'/dev', '/proc', '/run', '/var', '/sys', '/sys/fs', '/tmp', str(ATTEMPT / 'home')}
    for path in paths:
        parent = Path(path).parent
        while str(parent) not in ('/', '.'):
            directories.add(str(parent))
            parent = parent.parent
    for path in sorted(directories, key=lambda x: (x.count('/'), x)):
        if path != '/usr':
            argv += ['--dir', path]
    for path, target in runtime['topAliases'].items():
        argv += ['--symlink', target, path]
    for path, target in runtime['aliases'].items():
        argv += ['--symlink', target, path]
    for path in runtime['files']:
        argv += ['--ro-bind', path, path]
    argv += ['--remount-ro', '/usr']
    for path in sources['mountInputs']:
        argv += ['--ro-bind', path, path]
    for path in [str(HERE / 'PURE_REQUEST.json'), str(HERE / 'SOURCE_INPUTS.json'), str(ROOT / 'GRANT.json')]:
        argv += ['--ro-bind', path, path]
    for path in [closure['manifestPath'], closure['reviewReceiptPath']]:
        argv += ['--ro-bind', path, path]
    argv += ['--proc', '/proc', '--remount-ro', '/proc', '--ro-bind', '/sys/fs/cgroup', '/sys/fs/cgroup',
             '--bind', str(ATTEMPT), str(ATTEMPT), '--bind', str(OUTPUT), str(OUTPUT),
             '--bind', str(ATTEMPT / 'tmp'), '/tmp', '--ro-bind', '/dev/null', '/dev/null',
             '--remount-ro', '/', '--dev-bind', '/dev/null', '/dev/null', '--clearenv']
    for key, value in environment().items():
        argv += ['--setenv', key, value]
    argv += ['--chdir', str(OUTPUT), '--seccomp', str(policy_fd), '--', runtime['python'],
             '-I', '-S', '-B', str(HERE / 'pure_window.py'), '--inner', expected]
    api.null_setup_policy(argv)
    return argv


def sandbox(api, expected):
    request, runtime, sources, grant = authority(api, expected)
    api.record(ATTEMPT / 'sandbox-entry.json', {'pid': os.getpid(), 'uid': os.getuid(),
               'invocation': os.environ.get('INVOCATION_ID'), 'requestSHA256': expected})
    fd = None
    primary = saved = None
    issues = []
    try:
        fd = seccomp_fd()
        argv = namespace_argv(api, runtime, sources, expected, fd)
        api.record(ATTEMPT / 'bwrap-argv.json', argv)
        os.execve(argv[0], argv, HOST_ENV)
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        if fd is not None:
            api.attempt_finalization(issues, 'seccomp-fd-close', lambda: os.close(fd))
    terminal = {'primary': api.error_detail(primary) if primary else None, 'cleanupIssues': issues}
    api.attempt_finalization(issues, 'sandbox-failure-record', lambda: api.record(ATTEMPT / 'sandbox-failure.json', terminal))
    api.propagate(primary, saved, terminal)


def observe(api, sources, runtime, label, request):
    # Persist the raw table before the first guard, including on a future refusal.
    raw = api.read_blob('/proc/self/mountinfo', 1048576)
    api.write_blob(ATTEMPT / (label + '.mountinfo'), raw)
    mounts = []
    for line in raw.decode('utf-8', 'strict').splitlines():
        left, right = line.split(' - ', 1)
        fields = left.split()
        mounts.append({'path': fields[4], 'options': fields[5].split(','), 'filesystem': right.split()[0]})
    rw = [str(ATTEMPT), str(OUTPUT), '/tmp', '/dev/null']
    ro = ['/', '/usr', '/proc', '/sys/fs/cgroup'] + list(sources['mountInputs'])
    ro += [str(HERE / 'PURE_REQUEST.json'), str(HERE / 'SOURCE_INPUTS.json'), str(ROOT / 'GRANT.json')]
    api.mount_policy(mounts, rw, ro)
    api.need(set(os.listdir('/dev')) == {'null'} and not os.listdir('/run') and not os.listdir('/var'), 'pure-empty-service-layout')
    null = os.stat('/dev/null')
    api.need(stat.S_ISCHR(null.st_mode) and (os.major(null.st_rdev), os.minor(null.st_rdev)) == (1, 3), 'pure-null-device')
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    api.need(status['NoNewPrivs'].strip() == '1' and status['Seccomp'].strip() == '2'
             and all(int(status[name], 16) == 0 for name in ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']), 'pure-seccomp-capabilities')
    cgroup_line = Path('/proc/self/cgroup').read_text().strip()
    api.need(cgroup_line.startswith('0::/') and request['proposedUnit'] in cgroup_line, 'pure-unit-cgroup')
    cgroup = Path('/sys/fs/cgroup') / cgroup_line[4:]
    actual = {key: (cgroup / key).read_text().strip() for key in api.CAPS}
    api.resource_policy(actual)
    intent = json.loads(api.read_blob(ATTEMPT / 'intent.json', 1048576))
    namespaces = {name: os.readlink('/proc/self/ns/' + name) for name in ['net', 'pid', 'mnt']}
    api.need(all(namespaces[name] != intent['hostNamespaces'][name] for name in namespaces), 'pure-fresh-namespaces')
    api.need(os.environ == environment(), 'pure-private-environment')
    ro_trials = {}
    for path in [str(HERE.parent / 'operation_caller.py'), str(ROOT / 'GRANT.json')]:
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        except OSError as error:
            api.need(error.errno == 30, 'pure-readonly-errno30')
            ro_trials[path] = error.errno
        else:
            os.close(fd)
            raise RuntimeError('pure-readonly-write-open-succeeded')
    pins = {path: api.descriptor(path, pin, True) for path, pin in sources['mountInputs'].items()}
    for path, pin in runtime['files'].items():
        api.descriptor(path, pin, True)
    result = {'mounts': mounts, 'actualResources': actual, 'namespaces': namespaces, 'inputPins': pins,
              'readonlyTrials': ro_trials, 'innerPID': os.getpid(), 'uid': os.getuid(), 'gid': os.getgid(),
              'uidMap': Path('/proc/self/uid_map').read_text(), 'gidMap': Path('/proc/self/gid_map').read_text(),
              'namespaceOwnerParity': 'UNPROVED', 'memoryPeakSample': (cgroup / 'memory.peak').read_text().strip(),
              'pidsPeakSample': (cgroup / 'pids.peak').read_text().strip(),
              'memoryEventsSample': (cgroup / 'memory.events').read_text(), 'finalWholeUnitPeak': False}
    api.record(ATTEMPT / (label + '.observation.json'), result)
    return result


def inner(api, expected):
    started = time.monotonic()
    request, runtime, sources, grant = authority(api, expected, True)
    primary = saved = None
    issues = []
    original_argv = sys.argv
    try:
        observe(api, sources, runtime, 'before', request)
        # New data-only guard cohort is separate from the unchanged subject23/25.
        primitive_raw = api.read_blob(HERE / 'guard_controls.py', 1048576)
        guard_namespace = {'__name__': '_m1_operation_window_controls', '__file__': str(HERE / 'guard_controls.py')}
        api.record(ATTEMPT / 'guard-controls-intent.json', {'sourceSHA256': hashlib.sha256(primitive_raw).hexdigest(),
                   'requestSHA256': expected, 'authority': 'SUPPLIED_GUARD_DATA_ONLY'})
        exec(compile(primitive_raw, str(HERE / 'guard_controls.py'), 'exec'), guard_namespace)
        guard_report = guard_namespace['run'](api.read_blob(HERE / 'window_primitives.py', 1048576))
        api.record(ATTEMPT / 'guard-controls.json', guard_report)
        api.record(ATTEMPT / 'subject-entry-intent.json', {'requestSHA256': expected, 'sameProcessPID': os.getpid(),
                   'sourceInputsSHA256': request['sourceInputsSHA256'], 'executionModel': 'GUARDED_SAME_PROCESS_RUNPY'})
        sys.argv = [str(HERE / 'pure_main.py'), expected]
        api.need(time.monotonic() - started < 25, 'pure-inner-deadline-before-subject')
        runpy.run_path(str(HERE / 'pure_main.py'), run_name='__main__',
                       init_globals={'WINDOW_API': api, 'WINDOW_STARTED': started})
        api.need(time.monotonic() - started < 25, 'pure-inner-deadline-after-subject')
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        sys.argv = original_argv
        api.attempt_finalization(issues, 'final-security-readback', lambda: observe(api, sources, runtime, 'after', request))
        for path, pin in sources['mountInputs'].items():
            api.attempt_finalization(issues, 'final-input:' + path, lambda path=path, pin=pin: api.descriptor(path, pin, True))
        for path, pin in runtime['files'].items():
            api.attempt_finalization(issues, 'final-runtime-input:' + path,
                    lambda path=path, pin=pin: api.descriptor(path, pin, True))
        terminal = {'primary': api.error_detail(primary) if primary is not None else None,
                    'cleanupIssues': issues, 'terminalRecordFailure': None, 'subject23Only': True}
        try:
            api.record(ATTEMPT / 'inner-terminal.json', terminal)
        except BaseException as error:
            terminal['terminalRecordFailure'] = api.error_detail(error)
            issues.append(dict(operation='inner-terminal-record', **api.error_detail(error)))
    api.propagate(primary, saved, terminal)


def collect(api, process, start):
    selector = None
    streams = {}
    observed = {'stdout': 0, 'stderr': 0}
    primary = saved = None
    issues = []
    code = None
    try:
        selector = selectors.DefaultSelector()
        for name, pipe in [('stdout', process.stdout), ('stderr', process.stderr)]:
            stream_fd = os.open(ATTEMPT / (name + '.bin'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
            streams[name] = stream_fd
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name)
        while selector.get_map():
            api.need(time.monotonic() - start < 40, 'pure-parent-deadline')
            for key, _ in selector.select(0.05):
                raw = os.read(key.fileobj.fileno(), 65536)
                if not raw:
                    selector.unregister(key.fileobj)
                    continue
                name = key.data
                remaining = 1048576 - observed[name]
                observed[name] += len(raw)
                if remaining > 0:
                    kept = raw[:remaining]
                    written = os.write(streams[name], kept)
                    api.need(written == len(kept), 'pure-parent-short-stream-write')
                api.need(observed[name] <= 1048576, 'pure-parent-stream-overflow:' + name)
        code = process.wait(timeout=max(0.001, 40 - (time.monotonic() - start)))
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        if process.returncode is None:
            api.attempt_finalization(issues, 'owned-manager-client-kill', lambda: os.kill(process.pid, signal.SIGKILL))
            api.attempt_finalization(issues, 'owned-manager-client-wait', lambda: process.wait(timeout=2))
        if selector is not None:
            api.attempt_finalization(issues, 'selector-close', selector.close)
        for name, stream_fd in streams.items():
            # Raw FDs have no userspace buffer to flush.
            api.attempt_finalization(issues, name + '-fsync', lambda stream_fd=stream_fd: os.fsync(stream_fd))
            api.attempt_finalization(issues, name + '-close', lambda stream_fd=stream_fd: os.close(stream_fd))
        for name, pipe in [('stdout', process.stdout), ('stderr', process.stderr)]:
            if pipe is not None:
                api.attempt_finalization(issues, name + '-pipe-close', pipe.close)
    stream_pins = {}
    for name in ['stdout', 'stderr']:
        def stream_readback(name=name):
            path = ATTEMPT / (name + '.bin')
            raw = api.read_blob(path, 1048576)
            return {'path': str(path), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                    'mode': stat.S_IMODE(path.stat().st_mode)}
        stream_pins[name] = api.attempt_finalization(issues, name + '-stream-readback', stream_readback)
    terminal = {'primary': api.error_detail(primary) if primary is not None else None, 'cleanupIssues': issues,
                'managerClientReturncode': process.returncode, 'waitReturncode': code, 'observedBytes': observed,
                'streams': stream_pins,
                'serviceCancellationProved': False, 'terminalRecordFailure': None}
    try:
        api.record(ATTEMPT / 'collector-terminal.json', terminal)
    except BaseException as error:
        terminal['terminalRecordFailure'] = api.error_detail(error)
        issues.append(dict(operation='collector-terminal-record', **api.error_detail(error)))
    api.propagate(primary, saved, terminal)
    api.need(code == 0, 'pure-manager-nonzero')
    return terminal


def outer(api, expected):
    request, runtime, sources, grant = authority(api, expected)
    preservation = json.loads(api.read_blob(HERE / 'PRESERVATION.json', 1048576))['files']
    # Lock identity and manager/bwrap/Python pins are ROOT-owned future preflight fields.
    lock_fd = None
    primary = saved = None
    issues = []
    process = None
    collector_entered = False
    try:
        for path, pin in preservation.items():
            api.descriptor(path, {key: pin[key] for key in ['bytes', 'sha256', 'mode', 'uid', 'gid']})
        lock_fd = os.open(LOCK, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        lock_info = os.fstat(lock_fd)
        api.need([lock_info.st_dev, lock_info.st_ino] == grant['lockDeviceInode'], 'pure-root-lock-identity')
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        api.need(not ATTEMPT.exists() and not OUTPUT.exists(), 'pure-no-retry-new-paths')
        ATTEMPT.mkdir(mode=0o700)
        for name in ['home', 'tmp']:
            (ATTEMPT / name).mkdir(mode=0o700)
        OUTPUT.mkdir(mode=0o700)
        argv = ['/usr/bin/systemd-run', '--user', '--wait', '--pipe', '--collect', '--unit=' + request['proposedUnit']]
        for key, value in [('RuntimeMaxSec', '30'), ('TimeoutStopSec', '1'), ('KillMode', 'control-group'),
                           ('MemoryMax', '512M'), ('MemorySwapMax', '0'), ('CPUQuota', '50%'), ('CPUQuotaPeriodSec', '100ms'),
                           ('TasksMax', '64'), ('LimitCORE', '0'), ('UMask', '0077')]:
            argv += ['--property=' + key + '=' + value]
        argv += ['--', runtime['python'], '-I', '-S', '-B', str(HERE / 'pure_window.py'), '--sandbox', expected]
        api.need(argv == grant['managerArgv'], 'pure-exact-manager-argv')
        api.record(ATTEMPT / 'intent.json', {'requestSHA256': expected, 'argv': argv, 'parentPID': os.getpid(),
                   'hostNamespaces': {name: os.readlink('/proc/self/ns/' + name) for name in ['net', 'pid', 'mnt']},
                   'oneAttempt': True, 'runtimeManifestSHA256': request['runtimeClosure']['manifestSHA256']})
        api.need(time.time_ns() < grant['expiresUnixNs'], 'pure-root-grant-expired-before-manager')
        start = time.monotonic()
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=HOST_ENV, close_fds=True)
        api.record(ATTEMPT / 'returned.json', {'managerClientPID': process.pid, 'requestSHA256': expected})
        collector_entered = True
        collect(api, process, start)
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        if process is not None and not collector_entered and process.returncode is None:
            api.attempt_finalization(issues, 'outer-owned-client-kill', lambda: os.kill(process.pid, signal.SIGKILL))
            api.attempt_finalization(issues, 'outer-owned-client-wait', lambda: process.wait(timeout=2))
        if process is not None and not collector_entered:
            for name, pipe in [('stdout', process.stdout), ('stderr', process.stderr)]:
                if pipe is not None and not pipe.closed:
                    api.attempt_finalization(issues, 'outer-' + name + '-pipe-close', pipe.close)
        for path, pin in preservation.items():
            api.attempt_finalization(issues, 'final-preservation:' + path,
                    lambda path=path, pin=pin: api.descriptor(path, {key: pin[key] for key in ['bytes', 'sha256', 'mode', 'uid', 'gid']}))
        for path, pin in sources['mountInputs'].items():
            api.attempt_finalization(issues, 'final-source:' + path, lambda path=path, pin=pin: api.descriptor(path, pin))
        for path, pin in runtime['files'].items():
            api.attempt_finalization(issues, 'final-runtime:' + path, lambda path=path, pin=pin: api.descriptor(path, pin))
        if lock_fd is not None:
            api.attempt_finalization(issues, 'lock-fd-close', lambda: os.close(lock_fd))
        terminal = {'primary': api.error_detail(primary) if primary is not None else None,
                    'cleanupIssues': issues, 'terminalRecordFailure': None,
                    'managerClientPID': process.pid if process else None,
                    'managerClientReturncode': process.returncode if process else None,
                    'native': False, 'archive': False, 'runtimeProvedBySource': False}
        if ATTEMPT.is_dir():
            def audit_bound():
                total = sum(path.stat().st_size for root in [ATTEMPT, OUTPUT] for path in root.rglob('*') if path.is_file())
                api.need(total <= 8388608 - 1048576, 'pure-artifact-audit-reserve')
                return total
            terminal['artifactBytesBeforeTerminal'] = api.attempt_finalization(issues, 'artifact-audit', audit_bound)
            try:
                api.record(ATTEMPT / 'terminal.json', terminal)
            except BaseException as error:
                terminal['terminalRecordFailure'] = api.error_detail(error)
                issues.append(dict(operation='outer-terminal-record', **api.error_detail(error)))
    api.propagate(primary, saved, terminal)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('--outer', '--sandbox', '--inner'):
        raise RuntimeError('pure-fixed-mode-and-request-sha-required')
    API = load_api()
    {'--outer': outer, '--sandbox': sandbox, '--inner': inner}[sys.argv[1]](API, sys.argv[2])
