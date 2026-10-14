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
    driver = repo / 'docs/reviews/2026-10-13-odm-original-processing-commit/native_client.py'
    producer = driver.with_name('native_rpc_recovery.py')
    original = driver.read_bytes()
    text = original.decode()
    cases = []
    def add(label, before, insertion, reason):
        if text.count(before) != 1:
            raise ValueError('Runtime native anchor must be unique')
        cases.append((label, text.replace(before, insertion + before, 1), reason))
    add('read-child-census-lost', "        assert children.count('original_task_http.py')", "        children.remove('original_task_http.py')\n", 'Runtime native observation must launch the exact supervised read children')
    add('application-read-census-lost', '        assert len(reads) == 5', '        reads.pop()\n', 'Actual runtime observation must check current access and native identity')
    add('engine-check-census-lost', '        assert len(reads) == 5', '        checks.pop()\n', 'Actual runtime observation must check current access and native identity')
    add('body-hash-summary-changed', "        assert result['task']['bodySha256'] ==", "        result['task']['bodySha256'] = '0' * 64\n", 'Actual runtime metadata must bind the independent native reply')
    add('reported-failure-promoted', "        assert result['task']['reportedState'] ==", "        result['task']['reportedState'] = 'completed'\n", 'Runtime reported native failure cannot become processing success')
    add('processing-permission-promoted', "        assert result['commitPermission'] is False", "        result['commitPermission'] = True\n", 'Runtime observation cannot grant effects or publication')
    add('copied-reply-projection-changed', '        assert copied == saved,', "        copied['reportedState'] = 'completed'\n", 'Runtime local copied reply must remain exact without another engine read')
    add('commit-post-census-lost',"        assert commit_children.count('original_commit_http.py')", "        commit_children.remove('original_commit_http.py')\n", 'Native processing commit must use two application reads, three engine checks and one supervised POST')
    add('commit-application-census-lost',"        assert commit_children.count('original_commit_http.py')", "        commit_children.remove('application_dispatch_http.py')\n", 'Native processing commit must use two application reads, three engine checks and one supervised POST')
    add('commit-engine-census-lost',"        assert commit_children.count('original_commit_http.py')", "        commit_children.remove('native_engine_attestation.py')\n", 'Native processing commit must use two application reads, three engine checks and one supervised POST')
    add('commit-replay-state-changed',"        assert committed == replayed", "        replayed = {**replayed, 'state':'processing_complete'}\n", 'Native original commit must retain and replay its exact receipt')
    add('commit-quality-promoted',"        assert committed['callbackPermission']", "        committed['processingQualityVerification'] = 'accepted'\n", 'Native commit receipt cannot promote processing quality or publication')
    outcomes = []
    oracles = None
    def execute(label):
        result = subprocess.run([sys.executable, '-B', str(producer), '--fixture', '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-private-dispatch-producer-20261011/rpc-cli-09', '--socket', '/var/run/docker.sock', '--daemon-uid', '0', '--out', str(out / (label + '-private'))],
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
        if result.get('actualOriginalCommit') is not True or result.get('commitPosts') != 1 or result.get('commitReplayExact') is not True or result.get('actualRuntimeObservation') is not True or result.get('workerRecoveryAccepted') is not False:
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
                private = out / (label + '-private') / 'rpc'
                process = json.loads((private / 'bound-runtime-original-processing-commit-process.json').read_bytes())
                child = (private / 'bound-runtime-original-processing-commit-private.log').read_text()
                if code != 1 or not native_failure(process['returncode'], child, reason):
                    raise AssertionError(label + ': wrong native child failure\n' + child)
                if oracles is None:
                    oracles = oracle_controls(child, reason)
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
