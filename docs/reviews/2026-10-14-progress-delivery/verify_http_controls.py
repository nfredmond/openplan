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
    names = re.findall(r'^'+marker+r' ([^ ]+) \(test_progress_http.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test}
        and diagnostic in output and not re.search(r'^'+other, output, re.MULTILINE)
        and re.search(r'FAILED \('+kind+r'=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/progress_http.py'
    originals = {path: path.read_bytes() for path in [module]}
    text = originals[module].decode()
    test_path = repo/'workers/odm_worker/test_progress_http.py'
    test_bytes = test_path.read_bytes()
    (out/'original-source-private.py').write_bytes(originals[module])
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

    original_test = 'test_actual_post_preserves_path_bearer_body_and_response'
    replace('original-body-reencoded', "'bodyBase64': base64.b64encode(body).decode(),", "'bodyBase64': base64.b64encode(body.strip()).decode(),", original_test,
        'Transport preserves exact original UTF-8 body bytes')
    replace('original-query-omitted', "(parts.path or '/')+('?' + parts.query if parts.query else ''), body=body,", "(parts.path or '/'), body=body,", original_test,
        'Transport preserves the original callback path and query')
    replace('bearer-omitted', "'Authorization': 'Bearer '+value['token']", "'Authorization': 'Bearer wrong-original'", original_test,
        'Transport resolves the original callback bearer')
    replace('response-bytes-replaced', "'bodyBase64': base64.b64encode(reply).decode()}, separators=", "'bodyBase64': base64.b64encode(reply+b'changed').decode()}, separators=", original_test,
        'Complete receiver response stays exact')
    replace('redirect-followed', "        length = response_length(response.headers, REPLY_LIMIT)",
        "        if response.status == 302:\n            client.request('POST', response.getheader('Location'), body=body, headers={'Authorization': 'Bearer '+value['token']})\n            response = client.getresponse()\n        length = response_length(response.headers, REPLY_LIMIT)",
        'test_redirect_is_returned_without_following_or_forwarding_bearer',
        'Callback redirect cannot forward the bearer to another endpoint')
    replace('preflight-check-omitted', "        self._check(deadline, owned)\n        if url !=", "        if url !=",
        'test_precancelled_unowned_and_expired_calls_start_no_child_or_credential_read', 'Preflight interruption precedes credential resolution')
    replace('ownership-loss-ignored', "        if decision is not True:", "        if False:",
        'test_ownership_loss_during_response_stops_actual_child_and_socket', 'Progress HTTP child did not complete', kind='errors')
    replace('cancellation-ignored', "        self.policy._check(deadline)", "        deadline_check(deadline)",
        'test_cancellation_during_response_stops_actual_child_and_socket', 'Progress HTTP child did not complete', kind='errors')
    replace('deadline-check-ignored', "        self.policy._check(deadline)", "        if self.policy.cancelled(): raise InterruptedError('Source transport cancelled')",
        'test_deadline_stops_stalled_response_without_partial_acknowledgement', 'Progress HTTP child did not complete', kind='errors')
    altered = text.replace('length = response_length(response.headers, REPLY_LIMIT)', 'length = None').replace('response.read(REPLY_LIMIT+1)', 'response.read1(REPLY_LIMIT+1)').replace('if len(reply) > REPLY_LIMIT or length is not None and len(reply) != length or response.length not in (None, 0):', 'if False:').replace('if len(reply) > REPLY_LIMIT:', 'if False:')
    cases.append(('partial-response-accepted', module, altered,
        'test_short_and_oversized_response_cannot_be_confirmed', 'ValueError not raised', 'failures'))
    remove('changed-original-scope-accepted', 'Progress HTTP original endpoint or credential reference differs',
        'test_changed_endpoint_reference_body_and_credential_refuse_before_network')
    # The independent child bound still refuses the bytes. Losing the parent
    # guard changes the required preflight refusal into a later child failure.
    remove('oversized-original-body-accepted', 'Progress HTTP exact body bytes exceed their bound',
        'test_changed_endpoint_reference_body_and_credential_refuse_before_network',
        'Progress HTTP child did not complete')
    replace('address-policy-ignored', "tuple(ipaddress.ip_network(net, strict=True) for net in value['networks'])", "(ipaddress.ip_network('127.0.0.1/32'),)",
        'test_private_address_requires_explicit_policy')
    remove('invalid-constructor-accepted', 'Progress HTTP requires original endpoint and credential adapters',
        'test_nonboolean_owner_and_invalid_constructor_refuse')
    replace('response-status-accepted', "type(value['status']) is not int or not 100 <= value['status'] <= 599", 'False',
        'test_invalid_response_envelopes_cannot_become_acknowledgements')
    replace('response-unknown-fields-accepted', "set(value) != {'status', 'bodyBase64'}", 'False',
        'test_invalid_response_envelopes_cannot_become_acknowledgements')
    remove('oversized-response-accepted', 'Progress HTTP response exceeds its bound',
        'test_invalid_response_envelopes_cannot_become_acknowledgements')
    remove('response-wire-bound-ignored', 'Progress HTTP response wire bytes differ',
        'test_invalid_response_envelopes_cannot_become_acknowledgements')
    replace('duplicate-response-property-accepted', 'object_pairs_hook=strict_object', 'object_pairs_hook=dict',
        'test_invalid_response_envelopes_cannot_become_acknowledgements')
    replace('nonboolean-owner-accepted', 'if type(decision) is not bool:', 'if False:',
        'test_nonboolean_owner_and_invalid_constructor_refuse', 'Progress HTTP ownership ended', kind='errors')
    replace('noncanonical-base64-accepted', "reply = base64.b64decode(value['bodyBase64'], validate=True)", "reply = base64.b64decode(value['bodyBase64'], validate=False)",
        'test_invalid_response_envelopes_cannot_become_acknowledgements')
    tests = repo/'workers/odm_worker/test_progress_http.py'
    census = {node.name for node in ast.walk(ast.parse(tests.read_bytes()))
        if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    if {case[3] for case in cases} != census:
        raise ValueError('Every changed transport test requires an intended fault')

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_progress_http'+('.Checks.'+test if test else '')], cwd=module.parent,
            capture_output=True, text=True, timeout=90,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 11 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 11})

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
