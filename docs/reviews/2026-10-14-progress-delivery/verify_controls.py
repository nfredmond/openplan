"""Challenge progress delivery guards and restore every source edit in finally."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, test, diagnostic, kind='failures'):
    marker = 'FAIL:' if kind == 'failures' else 'ERROR:'
    other = 'ERROR:' if kind == 'failures' else 'FAIL:'
    names = re.findall(r'^'+marker+r' ([^ ]+) \(test_runtime_progress_delivery.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test}
        and diagnostic in output and not re.search(r'^'+other, output, re.MULTILINE)
        and re.search(r'FAILED \('+kind+r'=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/runtime_progress_delivery.py'
    originals = {path: path.read_bytes() for path in [module]}
    text = originals[module].decode()
    test_path = repo/'workers/odm_worker/test_runtime_progress_delivery.py'
    test_bytes = test_path.read_bytes()
    cases, controls, oracles = [], [], []

    def replace(label, before, after, test, diagnostic='ValueError not raised', target=module, kind='failures'):
        original = originals[target].decode()
        if original.count(before) != 1:
            raise ValueError(label+' requires one source binding')
        cases.append((label, target, original.replace(before, after), test, diagnostic, kind))

    def remove(label, message, test, diagnostic='ValueError not raised'):
        tree = ast.parse(text)
        found = [node for node in ast.walk(tree) if isinstance(node, ast.If)
            and any(isinstance(child, ast.Raise) and isinstance(child.exc, ast.Call)
                and child.exc.args and isinstance(child.exc.args[0], ast.Constant)
                and child.exc.args[0].value == message for child in node.body)]
        if len(found) != 1:
            raise ValueError(label+' requires one guard binding')
        found[0].test = ast.Constant(False)
        cases.append((label, module, ast.unparse(tree)+'\n', test, diagnostic, 'failures'))

    original_test = 'test_exact_scope_body_and_current_access_precede_one_post'
    replace('transport-reencodes-original', "command['bodyText'].encode('utf-8'), deadline,", "json_bytes(parse(command['bodyText'].encode('utf-8'), BODY_LIMIT)), deadline,", original_test,
        'Transport receives the original endpoint, credential reference and exact UTF-8 bytes')
    replace('acknowledged-replay-posts-again', "if state != 'retry_pending':", "if False:",
        'test_acknowledged_replay_never_posts_again', 'Acknowledged replay cannot duplicate delivery')
    replace('unknown-retry-changes-body', "command['bodyText'].encode('utf-8'), deadline,", "(command['bodyText'].encode('utf-8') if index == 0 else json_bytes(parse(command['bodyText'].encode('utf-8'), BODY_LIMIT))), deadline,",
        'test_transport_interruption_retries_original_identity_and_bytes', 'Unknown delivery retries exactly the original callback bytes')
    replace('reply-publication-omitted', "            publish(root, f'reply-{index:06d}.json', json_bytes(reply))", "            pass",
        'test_interruption_after_ack_before_receipt_uses_same_body', 'InterruptedError not raised')
    replace('refusal-retried', "if 400 <= status < 500:", "if False:",
        'test_refused_reply_stops_later_posts', 'Explicit consumer refusal stops retries')
    replace('transient-marked-acknowledged', "        return 'retry_pending'\n\n    def _before_transport", "        return 'acknowledged'\n\n    def _before_transport",
        'test_transient_and_unconfirmed_success_remain_retryable', 'Unconfirmed delivery cannot become acknowledgement')
    replace('changed-command-accepted', 'if json_bytes(saved) != json_bytes(expected):', 'if False:',
        'test_changed_saved_command_cannot_reach_transport')
    remove('foreign-reply-accepted', 'Progress delivery receiver reply binding differs',
        'test_changed_reply_binding_cannot_suppress_delivery')
    remove('foreign-attempt-accepted', 'Progress delivery attempt binding differs',
        'test_changed_attempt_binding_refuses_replay')
    remove('orphan-reply-accepted', 'Progress delivery reply requires its original attempt',
        'test_reply_without_original_attempt_refuses_another_post')
    # Both size checks protect the same returned-byte boundary.
    altered = text.replace("if type(body) is not bytes or len(body) > REPLY_LIMIT:", "if False:").replace("if len(body) > REPLY_LIMIT:", "if False:")
    cases.append(('oversized-reply-retained', module, altered,
        'test_oversized_reply_is_not_allocated_as_a_saved_receipt', 'ValueError not raised', 'failures'))
    replace('restart-reencodes-body', "command['bodyText'].encode('utf-8'), deadline,", "(command['bodyText'].encode('utf-8') if index == 0 else json_bytes(parse(command['bodyText'].encode('utf-8'), BODY_LIMIT))), deadline,",
        'test_restarted_runtime_uses_saved_body_and_original_start', 'A replacement runtime does not generate a new body')
    # Replace the saved original only for the callback command, leaving other journals intact.
    replace('new-event-replaces-original', "            publish(root, 'command.json', json_bytes(command))", "            (root/'command.json').unlink(missing_ok=True)\n            publish(root, 'command.json', json_bytes(command))",
        'test_existing_event_cannot_be_replaced_with_new_identity')
    remove('missing-command-recreated', 'Progress delivery records require their original command',
        'test_missing_command_with_existing_attempt_refuses_recreation')
    remove('revoked-access-accepted', 'Progress delivery current application access refused',
        'test_current_actor_revocation_refuses_preparation_and_replay', 'PermissionError not raised')
    replace('post-intent-access-omitted', "            self._access(request_id, deadline)\n            status, body =", "            status, body =",
        'test_revocation_after_intent_prevents_external_request', 'Access is checked again after the durable intent')
    replace('post-response-access-omitted', "            self._access(request_id, deadline)\n            return {'state': self._result(reply, command)", "            return {'state': self._result(reply, command)",
        'test_revocation_after_response_retains_fact_without_claiming_current_access', 'PermissionError not raised')
    remove('cancellation-ignored', 'Progress delivery cancelled',
        'test_unowned_and_cancelled_delivery_refuse_before_post', 'InterruptedError not raised')
    replace('terminal-progress-accepted', "STATUSES = set(contract.CALLBACK_STATUSES) - {'succeeded', 'failed', 'canceled'}", "STATUSES = set(contract.CALLBACK_STATUSES) - {'failed', 'canceled'}",
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    remove('attempt-limit-ignored', 'Progress delivery attempt retention limit reached',
        'test_attempt_capacity_and_sequence_cannot_be_bypassed')
    remove('invalid-deadline-accepted', 'Progress delivery needs a finite positive deadline',
        'test_constructor_requires_bounded_explicit_adapters')
    replace('invalid-event-key-accepted', "if not isinstance(event_key, str) or not event_key.strip() or len(event_key) > 256:", "if not isinstance(event_key, str):",
        'test_event_identity_and_cancellation_type_refuse')
    cases.append(('nonboolean-cancellation-accepted', module, text.replace('if type(decision) is not bool:', 'if False:').replace('if decision:', 'if decision is True:'),
        'test_event_identity_and_cancellation_type_refuse', 'ValueError not raised', 'failures'))
    replace('malformed-reply-status-accepted', "type(reply['status']) is not int or not 100 <= reply['status'] <= 599", 'False',
        'test_malformed_retained_reply_cannot_become_acknowledgement')
    remove('attempt-gap-accepted', 'Progress delivery attempt sequence differs',
        'test_attempt_capacity_and_sequence_cannot_be_bypassed')
    remove('missing-adapters-accepted', 'Progress delivery needs original dispatch and explicit transport adapters',
        'test_constructor_requires_bounded_explicit_adapters')
    remove('missing-credential-reference-accepted', 'Progress delivery needs an operator credential reference',
        'test_constructor_requires_bounded_explicit_adapters')
    remove('invalid-attempt-capacity-accepted', 'Progress delivery needs bounded attempt retention',
        'test_constructor_requires_bounded_explicit_adapters')
    remove('foreign-callback-scope-accepted', 'Progress delivery original callback scope differs',
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    replace('artifact-projection-accepted', "value.keys() - FIELDS - {'progress', 'message'}", 'False',
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    remove('invalid-callback-id-accepted', 'Progress delivery callback identity differs',
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    remove('invalid-progress-accepted', 'Progress delivery progress differs',
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    remove('invalid-message-accepted', 'Progress delivery message differs',
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    remove('oversized-body-accepted', 'Progress delivery JSON byte count differs',
        'test_terminal_artifact_foreign_and_invalid_payloads_refuse')
    replace('noncanonical-base64-accepted', "body = base64.b64decode(reply['bodyBase64'], validate=True)", "body = base64.b64decode(reply['bodyBase64'], validate=False)",
        'test_malformed_retained_reply_cannot_become_acknowledgement')
    replace('unicode-id-arbitrarily-refused', "len(value['callbackId'].encode('utf-16-le'))//2 < 8", "len(value['callbackId']) < 8",
        original_test, 'Progress delivery callback identity differs', kind='errors')
    replace('fractional-time-arbitrarily-refused', r'\.\d+', r'\.\d{1,9}',
        original_test, 'Progress delivery original occurrence time differs', kind='errors')
    tests = repo/'workers/odm_worker/test_runtime_progress_delivery.py'
    census = {node.name for node in ast.walk(ast.parse(tests.read_bytes()))
        if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    if {case[3] for case in cases} != census:
        raise ValueError('Every changed product test requires an intended fault')

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_runtime_progress_delivery'+('.Checks.'+test if test else '')], cwd=module.parent,
            capture_output=True, text=True, timeout=90,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 23 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 23})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless progress delivery recovery comment.\n')
        positive('harmless-comment')
        module.write_bytes(originals[module])
        positive('restored-after-harmless')
        for label, target, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                target.write_text(changed)
                code, output = execute(label, test)
                assert intended(code, output, test, diagnostic, kind), label+' misses its intended assertion'
                for variant, c, o, t, d, wanted in [
                    ('exact', code, output, test, diagnostic, True),
                    ('success', 0, output, test, diagnostic, False),
                    ('wrong-test', code, output, 'unrelated_test', diagnostic, False),
                    ('wrong-diagnostic', code, output, test, 'absent expected refusal', False),
                    ('syntax-error', code, 'SyntaxError', test, diagnostic, False),
                    ('unrelated-error', code, output+'\nERROR: unrelated\nFAIL: unrelated\n', test, diagnostic, False),
                    ('no-failure', code, 'Ran 1 test\nOK', test, diagnostic, False),
                    ('wrong-exit', 2, output, test, diagnostic, False),
                ]:
                    actual = bool(intended(c, o, t, d, kind))
                    assert actual == wanted, label+' oracle '+variant
                    oracles.append({'case': label, 'oracle': variant, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'test': test, 'diagnostic': diagnostic})
            finally:
                for path, payload in originals.items():
                    path.write_bytes(payload)
        positive('restored')
        assert test_path.read_bytes() == test_bytes, 'Test source remains unchanged through every cohort'
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        originals[test_path] = test_bytes
        (out/'bindings.json').write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(payload).hexdigest() for path, payload in originals.items()}, indent=2)+'\n')
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip() for key in ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}), flush=True)
    finally:
        for path, payload in originals.items():
            path.write_bytes(payload)
            assert path.read_bytes() == payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
