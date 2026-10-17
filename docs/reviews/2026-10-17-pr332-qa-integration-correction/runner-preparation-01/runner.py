#!/usr/bin/python3
"""SOURCE ONLY: one future ROOT-granted request, with no retry or successor."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

PUBLIC = Path(__file__).resolve().parent
PRIVATE = Path('/home/nathaniel/.local/state/openplan/pr332-qa-integration-correction-20261017/runner-preparation-01')
REQUEST = PUBLIC / 'REQUEST.json'
EXECUTION = PRIVATE / 'execution-01'
UNIT = 'openplan-pr332-qa-pure-20261017-01'
LOCK = Path('/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock')
STREAM_MAX = 1048576


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_bytes())


def record(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write((json.dumps(value, sort_keys=True, ensure_ascii=True) + '\n').encode())
        stream.flush()
        os.fsync(stream.fileno())


def append(value):
    with open(EXECUTION / 'journal.ndjson', 'ab', buffering=0) as stream:
        stream.write((json.dumps(value, sort_keys=True, ensure_ascii=True) + '\n').encode())
        os.fsync(stream.fileno())


def pinned(entries):
    for item in entries:
        path = Path(item['path'])
        info = path.stat()
        require(info.st_size == item['bytes'] and digest(path) == item['sha256'], 'input_changed:' + str(path))


def inputs(request):
    require(digest(request['inputIndex']['path']) == request['inputIndex']['sha256'], 'input_index_changed')
    index = read_json(request['inputIndex']['path'])
    pinned(index['files'])
    return index


def grant(request):
    path = PRIVATE / 'ROOT_GRANT.json'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and
            stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.getuid(), 'grant_file_custody')
    value = read_json(path)
    now = time.time()
    require(value['requestSHA256'] == digest(REQUEST) and value['runtimeGranted'] is True and
            value['nativeGranted'] is False and value['ciRetryGranted'] is False, 'grant_scope')
    require(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', value['epoch']) is not None, 'root_epoch_missing')
    require(value['issuedAt'] <= now <= value['expiresAt'] <= value['issuedAt'] + 60, 'grant_expired')
    require(request['runtimeGranted'] is False and request['oneShot'] is True, 'request_not_proposal')
    return value


def bounded(argv, cwd, env, name, deadline):
    """Bound both parent pipes, time and the owned subprocess group."""
    output = EXECUTION / 'logs'
    output.mkdir(mode=0o700, exist_ok=True)
    row = {'argv': argv, 'cwd': str(cwd), 'started': time.time(), 'name': name}
    record(output / (name + '.intent.json'), row)
    logs = [open(output / (name + suffix), 'xb', buffering=0) for suffix in ('.stdout', '.stderr')]
    proc = None
    total = [0, 0]
    primary = None
    try:
        require(time.monotonic() < deadline, 'deadline_before:' + name)
        proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ, 0)
            selector.register(proc.stderr, selectors.EVENT_READ, 1)
            while selector.get_map():
                require(time.monotonic() < deadline, 'deadline_during:' + name)
                for key, _ in selector.select(timeout=min(0.1, max(0, deadline - time.monotonic()))):
                    block = os.read(key.fileobj.fileno(), 65536)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    channel = key.data
                    room = STREAM_MAX - total[channel]
                    logs[channel].write(block[:max(0, room)])
                    total[channel] += len(block)
                    require(total[channel] <= STREAM_MAX, 'stream_limit:' + name)
            row['exit'] = proc.wait(timeout=max(0.01, deadline - time.monotonic()))
    except BaseException as error:
        primary = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        if proc is not None and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=2)
            except BaseException as error:
                row['processCleanupError'] = {'type': type(error).__name__, 'message': str(error)}
        for stream in logs:
            stream.close()
        row.update({'finished': time.time(), 'streamBytes': total, 'primaryError': primary})
        record(output / (name + '.receipt.json'), row)
    return row['exit']


def outer(request):
    started = time.monotonic()
    approval = grant(request)
    index = inputs(request)
    EXECUTION.mkdir(mode=0o700)
    deadline = started + 180
    description = 'PR332:' + digest(REQUEST) + ':' + approval['epoch']
    record(EXECUTION / 'outer.json', {'requestSHA256': digest(REQUEST), 'epoch': approval['epoch'],
           'deadlineMono': deadline, 'workDeadlineMono': started + 165,
           'hostNet': os.readlink('/proc/self/ns/net'), 'description': description})
    primary = None
    cleanup = []
    manager_started = False
    terminal = False
    try:
        # No check command, lock probe or manager call occurs before admission.
        # systemd's own atomic unit-name allocation refuses an existing unit.
        manager_started = True
        code = bounded(request['managerArgv'] + ['--description=' + description,
                       '/usr/bin/python3', '-B', str(PUBLIC / 'runner.py'), 'entry'],
                       PUBLIC, os.environ.copy(), 'manager', min(deadline - 8, time.monotonic() + 170))
        require(code == 0, 'manager_nonzero:' + str(code))
        require(read_json(EXECUTION / 'campaign.json')['complete'] is True, 'campaign_incomplete')
    except BaseException as error:
        primary = {'type': type(error).__name__, 'message': str(error)}
    finally:
        # Only stop a unit whose actual Description carries this exact request
        # and ROOT epoch. A unit-name collision must never stop another owner.
        if manager_started:
            try:
                show = ['/usr/bin/systemctl', '--user', 'show', UNIT, '--property=Description', '--value']
                code = bounded(show, PUBLIC, os.environ.copy(), 'cleanup-owner', min(deadline - 4, time.monotonic() + 2))
                observed = (EXECUTION / 'logs/cleanup-owner.stdout').read_text().strip()
                require(code == 0 and observed == description, 'unit_ownership_not_established')
                code = bounded(['/usr/bin/systemctl', '--user', 'stop', UNIT], PUBLIC,
                               os.environ.copy(), 'cleanup-stop', min(deadline - 1, time.monotonic() + 5))
                require(code == 0, 'owned_unit_stop_failed')
                code = bounded(['/usr/bin/systemctl', '--user', 'show', UNIT,
                                '--property=ActiveState', '--property=Result', '--property=ExecMainStatus',
                                '--property=InvocationID'], PUBLIC, os.environ.copy(), 'cleanup-terminal',
                               min(deadline, time.monotonic() + 2))
                text = (EXECUTION / 'logs/cleanup-terminal.stdout').read_text()
                require(code == 0 and ('ActiveState=inactive' in text or 'ActiveState=failed' in text), 'unit_terminal_unknown')
                terminal = True
                cleanup.append({'ownedUnitTerminal': True})
            except BaseException as error:
                cleanup.append({'type': type(error).__name__, 'message': str(error)})
        # Immutable seed and original checkout readback are independent of the
        # namespace worker. Partial evidence and the primary error survive.
        try:
            pinned(index['candidateFiles'])
            pinned(index['seedFiles'])
            if terminal or not manager_started:
                for item in request['mutable']:
                    target = EXECUTION / 'mutable' / item['id']
                    if target.exists():
                        target.write_bytes(Path(item['seed']).read_bytes())
                        require(digest(target) == item['sha256'], 'outer_restore_failed')
                cleanup.append({'originalsAndSeedUnchanged': True, 'privateMutableRestored': True})
            else:
                cleanup.append({'type': 'TerminalUnknown', 'message': 'private restoration deferred; no race with an unconfirmed worker'})
        except BaseException as error:
            cleanup.append({'type': type(error).__name__, 'message': str(error)})
        record(EXECUTION / 'outer-result.json', {'primary': primary, 'cleanup': cleanup,
               'elapsedSeconds': time.monotonic() - started,
               'complete': primary is None and all('type' not in item for item in cleanup)})
    require(primary is None and all('type' not in item for item in cleanup), 'request_not_complete_see_retained_results')


def entry(request):
    approval = grant(request)
    authority = read_json(EXECUTION / 'outer.json')
    require(authority['epoch'] == approval['epoch'] and authority['requestSHA256'] == digest(REQUEST), 'outer_binding')
    inputs(request)
    resource = resources()
    for name in ('tree', 'mutable', 'cache', 'home', 'tmp', 'config', 'state', 'data'):
        (EXECUTION / name).mkdir(mode=0o700)
    for item in request['mutable']:
        (EXECUTION / 'mutable' / item['id']).write_bytes(Path(item['seed']).read_bytes())
    # Exactly one nonblocking attempt. Never create, replace or retry the lock.
    fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if fd != 3:
        os.dup2(fd, 3, inheritable=True)
        os.close(fd)
    os.set_inheritable(3, True)
    record(EXECUTION / 'entry.json', {'epoch': approval['epoch'], 'resources': resource,
           'lockAcquiredNonblocking': True, 'lockDeviceInode': list((os.fstat(3).st_dev, os.fstat(3).st_ino))})
    argv = request['namespaceArgv']
    os.execve(argv[0], argv, {})


def resources():
    groups = [line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')]
    require(len(groups) == 1, 'cgroup_identity')
    root = Path('/sys/fs/cgroup') / groups[0].lstrip('/')
    value = {name: (root / file).read_text().strip() for name, file in (
        ('memory', 'memory.max'), ('swap', 'memory.swap.max'), ('cpu', 'cpu.max'), ('tasks', 'pids.max'))}
    require(value == {'memory': '1073741824', 'swap': '0', 'cpu': '50000 100000', 'tasks': '64'}, 'resource_caps_mismatch')
    return value


def report_rows(path, maximum):
    require(path.is_file() and path.stat().st_size <= maximum, 'missing_or_large_report:' + str(path))
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    require(rows and rows[0]['type'] == 'start' and rows[-1]['type'] == 'end', 'partial_report:' + str(path))
    require(rows[0]['runtime'] == 'v24.22.0', 'runtime_metadata_mismatch')
    return rows


def cases(command, exit_code):
    rows = report_rows(Path(command['report']), 8388608)
    selected = [row for row in rows if row['type'] == 'case' and not row.get('skip')]
    require(selected, 'zero_selected_cases')
    if command['runner'] == 'vitest':
        end = rows[-1]
        require(end['reason'] == ('passed' if exit_code == 0 else 'failed') and not end['unhandledErrors'], 'vitest_run_aborted_or_unhandled')
        require(sorted(item['file'] for item in end['modules']) == sorted(command['modulePaths']), 'module_selection_changed')
        require(all(not item['errors'] and not item['suiteErrors'] for item in end['modules']), 'collection_or_suite_error')
        require(all(row['state'] in ('passed', 'failed') for row in selected), 'unfinished_or_skipped_case')
        require(all(row.get('state') != 'skipped' for row in rows if row['type'] == 'case'), 'unexpected_vitest_skip')
    else:
        require({row['name'] for row in selected} == set(command['selectedNames']), 'node_selection_changed')
        require(all(row['name'] in command['excludedNames'] for row in rows if row['type'] == 'case' and row.get('skip')), 'unknown_node_skip')
    failures = [row for row in selected if row['state'] == 'failed']
    require((exit_code == 0 and not failures) or (exit_code == 1 and failures), 'exit_assertion_disagreement')
    return selected, failures


def key(row):
    return (row.get('file', ''), row.get('fullName', row.get('name')))


def fault_oracle(command, selected, failures, baseline):
    oracle = command['oracle']
    expected = set(oracle['names'])
    require({row.get('fullName', row.get('name')) for row in failures} == expected, 'wrong_failed_test_set:' + command['id'])
    for row in failures:
        require(key(row) in baseline and baseline[key(row)]['state'] == 'passed', 'fault_without_passed_control')
        errors = row.get('errors') or [row['error'].get('cause') or row['error']]
        require(len(errors) == 1, 'unexpected_multiple_assertions')
        error = errors[0]
        require(error['name'] == 'AssertionError', 'generic_failure_not_a_kill')
        if command['runner'] == 'node':
            require(error['code'] == 'ERR_ASSERTION', 'node_not_an_assertion')
        stack = error.get('stack') or ''
        require(re.search(re.escape(oracle['file']) + ':' + str(oracle['line']) + r':\d+', stack), 'wrong_assertion_location')
        rendered = json.dumps(error, ensure_ascii=True)
        for token in oracle.get('tokens', []):
            require(token in rendered, 'missing_failure_detail:' + token)
        for field in ('actual', 'expected'):
            if field in oracle:
                require(error.get(field) == oracle[field], 'wrong_' + field)


def campaign(request):
    authority = read_json(EXECUTION / 'outer.json')
    deadline = authority['workDeadlineMono']
    resources()
    require(os.fstat(3).st_ino == read_json(EXECUTION / 'entry.json')['lockDeviceInode'][1], 'inherited_lock_missing')
    require(os.readlink('/proc/self/ns/net') != authority['hostNet'], 'network_not_unshared')
    require(os.statvfs(request['donor']).f_flag & os.ST_RDONLY, 'donor_not_readonly')
    require(os.statvfs(request['tree']).f_flag & os.ST_RDONLY, 'seed_not_readonly')
    require(os.statvfs('/').f_flag & os.ST_RDONLY, 'host_root_not_readonly')
    index = inputs(request)
    baseline = {}
    primary = None
    restoration = []
    current = None
    def restore():
        rows = []
        for item in request['mutable']:
            target = EXECUTION / 'mutable' / item['id']
            target.write_bytes(Path(item['seed']).read_bytes())
            require(digest(target) == item['sha256'], 'private_restore_failed')
            rows.append({'path': str(target), 'sha256': digest(target)})
        return rows
    try:
        for phase in request['phases']:
            current = phase['id']
            require(time.monotonic() < deadline, 'campaign_deadline')
            phase_error = None
            try:
                restore()
                for mutation in phase['mutations']:
                    require(digest(mutation['path']) == mutation['sha256'], 'fault_payload_changed')
                    (EXECUTION / 'mutable' / mutation['target']).write_bytes(Path(mutation['path']).read_bytes())
                append({'phase': current, 'event': 'start', 'mutations': phase['mutations']})
                for command in phase['commands']:
                    env = dict(request['environment'])
                    env.update(command['environment'])
                    code = bounded(command['argv'], Path(command['cwd']), env, command['id'],
                                   min(deadline, time.monotonic() + command['seconds']))
                    selected, failures = cases(command, code)
                    if phase['kind'] == 'fault':
                        fault_oracle(command, selected, failures, baseline)
                    else:
                        require(not failures and code == 0, 'control_or_integration_failed:' + current)
                        if phase['kind'] == 'harmless':
                            for row in selected:
                                require(key(row) not in baseline, 'duplicate_baseline_identity')
                                baseline[key(row)] = row
                        elif phase['kind'] in ('baseline', 'restored'):
                            observed = {key(row) for row in selected}
                            expected = {identity for identity in baseline if identity[0] in command['modulePaths']}
                            require(observed == expected, 'restored_selection_changed')
                    append({'phase': current, 'command': command['id'], 'event': 'accepted', 'cases': len(selected)})
            except BaseException as error:
                phase_error = {'type': type(error).__name__, 'message': str(error)}
                append({'phase': current, 'primary': phase_error})
                raise
            finally:
                try:
                    row = {'phase': current, 'restored': restore()}
                    append(row)
                    restoration.append(row)
                except BaseException as error:
                    append({'phase': current, 'cleanup': {'type': type(error).__name__, 'message': str(error)}})
                    if phase_error is None:
                        raise
        require(len(restoration) == len(request['phases']), 'missing_phase')
    except BaseException as error:
        primary = {'type': type(error).__name__, 'message': str(error), 'phase': current}
    finally:
        cleanup = None
        try:
            restored = restore()
            pinned(index['candidateFiles'])
            pinned(index['seedFiles'])
        except BaseException as error:
            cleanup = {'type': type(error).__name__, 'message': str(error)}
            restored = []
        record(EXECUTION / 'campaign.json', {'primary': primary, 'cleanup': cleanup,
               'restored': restored, 'complete': primary is None and cleanup is None,
               'coreAndIntegrationEvidenceSeparate': True})
    require(primary is None and cleanup is None, 'campaign_stopped_see_primary')


if __name__ == '__main__':
    os.umask(0o077)
    require(sys.argv[1:] in (['outer'], ['entry'], ['campaign']), 'exact_mode_required')
    request = read_json(REQUEST)
    {'outer': outer, 'entry': entry, 'campaign': campaign}[sys.argv[1]](request)
