#!/usr/bin/python3
"""Prepared parent collector for one separately granted original catalog wrapper."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time

ROOT = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/outer-v2')
CAPTURE = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2')
RUNTIME = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2')
PACKAGE = 'b9c0e7c418df4a295f44f1374a539e6e33dbd242a210c2840dd07831a6b1a35c'
REQUEST = '9d98505c0569d764e11e6137d9d213b7d5ebb0d39e4215bcd9e6b8e094fb0979'
ARGV = ['/bin/bash', str(CAPTURE/'run-capture-window.sh')]
UNIT = 'openplan-budget-catalog-settings-v2-20261016'
DEADLINE = 115
BOUNDS = {'stdout': 1048576, 'stderr': 65536}
RUNTIME_PINS = {
    'controller.py': '328b1f84a12925345f95aa6d52996f0b1d980bd7ac84de6571f44d8eb6e6788e',
    'journal.py': '18ea275bf28c931979af1ef774ab5e40ec8aca2277308f77695a6c9883905eb6',
    'policy.py': '87918149e6a20accac0fc5d7be2decbe7a75929c5ca7deb74a1f2caf4b4d2d4c',
    'sql.py': 'f9f612ed9f411f4347566b0d0d0d442049e89be0af81882f5014c1e04352df90',
}


def need(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private(path, directory=False):
    info = path.lstat()
    need(not path.is_symlink() and info.st_uid == os.getuid() and
         info.st_mode & 0o777 == (0o700 if directory else 0o600) and
         (path.is_dir() if directory else path.is_file()), 'private-path')


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def record(path, row):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write((json.dumps(row, sort_keys=True, separators=(',', ':'))+'\n').encode())
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def read(path):
    private(path)
    need(0 < path.stat().st_size <= 1048576, 'record-size')
    return json.loads(path.read_bytes())


def manager_env():
    uid = os.getuid()
    need(type(uid) is int and uid > 0, 'manager-user-uid')
    return {'PATH': '/usr/bin:/bin', 'HOME': '/home/nathaniel', 'LANG': 'C.UTF-8',
            'XDG_RUNTIME_DIR': f'/run/user/{uid}',
            'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{uid}/bus'}


def source_pins():
    private(CAPTURE, True)
    need(sha(CAPTURE/'catalog-capture-request.json') == REQUEST, 'exact-original-request')
    request = read(CAPTURE/'catalog-capture-request.json')
    need(request['outerArgv'] == ARGV, 'exact-original-wrapper-argv')
    for name, pin in request['inputs'].items():
        path = CAPTURE/name
        private(path)
        need(sha(path) == pin['sha256'] and path.stat().st_size == pin['bytes'], 'original-input:'+name)
    for name, expected in RUNTIME_PINS.items():
        path = RUNTIME/name
        need(not path.is_symlink() and sha(path) == expected, 'original-runtime:'+name)
    return request


def ready():
    private(ROOT, True)
    private(Path(__file__))
    source_pins()
    grant = read(CAPTURE/'capture-grant.json')
    window = read(CAPTURE/'capture-window.json')
    private(CAPTURE/'capture-review.md')
    need((CAPTURE/'capture-review.md').stat().st_size > 0, 'nonempty-root-capture-review')
    facts = {'schema':2, 'packageSHA256':PACKAGE,
             'requestSHA256': REQUEST, 'stage': 'catalog-capture-v2',
             'exclusive': True, 'nativeOperationGranted': True}
    for row in (grant, window):
        for key, expected in facts.items():
            need(type(row.get(key)) is type(expected) and row.get(key) == expected, 'capture-authority:'+key)
    need(grant.get('uid') == os.getuid() and type(grant.get('uid')) is int and
         grant.get('unitName') == UNIT, 'capture-user-unit')
    now = int(time.time())
    need(type(grant.get('notBefore')) is int and type(grant.get('notAfter')) is int and
         grant['notBefore'] <= now < grant['notAfter'] and
         0 < grant['notAfter']-grant['notBefore'] <= 600, 'fresh-root-capture-window')
    for key in ('notBefore', 'notAfter'):
        need(grant[key] == window.get(key), 'same-root-capture-window')
    files = {'captureGrantSHA256': sha(CAPTURE/'capture-grant.json'),
             'captureReviewSHA256': sha(CAPTURE/'capture-review.md'),
             'captureWindowSHA256': sha(CAPTURE/'capture-window.json')}
    need(grant.get('reviewSHA256') == files['captureReviewSHA256'] and
         grant.get('windowSHA256') == files['captureWindowSHA256'], 'capture-record-hashes')
    authorization = read(ROOT/'collector-authorization.json')
    for key, expected in dict(files, requestSHA256=REQUEST, collectorSHA256=sha(Path(__file__)),
                              nativeOperationGranted=True, exclusive=True, uid=os.getuid()).items():
        need(type(authorization.get(key)) is type(expected) and authorization.get(key) == expected,
             'root-collector-authorization:'+key)
    need(authorization.get('notBefore') == grant['notBefore'] and
         authorization.get('notAfter') == grant['notAfter'], 'collector-same-capture-window')
    outer_intent = read(ROOT/'root-outer-intent.json')
    for key, expected in dict(files, requestSHA256=REQUEST,
            collectorSHA256=sha(Path(__file__)), collectorAuthorizationSHA256=sha(ROOT/'collector-authorization.json'),
            argv=ARGV, unitName=UNIT, retry='FORBIDDEN', deadlineSeconds=DEADLINE,
            stdoutLimit=BOUNDS['stdout'], stderrLimit=BOUNDS['stderr']).items():
        need(type(outer_intent.get(key)) is type(expected) and outer_intent[key] == expected,
             'root-outer-intent:'+key)
    return dict(files, requestSHA256=REQUEST, collectorSHA256=sha(Path(__file__)), runtimePins=RUNTIME_PINS,
                collectorAuthorizationSHA256=sha(ROOT/'collector-authorization.json'))


def remaining(start):
    left = DEADLINE-(time.monotonic()-start)
    if left <= 0:
        raise TimeoutError('collector-deadline')
    return left


def collect(folder):
    # The caller durably reserves the namespace and exact intent before this call.
    outputs = {label: open(folder/(label+'.bin'), 'xb', buffering=0) for label in BOUNDS}
    for stream in outputs.values():
        os.fchmod(stream.fileno(), 0o600)
    proc, code, failure = None, None, None
    counts = dict.fromkeys(BOUNDS, 0)
    start = time.monotonic()
    try:
        proc = subprocess.Popen(ARGV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=manager_env(), close_fds=True)
        need(type(proc.pid) is int and proc.pid > 0, 'returned-wrapper-pid')
        record(folder/'returned-process.json', {'parentPID': os.getpid(),
               'wrapperPID': proc.pid, 'ack': 'process-returned-only'})
        with selectors.DefaultSelector() as selector:
            for label, pipe in (('stdout', proc.stdout), ('stderr', proc.stderr)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, label)
            while selector.get_map():
                left = remaining(start)
                for key, _ in selector.select(min(0.1, left)):
                    label, bound = key.data, BOUNDS[key.data]
                    chunk = os.read(key.fd, min(65536, bound-counts[label]+1))
                    if not chunk:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                        continue
                    counts[label] += len(chunk)
                    outputs[label].write(chunk[:len(chunk)-max(0, counts[label]-bound)])
                    if counts[label] > bound:
                        raise RuntimeError('collector-overflow:'+label)
            code = proc.wait(timeout=remaining(start))
            remaining(start)
    except BaseException as error:
        failure = {'type': type(error).__name__, 'reason': str(error)}
        # Close only collector descriptors. Never kill, replay or infer backend death.
        if proc:
            for pipe in (proc.stdout, proc.stderr):
                if pipe and not pipe.closed:
                    pipe.close()
    finally:
        for stream in outputs.values():
            os.fsync(stream.fileno())
            stream.close()
        sync(folder)
        terminal = {'parentPID': os.getpid(), 'wrapperPID': proc.pid if proc else None,
            'returncode': code, 'failure': failure,
            'classification': ('UNKNOWN_NO_REPLAY' if failure or code is None else
                               'terminal-zero' if code == 0 else 'terminal-nonzero'),
            'elapsedSeconds': time.monotonic()-start, 'deadlineSeconds': DEADLINE,
            'backendDeath': 'UNASSESSED', 'streams': {label: {
                'observedBytes': counts[label], 'retainedBytes': (folder/(label+'.bin')).stat().st_size,
                'sha256': sha(folder/(label+'.bin')), 'limit': BOUNDS[label]} for label in BOUNDS}}
        record(folder/'terminal.json', terminal)
    return terminal


def correlate(folder, facts):
    raw = (folder/'stderr.bin').read_text()
    starts = re.findall(r'(?m)^Running as unit: (.*)$', raw)
    need(len(starts) == 1, 'one-manager-start-line')
    start = re.fullmatch(re.escape(UNIT)+r'\.service(?:; invocation ID: ([a-f0-9]{32}))?', starts[0])
    need(start is not None, 'fixed-manager-start-line')
    need('Finished with result: success' in raw and
         'Main processes terminated with: code=exited, status=0/SUCCESS' in raw,
         'manager-wait-reported-success')
    intent = read(CAPTURE/'capture-attempt/intent.json')
    complete = read(CAPTURE/'capture-attempt/complete.json')
    need(complete.get('status') == 'capture-complete' and complete.get('schema') == 2,
         'actual-capture-complete')
    # This imports pinned NEW source for an inert artifact validator, never a manager call.
    sys.path.insert(0, str(RUNTIME))
    import journal as j
    import policy as p
    ack_path = CAPTURE/'capture-attempt/manager-ack.json'
    private(ack_path)
    need(complete.get('managerAckSHA256') == sha(ack_path), 'capture-manager-ack-hash')
    ack = j.verify_manager_ack(CAPTURE/'capture-attempt', UNIT, intent['entry'], 90)
    invocation = ack['entry']['invocation']
    need(start[1] is None or start[1] == invocation, 'optional-start-invocation-match')
    need(intent.get('controllerPID') == ack['entry']['pid'] and
         type(intent.get('controllerPID')) is int and intent.get('uid') == os.getuid()
         and ack['entry']['uid'] == os.getuid(), 'capture-entry-pid-uid')
    for row in (intent, complete):
        need(row.get('entry') == ack['entry'], 'capture-manager-entry')
        need(row.get('invocation') == invocation, 'capture-manager-invocation')
        need(row.get('unitName') == UNIT, 'capture-manager-unit')
        need(row.get('requestSHA256') == REQUEST and
             row.get('grantSHA256') == facts['captureGrantSHA256'], 'capture-intent-complete-binding')
        need(row.get('inputSHA256') == sha(CAPTURE/'catalog-capture.sql'), 'capture-exact-query')
    for key, name in (('catalogSHA256','catalog.json'), ('scopeSHA256','original-scope.json')):
        path = CAPTURE/'capture-attempt'/name
        private(path)
        need(path.stat().st_size > 0 and complete.get(key) == sha(path), 'capture-output:'+key)
    p.scope(read(CAPTURE/'capture-attempt/original-scope.json'))
    for key, name in (('captureGrantSHA256','capture-grant.json'),
                      ('captureReviewSHA256','capture-review.md'), ('captureWindowSHA256','capture-window.json')):
        need(facts[key] == sha(CAPTURE/name), 'root-record-unchanged:'+key)
    source_pins()
    need(facts['collectorSHA256'] == sha(Path(__file__)) and
         facts['collectorAuthorizationSHA256'] == sha(ROOT/'collector-authorization.json'),
         'collector-source-authorization-unchanged')
    return {'invocation':invocation, 'managerWait':'reported-success',
            'postShow':'RAW_RETAINED_UNBOUND_FOR_IDENTITY_AND_LIMITS',
            'captureManagerAckSHA256':sha(ack_path),
            'captureIntentSHA256':sha(CAPTURE/'capture-attempt/intent.json'),
            'captureCompleteSHA256':sha(CAPTURE/'capture-attempt/complete.json'),
            'outerTerminalSHA256':sha(folder/'terminal.json'),
            'backendDeath':'UNASSESSED', 'successorGranted':False}


def main():
    os.umask(0o077)
    need(sys.argv[1:] == ['--collect-once'], 'one-fixed-collector-entry')
    facts = ready()
    folder = ROOT/'native-capture-parent'
    folder.mkdir(mode=0o700)  # Permanent O_EXCL namespace; no retry or cleanup.
    sync(ROOT)
    record(folder/'intent.json', dict(facts, argv=ARGV, environment=manager_env(),
           stdoutLimit=BOUNDS['stdout'], stderrLimit=BOUNDS['stderr'], deadlineSeconds=DEADLINE,
           parentPID=os.getpid(), inputPins=read(CAPTURE/'catalog-capture-request.json')['inputs'],
           retry='FORBIDDEN'))
    terminal = collect(folder)
    need(terminal['returncode'] == 0 and terminal['failure'] is None, 'collector-transport-refused')
    correlation = correlate(folder, facts)
    record(folder/'complete.json', dict(correlation, status='collected-correlated-capture',
           terminalSHA256=sha(folder/'terminal.json'), **facts))


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('COLLECTOR STOP: retain namespace/streams; no replay or successor', file=sys.stderr)
        raise SystemExit(1)
