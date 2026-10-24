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


def readable_stream(stream):
    if stream is None:
        return ''
    return stream.decode('utf-8', errors='backslashreplace') if isinstance(stream, bytes) else stream


def stream_bytes(stream):
    if stream is None:
        return b''
    return stream if isinstance(stream, bytes) else stream.encode('utf-8', errors='surrogatepass')


# Keep each stream independently, even when another evidence write fails.
def write_evidence(out, label, stdout, stderr, status):
    log = out / (label + '-private.log')
    writes = [
        (out / (label + '-stdout-private.bin'), lambda path: path.write_bytes(stream_bytes(stdout))),
        (out / (label + '-stderr-private.bin'), lambda path: path.write_bytes(stream_bytes(stderr))),
        (log, lambda path: path.write_text(
            status + '\nRaw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
            + '--- stdout (' + type(stdout).__name__ + ') ---\n' + readable_stream(stdout)
            + '\n--- stderr (' + type(stderr).__name__ + ') ---\n' + readable_stream(stderr),
            encoding='utf-8', errors='backslashreplace')),
    ]
    failures = []
    for path, write in writes:
        try:
            write(path)
        except Exception as error:
            failure = RuntimeError('EVIDENCE FAILURE: ' + path.name + ': ' + repr(error))
            failure.__cause__ = error
            failures.append(failure)
    if failures:
        raise ExceptionGroup('Control evidence writes failed', failures)


# Evidence cannot replace the child timeout as the primary failure.
def execute(module, out, label, test=None):
    names = ['test_uncertain_commit_inspection' + ('.Checks.' + test if test else '')]
    try:
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    except subprocess.TimeoutExpired as timeout:
        timeout.add_note('CONTROL TIMEOUT: ' + label + '; partial streams belong to this timed-out child.')
        try:
            write_evidence(out, label, timeout.stdout, timeout.stderr, 'TIMEOUT: ' + label + '; limit=30 seconds')
        except Exception as evidence_error:
            timeout.add_note('TIMEOUT EVIDENCE FAILURE: ' + repr(evidence_error))
        raise
    output = result.stdout + result.stderr
    write_evidence(out, label, result.stdout, result.stderr, 'RETURN CODE: ' + str(result.returncode) + '; control=' + label)
    return result.returncode, output


