"""Actual owned-child receipt interruption and shutdown assertion controls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def intended_failure(code, text, selected, reason):
    if type(code) is not int or code != 1 or not isinstance(text, str) or not isinstance(selected, str) or not isinstance(reason, str) or not reason:
        return False
    if re.findall(r'(?m)^not ok \d+ - (.+)$', text) != [selected]:
        return False
    if any(not re.search(r'(?m)^# ' + field + ' ' + str(value) + '$', text)
           for field, value in [('tests', 1), ('pass', 0), ('fail', 1), ('cancelled', 0), ('skipped', 0)]):
        return False
    error = re.search(r'(?m)^  error: (.+)$', text)
    if not error:
        return False
    detail = error.group(1)
    if detail == '|-':
        lines = text[error.end() + 1:].splitlines()
        detail = '\n'.join(line[4:] for line in lines[:next((i for i, line in enumerate(lines) if not line.startswith('    ')), len(lines))])
    return reason in detail


def oracle_controls(text, selected, reason):
    rows = []
    for label, output in [('baseline', text), ('harmless-prefix', '# Harmless oracle comment.\n' + text), ('restored', text)]:
        if not intended_failure(1, output, selected, reason):
            raise AssertionError('Receipt oracle positive refused: ' + label)
        rows.append({'control':label, 'outcome':'survived'})
    cases = [('zero-exit', 0, text, selected, reason), ('boolean-exit', True, text, selected, reason),
             ('wrong-exit', 2, text, selected, reason), ('missing-output', 1, None, selected, reason),
             ('wrong-test', 1, text.replace(selected, 'unrelated test'), selected, reason),
             ('missing-reason', 1, text.replace(reason, 'unrelated'), selected, reason),
             ('extra-failure', 1, text + '\nnot ok 2 - unrelated test\n', selected, reason),
             ('wrong-count', 1, text.replace('# tests 1', '# tests 2'), selected, reason),
             ('cancelled-test', 1, text.replace('# cancelled 0', '# cancelled 1'), selected, reason),
             ('missing-error', 1, re.sub(r'(?m)^  error:.*$', '', text), selected, reason),
             ('stdout-decoy', 1, reason + '\n' + text.replace(reason, 'unrelated'), selected, reason),
             ('missing-selected', 1, text, None, reason), ('missing-reason-value', 1, text, selected, None)]
    for label, code, output, test, expected in cases:
        if intended_failure(code, output, test, expected):
            raise AssertionError('Receipt oracle invalid result accepted: ' + label)
        rows.append({'control':label, 'outcome':'intended_refusal'})
    return rows


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    helper = repo / 'workers/planner_agent_connector/test/fixtures/receipt-publication.mjs'
    fixture = repo / 'workers/planner_agent_connector/test/fixtures/opencode-server.mjs'
    tests = repo / 'workers/planner_agent_connector/test/opencode-process.test.mjs'
    production = repo / 'workers/planner_agent_connector/opencode-process.mjs'
    originals = {p:p.read_bytes() for p in (helper, fixture, tests, production)}
    interrupted = 'interrupted fixture publication preserves its last complete receipt'
    shutdown = 'shutdown escalates when the owned child ignores termination'
    def swap(before, after):
        def transform(text):
            if text.count(before) != 1:
                raise ValueError('Receipt mutation anchor must be unique')
            return text.replace(before, after, 1)
        return transform
    cases = [
        ('preceding-in-place-publication', helper, interrupted,
         swap('const temporary = `${path}.partial`;', 'const temporary = path;'),
         'Unexpected end of JSON input'),
        ('partial-published-before-data', helper, interrupted,
         swap('    beforeData();', '    if (receipt.terminated) renameSync(temporary, path);\n    beforeData();'),
         'Unexpected end of JSON input'),
        ('wrong-initial-signal', production, shutdown,
         swap('child.kill("SIGTERM");', 'child.kill("SIGINT");'),
         'owned shutdown must deliver termination then forced kill'),
        ('wrong-escalation-signal', production, shutdown,
         swap('child.kill("SIGKILL")', 'child.kill("SIGINT")'),
         'owned shutdown must deliver termination then forced kill'),
        ('missing-publication-barrier', helper, interrupted,
         swap('    beforeData();', '    // Deliberately omit the actual publication seam.'),
         'owned fixture must reach the actual publication barrier'),
    ]
    outcomes = []
    oracles = None
    def restore():
        for p, b in originals.items():p.write_bytes(b)
    def execute(label, selected=None):
        args = ['node', '--test', '--test-reporter=tap']
        if selected:args.append('--test-name-pattern=^' + re.escape(selected) + '$')
        args.append(str(tests))
        result = subprocess.run(args, cwd=repo, capture_output=True, timeout=30)
        text = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(text)
        return result.returncode, text
    def positive(label):
        code, text = execute(label)
        if code or not re.search(r'(?m)^# tests 32$', text) or not re.search(r'(?m)^# pass 32$', text) or not re.search(r'(?m)^# fail 0$', text):
            raise AssertionError(label + ': receipt fixture positive failed\n' + text)
        outcomes.append({'control':label, 'outcome':'survived'})
    try:
        positive('baseline')
        helper.write_bytes(originals[helper] + b'\n// Harmless receipt publication comment.\n')
        fixture.write_bytes(originals[fixture] + b'\n// Harmless owned fixture comment.\n')
        tests.write_bytes(originals[tests] + b'\n// Harmless physical shutdown test comment.\n')
        positive('harmless-comments')
        restore();positive('restored-after-harmless')
        for label, file, selected, transform, reason in cases:
            try:
                file.write_text(transform(originals[file].decode()))
                code, text = execute(label, selected)
                if not intended_failure(code, text, selected, reason):
                    raise AssertionError(label + ': wrong interruption/shutdown failure\n' + text)
                if oracles is None:
                    oracles = oracle_controls(text, selected, reason)
                outcomes.append({'control':label, 'test':selected, 'outcome':'intended_failure', 'reason':reason})
            finally:
                restore()
        positive('restored-final')
        if any(p.read_bytes() != b for p, b in originals.items()):
            raise AssertionError('Receipt mutation sources did not restore')
        (out / 'controls.json').write_text(json.dumps(outcomes, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}, indent=2) + '\n')
        print(json.dumps({'survivors':4, 'faults':len(cases), 'controls':len(outcomes),
                          'cases':32, 'productionRestoredUnchanged':True}))
    finally:
        restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
