"""Run real isolated API/root journeys, with named native fault predicates."""
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
    driver = repo / 'docs/reviews/2026-10-13-odm-task-observation-retention/native_retention.py'
    original = driver.read_bytes()
    text = original.decode()
    cases = []
    def add(label, before, insertion, reason):
        if text.count(before) != 1:
            raise ValueError('Native retention anchor must be unique')
        cases.append((label, text.replace(before, insertion + before, 1), reason))
    add('actual-reply-view-changed', '        assert saved == result,',
        "        saved['reportedProgressPercent'] = None\n", 'Native private record must equal its checked actual reply')
    add('extra-native-observation', '    assert len(retained) == 1,',
        '    retained.append(retained[0])\n', 'Native fixture must retain exactly one committed failed reply')
    add('producer-ownership-changed', "    assert actual['Id'] == owner['id']",
        "    actual['Config']['Labels']['openplan.proof'] = 'other'\n", 'Native producer ownership must remain exact')
    add('producer-still-running', "    assert actual['State']['Running'] is False,",
        "    actual['State']['Running'] = True\n", 'Native producer must stop before the selected-root point')
    add('package-projection-changed', '    assert verify(package, timeout=10) == captured,',
        "    captured['format'] = 'other'\n", 'Native selected-root package must verify exactly')
    add('reopened-reply-view-changed', '    assert restored == observed,',
        "    restored['reportedProgressPercent'] = None\n", 'Native selected-root consumer must recover the original exact reply')
    add('actual-body-hash-changed', "    assert restored['bodySha256'] == hashlib.sha256(body).hexdigest(),",
        "    restored['bodySha256'] = '0' * 64\n", 'Native retained response hash must bind actual reply bytes')
    add('reported-failure-relabeled', "    assert restored['reportedState'] == 'failed'",
        "    restored['reportedState'] = 'completed'\n", 'Native reported failure must remain separate from success')
    add('reported-count-becomes-zero', "    assert restored['reportedState'] == 'failed'",
        "    restored['reportedImageCount'] = 0\n", 'Native reported failure must remain separate from success')
    anchor = "    for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',"
    for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',
                  'effectiveExecutionSettingsVerification', 'processingQualityVerification', 'freshnessVerification'):
        add('claim-promoted-' + field, anchor, "    restored[" + repr(field) + "] = 'verified'\n",
            'Native retained metadata cannot promote ' + field)
    for field in ('transportPermission', 'publicationPermission'):
        add('permission-promoted-' + field, "    assert restored['transportPermission'] is False",
            '    restored[' + repr(field) + '] = True\n', 'Native retained metadata cannot grant writes')
    add('original-selected-root-changed', '    assert inventory(source, time.monotonic() + 10) == before,',
        "    (source / 'unexpected-record').write_bytes(b'changed')\n", 'Native recovery must preserve the original root')
    add('original-engine-commands-changed', "    assert inventory(api_root / 'effects', time.monotonic() + 10) == original_engine_before,",
        "    (api_root / 'effects' / 'unexpected-record').write_bytes(b'changed')\n", 'Native metadata must leave original engine commands intact')
    add('immutable-package-changed', '    assert inventory(package, time.monotonic() + 10) == package_before,',
        "    (package / 'unexpected-record').write_bytes(b'changed')\n", 'Native recovery must preserve the immutable package')
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
        if result.get('actualReplyRetained') is not True or result.get('workerRecoveryAccepted') is not False:
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
