"""Exercise exhaustion/error boundaries against the actual translation loaders."""
from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
source = app / 'src/lib/engagement/campaign-translations.ts'
original = source.read_text()
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-complete-read-controls')
private.mkdir(exist_ok=True)
files = ['src/test/engagement-campaign-detail-page.test.tsx', 'src/test/engagement-translation-complete-reads.test.ts', 'src/test/an-operator-can-author-a-campaigns-translations.test.tsx', 'src/test/accepting-a-machine-translation-makes-it-the-agencys-own.test.ts']
mutations = [
    ('baseline', original, None),
    ('harmless-comment', original + '\n// Harmless read coverage comment.\n', None),
    ('stop-after-first-page', original.replace('await readEveryPage(fetchPage)', 'await readEveryPage(fetchPage, { maxPages: 1 })'), 'loads every source'),
    ('ignore-incomplete', original.replace('if (!result.complete)', 'if (false)'), 'withholds results'),
    ('omit-unique-order', original.replace('.order("id", { ascending: true })', ''), 'loads every source'),
    ('drop-source-projection', original.replace('.select("id, prompt, help_text")', '.select("id, prompt")'), 'loads every source'),
]
results = []
try:
    for name, text, target in mutations:
        source.write_text(text)
        report = private / (name + '.json')
        run = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', *files, '--reporter=json', '--outputFile=' + str(report)], cwd=app, capture_output=True, text=True, timeout=60)
        data = json.loads(report.read_text())
        failed = [test['fullName'] for file in data['testResults'] for test in file['assertionResults'] if test['status'] == 'failed']
        matched = run.returncode == 0 and data['numPassedTests'] == 123 if target is None else run.returncode != 0 and any(target in test for test in failed)
        results.append({'case': name, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'matched': matched, 'failures': failed})
        assert matched, results[-1]
finally:
    source.write_text(original)
(Path(__file__).parent / 'complete-read-controls.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results))
