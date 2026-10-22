"""Challenge actual original archive transport boundaries and restore source in finally."""
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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_original_output_http.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module=repo/'workers/odm_worker/original_output_http.py'
    originals={module:module.read_bytes()};original=originals[module];text=original.decode()
    tests=repo/'workers/odm_worker/test_original_output_http.py';rows=[];oracles=[];cases=[]
    def fault(label,before,after,test,diagnostic='ValueError not raised',kind='failures'):
        if text.count(before)!=1:raise ValueError(label+' binding must be unique')
        cases.append((label,module,text.replace(before,after),test,diagnostic,kind))
    def removed(label,message,test,diagnostic='ValueError not raised',kind='failures'):
        tree=ast.parse(text)
        found=[n for n in ast.walk(tree) if isinstance(n,ast.If) and any(isinstance(c,ast.Raise) and isinstance(c.exc,ast.Call) and c.exc.args and isinstance(c.exc.args[0],ast.Constant) and c.exc.args[0].value==message for c in n.body)]
        if len(found)!=1:raise ValueError(label+' guard must be unique')
        found[0].test=ast.Constant(False);cases.append((label,module,ast.unparse(tree)+'\n',test,diagnostic,kind))
    fault('original-route-changed', "'/download/all.zip'", "'/download/other.zip'", 'test_fixed_original_get_streams_exact_bytes_with_two_engine_checks', 'Only the original task archive route may be requested')
    fault('credential-query-omitted', "url += '?' + urlencode({'token': token})", 'url += ""', 'test_token_is_encoded_for_only_the_fixed_original_endpoint', 'Credential must remain a query value on the original endpoint')
    removed('different-plan-accepted','Original archive request plan differs','test_changed_plan_refuses_before_engine_or_network')
    removed('pre-cancellation-accepted','Original archive download cancelled','test_pre_cancelled_call_refuses_before_resolution_and_engine','InterruptedError not raised')
    removed('ended-owner-accepted','Original archive ownership ended','test_ended_owner_refuses_before_resolution_and_engine','InterruptedError not raised')
    removed('ownership-type-unchecked','Original archive ownership must be a boolean','test_ownership_and_cancellation_require_boolean_values')
    removed('cancellation-type-unchecked','Original archive cancellation must be a boolean','test_ownership_and_cancellation_require_boolean_values','InterruptedError: Original archive download cancelled','errors')
    fault('deadline-extended', '        finite_deadline(deadline)', '        pass', 'test_deadline_and_writer_bound_precede_engine_or_child', 'Invalid writer or limits must be refused before engine checks')
    removed('writer-bound-unchecked','Original archive needs a bounded byte writer','test_deadline_and_writer_bound_precede_engine_or_child','does not match')
    removed('engine-confirmation-unchecked','Original archive engine check refused','test_engine_check_requires_exact_true')
    fault('post-transfer-engine-not-checked', '        count = transport(url, _CompleteWriter(output), max_bytes, deadline)\n        self._attest(deadline, owned)', '        count = transport(url, _CompleteWriter(output), max_bytes, deadline)', 'test_revoked_engine_after_body_refuses_success')
    removed('invalid-credentials-forwarded','Original archive credential value differs','test_bad_credential_and_resolver_error_do_not_launch_request')
    fault('credential-resolution-detail-leaked', "raise ValueError('Original archive credential resolution failed') from None", "raise ValueError('Synthetic private credential detail') from None", 'test_bad_credential_and_resolver_error_do_not_launch_request','does not match')
    fault('stream-byte-limit-expanded', 'transport(url, _CompleteWriter(output), max_bytes, deadline)', 'transport(url, _CompleteWriter(output), 4096, deadline)', 'test_redirect_partial_and_oversized_bodies_refuse','does not match \"Original archive complete byte count differs\"','failures')
    fault('cancellation-during-body-ignored', '        def interrupted():\n            self._check(deadline, owned)\n            return False', '        def interrupted():\n            return False', 'test_cancelled_body_closes_the_actual_response', 'Cancelled archive request must physically close its response before deadline')
    fault('ownership-during-body-ignored', '        def interrupted():\n            self._check(deadline, owned)\n            return False', '        def interrupted():\n            return False', 'test_owner_loss_during_body_closes_the_actual_response', 'Ended archive ownership must physically close its response before deadline')
    removed('empty-body-success','Original archive complete byte count differs','test_empty_complete_http_body_is_not_archive_success')
    removed('constructor-adapters-unchecked','Original archive supervision requires explicit adapters','test_constructor_requires_adapters_and_captured_literal_address')
    fault('uncaptured-hostname-accepted', 'ipaddress.ip_address(parts.hostname)', 'ipaddress.ip_address("127.0.0.1")', 'test_constructor_requires_adapters_and_captured_literal_address')
    removed('boolean-local-write-accepted','Original archive writer did not retain the complete chunk','test_boolean_local_write_cannot_confirm_a_one_byte_body')
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[3] for row in cases}!=census:raise ValueError('Every archive transport case requires a targeted control')
    def execute(label, test=None):
        names = ['test_original_output_http' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 16 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete archive transport cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 16})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless original processing access control.\n')
        positive('restored-after-harmless', original)
        for label, target, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                target.write_text(changed)
                code, output = execute(label, test)
                if not intended(code, output, test, diagnostic, kind):
                    raise AssertionError(label + ' did not fail at its intended assertion')
                for name, c, o, t, d, k, wanted in [
                    ('exact', code, output, test, diagnostic, kind, True),
                    ('wrong-exit', 0, output, test, diagnostic, kind, False),
                    ('boolean-exit', True, output, test, diagnostic, kind, False),
                    ('wrong-case', code, output, 'unrelated_case', diagnostic, kind, False),
                    ('wrong-diagnostic', code, output, test, 'unrelated diagnostic', kind, False),
                    ('wrong-kind', code, output, test, diagnostic, 'errors' if kind == 'failures' else 'failures', False),
                    ('success-output', code, 'OK', test, diagnostic, kind, False)]:
                    actual = bool(intended(c, o, t, d, k))
                    if actual is not wanted:
                        raise AssertionError('Original archive transport failure oracle differs')
                    oracles.append({'control': label + '-' + name, 'accepted': actual})
                rows.append({'control': label, 'outcome': 'intended_failure', 'case': test, 'diagnostic': diagnostic, 'kind': kind})
            finally:
                for path, data in originals.items(): path.write_bytes(data)
        positive('restored-final', original)
        if module.read_bytes() != original:
            raise AssertionError('Original archive transport HTTP source did not restore')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [module, tests, Path(__file__)]}, indent=2) + '\n')
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 16, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        for path, data in originals.items(): path.write_bytes(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
