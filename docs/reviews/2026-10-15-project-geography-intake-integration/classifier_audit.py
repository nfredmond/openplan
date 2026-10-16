"""Replay retained trials and refuse mismatched or runner-error reports."""
import ast
import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATH = HERE / 'fixture_controls.py'
original = PATH.read_bytes()
FIXTURE = HERE.parents[2] / 'openplan/src/test/project-detail-page.test.tsx'
NAME = 'ProjectDetailPage keeps the ordinary empty states when the reads succeeded and there is nothing'

def load(text):
    node = next(n for n in ast.parse(text).body if isinstance(n, ast.FunctionDef) and n.name == 'classify')
    namespace = {'FIXTURE': FIXTURE, 'NAME': NAME}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(PATH), 'exec'), namespace)
    return namespace['classify']

summary = json.loads((HERE / 'evidence/fixture-controls/summary.json').read_text())
base = json.loads((HERE / 'evidence/fixture-controls/page-projection-fault.json').read_text())
diag = 'project page must read the complete geography and jurisdiction projection'
fixtures = []
for label in ['runtime-suite', 'unhandled', 'errors', 'wrong-file', 'empty-selection', 'wrong-name', 'wrong-diagnostic', 'extra-active', 'extra-failure', 'wrong-count', 'wrong-status', 'inconsistent-success', 'startup-exit', 'todo']:
    bad = copy.deepcopy(base); code = 1
    test = next(t for s in bad['testResults'] for t in s['assertionResults'] if t['status'] == 'failed')
    if label == 'runtime-suite': bad['numRuntimeErrorTestSuites'] = 1
    elif label == 'unhandled': bad['unhandledErrors'] = ['synthetic']
    elif label == 'errors': bad['errors'] = ['synthetic']
    elif label == 'wrong-file': bad['testResults'][0]['name'] += '.wrong'
    elif label == 'empty-selection': test['status'] = 'skipped'
    elif label == 'wrong-name': test['fullName'] += ' wrong'
    elif label == 'wrong-diagnostic': test['failureMessages'] = ['AssertionError: other: no']
    elif label in ('extra-active', 'extra-failure'): bad['testResults'][0]['assertionResults'].append(copy.deepcopy(test))
    elif label == 'wrong-count': bad['numFailedTests'] = 2
    elif label == 'wrong-status': test['status'] = 'passed'
    elif label == 'inconsistent-success': bad['success'] = True
    elif label == 'startup-exit': code = 2
    else: bad['numTodoTests'] = 1
    fixtures.append((label, bad, code))

def audit(classifier):
    for row in summary:
        report = json.loads((HERE / 'evidence/fixture-controls' / (row['name'] + '.json')).read_text())
        assert classifier(report, row['exitCode'], row['expectedDiagnostic']), 'classifier retained trial: ' + row['name']
    for label, report, code in fixtures:
        assert not classifier(report, code, diag), 'classifier refusal: ' + label

classifier = load(original.decode()); audit(classifier)
audit(load(original.decode() + '\n# Harmless classifier comment.\n'))
try:
    audit(lambda *_args: True)
except AssertionError as error:
    if str(error) != 'classifier refusal: runtime-suite': raise
    fault = str(error)
else:
    raise RuntimeError('Vacuous classifier survived')
if PATH.read_bytes() != original: raise RuntimeError('Classifier source changed')
(HERE / 'evidence/classifier-audit.json').write_text(json.dumps({'retainedTrialsAccepted': len(summary), 'refusals': [r[0] for r in fixtures], 'harmless': 'survived', 'vacuousClassifierFault': fault, 'restoredSha256': hashlib.sha256(original).hexdigest()}, indent=2) + '\n')
print('6 retained trials accepted; 14 refusals; harmless survivor; intended vacuous-classifier fault')
