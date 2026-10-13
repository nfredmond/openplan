"""Challenge actual original-task command boundaries and restore source in finally."""
import argparse
import ast
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys


def intended(code, output, test, diagnostic, kind):
    marker = 'FAIL:' if kind == 'failures' else 'ERROR:'
    other = 'ERROR:' if kind == 'failures' else 'FAIL:'
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_live_task_observation_cli.Checks.[^)]*\)', output, re.MULTILINE)
    return code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/task_observation_cli.py'
    original = module.read_bytes()
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_live_task_observation_cli.py'
    rows = []
    oracles = []
    cases = []
    def fault(label, before, after, test, diagnostic, kind='failures'):
        if text.count(before) != 1:
            raise ValueError(label + ' source binding must be unique')
        cases.append((label, text.replace(before, after), test, diagnostic, kind))
    fault('fetch-mode-guard-removed', "if type(fetch) is not bool or sum((record_file is not None, digest is not None, fetch)) != 1:", 'if False:', 'test_fetch_inputs_and_mixed_modes_refuse_before_plan_read', 'Invalid fetch inputs reached plan read')
    fault('native-input-guard-removed', "if fetch and (response_status is not None or daemon_socket is None or type(daemon_uid) is not int or daemon_uid < 0 or credential_file is None or not callable(owned)):", 'if fetch and not callable(owned):', 'test_fetch_inputs_and_mixed_modes_refuse_before_plan_read', 'Invalid fetch inputs reached plan read')
    fault('native-inputs-in-local-mode', "if not fetch and any(value is not None for value in (daemon_socket, daemon_uid, credential_file, owned)):", 'if False:', 'test_local_modes_refuse_native_inputs_before_plan_read', 'Native inputs reached local mode plan read')
    fault('initial-owner-type-removed', 'if type(ownership) is not bool:', 'if False:', 'test_ended_or_nonboolean_owner_refuses_before_plan_read', 'Ended fetch owner reached plan read')
    fault('initial-owner-check-removed', 'if not ownership:', 'if False:', 'test_ended_or_nonboolean_owner_refuses_before_plan_read', 'Ended fetch owner reached plan read')
    fault('credential-format-binding-removed', "if not isinstance(value, dict) or set(value) != {'format', 'credentialReference', 'token'} or value['format'] != CREDENTIAL_FORMAT or value['credentialReference'] != reference:", 'if False:', 'test_credential_file_binding_and_duplicate_keys_refuse', 'Invalid credential reached native engine construction')
    fault('credential-value-guard-removed', "if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):", 'if False:', 'test_credential_file_binding_and_duplicate_keys_refuse', 'Invalid credential reached native engine construction')
    fault('duplicate-key-guard-removed', 'if key in result:', 'if False:', 'test_credential_file_binding_and_duplicate_keys_refuse', 'Invalid credential reached native engine construction')
    fault('credential-size-guard-removed', 'if info.st_size > CREDENTIAL_LIMIT:', 'if False:', 'test_credential_bound_precedes_body_read', 'Oversized credential reached body read')
    fault('credential-parent-guard-removed', '\n    private(path.parent, True)\n', '\n', 'test_public_credential_parent_refuses', 'Public credential directory reached native engine construction')
    fault('credential-deadline-check-removed', '\n    check_time(deadline)\n    def pairs', '\n    def pairs', 'test_credential_read_does_not_restart_deadline', 'Late credential reached native engine construction')
    fault('native-daemon-identity-replaced', "Attestor(plan['engine'], str(daemon_socket), daemon_uid)", "Attestor(plan['engine'], '/wrong/socket', daemon_uid)", 'test_original_fetch_routes_to_owned_read_and_retention', 'expected call not found')
    fault('live-read-bypassed', 'result = transport.retain(store, deadline=deadline, owned=owned)', "result = store.record(200, b'{}', deadline=deadline)", 'test_original_fetch_routes_to_owned_read_and_retention', 'Task metadata required fields differ', 'errors')
    fault('live-summary-hash-replaced', 'return {field: result[field] for field in SUMMARY_FIELDS}', "return {**{field: result[field] for field in SUMMARY_FIELDS}, 'bodySha256':'0'*64}", 'test_original_fetch_routes_to_owned_read_and_retention', 'Live command summary must bind actual reply bytes')
    fault('signal-ignores-operator', 'lambda signum, frame: interrupted.set()', 'lambda signum, frame: None', 'test_signal_owner_and_original_handlers_restore', 'Operator signal must end fetch ownership')
    fault('signal-handlers-not-restored', 'signal.signal(name, handler)', 'pass', 'test_signal_owner_and_original_handlers_restore', 'Command must restore the original signal handlers')
    fault('actual-signal-ignored', 'lambda signum, frame: interrupted.set()', 'lambda signum, frame: None', 'test_actual_operator_signal_stops_loopback_read', 'subprocess.TimeoutExpired:', 'errors')
    fault('private-error-exposed', "        sys.stderr.write('Task observation refused. Check the private roots, original plan, reply bytes and command inputs.\\n')", "        sys.stderr.write('PRIVATE_CREDENTIAL_MARKER\\n')", 'test_actual_bad_credentials_keep_private_diagnostics', 'PRIVATE_CREDENTIAL_MARKER')
    fault('credential-reader-checks-bypassed', '\n    with reader(path.parent, path.name) as (stream, info):', "\n    with path.open('rb') as stream:\n        info = path.stat()", 'test_credential_alias_and_permissions_refuse', 'Unsafe credential file reached native engine construction')
    fault('ownership-adapter-check-removed', 'or not callable(owned)):', 'or False):', 'test_fetch_inputs_and_mixed_modes_refuse_before_plan_read', "TypeError: 'NoneType' object is not callable", 'errors')
    fault('decoder-depth-error-exposed', 'except RecursionError:', 'except RuntimeWarning:', 'test_credential_decoder_depth_refuses', 'RecursionError: Synthetic decoder depth boundary', 'errors')
    fault('final-window-cancellation-check-removed', 'if args.fetch_original and interrupted.is_set():', 'if False:', 'test_signal_during_handler_restoration_refuses_success', 'Final-window cancellation must refuse success')
    def execute(label, test=None):
        names = ['test_live_task_observation_cli' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 14 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete task-read cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 14})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless original-task command control.\n')
        positive('restored-after-harmless', original)
        for label, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                module.write_text(changed)
                code, output = execute(label, test)
                if not intended(code, output, test, diagnostic, kind):
                    raise AssertionError(label + ' did not fail at its intended assertion')
                for name, c, o, t, d, k, wanted in [
                    ('exact', code, output, test, diagnostic, kind, True),
                    ('wrong-exit', 0, output, test, diagnostic, kind, False),
                    ('wrong-case', code, output, 'unrelated_case', diagnostic, kind, False),
                    ('wrong-diagnostic', code, output, test, 'unrelated diagnostic', kind, False),
                    ('wrong-kind', code, output, test, diagnostic, 'errors' if kind == 'failures' else 'failures', False),
                    ('success-output', code, 'OK', test, diagnostic, kind, False)]:
                    actual = bool(intended(c, o, t, d, k))
                    if actual is not wanted:
                        raise AssertionError('Original task failure oracle differs')
                    oracles.append({'control': label + '-' + name, 'accepted': actual})
                rows.append({'control': label, 'outcome': 'intended_failure', 'case': test, 'diagnostic': diagnostic, 'kind': kind})
            finally:
                module.write_bytes(original)
        positive('restored-final', original)
        if module.read_bytes() != original:
            raise AssertionError('Original task HTTP source did not restore')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [module, tests, Path(__file__)]}, indent=2) + '\n')
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 14, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        module.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
