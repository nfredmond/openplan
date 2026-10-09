"""Prove the project export assertions detect missing identity, scope and records."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
source = ROOT/'openplan/src/lib/project-evidence-bundles/generated-records.ts'
original = source.read_text()
mutations = [
    ('drop-method', 'attemptInstrumentCustody = rows(attemptRead.data);', 'attemptInstrumentCustody = rows(attemptRead.data).filter(row => row.demand_method === "aequilibrae");'),
    ('collapse-attempts', 'attemptInstrumentCustody = rows(attemptRead.data);', 'attemptInstrumentCustody = rows(attemptRead.data).slice(0, 2);'),
    ('missing-output-hash', 'attempt_id, demand_method, model_output_artifact_id, model_output_sha256, input_bundle_artifact_id', 'attempt_id, demand_method, model_output_artifact_id, input_bundle_artifact_id'),
    ('stale-revision', 'attemptInstrumentCustody: withoutPersonalIdentifiers(modelingEvidence.attemptInstrumentCustody),', 'attemptInstrumentCustody: [],'),
    ('ignore-page-failure', 'if (attemptRead.error) {', 'if (false) {'),
]
start = original.index('    const attemptRead =')
end = original.index('    const structuralDemandRead =', start)
block = original[start:end]
scoped = block.replace('.eq("workspace_id", workspaceId)', '.eq("workspace_id", "wrong-workspace")')
assert scoped != block
variants = [('harmless', original+'\n// Harmless formatting control.\n')]
for name, before, after in mutations:
    assert original.count(before) == 1, name
    variants.append((name, original.replace(before, after)))
variants += [('wrong-workspace', original[:start]+scoped+original[end:]), ('restored', original)]
results = []
try:
    for name, content in variants:
        source.write_text(content)
        result = subprocess.run(['npm','exec','--','vitest','run','src/test/project-evidence-generated-pagination.test.ts','--maxWorkers=1'], cwd=ROOT/'openplan', capture_output=True, text=True, timeout=90)
        detail = result.stdout+result.stderr
        if name in ('harmless', 'restored'):
            assert result.returncode == 0, detail
        else:
            assert result.returncode != 0 and ('AssertionError' in detail or 'expected' in detail), detail
        results.append({'control': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_text(original)
report = {'source_sha256': hashlib.sha256(original.encode()).hexdigest(), 'cases': results,
    'limits': 'Synthetic generated-file tests with asserted query projections and filters. Native RLS, authenticated HTTP freeze, downloaded archives and browser acceptance require separate checks.'}
Path(__file__).with_name('instrument-export-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
