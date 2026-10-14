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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_runtime_commit.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/runtime_commit.py'
    original = module.read_bytes()
    text = original.decode()
    tests = repo / 'workers/odm_worker/test_runtime_commit.py'
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
    fault('incomplete-draft-grants-commit',"if any(row['state'] != 'acknowledged' for row in snapshot['commands'][:-1]):",'if False:','test_incomplete_original_drafts_hold_before_permission_or_transport','held_incomplete_draft')
    fault('acknowledged-commit-replayed',"if snapshot['commands'][-1]['state'] == 'acknowledged':",'if False:','test_one_exact_commit_retains_reply_and_replay_sends_nothing','Retained commit replay cannot obtain another grant')
    fault('denied-permission-accepted','if allowed is not True:','if False:','test_permission_requires_exact_true_before_intent','PermissionError not raised')
    fault('uncertain-commit-reauthorized',"if any(row['state'] == 'unresolved' for row in snapshot['commands']):",'if False:','test_lost_acknowledgment_keeps_uncertain_commit_without_second_post','Uncertain original commit cannot obtain another grant')
    fault('wrong-reply-accepted',"effects.save_reply('commit', status, body)","effects.save_reply('commit', 200, json_bytes({'uuid':effects.plan['taskUuid']}))",'test_wrong_original_commit_reply_stays_unresolved','ValueError not raised')
    removed('response-shape-unchecked','Original processing response shape differs','test_response_shape_must_be_tuple_before_retention')
    fault('authorization-plan-alias','self.authorize(copy.deepcopy(effects.plan),','self.authorize(effects.plan,','test_adapters_cannot_replace_original_plan_or_command','Saved engine plan differs from original identity','errors')
    fault('authorization-command-alias','copy.deepcopy(command), deadline=deadline)','command, deadline=deadline)','test_adapters_cannot_replace_original_plan_or_command','Authorization cannot replace the original commit command')
    # Both the local permission check and the shared Effects deadline protect this intent.
    fault('permission-deadline-not-checked','            check_time(deadline)\n            if allowed','            effects.deadline = None\n            if allowed','test_expired_permission_refuses_before_commit_intent','Expired processing permission cannot issue an original intent')
    fault('owner-silently-restored-before-intent','            self.draft.preparation._entry(request_id)\n            check_time(deadline)\n            if allowed',"            runtime._owned = True\n            self.draft.preparation._entry(request_id)\n            check_time(deadline)\n            if allowed",'test_owner_loss_during_permission_refuses_before_intent','ValueError not raised')
    fault('owner-silently-restored-after-transport','            self.draft.preparation._entry(request_id)\n            check_time(deadline)\n            if type(response)',"            runtime._owned = True\n            self.draft.preparation._entry(request_id)\n            check_time(deadline)\n            if type(response)",'test_owner_loss_after_transport_retains_intent_and_refuses_reply','ValueError not raised')
    fault('processing-lock-omitted','with writer(dispatch, deadline):','with __import__("contextlib").nullcontext():','test_concurrent_committers_share_one_durable_intent_and_post','Concurrent original committers must retain the same coordination outcome')
    removed('command-order-unchecked','Original processing command order differs','test_out_of_order_original_receipts_refuse')
    removed('original-job-scope-unchecked','Processing job request differs from its original','test_job_hook_requires_original_request_and_never_reports_completion')
    removed('constructor-adapters-not-required','Original draft and explicit processing adapters are required','test_constructor_requires_explicit_adapters_and_finite_timeout')
    removed('constructor-deadline-not-required','Original commit timeout must be positive and finite','test_constructor_requires_explicit_adapters_and_finite_timeout')
    removed('malformed-job-not-refused','Original processing needs its original job request','test_malformed_job_hook_refuses_before_journal_or_transport',"TypeError: 'NoneType' object is not subscriptable",'errors')
    fault('existing-intent-sent-again','if first is not True:','if False:','test_existing_intent_is_never_sent_from_stale_snapshot','held_uncertain')
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[2] for row in cases}!=census:raise ValueError('Every processing access case requires a targeted control')
    def execute(label, test=None):
        names = ['test_runtime_commit' + ('.Checks.' + test if test else '')]
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
