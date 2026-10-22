"""Challenge actual original-task read boundaries and restore source in finally."""
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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_original_task_http.Checks.[^)]*\)', output, re.MULTILINE)
    return code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/original_task_http.py'
    original = module.read_bytes()
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_original_task_http.py'
    rows = []
    oracles = []
    cases = []
    def fault(label, before, after, test, diagnostic, kind='failures'):
        if text.count(before) != 1:
            raise ValueError(label + ' source binding must be unique')
        cases.append((label, text.replace(before, after), test, diagnostic, kind))
    fault('plan-comparison-removed', 'if not same(original_plan(copy.deepcopy(plan)), self.plan):', 'if False:',
          'test_changed_plan_refuses_before_credentials_or_network', 'ValueError not raised')
    fault('initial-engine-check-removed', '        self._attest(deadline, owned)\n        try:', '        try:',
          'test_engine_check_false_or_nonboolean_refuses', 'Refused engine check must precede any HTTP')
    fault('final-engine-check-removed', '            self._attest(deadline, owned)\n            return', '            return',
          'test_final_engine_check_refuses_saved_record', 'ValueError not raised')
    fault('truthy-engine-accepted', "if self.attest(copy.deepcopy(self.plan['engine']), deadline) is not True:",
          "if not self.attest(copy.deepcopy(self.plan['engine']), deadline):",
          'test_engine_check_false_or_nonboolean_refuses', 'ValueError not raised')
    fault('ownership-removed', 'if not ownership:', 'if False:',
          'test_absent_or_nonboolean_ownership_refuses', 'not raised')
    fault('ownership-type-removed', 'if type(ownership) is not bool:', 'if False:',
          'test_absent_or_nonboolean_ownership_refuses', 'not raised')
    fault('cancellation-removed', 'if decision:', 'if False:',
          'test_pre_cancelled_refuses_before_engine_or_network', 'InterruptedError not raised')
    fault('cancellation-type-removed', 'if type(decision) is not bool:', 'if False:',
          'test_nonboolean_cancellation_refuses', 'ValueError not raised')
    fault('deadline-removed', '        finite_deadline(deadline)\n\n    def _attest', '        pass\n\n    def _attest',
          'test_deadline_refuses_before_network', 'AssertionError')
    fault('credential-reference-changed', "self.resolve(self.plan['engine']['credentialReference'])", "self.resolve('wrong')",
          'test_exact_original_get_and_credentials', 'Original task credential resolution failed', 'errors')
    fault('credential-type-removed', "        if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):\n            raise ValueError('Original task credential value differs')\n", '',
          'test_credential_none_and_invalid_values', 'Original task read did not complete')
    fault('credential-error-exposed', "raise ValueError('Original task credential resolution failed') from None", 'raise',
          'test_credential_resolution_error_is_not_exposed', 'RuntimeError: PRIVATE_CREDENTIAL_MARKER', 'errors')
    fault('adapter-check-removed', "if sys.platform != 'linux' or not all(callable(x) for x in (resolve, attest, cancelled)):", 'if False:',
          'test_adapters_are_required', 'ValueError not raised')
    fault('ownership-adapter-removed', 'if not callable(owned):', 'if False:',
          'test_adapters_are_required', "TypeError: 'NoneType' object is not callable", 'errors')
    fault('response-bound-removed', "if len(chunk) > bound - len(target):", 'if False:',
          'test_owned_child_output_bounds', 'ValueError not raised')
    fault('child-input-bound-removed', 'if size > METADATA_LIMIT:', 'if False:',
          'test_child_metadata_bound_precedes_payload_read', 'Oversized child metadata reached payload read')
    fault('wrong-uuid-path', "path = endpoint.path + '/task/' + task + '/info'", "path = endpoint.path + '/task/not-original/info'",
          'test_exact_original_get_and_credentials', 'Read must use original UUID')
    fault('token-not-encoded', "urlencode({'token': token})", "'token=' + token",
          'test_exact_original_get_and_credentials', 'Original task read did not complete', 'errors')
    fault('status-check-removed', 'if response.status != 200:', 'if False:',
          'test_redirect_is_not_followed', 'ValueError not raised')
    fault('framing-check-removed', 'if not payload or len(payload) > RESPONSE_LIMIT or declared is not None and len(payload) != declared or response.length not in (None, 0):', 'if False:',
          'test_short_valid_json_prefix_refuses', 'ValueError not raised')
    fault('encoding-check-removed', 'declared = response_length(response.headers, RESPONSE_LIMIT)', 'declared = None',
          'test_compressed_response_refuses', 'ValueError not raised')
    fault('reported-length-bound-removed', 'declared = response_length(response.headers, RESPONSE_LIMIT)', 'declared = response_length(response.headers, RESPONSE_LIMIT + 1)',
          'test_oversized_response_refuses', 'TimeoutError: Original draft HTTP deadline exceeded', 'errors')
    fault('close-delimited-refused', 'declared = response_length(response.headers, RESPONSE_LIMIT)', 'declared = response_length(response.headers, RESPONSE_LIMIT)\n        if declared is None: raise ValueError("Missing length")',
          'test_close_delimited_response_preserves_exact_bytes', 'Original task read did not complete', 'errors')
    fault('reply-bytes-altered', 'return 200, bytes(output)', 'return 200, bytes(output).rstrip()',
          'test_exact_original_get_and_credentials', 'Exact original reply must survive transport')
    fault('retention-bypassed', 'result = observations.record(status, body, deadline=deadline)', 'from task_observation import observe\n        result = observe(observations.plan, status, body)',
          'test_retain_and_reopen_exact_reply', 'Retained task observation ledger plan is missing', 'errors')
    fault('wrong-reply-retained', 'result = observations.record(status, body, deadline=deadline)', 'result = {}',
          'test_wrong_task_reply_refuses_retention', 'ValueError not raised')
    fault('parent-watch-removed', 'threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()', 'pass',
          'test_abrupt_parent_exit_stops_and_reaps_owned_http_child', 'Parent exit must stop the owned HTTP child')
    fault('inflight-cancellation-removed', 'if decision:', 'if False:',
          'test_cancelled_inflight_closes_connection', 'TimeoutError: Original draft HTTP deadline exceeded', 'errors')
    fault('inflight-ownership-removed', 'if not ownership:', 'if False:',
          'test_lost_ownership_closes_connection', 'TimeoutError: Original draft HTTP deadline exceeded', 'errors')
    def execute(label, test=None):
        names = ['test_original_task_http' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 23 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete task-read cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 23})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless original-task read control.\n')
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
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 23, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        module.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
