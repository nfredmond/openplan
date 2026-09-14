"""Check the reviewed SQL classifications, plain copy and migration disclosure without weakening the guards."""
import hashlib
import json
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[3]
app = root / 'openplan'
catalog = app / 'src/test/a-column-nothing-reads-is-a-question.test.ts'
editor = app / 'src/components/engagement/synthesis-review-editor.tsx'
changelog = root / 'CHANGELOG.md'
originals = {path: path.read_text() for path in [catalog, editor, changelog]}
tests = ['src/test/a-column-nothing-reads-is-a-question.test.ts', 'src/test/planner-copy-says-the-plain-thing.test.ts', 'src/test/migrations/release-ordering.test.ts']
cases = [('baseline', None, None, None, None), ('harmless-comment', catalog, '\n', '\n// Harmless review inventory comment.\n', None)]
for line in originals[catalog].splitlines(keepends=True):
    if 'column: "engagement_synthesis_review' in line:
        column = line.split('column: "')[1].split('"')[0]
        cases.append((f'undocumented-{column}', catalog, line, '', 'finds no unread column that is not accounted for'))
cases.append(('planner-copy-regression', editor, 'Reopen this consultation to check access.', 'Reopen this campaign to check access.', 'uses no term from the ledger more often than the recorded baseline'))
line = next(line for line in originals[changelog].splitlines(keepends=True) if line.startswith('- `20261014000027_'))
cases.append(('undisclosed-migration', changelog, line, '', "the CHANGELOG's Unreleased section names every migration landed since the newest tag"))
results = []
try:
    with tempfile.TemporaryDirectory(prefix='openplan-review-integration-') as tmp:
        for name, path, before, after, expected in cases:
            for file, raw in originals.items():
                file.write_text(raw)
            if path:
                assert before in originals[path]
                path.write_text(originals[path].replace(before, after, 1))
            report = pathlib.Path(tmp) / 'result.json'
            run = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', *tests, '--reporter=json', f'--outputFile={report}'], cwd=app, text=True, capture_output=True)
            parsed = json.loads(report.read_text())
            failed = [test for suite in parsed['testResults'] for test in suite['assertionResults'] if test['status'] == 'failed']
            detail = '\n'.join(test['fullName'] for test in failed)
            success = run.returncode == 0 and parsed['numPassedTests'] == 15 if expected is None else run.returncode == 1 and len(failed) == 1 and parsed['numPassedTests'] == 14 and expected in detail
            result = {'case': name, 'exitCode': run.returncode, 'passed': parsed['numPassedTests'], 'failed': [test['fullName'] for test in failed], 'expectedOutcome': success}
            results.append(result)
            print(json.dumps(result), flush=True)
            assert success, f'{name} did not produce the expected test outcome: {run.stdout[-1000:]} {run.stderr[-1000:]}'
finally:
    for file, raw in originals.items():
        file.write_text(raw)
output = {'sourcesRestored': all(file.read_text() == raw for file, raw in originals.items()), 'cases': results,
          'sha256': {str(file.relative_to(root)): hashlib.sha256(file.read_bytes()).hexdigest() for file in originals}}
(pathlib.Path(__file__).parent / 'review-integration-mutations.json').write_text(json.dumps(output, indent=2) + '\n')
