"""Exercise the one adapted page test and its exact query projection."""
import copy
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
APP = ROOT / 'openplan'
OUT = HERE / 'evidence/fixture-controls'
OUT.mkdir(exist_ok=False)
NAME = 'ProjectDetailPage keeps the ordinary empty states when the reads succeeded and there is nothing'
TEST = 'src/test/project-detail-page.test.tsx'
PAGE = ROOT / 'openplan/src/app/(app)/projects/[projectId]/page.tsx'
FIXTURE = APP / TEST
originals = {p: p.read_bytes() for p in [PAGE, FIXTURE]}
rows = []

def classify(report, code, diagnostic=None):
    if (report.get('numRuntimeErrorTestSuites', 0) or report.get('unhandledErrors') or report.get('errors')
            or len(report.get('testResults', [])) != 1 or report.get('numTotalTests') != 67
            or report.get('numPendingTests') != 66 or report.get('numTodoTests') != 0
            or report['testResults'][0].get('name') != str(FIXTURE)):
        return False
    executed = [t for s in report.get('testResults', []) for t in s.get('assertionResults', []) if t['status'] in ('passed', 'failed')]
    if len(executed) != 1 or executed[0]['fullName'] != NAME:
        return False
    t = executed[0]
    if diagnostic is None:
        return code == 0 and report.get('success') is True and report.get('numPassedTests') == 1 and report.get('numFailedTests') == 0 and t['status'] == 'passed'
    failures = t.get('failureMessages', [])
    return (code == 1 and report.get('success') is False and report.get('numPassedTests') == 0 and report.get('numFailedTests') == 1 and t['status'] == 'failed' and len(failures) == 1 and failures[0].startswith('AssertionError: ' + diagnostic + ':') and all(s.get('assertionResults') for s in report['testResults']))

def run(name, diagnostic=None):
    command = ['node', '--max-old-space-size=640', 'node_modules/vitest/vitest.mjs', 'run', TEST, '--configLoader', 'runner', '--config', str(HERE / 'vitest.config.mts'), '--maxWorkers', '1', '--no-file-parallelism', '-t', '^' + NAME + '$', '--reporter=json', '--outputFile=' + str(OUT / (name + '.json'))]
    with (OUT / (name + '.log')).open('w') as log:
        result = subprocess.run(command, cwd=APP, stdout=log, stderr=subprocess.STDOUT)
    report = json.loads((OUT / (name + '.json')).read_text())
    row = {'name': name, 'exitCode': result.returncode, 'expectedDiagnostic': diagnostic, 'accepted': classify(report, result.returncode, diagnostic)}
    rows.append(row)
    (OUT / 'summary.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(name, row['accepted'], flush=True)
    if not row['accepted']:
        raise RuntimeError('Refused trial: ' + name)
    return report

try:
    run('baseline')
    for name, path, before, after, diagnostic in [
        ('page-projection', PAGE, 'rtp_posture_updated_at, jurisdiction_context, latitude', 'rtp_posture_updated_at, latitude', 'project page must read the complete geography and jurisdiction projection'),
        ('legacy-null', FIXTURE, '        jurisdiction_context: null,\n        id: "project-1",', '        jurisdiction_context: undefined,\n        id: "project-1",', 'successful legacy-null reads must show zero unavailable disclosures'),
    ]:
        text = originals[path].decode()
        path.write_text('// Harmless integration-control comment.\n' + text)
        run(name + '-harmless')
        path.write_bytes(originals[path])
        if text.count(before) != 1:
            raise RuntimeError('Mutation anchor is not unique: ' + name)
        path.write_text(text.replace(before, after))
        report = run(name + '-fault', diagnostic)
        fixtures = []
        for label in ['startup', 'wrong-name', 'wrong-diagnostic', 'extra-failure']:
            bad = copy.deepcopy(report)
            t = next(t for s in bad['testResults'] for t in s['assertionResults'] if t['status'] == 'failed')
            code = 1
            if label == 'startup': code = 2
            elif label == 'wrong-name': t['fullName'] += ' wrong'
            elif label == 'wrong-diagnostic': t['failureMessages'] = ['AssertionError: other diagnostic: no']
            else:
                bad['numFailedTests'] += 1
                bad['testResults'][0]['assertionResults'].append(copy.deepcopy(t))
            accepted = classify(bad, code, diagnostic)
            fixtures.append({'fixture': label, 'accepted': accepted})
            if accepted: raise RuntimeError('Classifier accepted ' + label)
        (OUT / (name + '-classifier.json')).write_text(json.dumps(fixtures, indent=2) + '\n')
        path.write_bytes(originals[path])
    run('restored')
finally:
    for path, data in originals.items(): path.write_bytes(data)
    (OUT / 'restoration.json').write_text(json.dumps({str(p.relative_to(ROOT)): {'sha256': hashlib.sha256(data).hexdigest(), 'restored': p.read_bytes() == data} for p, data in originals.items()}, indent=2) + '\n')
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    (OUT / 'resources.json').write_text(json.dumps({key: (group / key).read_text().strip() for key in ['memory.max', 'memory.swap.max', 'memory.peak', 'memory.events']}, indent=2) + '\n')
