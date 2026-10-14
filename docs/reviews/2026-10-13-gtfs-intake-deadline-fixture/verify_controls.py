"""Prove the intake deadline/recovery fixture with restored selected faults."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

TEST = 'bounds an ignored upload deadline and recovers saved bytes on retry'
FULL_NAME = 'managed GTFS source intake '+TEST


def intended_failure(code, report, diagnostic, reason, kind):
    failed = [row for suite in report.get('testResults', []) for row in suite.get('assertionResults', []) if row.get('status') == 'failed']
    if code != 1 or type(report.get('numFailedTests')) is not int or report['numFailedTests'] != 1 or len(failed) != 1:
        return False
    row = failed[0];messages = row.get('failureMessages', [])
    clean = re.sub(r'\x1b\[[0-9;]*m', '', diagnostic)
    return row.get('fullName') == FULL_NAME and len(messages) == 1 and messages[0].splitlines()[0].startswith(kind+': ') \
        and reason in messages[0].splitlines()[0] and not re.search(r'Unhandled (?:Errors|Rejection)|uncaught exception', clean, re.IGNORECASE)


def oracle_controls(code, report, diagnostic, reason, kind):
    rows = []
    for name, value in [('baseline', report), ('harmless', {**report, 'note':'Harmless proof metadata'}), ('restored', copy.deepcopy(report))]:
        assert intended_failure(code, value, diagnostic, reason, kind)
        rows.append({'case':name, 'outcome':'survived'})
    cases = []
    wrong = copy.deepcopy(report);wrong['numFailedTests'] = True;cases.append(('wrong-count-type', code, wrong, diagnostic))
    wrong = copy.deepcopy(report)
    failed = next(row for suite in wrong['testResults'] for row in suite['assertionResults'] if row['status'] == 'failed')
    failed['fullName'] = 'Unrelated selected test';cases.append(('wrong-test', code, wrong, diagnostic))
    wrong = copy.deepcopy(report)
    failed = next(row for suite in wrong['testResults'] for row in suite['assertionResults'] if row['status'] == 'failed')
    failed['failureMessages'] = ['TypeError: '+reason];cases.append(('wrong-error-kind', code, wrong, diagnostic))
    wrong = copy.deepcopy(report)
    failed = next(row for suite in wrong['testResults'] for row in suite['assertionResults'] if row['status'] == 'failed')
    failed['failureMessages'] = [kind+': Unrelated failure\n    source mentions '+reason];cases.append(('reason-only-in-source', code, wrong, diagnostic))
    cases += [('zero-exit', 0, report, diagnostic), ('extra-unhandled-error', code, report, diagnostic+'\nUnhandled Rejection: secondary failure\n')]
    for name, status, value, text in cases:
        assert not intended_failure(status, value, text, reason, kind), 'GTFS fault oracle accepted an unrelated failure'
        rows.append({'case':name, 'outcome':'intended_refusal'})
    return rows


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    app = repo/'openplan';test = app/'src/test/gtfs-managed-worker-intake.test.ts';source = app/'src/lib/gtfs/managed-worker-intake.ts'
    originals = {path:path.read_bytes() for path in (test, source)}
    def restore():
        for path, value in originals.items():
            path.write_bytes(value)
            with path.open('rb') as stream:os.fsync(stream.fileno())
    def execute(label, selected=True):
        args = ['node', '--max-old-space-size=512', 'node_modules/vitest/vitest.mjs', 'run', 'src/test/gtfs-managed-worker-intake.test.ts']
        if selected:args += ['-t', TEST]
        args += ['--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile='+str(out/(label+'-tests.json'))]
        result = subprocess.run(args, cwd=app, capture_output=True, text=True, timeout=60)
        diagnostic = result.stdout+result.stderr;(out/(label+'-private.log')).write_text(diagnostic)
        (out/(label+'-process.json')).write_text(json.dumps({'returncode':result.returncode})+'\n')
        report = json.loads((out/(label+'-tests.json')).read_text())
        return result.returncode, report, diagnostic
    def positive(label, harmless=False, selected=True):
        restore()
        if harmless:test.write_bytes(originals[test]+b'\n// Harmless deadline fixture comment.\n')
        code, report, diagnostic = execute(label, selected)
        assert code == 0 and report['numFailedTests'] == 0 and report['numPassedTests'] == (1 if selected else 38), 'GTFS deadline positive control failed: '+label
        rows.append({'control':label, 'outcome':'survived'});print(label+': survived', flush=True)
    rows = [];oracles = []
    try:
        positive('baseline');positive('harmless-comment', True);positive('restored-after-harmless')
        for label, path, before, after, reason, kind in [
            ('normal-retry-keeps-fault-deadline', test, '    f.options.uploadTimeoutMs = recoveryTimeoutMs;\n', '', 'GTFS uploaded archive is unconfirmed', 'Error'),
            ('upload-gets-owner-signal-without-deadline', source,
             'gtfsIntakeStorage(normalizedTarget, options.serviceKey, uploadSignal, options.storageFetch)',
             'gtfsIntakeStorage(normalizedTarget, options.serviceKey, signal, options.storageFetch)',
             'Ignored upload must receive its deadline before reconciliation', 'AssertionError')]:
            try:
                restore();text = originals[path].decode();assert text.count(before) == 1, 'GTFS mutation anchor is not unique'
                path.write_text(text.replace(before, after, 1));code, report, diagnostic = execute(label)
                assert intended_failure(code, report, diagnostic, reason, kind), 'GTFS deadline fault failed for another reason: '+label
                oracles += oracle_controls(code, report, diagnostic, reason, kind)
                rows.append({'control':label, 'outcome':'intended_failure', 'reason':reason});print(label+': intended_failure', flush=True)
            finally:restore()
        positive('restored-final');positive('complete-intake-suite', selected=False)
        assert all(path.read_bytes() == value for path,value in originals.items())
        (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles, indent=2)+'\n')
        bindings = {str(path.relative_to(repo)):hashlib.sha256(value).hexdigest() for path,value in originals.items()}
        bindings[str(Path(__file__).relative_to(repo))] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        (out/'source-bindings.json').write_text(json.dumps(bindings, indent=2)+'\n')
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            raw = subprocess.check_output(['systemctl', '--user', 'show', os.environ['OPENPLAN_OWNED_PROOF_UNIT'], '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak'], text=True)
            props = dict(line.split('=', 1) for line in raw.splitlines());group = Path('/sys/fs/cgroup')/props.pop('ControlGroup').lstrip('/')
            props['memoryEvents'] = dict(line.split() for line in (group/'memory.events').read_text().splitlines())
            (out/'resources.json').write_text(json.dumps(props, indent=2)+'\n')
        print(json.dumps({'controls':len(rows), 'faults':2, 'survivors':5, 'oracleControls':len(oracles)}))
    finally:restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.resolve())
