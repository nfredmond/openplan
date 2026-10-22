"""Challenge actual original processing access boundaries and restore source in finally."""
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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_original_commit_http.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/original_commit_http.py'
    original = module.read_bytes()
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_original_commit_http.py'
    rows = []
    oracles = []
    cases = []
    def fault(label, before, after, test, diagnostic, kind='failures'):
        if text.count(before) != 1:
            raise ValueError(label + ' source binding must be unique')
        cases.append((label, text.replace(before, after), test, diagnostic, kind))
    def removed(label, message, test, diagnostic='ValueError not raised', kind='failures'):
        tree=ast.parse(text)
        found=[node for node in ast.walk(tree) if isinstance(node,ast.If) and any(isinstance(child,ast.Raise) and isinstance(child.exc,ast.Call) and child.exc.args and isinstance(child.exc.args[0],ast.Constant) and child.exc.args[0].value==message for child in node.body)]
        if len(found)!=1:raise ValueError('Processing guard anchor must be unique')
        found[0].test=ast.Constant(False)
        cases.append((label,ast.unparse(tree)+'\n',test,diagnostic,kind))
    fault('post-changed-to-get',"connection.request('POST', path, body=b'', headers=","connection.request('GET', path, body=b'', headers=",'test_one_exact_original_post_and_complete_reply','Original processing commit did not complete','errors')
    fault('commit-reply-not-validated',"            parsed_reply(self.plan, 'commit', 200, bytes(output))\n",'', 'test_wrong_uuid_error_and_duplicate_reply_refuse','ValueError not raised')
    removed('non-success-response-accepted','Original commit response status differs','test_non_success_and_partial_body_refuse_without_retry')
    removed('partial-response-accepted','Original commit response bytes differ','test_non_success_and_partial_body_refuse_without_retry')
    removed('unowned-commit-accepted','Original commit ownership ended','test_unowned_and_precancelled_calls_stop_before_credentials_or_http','InterruptedError not raised')
    removed('pre-cancellation-ignored','Original processing commit cancelled','test_unowned_and_precancelled_calls_stop_before_credentials_or_http','InterruptedError not raised')
    removed('engine-check-omitted','Original commit engine check refused','test_engine_refusal_prevents_commit_request')
    fault('late-owner-check-suppressed',"        ownership = owned()",'        ownership = True','test_owner_loss_closes_stalled_actual_request','TimeoutError','errors')
    fault('final-engine-check-omitted','            self._attest(deadline, owned)\n            return 200, bytes(output)','            return 200, bytes(output)','test_final_engine_refusal_cannot_acknowledge_commit_reply','ValueError not raised')
    fault('parent-metadata-bound-omitted','        if len(metadata) > METADATA_LIMIT:','        if False:','test_parent_metadata_bound_precedes_child_creation','Oversized original metadata reached child creation','failures')
    fault('child-envelope-shape-unchecked',"    if not isinstance(value, dict) or set(value) != {'engine', 'taskUuid', 'token', 'deadline'}:",'    if False:','test_child_shape_uuid_and_credential_refuse_before_http','ValueError not raised')
    fault('child-uuid-unchecked',"    if not isinstance(task, str) or not re.fullmatch(TASK, task):",'    if False:','test_child_shape_uuid_and_credential_refuse_before_http','ValueError not raised')
    removed('original-plan-comparison-omitted','Original commit plan differs','test_changed_plan_refuses_before_credentials_or_network')
    fault('engine-boolean-coerced',"if self.attest(copy.deepcopy(self.plan['engine']), deadline) is not True:","if not self.attest(copy.deepcopy(self.plan['engine']), deadline):",'test_engine_check_false_or_nonboolean_refuses','ValueError not raised')
    fault('parent-credential-check-omitted',"        if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):",'        if False:','test_credential_none_and_invalid_values','Invalid original credential reached child creation','failures')
    fault('child-credential-check-omitted',"\n    if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):",'\n    if False:','test_child_shape_uuid_and_credential_refuse_before_http','ValueError not raised')
    fault('credential-error-exposed',"raise ValueError('Original commit credential resolution failed') from None",'raise','test_credential_resolution_error_is_not_exposed','PRIVATE_CREDENTIAL_MARKER','errors')
    removed('cancellation-type-coerced','Original commit cancellation must be a boolean','test_nonboolean_cancellation_refuses')
    removed('constructor-adapters-unchecked','Original commit supervision and explicit adapters are required','test_adapters_are_required')
    removed('missing-owner-adapter-unchecked','Original commit ownership adapter is required','test_adapters_are_required',"'NoneType' object is not callable",'errors')
    removed('owned-output-bound-omitted','Original commit child output exceeds its bound','test_owned_child_output_bounds','does not match','failures')
    fault('child-metadata-bound-omitted','    if size > METADATA_LIMIT:','    if False:','test_child_metadata_bound_precedes_payload_read','Oversized child metadata reached payload read','failures')
    removed('owner-type-coerced','Original commit ownership must be a boolean','test_absent_or_nonboolean_ownership_refuses','not raised','failures')
    fault('deadline-not-checked','        finite_deadline(deadline)\n\n    def _attest','        return\n\n    def _attest','test_deadline_refuses_before_network','did not complete','errors')
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[2] for row in cases}!=census:raise ValueError('Every processing access case requires a targeted control')
    def execute(label, test=None):
        names = ['test_original_commit_http' + ('.Checks.' + test if test else '')]
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
        positive('harmless-comment', original + b'\n# Harmless original processing access control.\n')
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
                    ('boolean-exit', True, output, test, diagnostic, kind, False),
                    ('wrong-case', code, output, 'unrelated_case', diagnostic, kind, False),
                    ('wrong-diagnostic', code, output, test, 'unrelated diagnostic', kind, False),
                    ('wrong-kind', code, output, test, diagnostic, 'errors' if kind == 'failures' else 'failures', False),
                    ('success-output', code, 'OK', test, diagnostic, kind, False)]:
                    actual = bool(intended(c, o, t, d, k))
                    if actual is not wanted:
                        raise AssertionError('Original processing authority failure oracle differs')
                    oracles.append({'control': label + '-' + name, 'accepted': actual})
                rows.append({'control': label, 'outcome': 'intended_failure', 'case': test, 'diagnostic': diagnostic, 'kind': kind})
            finally:
                module.write_bytes(original)
        positive('restored-final', original)
        if module.read_bytes() != original:
            raise AssertionError('Original processing authority HTTP source did not restore')
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