def intended(code, output, test, diagnostic, kind):
    marker = 'FAIL:' if kind == 'failures' else 'ERROR:'
    other = 'ERROR:' if kind == 'failures' else 'FAIL:'
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_uncertain_commit_inspection.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/uncertain_commit_inspection.py'
    observer = repo / 'workers/odm_worker/runtime_observation.py'
    draft = repo / 'workers/odm_worker/runtime_draft.py'
    effects = repo / 'workers/odm_worker/engine_effects.py'
    preparation = repo / 'workers/odm_worker/runtime_preparation.py'
    originals = {path: path.read_bytes() for path in (module, observer, draft, effects, preparation)}
    original = originals[module]
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_uncertain_commit_inspection.py'
    rows = []; oracles = []; cases = []
    def fault(label, before, after, test, diagnostic, kind='failures', target=module):
        source = originals[target].decode()
        if source.count(before) != 1: raise ValueError(label + ' source binding must be unique')
        changed = source.replace(before, after)
        if label == 'acknowledged-task-get': changed = changed.replace("            if acknowledgment != 'unresolved':", "            if acknowledgment == 'unissued':")
        cases.append((label, target, changed, test, diagnostic, kind))
    def removed(label, message, test, diagnostic='ValueError not raised', kind='failures'):
        tree = ast.parse(text)
        found = [node for node in ast.walk(tree) if isinstance(node, ast.If) and any(isinstance(child, ast.Raise) and isinstance(child.exc, ast.Call) and child.exc.args and isinstance(child.exc.args[0], ast.Constant) and child.exc.args[0].value == message for child in node.body)]
        if len(found) != 1: raise ValueError(label + ' guard must be unique')
        found[0].test = ast.Constant(False)
        cases.append((label, module, ast.unparse(tree)+'\n', test, diagnostic, kind))
    fault('uncertain-ack-promoted', "return self._result(effects, final['commands'][-1]['state'], observation)", "return self._result(effects, 'acknowledged', observation)", 'test_uncertain_commit_inspects_exact_task_without_another_post_or_reply', 'Task GET must not acknowledge a missing commit reply')
    fault('incomplete-draft-read', "if any(row['state'] != 'acknowledged' for row in snapshot['commands'][:-1]):", 'if False:', 'test_incomplete_draft_returns_without_current_read', 'Incomplete original uploads must hold before GET')
    fault('unissued-processing-invented', "        if acknowledgment != 'unresolved':\n            return self._result(effects, acknowledgment)", "        if acknowledgment != 'unresolved':\n            return self._result(effects, 'unresolved')", 'test_unissued_commit_returns_without_current_read', 'Unissued original commit must not inspect a processing effect')
    fault('acknowledged-task-get', "        if acknowledgment != 'unresolved':\n            return self._result(effects, acknowledgment)", "        if acknowledgment == 'unissued':\n            return self._result(effects, acknowledgment)", 'test_acknowledged_commit_returns_without_current_read', 'Exact acknowledged commit must return without task GET')
    removed('original-dispatch-not-checked', 'Commit inspection original dispatch differs', 'test_original_processing_dispatch_is_required_before_get')
    removed('observation-plan-unchecked', 'Commit inspection original observation differs', 'test_wrong_observation_plan_is_refused')
    fault('revocation-accepted', "if observed['authorizedNow'] is not True:", 'if False:', 'test_current_revocation_refuses_without_another_post', 'PermissionError not raised', target=observer)
    removed('wrong-constructor-adapter', 'Original commit and current task observer are required', 'test_same_runtime_and_real_adapter_types_are_required', "'NoneType' object has no attribute 'draft'", 'errors')
    fault('ended-owner-replaced', '        self._scope()\n        draft =', '        self._scope()\n        self.commit.draft.preparation.runtime._owned = True\n        draft =', 'test_unowned_inspection_refuses_before_current_read', 'ValueError not raised')
    removed('changed-job-accepted', 'Commit inspection job request differs from its original', 'test_job_hook_preserves_state_and_requires_original_request')
    fault('runtime-alias-unchecked', '        self._scope()\n        draft =', '        draft =', 'test_changed_runtime_refuses_before_get', "'object' object has no attribute 'root'", 'errors')
    fault('late-ack-ignored', "return self._result(effects, final['commands'][-1]['state'], observation)", "return self._result(effects, 'unresolved', observation)", 'test_late_exact_reply_is_retained_separately_from_task_metadata', 'Final exact reply arrival must remain distinct from task GET')
    before = '            observation = observer.observe(request_id)\n'
    tail = text[text.index(before):]
    fault('ended-owner-after-read-accepted', tail, tail.replace('            draft.preparation._entry(request_id)\n',''), 'test_ended_ownership_after_observation_refuses_return', 'ValueError not raised')
    fault('expiry-checks-and-final-journal-validation-removed', tail, tail.replace('            check_time(deadline)\n','').replace('final = effects.snapshot(deadline=deadline)', 'final = current'), 'test_expired_observation_refuses_return', 'TimeoutError not raised')
    fault('observation-deadline-extended', 'timeout=min(self.observer.timeout, remaining)', 'timeout=self.observer.timeout', 'test_observer_timeout_uses_remaining_commit_budget', 'Inspection cannot extend the commit budget for its task read')
    fault('preparation-budget-not-forwarded', 'self.preparation.resume(request_id, deadline=deadline)', 'self.preparation.resume(request_id)', 'test_shared_budget_bounds_actual_slow_preparation_validation', 'Inspection budget must bound slow preparation source validation', target=draft)
    fault('snapshot-budget-not-forwarded', 'snapshot = effects.snapshot(deadline=deadline)', 'snapshot = effects.snapshot()', 'test_shared_budget_bounds_actual_slow_snapshot_validation', 'Inspection budget must bound slow snapshot source validation')
    fault('preparation-deadline-bool-accepted', 'type(deadline) not in (int, float)', 'not isinstance(deadline, (int, float))', 'test_preparation_deadline_types_refuse_before_supplier', 'TimeoutError: Source custody deadline exceeded', 'errors', target=preparation)
    fault('effect-deadline-bool-accepted', 'type(supplied) not in (int, float)', 'not isinstance(supplied, (int, float))', 'test_effect_deadline_types_refuse_before_source_validation', 'TimeoutError: Source custody deadline exceeded', 'errors', target=effects)
    source = originals[effects].decode()
    before = source[source.index('    def snapshot(self, *, deadline=None):'):]
    fault('snapshot-lock-budget-not-forwarded', before, before.replace('end = self._end(deadline)', 'end = self._end()'), 'test_effect_snapshot_shared_deadline_bounds_actual_lock_wait', 'Shared snapshot budget must bound its actual journal lock wait', target=effects)
    fault('source-timeout-bool-normalized', 'type(original_timeout) not in (int, float)', 'not isinstance(original_timeout, (int, float))', 'test_source_timeout_types_are_not_normalized_by_deadline_clamping', 'ValueError not raised', target=effects)
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[3] for row in cases}!=census:raise ValueError('Every processing access case requires a targeted control')
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(module, out, label)
        if code or 'Ran 21 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete task-read cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 21})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless original processing access control.\n')
        positive('restored-after-harmless', original)
        for label, target, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                target.write_text(changed)
                code, output = execute(module, out, label, test)
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
                for path, data in originals.items(): path.write_bytes(data)
        positive('restored-final', original)
        if module.read_bytes() != original:
            raise AssertionError('Original processing authority HTTP source did not restore')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [module, observer, draft, effects, preparation, tests, Path(__file__)]}, indent=2) + '\n')
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 21, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        for path, data in originals.items(): path.write_bytes(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
