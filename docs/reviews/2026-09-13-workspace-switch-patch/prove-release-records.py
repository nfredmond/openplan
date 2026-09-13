"""Exercise the new patch release record without changing historical releases."""
import hashlib
import json
from pathlib import Path
import subprocess

review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / 'openplan'
target = app / 'src/test/migrations/release-ordering.test.ts'
private = Path('/home/nathaniel/.local/state/openplan/workspace-switch-v0581-evidence/release-controls')
private.mkdir(exist_ok=True)
original = target.read_text()
record = 'tag: "0.58.1",\n    lastMigration: "20261014000009_engagement_translation_history.sql",\n    migrationsAtRelease: 328,'
assert original.count(record) == 1
results = []
try:
    for name, source, broken in [
        ('baseline', original, False),
        ('harmless-comment', original + '\n// Patch release accounting control.\n', False),
        ('wrong-patch-count', original.replace(record, record.replace('328', '327')), True),
    ]:
        target.write_text(source)
        report = private / (name + '.json')
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', 'src/test/migrations/release-ordering.test.ts', '--reporter=json', '--outputFile=' + str(report)], cwd=app, capture_output=True, text=True, timeout=90)
        (private / (name + '.log')).write_text(run.stdout + run.stderr)
        data = json.loads(report.read_text())
        failed = [test['fullName'] for file in data['testResults'] for test in file['assertionResults'] if test['status'] == 'failed']
        matched = run.returncode != 0 and any('no migration has been inserted at or below' in test for test in failed) if broken else run.returncode == 0 and data['numPassedTests'] > 0
        results.append({'case': name, 'matched': matched, 'exit': run.returncode, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'passed': data['numPassedTests'], 'failed': failed})
        (review / 'release-record-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(original.encode()).hexdigest(), 'results': results, 'limits': 'Checks release migration accounting; does not execute migrations or verify browser behavior.'}, indent=2) + '\n')
        print(name, matched, flush=True)
        assert matched, results[-1]
finally:
    target.write_text(original)
