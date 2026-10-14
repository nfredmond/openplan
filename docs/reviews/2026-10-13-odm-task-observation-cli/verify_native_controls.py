"""Challenge actual command/native-root predicates and restore driver bytes."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    driver = repo / 'docs/reviews/2026-10-13-odm-task-observation-cli/native_cli.py'
    old = repo / 'docs/reviews/2026-10-13-odm-task-observation-retention/verify_native_controls.py'
    spec = importlib.util.spec_from_file_location('retained_native_predicate_oracle', old)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    original = driver.read_bytes()
    text = original.decode()
    cases = []
    def add(label, before, insertion, reason):
        if text.count(before) != 1:
            raise ValueError('Native operator anchor must be unique')
        cases.append((label, text.replace(before, insertion + before, 1), reason))
    add('command-failure-mislabeled', '        assert reply.returncode == 0 and not reply.stderr,',
        '        reply.returncode = 2\n', 'Native operator command must complete without a private diagnostic')
    add('command-diagnostic-present', '        assert reply.returncode == 0 and not reply.stderr,',
        "        reply.stderr = b'private diagnostic'\n", 'Native operator command must complete without a private diagnostic')
    add('actual-reply-digest-changed', "    assert recorded['bodySha256'] == result['bodySha256'],",
        "    recorded['bodySha256'] = '0' * 64\n", 'Native command must bind its actual retained reply digest')
    add('failed-state-relabelled', "    assert recorded['reportedState'] == 'failed'",
        "    recorded['reportedState'] = 'completed'\n", 'Native command must preserve reported failed-task facts')
    add('reported-count-lost', "    assert recorded['reportedState'] == 'failed'",
        "    recorded['reportedImageCount'] = 0\n", 'Native command must preserve reported failed-task facts')
    add('relocated-summary-changed', '    assert loaded == recorded,',
        "    loaded['reportedProgressPercent'] = None\n", 'Native relocated command must return the exact original summary')
    add('metadata-root-already-populated', '    assert not any(records.iterdir()),',
        "    (records / 'already-present').write_bytes(b'old record')\n", 'Native command must start with an empty metadata root')
    add('command-record-not-created', "    assert (records / (recorded['bodySha256'] + '.json')).is_file(),",
        "    (records / (recorded['bodySha256'] + '.json')).unlink()\n", 'Native command must create its own retained record')
    add('old-record-captured-instead', "    assert inventory(command_package / 'root' / 'observations', time.monotonic() + 10) == fresh_before,",
        "    (command_package / 'root' / 'observations' / 'different-record').write_bytes(b'old')\n", 'Native capture must contain the record created by the command')
    add('fresh-record-changed-after-recovery', '    assert inventory(records, time.monotonic() + 10) == fresh_before,',
        "    (records / 'changed-after-recovery').write_bytes(b'changed')\n", 'Native fresh command record must remain unchanged after recovery')
    for field in ('bodyBase64', 'reportedErrorDetail', 'engine', 'requestedOptions', 'reportedOptions'):
        add('private-detail-' + field, "    for field in ('bodyBase64', 'reportedErrorDetail', 'engine', 'requestedOptions', 'reportedOptions'):",
            '    loaded[' + repr(field) + "] = 'private'\n", 'Native command must exclude private detail field ' + field)
    for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',
                  'effectiveExecutionSettingsVerification', 'processingQualityVerification', 'freshnessVerification'):
        add('claim-promoted-' + field, "    for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',",
            '    loaded[' + repr(field) + "] = 'verified'\n", 'Native command cannot promote ' + field)
    for field in ('transportPermission', 'publicationPermission'):
        add('permission-promoted-' + field, "    assert loaded['transportPermission'] is False",
            '    loaded[' + repr(field) + '] = True\n', 'Native command cannot grant writes')
    # Select the final loop, after its actual command invocations and reads.
    before = "    for name, root in [('engine', engine), ('records', original_records), ('package', package)]:"
    for name in ('engine', 'records', 'package'):
        add('original-root-changed-' + name, before,
            '    (' + ('original_records' if name == 'records' else name) + " / 'unexpected-record').write_bytes(b'changed')\n", 'Native command must preserve original ' + name)
    outcomes = []
    oracles = None
    def execute(label):
        result = subprocess.run([sys.executable, '-B', str(driver), '--out', str(out / (label + '-private'))],
            cwd=repo, capture_output=True, timeout=120, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
        output = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        driver.write_bytes(payload)
        code, output = execute(label)
        if code:
            raise AssertionError(label + ': native command positive failed\n' + output)
        result = json.loads((out / (label + '-private') / 'results.json').read_bytes())
        if result.get('actualRecordCommandPassed') is not True or result.get('workerRecoveryAccepted') is not False:
            raise AssertionError(label + ': native command scope differs')
        outcomes.append({'control':label, 'outcome':'survived'})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless native operator control.\n')
        positive('restored-after-harmless', original)
        for label, changed, reason in cases:
            try:
                ast.parse(changed)
                driver.write_text(changed)
                code, output = execute(label)
                if not helper.native_failure(code, output, reason):
                    raise AssertionError(label + ': wrong native command failure\n' + output)
                if oracles is None:
                    oracles = helper.oracle_controls(output, reason)
                outcomes.append({'control':label, 'outcome':'intended_failure', 'reason':reason, 'exitCode':code})
            finally:
                driver.write_bytes(original)
        positive('restored-final', original)
        if driver.read_bytes() != original:
            raise AssertionError('Native operator source did not restore')
        (out / 'controls.json').write_text(json.dumps(outcomes, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in (driver, Path(__file__), old)}, indent=2) + '\n')
        print(json.dumps({'survivors':4, 'faults':len(cases), 'controls':len(outcomes)}))
    finally:
        driver.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
