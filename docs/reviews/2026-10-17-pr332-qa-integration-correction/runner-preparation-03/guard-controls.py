#!/usr/bin/python3
"""SOURCE ONLY. Future ROOT-controlled separate 30s/128MiB local window.

This is not an admission controller. ROOT must pin all inputs and grant its
separate finite external resource window before invoking this exact source.
No subject, manager, lock, namespace, dependency or provider is invoked here.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import time
import traceback

PUBLIC = Path(__file__).resolve().parent
PRIVATE = Path('/home/nathaniel/.local/state/openplan/pr332-qa-integration-correction-20261017/runner-preparation-03')
OUTPUT = PRIVATE / 'guard-execution-01'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def save(path, value):
    data = (json.dumps(value, sort_keys=True) + '\n').encode()
    with path.open('xb') as stream:
        count = stream.write(data)
        if count != len(data):
            raise RuntimeError('control_record_short_write')
    if path.read_bytes() != data:
        raise RuntimeError('control_record_readback_mismatch')


def main():
    started = time.monotonic()
    # Three seconds remain inside the external 30-second window for ROOT's
    # termination and terminal evidence. This adds no runtime.
    deadline = started + 27
    os.umask(0o077)
    # The future external ROOT window supplies memory/cgroup/time limits.
    # This inherited file-size ceiling also bounds both raw child streams.
    resource.setrlimit(resource.RLIMIT_FSIZE, (262144, 262144))
    if sys.flags.optimize or not sys.dont_write_bytecode:
        raise RuntimeError('control_requires_B_without_O')
    plan = json.loads((PUBLIC / 'GUARD_SOURCE.json').read_bytes())
    OUTPUT.mkdir(mode=0o700)
    cases = load(PUBLIC / 'guard-cases.py', 'local_guard_cases')
    readers = load(PUBLIC / 'guard-readers.py', 'independent_guard_readers')
    baseline = Path(plan['python']['baseline']).read_bytes()
    node_baseline = Path(plan['node']['baseline']).read_bytes()
    working = OUTPUT / 'working-python.py'
    rows, cleanup = [], []
    primary = None
    restored_sha = None
    summary = None
    child = None
    child_streams = []
    execution_order = []
    def restore():
        if working.write_bytes(baseline) != len(baseline) or working.read_bytes() != baseline:
            raise RuntimeError('control_python_restore_mismatch')
    def node_phase(name, identities, first=False):
        nonlocal child
        if first:
            env = {'PATH': '/usr/bin:/bin', 'HOME': str(OUTPUT), 'TMPDIR': str(OUTPUT),
                   'NODE_OPTIONS': '--max-old-space-size=32 --max-semi-space-size=1', 'PYTHONDONTWRITEBYTECODE': '1'}
            for suffix in ('stdout', 'stderr'):
                child_streams.append((OUTPUT / ('node.' + suffix)).open('xb'))
            child = subprocess.Popen(['/usr/bin/node', '--max-old-space-size=32', '--max-semi-space-size=1',
                                      str(PUBLIC / 'guard-node-controls.mjs')], cwd=PUBLIC, env=env,
                                     stdin=subprocess.DEVNULL, stdout=child_streams[0], stderr=child_streams[1])
        else:
            marker = OUTPUT / ('go-' + name)
            with marker.open('xb') as stream:
                if stream.write(b'1') != 1:
                    raise RuntimeError('guard_phase_short_write')
            if marker.read_bytes() != b'1':
                raise RuntimeError('guard_phase_readback_mismatch')
        ack = OUTPUT / ('ack-' + name)
        while not ack.exists():
            if time.monotonic() >= deadline:
                raise RuntimeError('guard_phase_deadline:' + name)
            if child.poll() is not None:
                raise RuntimeError('guard_node_exited_before_ack:' + name)
            time.sleep(0.01)
        if ack.read_bytes() != b'1':
            raise RuntimeError('guard_ack_changed:' + name)
        execution_order.extend(identities)
    try:
        readers.read_source_equivalence(plan)
        for step in plan['python']['steps']:
            if time.monotonic() >= deadline:
                raise RuntimeError('guard_window_deadline')
            source = Path(step['source']).read_bytes()
            if hashlib.sha256(source).hexdigest() != step['sha256']:
                raise RuntimeError('guard_source_changed')
            if working.write_bytes(source) != len(source) or working.read_bytes() != source:
                raise RuntimeError('guard_working_copy_mismatch')
            try:
                module = load(working, 'exact_local_guard_' + step['id'])
                for case in step['cases']:
                    root = OUTPUT / (step['id'] + '-' + case)
                    root.mkdir(mode=0o700)
                    evidence, error = {}, None
                    try:
                        cases.CASES[case](module, root, evidence)
                    except BaseException as caught:
                        error = {'name': type(caught).__name__, 'message': str(caught),
                                 'traceback': traceback.format_exc(),
                                 'frames': [{'filename': frame.filename, 'lineno': frame.lineno, 'name': frame.name}
                                            for frame in traceback.extract_tb(caught.__traceback__)]}
                    rows.append({'variant': step['id'], 'case': case, 'passed': error is None, 'error': error, 'evidence': evidence})
                    save(OUTPUT / ('python-row-' + str(len(rows)) + '.json'), rows[-1])
                    execution_order.append([step['id'], case])
                    if step['id'] in ('harmless', 'baseline', 'restored') and error is not None:
                        raise RuntimeError('guard_python_control_failed')
            finally:
                restore()
            if step['id'] == 'harmless':
                node_phase('harmless', [['harmless', 'N-WRITE'], ['harmless', 'N-READBACK']], first=True)
            elif step['id'] == 'baseline':
                node_phase('baseline', [['baseline', 'N-WRITE'], ['baseline', 'N-READBACK']])
            elif step['id'] == 'P-M1':
                node_phase('omissions', [['N-W1', 'N-WRITE'], ['N-W2', 'N-WRITE'], ['N-R1', 'N-READBACK']])
            elif step['id'] == 'restored':
                node_phase('restored', [['restored', 'N-WRITE'], ['restored', 'N-READBACK']])
        if child.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
            raise RuntimeError('guard_node_recording_nonzero')
    except BaseException as error:
        primary = {'name': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
    finally:
        # Restoration, readback and partial recording each get their own attempt.
        if child is not None and child.poll() is None:
            try:
                child.kill()
            except BaseException as error:
                cleanup.append({'step': 'kill-own-node', 'name': type(error).__name__, 'message': str(error)})
            try:
                child.wait(timeout=1)
            except BaseException as error:
                cleanup.append({'step': 'wait-own-node', 'name': type(error).__name__, 'message': str(error)})
        for stream in child_streams:
            try:
                stream.close()
            except BaseException as error:
                cleanup.append({'step': 'close-node-stream', 'name': type(error).__name__, 'message': str(error)})
        if child is not None and child.poll() is not None:
            node_working = OUTPUT / 'working-node.mjs'
            try:
                if node_working.write_bytes(node_baseline) != len(node_baseline):
                    raise RuntimeError('control_node_terminal_restore_short_write')
            except BaseException as error:
                cleanup.append({'step': 'terminal-node-restore', 'name': type(error).__name__, 'message': str(error)})
            try:
                if node_working.read_bytes() != node_baseline:
                    raise RuntimeError('control_node_terminal_readback_mismatch')
            except BaseException as error:
                cleanup.append({'step': 'terminal-node-readback', 'name': type(error).__name__, 'message': str(error)})
        try:
            restore()
        except BaseException as error:
            cleanup.append({'step': 'restore', 'name': type(error).__name__, 'message': str(error)})
        try:
            actual = working.read_bytes()
            if actual != baseline:
                raise RuntimeError('control_python_final_readback_mismatch')
            restored_sha = hashlib.sha256(actual).hexdigest()
        except BaseException as error:
            cleanup.append({'step': 'restore-readback', 'name': type(error).__name__, 'message': str(error)})
        python = {'rows': rows, 'primary': primary, 'cleanup': cleanup, 'restoredSHA256': restored_sha,
                  'executionOrder': execution_order}
        try:
            save(OUTPUT / 'python-results.json', python)
        except BaseException as error:
            cleanup.append({'step': 'partial-record', 'name': type(error).__name__, 'message': str(error)})
    reader_error = None
    try:
        for name in ('node-results.json', 'python-results.json', 'node.stdout', 'node.stderr'):
            if (OUTPUT / name).stat().st_size > 262144:
                raise RuntimeError('guard_result_size_limit:' + name)
        node = json.loads((OUTPUT / 'node-results.json').read_bytes())
        python = json.loads((OUTPUT / 'python-results.json').read_bytes())
        if cleanup:
            raise RuntimeError('guard_cleanup_or_record_incomplete')
        summary = readers.read_results(python, node, plan, OUTPUT)
        if time.monotonic() >= deadline:
            raise RuntimeError('guard_window_deadline')
    except BaseException as error:
        reader_error = {'name': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
    save(OUTPUT / 'guard-summary.json', {'primary': primary, 'cleanup': cleanup, 'readerError': reader_error,
                                       'summary': summary, 'elapsedSeconds': time.monotonic() - started,
                                       'complete': primary is None and not cleanup and reader_error is None})
    if primary is not None or cleanup or reader_error is not None:
        raise RuntimeError('guard_window_incomplete_see_retained_records')


if __name__ == '__main__':
    main()
