"""Challenge the actual original-task reader and selected-root observations."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def native_failure(code, output, reason):
    return (type(code) is int and code == 1 and isinstance(output, str)
            and isinstance(reason, str) and bool(reason)
            and 'Traceback (most recent call last):' in output
            and re.findall(r'(?m)^AssertionError: (.+)$', output) == [reason])


def oracle_controls(output, reason):
    result = []
    for label, text in [('baseline', output), ('harmless-prefix', '# Harmless oracle note.\n' + output), ('restored', output)]:
        if not native_failure(1, text, reason):
            raise AssertionError('Native oracle positive refused: ' + label)
        result.append({'control':label, 'outcome':'survived'})
    faults = [('success-exit', 0, output, reason), ('boolean-exit', True, output, reason),
              ('other-exit', 2, output, reason), ('missing-output', 1, None, reason),
              ('missing-reason', 1, output, None), ('empty-reason', 1, output, ''),
              ('unrelated-reason', 1, output.replace(reason, 'unrelated'), reason),
              ('extra-assertion', 1, output + '\nAssertionError: unrelated\n', reason),
              ('missing-traceback', 1, output.replace('Traceback (most recent call last):', ''), reason),
              ('stdout-decoy', 1, reason + '\n' + output.replace(reason, 'unrelated'), reason)]
    for label, code, text, expected in faults:
        if native_failure(code, text, expected):
            raise AssertionError('Native oracle invalid result accepted: ' + label)
        result.append({'control':label, 'outcome':'intended_refusal'})
    return result


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    driver = repo / 'docs/reviews/2026-10-13-odm-original-task-read/native_read.py'
    original = driver.read_bytes()
    text = original.decode()
    cases = []
    def add(label, before, insertion, reason):
        if text.count(before) != 1:
            raise ValueError('Original task native anchor must be unique')
        cases.append((label, text.replace(before, insertion + before, 1), reason))
    add('producer-label-changed', "        assert info['Config']['Labels'].get('openplan.proof')", "        info['Config']['Labels']['openplan.proof'] = 'other'\n", 'Actual engine must belong to this producer')
    add('native-port-changed', '        assert port == 34100,', '        port = 1\n', 'Pinned native task port must remain exact')
    add('actual-attestor-check-refused', "            assert result is True,", '            result = False\n', 'Original live engine check must succeed')
    add('read-child-observation-lost', "        assert supervised.count('original_task_http.py')", "        supervised.remove('original_task_http.py')\n", 'Actual read and both native checks must launch their owned children')
    add('engine-child-observation-lost', "        assert supervised.count('original_task_http.py')", "        supervised.remove('native_engine_attestation.py')\n", 'Actual read and both native checks must launch their owned children')
    add('actual-reply-changed', '        assert result == original,', "        result['reportedState'] = 'completed'\n", 'Actual supervised read must equal the independent failed-task reply')
    add('loaded-reply-changed', "        assert store.load(result['bodySha256']) == result,", "        result['reportedProgressPercent'] = None\n", 'Actual retained task reply must reopen')
    add('native-check-census-lost', '    assert len(retained) == 1', '    checks.pop()\n', 'One actual task read must have both engine checks')
    add('producer-running-projection', "    assert stopped['Id'] == owner['id']", "    stopped['State']['Running'] = True\n", 'Owned engine must stop before capture')
    add('snapshot-manifest-changed', '    assert verify(point, timeout=10) == captured,', "    captured['format'] = 'other'\n", 'Actual task record root must verify')
    add('relocated-reply-changed', '    assert restored == result', "    restored['reportedState'] = 'completed'\n", 'Relocated read must recover exact actual reply bytes')
    add('original-root-changed', '    assert inventory(source, time.monotonic() + 10) == before,', "    (source / 'unexpected-record').write_bytes(b'changed')\n", 'Original selected root must remain unchanged')
    add('retained-snapshot-changed', '    assert inventory(point, time.monotonic() + 10) == point_before,', "    (point / 'unexpected-record').write_bytes(b'changed')\n", 'Retained snapshot must remain unchanged')
    outcomes = []
    oracles = None
    def execute(label):
        result = subprocess.run([sys.executable, '-B', str(driver), '--out', str(out / (label + '-private'))],
            capture_output=True, cwd=repo, timeout=120, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
        output = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        driver.write_bytes(payload)
        code, output = execute(label)
        if code:
            raise AssertionError(label + ': native positive failed\n' + output)
        result = json.loads((out / (label + '-private') / 'results.json').read_bytes())
        if result.get('actualOriginalTaskRead') is not True or result.get('workerRecoveryAccepted') is not False:
            raise AssertionError(label + ': native result limits differ')
        outcomes.append({'control':label, 'outcome':'survived'})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless selected-root native control.\n')
        positive('restored-after-harmless', original)
        for label, changed, reason in cases:
            try:
                ast.parse(changed)
                driver.write_text(changed)
                code, output = execute(label)
                if not native_failure(code, output, reason):
                    raise AssertionError(label + ': wrong native failure\n' + output)
                if oracles is None:
                    oracles = oracle_controls(output, reason)
                outcomes.append({'control':label, 'outcome':'intended_failure', 'reason':reason, 'exitCode':code})
            finally:
                driver.write_bytes(original)
        positive('restored-final', original)
        if driver.read_bytes() != original:
            raise AssertionError('Native retention source did not restore')
        (out / 'controls.json').write_text(json.dumps(outcomes, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in (driver, Path(__file__))}, indent=2) + '\n')
        print(json.dumps({'positive':4, 'broken':len(cases), 'controls':len(outcomes)}))
    finally:
        driver.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
