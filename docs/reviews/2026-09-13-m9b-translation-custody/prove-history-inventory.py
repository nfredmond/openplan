"""Exercise the inventory against missing history declarations without database writes."""
from pathlib import Path
import json, os, re, subprocess
root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
evidence = Path(os.environ['OPENPLAN_TRANSLATION_PROBE_EVIDENCE']).resolve()
if evidence.is_relative_to(root):
    raise ValueError('Keep mutation evidence outside the repository')
evidence.mkdir(parents=True, exist_ok=True)
migration = app / 'supabase/migrations/20261014000009_engagement_translation_history.sql'
original = migration.read_text()
results = []
def run(name, source, expected=()):
    migration.write_text(source)
    report = evidence / (name + '.json')
    result = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run',
        'src/test/migrations/inventory.test.ts', '--reporter=json', '--outputFile=' + str(report)],
        cwd=app, capture_output=True, text=True, timeout=60)
    (evidence / (name + '.log')).write_text(result.stdout + result.stderr)
    data = json.loads(report.read_text())
    failed = [test['fullName'] for file in data['testResults'] for test in file['assertionResults'] if test['status'] == 'failed']
    matched = (result.returncode == 0 and data['numPassedTests'] == 29) if not expected else (
        result.returncode != 0 and all(any(title in failure for failure in failed) for title in expected))
    results.append({'case': name, 'matched': matched, 'outcome': 'survived' if result.returncode == 0 else 'killed', 'failed': failed})
    (evidence / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    assert matched, results[-1]
try:
    run('baseline', original)
    run('harmless-comment', original + '\n-- Harmless migration comment.\n')
    without_policy, count = re.subn(r'CREATE POLICY engagement_translation_history_staff_read[\s\S]*?\)\);', '', original, count=1)
    assert count == 1
    run('missing-staff-policy', without_policy, ('counts what the database actually has',))
    statement = 'ALTER TABLE public.engagement_translation_history ENABLE ROW LEVEL SECURITY;'
    assert statement in original
    run('missing-rls', original.replace(statement, ''), ('reads every relation the migrations declare',))
    run('missing-history-migration', '', ('counts what the database actually has', 'reads every relation the migrations declare'))
finally:
    migration.write_text(original)
