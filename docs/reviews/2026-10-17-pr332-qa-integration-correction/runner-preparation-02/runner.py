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
import traceback

PUBLIC = Path(__file__).resolve().parent
PRIVATE = Path('/home/nathaniel/.local/state/openplan/pr332-qa-integration-correction-20261017/runner-preparation-02')
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


def error_info(error):
    return {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}


def write_all(fd, data):
    offset = 0
    while offset < len(data):
        count = os.write(fd, memoryview(data)[offset:])
        require(type(count) is int and 0 < count <= len(data) - offset, 'invalid_actual_write_count')
        offset += count
    return offset


def independent_actions(primary, actions):
    completed, errors = [], []
    for label, operation in actions:
        try:
            completed.append({'step': label, 'value': operation()})
        except BaseException as error:
            errors.append({'step': label, **error_info(error)})
    return {'primary': primary, 'completed': completed, 'errors': errors}


def stable(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def descriptor(path):
    path = Path(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and not path.is_symlink(), 'input_not_regular_nonsymlink:' + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        require(stable(before) == stable(opened), 'input_changed_at_open:' + str(path))
        sha = hashlib.sha256()
        length = 0
        while True:
            data = os.read(fd, 1048576)
            if not data:
                break
            sha.update(data)
            length += len(data)
        after = os.fstat(fd)
        require(stable(opened) == stable(after) == stable(path.lstat()), 'input_metadata_unstable:' + str(path))
        require(length == after.st_size, 'input_length_unstable:' + str(path))
        return {'path': str(path), 'bytes': length, 'sha256': sha.hexdigest(),
                'mode': stat.S_IMODE(after.st_mode), 'uid': after.st_uid, 'gid': after.st_gid,
                'device': after.st_dev, 'inode': after.st_ino, 'mtime_ns': after.st_mtime_ns,
                'ctime_ns': after.st_ctime_ns, 'type': 'regular', 'nonsymlink': True}
    finally:
        os.close(fd)


def readback(path, data):
    observed = descriptor(path)
    require(observed['bytes'] == len(data) and observed['sha256'] == hashlib.sha256(data).hexdigest(), 'saved_file_readback_mismatch:' + str(path))
    return observed


def read_json(path):
    return json.loads(Path(path).read_bytes())


def store(path, data, flags, expected=None):
    fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    errors = []
    try:
        write_all(fd, data)
        os.fsync(fd)
    except BaseException as error:
        errors.append(error)
    finally:
        try:
            os.close(fd)
        except BaseException as error:
            errors.append(error)
    observed = None
    try:
        observed = readback(path, data if expected is None else expected)
    except BaseException as error:
        errors.append(error)
    if errors:
        raise BaseExceptionGroup('storage_write_close_and_readback_errors', errors)
    return observed


def record(path, value):
    data = (json.dumps(value, sort_keys=True, ensure_ascii=True) + '\n').encode()
    return store(path, data, os.O_WRONLY | os.O_CREAT | os.O_EXCL)


def overwrite_private(path, data):
    descriptor(path)
    return store(path, data, os.O_WRONLY | os.O_TRUNC)


def append(value):
    path = EXECUTION / 'journal.ndjson'
    prior = path.read_bytes() if path.exists() else b''
    data = (json.dumps(value, sort_keys=True, ensure_ascii=True) + '\n').encode()
    require(len(prior) + len(data) <= 4194304, 'journal_limit')
    store(path, data, os.O_WRONLY | os.O_CREAT | os.O_APPEND, expected=prior + data)


def pinned(entries):
    for item in entries:
        require(descriptor(item['path']) == item, 'complete_input_descriptor_changed:' + item['path'])


def aliases(entries):
    # These paths are deliberately NOT admitted as regular files. Their exact
    # link descriptors and separately pinned resolved files require ROOT review.
    for item in entries:
        path = Path(item['path'])
        before = path.lstat()
        require(stat.S_ISLNK(before.st_mode), 'declared_alias_not_symlink')
        target, resolved = os.readlink(path), str(path.resolve(strict=True))
        after = path.lstat()
        require(stable(before) == stable(after), 'alias_metadata_unstable')
        observed = {'path': str(path), 'target': target, 'resolved': resolved,
                    'mode': stat.S_IMODE(after.st_mode), 'uid': after.st_uid, 'gid': after.st_gid,
                    'device': after.st_dev, 'inode': after.st_ino, 'bytes': after.st_size,
                    'mtime_ns': after.st_mtime_ns, 'ctime_ns': after.st_ctime_ns, 'type': 'symlink'}
        require(observed == item, 'declared_alias_changed:' + str(path))


def inputs(request):
    require(descriptor(request['inputIndex']['path']) == request['inputIndex'], 'input_index_changed')
    index = read_json(request['inputIndex']['path'])
    for inventory in index['inventories']:
        observed = []
        for root, dirs, files in os.walk(inventory['root'], followlinks=False):
            base = Path(root)
            for name in list(dirs):
                path = base / name
                if str(path) in inventory['excludedDirectories']:
                    dirs.remove(name)
                elif path.is_symlink():
                    dirs.remove(name)
                    observed.append(str(path))
            observed.extend(str(base / name) for name in files)
        require(sorted(observed) == inventory['paths'], 'input_inventory_changed:' + inventory['root'])
    pinned(index['files'])
    aliases(index['aliases'])
    return index


def grant(request):
    path = PRIVATE / 'ROOT_GRANT.json'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and
            stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.getuid(), 'grant_file_custody')
    value = read_json(path)
    require(descriptor(REQUEST) == value['requestDescriptor'], 'request_complete_descriptor_changed')
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
    row = {'argv': argv, 'cwd': str(cwd), 'started': time.time(), 'name': name, 'step': 'setup'}
    logs = []
    proc = None
    selector = None
    total = [0, 0]
    retained = [0, 0]
    hashes = [hashlib.sha256(), hashlib.sha256()]
    primary = None
    primary_exception = None
    cleanup_errors = []
    evidence_errors = []
    readbacks = []
    def attempt(label, operation, bucket):
        outcome = independent_actions(primary, [(label, operation)])
        bucket.extend(outcome['errors'])
        return outcome['completed'][0]['value'] if outcome['completed'] else None
    try:
        output.mkdir(mode=0o700, exist_ok=True)
        row['step'] = 'intent'
        record(output / (name + '.intent.json'), row)
        for channel, suffix in enumerate(('.stdout', '.stderr')):
            row['step'] = 'open' + suffix
            fd = os.open(output / (name + suffix), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            logs.append((channel, fd, output / (name + suffix)))
        require(time.monotonic() < deadline, 'deadline_before:' + name)
        row['step'] = 'spawn'
        proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        row['step'] = 'select'
        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ, 0)
        selector.register(proc.stderr, selectors.EVENT_READ, 1)
        while selector.get_map():
            require(time.monotonic() < deadline, 'deadline_during:' + name)
            for key, _ in selector.select(timeout=min(0.1, max(0, deadline - time.monotonic()))):
                row['step'] = 'read_pipe'
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                    continue
                channel = key.data
                room = STREAM_MAX - retained[channel]
                piece = block[:max(0, room)]
                row['step'] = 'write_log'
                offset = 0
                while offset < len(piece):
                    count = os.write(logs[channel][1], memoryview(piece)[offset:])
                    require(type(count) is int and 0 < count <= len(piece) - offset, 'invalid_actual_log_write_count')
                    hashes[channel].update(piece[offset:offset + count])
                    retained[channel] += count
                    offset += count
                total[channel] += len(block)
                require(total[channel] <= STREAM_MAX, 'stream_limit:' + name)
        row['step'] = 'wait'
        row['exit'] = proc.wait(timeout=max(0.01, deadline - time.monotonic()))
    except BaseException as error:
        # Capture the original error and traceback before any cleanup starts.
        primary_exception = error
        primary = {'step': row['step'], **error_info(error)}
        attempt('save_primary', lambda: record(output / (name + '.primary.json'), primary), evidence_errors)
    finally:
        if proc is not None and proc.poll() is None:
            attempt('kill_owned_group', lambda: os.killpg(proc.pid, signal.SIGKILL), cleanup_errors)
            attempt('wait_owned_group', lambda: proc.wait(timeout=2), cleanup_errors)
        if selector is not None:
            attempt('close_selector', selector.close, cleanup_errors)
        if proc is not None:
            for label, pipe in (('stdout', proc.stdout), ('stderr', proc.stderr)):
                if pipe is not None:
                    attempt('close_pipe_' + label, pipe.close, cleanup_errors)
        for channel, fd, path in logs:
            attempt('fsync_' + str(channel), lambda fd=fd: os.fsync(fd), evidence_errors)
            attempt('close_log_' + str(channel), lambda fd=fd: os.close(fd), cleanup_errors)
        # Read each saved file independently after all closes were attempted.
        # These readbacks establish observed bytes, not storage durability.
        for channel, _, path in logs:
            def check_saved(channel=channel, path=path):
                observed = descriptor(path)
                require(observed['bytes'] == retained[channel] and observed['sha256'] == hashes[channel].hexdigest(), 'saved_log_readback_mismatch')
                readbacks.append(observed)
            attempt('readback_log_' + str(channel), check_saved, evidence_errors)
        row.update({'finished': time.time(), 'pipeBytes': total, 'retainedActualBytes': retained,
                    'primaryError': primary, 'cleanupErrors': cleanup_errors,
                    'evidenceErrors': evidence_errors, 'savedFileReadbacks': readbacks})
        receipt = attempt('save_receipt', lambda: record(output / (name + '.receipt.json'), row), evidence_errors)
        if receipt is None:
            # A distinct fallback may retain the original failure when the full
            # receipt cannot be saved. Neither fallback authorizes success.
            attempt('save_incomplete_record', lambda: record(output / (name + '.incomplete.json'), row), evidence_errors)
    if primary is not None or cleanup_errors or evidence_errors or len(readbacks) != 2:
        raise RuntimeError('bounded_capture_incomplete:' + name + ':see_primary_cleanup_and_evidence_records') from primary_exception
    return row['exit']


def outer(request):
    started = time.monotonic()
    approval = grant(request)
    EXECUTION.mkdir(mode=0o700)
    index = None
    require(request['budget']['overallSeconds'] in (180, 480), 'budget_requires_source_disposition')
    deadline = started + request['budget']['overallSeconds']
    description = 'PR332:' + digest(REQUEST) + ':' + approval['epoch']
    record(EXECUTION / 'outer.json', {'requestSHA256': digest(REQUEST), 'epoch': approval['epoch'],
           'deadlineMono': deadline, 'workDeadlineMono': deadline - 15,
           'hostNet': os.readlink('/proc/self/ns/net'), 'description': description})
    primary = None
    cleanup = []
    manager_started = False
    terminal = False
    try:
        index = inputs(request)
        # No check command, lock probe or manager call occurs before admission.
        # systemd's own atomic unit-name allocation refuses an existing unit.
        manager_started = True
        code = bounded(request['managerArgv'] + ['--description=' + description,
                       '/usr/bin/python3', '-B', str(PUBLIC / 'runner.py'), 'entry'],
                       PUBLIC, os.environ.copy(), 'manager', deadline - 8)
        require(code == 0, 'manager_nonzero:' + str(code))
        require(read_json(EXECUTION / 'campaign.json')['complete'] is True, 'campaign_incomplete')
    except BaseException as error:
        primary = error_info(error)
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
            require(index is not None, 'preflight_input_index_not_admitted')
            pinned(index['candidateFiles'])
            pinned(index['seedFiles'])
            if terminal or not manager_started:
                for item in request['mutable']:
                    target = EXECUTION / 'mutable' / item['id']
                    if target.exists():
                        overwrite_private(target, Path(item['seed']).read_bytes())
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
    for name in ('tree', 'mutable', 'cache', 'home', 'tmp', 'config', 'state', 'data', 'reports'):
        (EXECUTION / name).mkdir(mode=0o700)
    for item in request['mutable']:
        store(EXECUTION / 'mutable' / item['id'], Path(item['seed']).read_bytes(), os.O_WRONLY | os.O_CREAT | os.O_EXCL)
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


def report_rows(path, maximum, command_id):
    require(path.is_file() and path.stat().st_size <= maximum, 'missing_or_large_report:' + str(path))
    observed = descriptor(path)
    receipt_path = Path(str(path) + '.receipt.json')
    receipt_info = descriptor(receipt_path)
    receipt = read_json(receipt_path)
    require(receipt['complete'] is True and receipt['errors'] == [] and
            receipt['readback']['bytes'] == observed['bytes'] and
            receipt['readback']['sha256'] == observed['sha256'], 'report_io_not_complete')
    signals = [line[len('PR332_REPORT_COMPLETE '):] for line in
               (EXECUTION / 'logs' / (command_id + '.stdout')).read_text().splitlines()
               if line.startswith('PR332_REPORT_COMPLETE ')]
    require(len(signals) == 1 and json.loads(signals[0]) == {
            'path': str(path), 'sha256': observed['sha256'],
            'receiptSHA256': receipt_info['sha256']}, 'reporter_completion_not_observed')
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    require(rows and rows[0]['type'] == 'start' and rows[-1]['type'] == 'end', 'partial_report:' + str(path))
    require(rows[0]['runtime'] == 'v24.22.0', 'runtime_metadata_mismatch')
    return rows


def cases(command, exit_code, baseline):
    rows = report_rows(Path(command['report']), 8388608, command['id'])
    selected = [row for row in rows if row['type'] == 'case' and not row.get('skip') and row['state'] != 'skipped']
    require(selected, 'zero_selected_cases')
    if command['runner'] == 'vitest':
        end = rows[-1]
        require(end['reason'] == ('passed' if exit_code == 0 else 'failed') and not end['unhandledErrors'], 'vitest_run_aborted_or_unhandled')
        require(sorted(item['file'] for item in end['modules']) == sorted(command['modulePaths']), 'module_selection_changed')
        require(all(not item['errors'] and not item['suiteErrors'] for item in end['modules']), 'collection_or_suite_error')
        require(all(row['state'] in ('passed', 'failed') for row in selected), 'unfinished_or_skipped_case')
        skipped = [row for row in rows if row['type'] == 'case' and row['state'] == 'skipped']
        if 'selectedFullNames' in command:
            require({row['fullName'] for row in selected} == set(command['selectedFullNames']), 'filtered_selection_changed')
            require(all(key(row) in baseline and row['fullName'] not in command['selectedFullNames'] for row in skipped), 'unknown_filtered_skip')
        else:
            require(not skipped, 'unexpected_vitest_skip')
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
    oracles_joined = False
    def restore():
        rows = []
        for item in request['mutable']:
            target = EXECUTION / 'mutable' / item['id']
            overwrite_private(target, Path(item['seed']).read_bytes())
            require(digest(target) == item['sha256'], 'private_restore_failed')
            rows.append({'path': str(target), 'sha256': digest(target)})
        return rows
    try:
        for phase in request['phases']:
            current = phase['id']
            require(time.monotonic() < deadline, 'campaign_deadline')
            if phase['kind'] == 'fault' and not oracles_joined:
                for planned in request['phases']:
                    if planned['kind'] == 'fault':
                        for command in planned['commands']:
                            for name in command['oracle']['names']:
                                require(any((module, name) in baseline and baseline[(module, name)]['state'] == 'passed'
                                            for module in command['modulePaths']), 'oracle_not_in_passed_baseline:' + name)
                oracles_joined = True
            phase_error = None
            try:
                restore()
                for mutation in phase['mutations']:
                    require(digest(mutation['path']) == mutation['sha256'], 'fault_payload_changed')
                    overwrite_private(EXECUTION / 'mutable' / mutation['target'], Path(mutation['path']).read_bytes())
                append({'phase': current, 'event': 'start', 'mutations': phase['mutations']})
                for command in phase['commands']:
                    env = dict(request['environment'])
                    env.update(command['environment'])
                    code = bounded(command['argv'], Path(command['cwd']), env, command['id'],
                                   min(deadline, time.monotonic() + command['seconds']))
                    selected, failures = cases(command, code, baseline)
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
                phase_error = error_info(error)
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
        primary = {**error_info(error), 'phase': current}
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
