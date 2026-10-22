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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_application_processing_authority.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/application_processing_authority.py'
    original = module.read_bytes()
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_application_processing_authority.py'
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
    initial="        if self.reader.observe(request_id, deadline=deadline)['authorizedNow'] is not True:\n            return False"
    fault('initial-current-read-omitted',initial,'        if False:\n            return False','test_exact_commit_checks_current_access_around_engine_attestation','Processing permission must check current access before and after attestation')
    removed('command-guard-omitted','Only the exact original processing commit can be authorized','test_draft_commands_and_changed_commit_refuse_before_current_read')
    removed('saved-engine-plan-guard-omitted','Processing plan differs from the saved original engine plan','test_changed_valid_plan_cannot_reuse_original_application_binding')
    fault('initial-revocation-ignored',initial,'        if False:\n            return False','test_initial_revocation_refuses_before_engine_check','Revoked access cannot reach processing engine attestation')
    fault('final-revocation-ignored',"        return current['authorizedNow'] is True",'        return True','test_revocation_during_attestation_refuses_permission','Revocation during attestation cannot grant processing permission')
    removed('non-boolean-engine-result-accepted','Processing engine attestation must return a boolean','test_engine_refusal_and_non_boolean_attestation_do_not_permit')
    fault('engine-refusal-ignored','        if attested is not True:\n            return False','        if False:\n            return False','test_engine_refusal_and_non_boolean_attestation_do_not_permit','True is not False')
    fault('owner-silently-acquired','        if deadline is None:',"        if not self.reader.dispatch.runtime._owned:\n            with self.reader.dispatch.runtime.owner():\n                return self(plan, operation, command, deadline=deadline)\n        if deadline is None:",'test_unowned_runtime_cannot_obtain_processing_permission','ValueError not raised')
    fault('scope-comparisons-disabled','from engine_effects import commands, engine_identity, same','from engine_effects import commands, engine_identity, same\ndef same(left, right):return True','test_changed_scope_and_engine_refuse_before_current_access','ValueError not raised')
    removed('constructor-adapters-not-required','Private reader and explicit processing engine attestation are required','test_constructor_requires_private_reader_and_explicit_attestor')
    removed('missing-shared-deadline-accepted','Processing authority requires its actual shared deadline','test_actual_shared_deadline_is_required_before_current_access')
    removed('binding-shape-guard-omitted','Processing original application binding is required','test_original_binding_shape_is_required_before_private_reads',"KeyError: 'requestId'",'errors')
    fault('engine-alias-forwarded','self.attest(copy.deepcopy(self.engine), deadline,','self.attest(self.engine, deadline,','test_engine_attestation_cannot_change_original_or_extend_deadline','Processing attestation cannot replace the configured engine through an alias')
    fault('shared-deadline-extended','deadline = self.reader._deadline(deadline)','deadline = self.reader._deadline(deadline + 30)','test_engine_attestation_cannot_change_original_or_extend_deadline','Processing attestation must receive its original engine and actual deadline')
    removed('configured-engine-guard-omitted','Processing engine differs from the configured original','test_configured_engine_cannot_authorize_another_saved_engine')
    removed('saved-application-scope-guard-omitted','Processing scope differs from the saved application original','test_changed_saved_plan_cannot_replace_original_application_scope')
    removed('prepared-runtime-guard-omitted','Processing plan differs from its prepared runtime record','test_mixed_saved_engine_plan_cannot_replace_prepared_task')
    removed('prepared-digest-ignored','Processing plan differs from its prepared runtime record','test_prepared_engine_digest_is_required_before_current_access')
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[2] for row in cases}!=census:raise ValueError('Every processing access case requires a targeted control')
    def execute(label, test=None):
        names = ['test_application_processing_authority' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 16 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete task-read cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 16})
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
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 16, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        module.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
