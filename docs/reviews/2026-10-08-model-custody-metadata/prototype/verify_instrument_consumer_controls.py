"""Detect omitted attempt identity, scope and read failures in actual consumers."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
paths = {name: ROOT/'openplan/src/lib'/path for name, path in {
    'reader': 'models/attempt-instrument-read.ts', 'report': 'reports/run-citations.ts',
    'html': 'reports/html.ts', 'assistant': 'assistant/chat-tools.ts',
}.items()}
originals = {name: path.read_text() for name, path in paths.items()}
tests = ['src/test/attempt-instrument-read.test.ts', 'src/test/assistant-chat-evidence-tools.test.ts',
         'src/test/report-lane-citations-carry-their-claim-tier.test.tsx']
mutations = [
    ('reader', 'missing-output-hash', 'model_output_artifact_id, model_output_sha256, input_bundle_artifact_id', 'model_output_artifact_id, input_bundle_artifact_id'),
    ('reader', 'drop-method-or-attempt', 'records: result.rows, readFailed: false', 'records: result.rows.slice(0, 1), readFailed: false'),
    ('reader', 'omit-workspace', 'if (workspaceId) query = query.eq("workspace_id", workspaceId);', '// Fault: workspace scope omitted.'),
    ('reader', 'hide-read-failure', 'records: [], readFailed: true', 'records: [], readFailed: false'),
    ('report', 'wrong-parent', 'record.model_run_id === run.id', 'record.model_run_id !== run.id'),
    ('html', 'omit-rendered-evidence', '${attemptInstrumentMarkup(run)}', ''),
    ('assistant', 'hide-assistant-failure', 'attemptResult.readFailed ? "read_failed" : "available"', '"available"'),
]
results = []
try:
    for label, mutation in [('harmless', None), *[(item[1], item) for item in mutations], ('restored', None)]:
        for name, path in paths.items(): path.write_text(originals[name])
        if label == 'harmless': paths['reader'].write_text(originals['reader']+'\n// Harmless formatting.\n')
        if mutation:
            name, _, before, after = mutation
            assert before in originals[name]
            paths[name].write_text(originals[name].replace(before, after))
        result = subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1'], cwd=ROOT/'openplan', capture_output=True,text=True,timeout=90)
        detail = result.stdout+result.stderr
        if mutation:
            assert result.returncode != 0 and 'AssertionError' in detail, detail
        else: assert result.returncode == 0, detail
        results.append({'control': label, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    for name, path in paths.items(): path.write_text(originals[name])
report = {'source_sha256': {name: hashlib.sha256(text.encode()).hexdigest() for name,text in originals.items()},
    'cases': results, 'limits': 'Real reader, assistant and report HTML builders over synthetic database mocks. No authenticated REST, actual report download, browser layout, source completeness or scientific acceptance.'}
Path(__file__).with_name('instrument-consumer-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
