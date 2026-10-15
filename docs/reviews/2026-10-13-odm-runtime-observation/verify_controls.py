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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_runtime_observation.Checks.[^)]*\)', output, re.MULTILINE)
    return code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/runtime_observation.py'
    original = module.read_bytes()
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_runtime_observation.py'
    rows = []
    oracles = []
    cases = []
    def fault(label, before, after, test, diagnostic, kind='failures'):
        if text.count(before) != 1:
            raise ValueError(label + ' source binding must be unique')
        cases.append((label, text.replace(before, after), test, diagnostic, kind))
    fault('binding-check-removed', "if not same(plan['binding'], expected):", 'if False:', 'test_changed_plan_binding_refuses_before_current_access', 'ValueError not raised')
    fault('current-access-check-removed', "if observed['authorizedNow'] is not True:", 'if False:', 'test_revoked_initial_access_refuses_before_engine_read', 'PermissionError not raised')
    fault('initial-access-read-removed', '        self._access(request_id, deadline)\n        dispatch =', '        dispatch =', 'test_revoked_initial_access_refuses_before_engine_read', 'Revoked initial access must precede engine checks')
    fault('post-read-access-removed', '        self._access(request_id, deadline)\n        observe(plan, status, body)', '        observe(plan, status, body)', 'test_revocation_after_get_refuses_before_record', 'Post-read revocation cannot publish metadata')
    fault('final-access-read-removed', '        final = self._access(request_id, deadline)', "        final = {'authorityObservedAt':'missing'}", 'test_revocation_after_record_refuses_without_deleting_it', 'PermissionError not raised')
    fault('task-preflight-removed', '        observe(plan, status, body)\n', '', 'test_wrong_metadata_refuses_before_record_directory', 'Wrong task reply cannot create a metadata directory')
    fault('record-hash-summary-altered', "'task': {field: copy.deepcopy(result[field]) for field in SUMMARY_FIELDS}", "'task': {**{field: copy.deepcopy(result[field]) for field in SUMMARY_FIELDS},'bodySha256':'0'*64}", 'test_original_read_checks_access_and_retains_exact_reply', 'Runtime summary must bind actual original reply bytes')
    fault('initial-read-census-lost', '        self._access(request_id, deadline)\n        dispatch =', '        dispatch =', 'test_original_read_checks_access_and_retains_exact_reply', 'Runtime must check current access around read and publication')
    fault('processing-permission-granted', "'commitPermission': False", "'commitPermission': True", 'test_original_read_checks_access_and_retains_exact_reply', 'True is not False')
    fault('callback-permission-granted', "'callbackPermission': False", "'callbackPermission': True", 'test_job_attachment_does_not_promote_state_or_callback', 'True is not False')
    fault('state-promoted-from-observation', "        job['taskObservation'] = self.observe(request_id)", "        job['taskObservation'] = self.observe(request_id)\n        job['state'] = 'succeeded'", 'test_job_attachment_does_not_promote_state_or_callback', 'Task observation cannot promote the original job state')
    fault('invalid-timeout-accepted', 'if not finite_number(timeout) or timeout <= 0:', 'if False:', 'test_timeout_rejection_precedes_private_read', 'ValueError not raised')
    fault('invalid-adapters-accepted', 'if not isinstance(reader, Reader) or not callable(resolve) or not callable(attest):', 'if False:', 'test_adapter_types_are_required', 'ValueError not raised')
    fault('runtime-ownership-not-forwarded', 'owned = lambda: dispatch.runtime._owned', 'owned = lambda: True', 'test_owner_loss_in_engine_check_stops_network', 'Runtime preparation requires its lifetime owner', 'errors')
    fault('engine-check-bypassed', 'lambda engine, end: self.attest(engine, end, owned=owned)', 'lambda engine, end: True', 'test_engine_refusal_stops_before_network', 'ValueError not raised')
    fault('metadata-alias-accepted', '        private(records, True)\n', '        records = records.resolve()\n        private(records, True)\n', 'test_existing_metadata_alias_refuses', 'ValueError not raised')
    fault('local-copy-digest-summary-altered', "'task': {field: copy.deepcopy(result[field]) for field in SUMMARY_FIELDS}", "'task': {**{field: copy.deepcopy(result[field]) for field in SUMMARY_FIELDS},'bodySha256':'0'*64}", 'test_relocated_private_reply_reopens_without_new_fetch', 'No such file', 'errors')
    fault('unowned-runtime-adopted', '        entry = dispatch._check(request_id, deadline)\n', '        dispatch.runtime._owned = True\n        entry = dispatch._check(request_id, deadline)\n', 'test_unowned_runtime_refuses_before_reads', 'ValueError not raised')
    fault('job-original-check-removed', "if not same(job['request'], entry.request):", 'if False:', 'test_changed_job_scope_refuses_before_private_reads', 'ValueError not raised')
    fault('prepared-engine-hash-ignored',"or prepared.get('enginePlanSha256') != hashlib.sha256(json_bytes(plan)).hexdigest()",'or False','test_changed_valid_engine_plan_refuses_before_current_access','Task metadata original UUID or name differs')
    fault('prepared-record-checks-ignored',"        prepared = read_json(root, 'prepared.json')", "        return root, plan\n        prepared = read_json(root, 'prepared.json')",'test_prepared_record_must_bind_its_complete_original_preparation','ValueError not raised')
    fault('invalid-cancellation-adapter', "if not callable(cancelled):raise ValueError('Runtime observation needs a cancellation adapter')", "if False:raise ValueError('Runtime observation needs a cancellation adapter')", 'test_cancellation_adapter_type_refuses_before_private_reads', 'ValueError not raised')
    fault('active-task-cancellation-not-forwarded','cancelled=self.cancelled','cancelled=lambda:False','test_active_task_get_closes_after_supplied_cancellation','InterruptedError not raised')
    def execute(label, test=None):
        names = ['test_runtime_observation' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 19 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete task-read cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 19})
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
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 19, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        module.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
