"""Mutate only the owned path guard; restore bytes after every test run."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[4]
app = root / 'openplan'
source = app / 'src/lib/models/artifact-source.ts'
resolver = app / 'src/lib/files/tenant-scoped-storage.ts'
resolver_original = resolver.read_bytes()
out = Path(__file__).resolve().parent
original = source.read_bytes()
text = original.decode()
seam = '    canonicalStorageObjectPath(ref.objectPath) &&'
assert text.count(seam) == 1, 'Expected canonical path guard seam'
cases = [
    ('baseline', source, text, False),
    ('harmless-comment', source, '// Synthetic harmless mutation control.\n' + text, False),
    ('missing-canonical-path-check', source, text.replace(seam, '    true &&'), True),
    ('resolver-trims-object-name', resolver, resolver_original.decode().replace('typeof value === "string" ? value : ""', 'typeof value === "string" ? value.trim() : ""'), True),
]
results = []
try:
    for name, target, candidate, should_fail in cases:
        target.write_text(candidate)
        report = out / f'security-path-{name}.json'
        run = subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run',
            'src/test/storage-reference-canonicalization.test.ts', '--reporter=json',
            f'--outputFile={report}'], cwd=app, capture_output=True, text=True)
        source.write_bytes(original)
        resolver.write_bytes(resolver_original)
        assert report.exists(), f'{name}: runner did not create an assertion report'
        parsed = json.loads(report.read_text())
        failures = [case for suite in parsed['testResults'] for case in suite['assertionResults'] if case['status'] == 'failed']
        if should_fail:
            assert run.returncode != 0 and failures, 'Targeted defect unexpectedly survived'
            assert all('refuses' in case['fullName'] and any('to be null' in message for message in case['failureMessages']) for case in failures), 'Failure was not the intended canonical-path refusal'
        else:
            assert run.returncode == 0 and not failures and parsed['numPassedTests'] == 25, f'{name}: valid control failed'
        results.append({'case': name, 'exitCode': run.returncode, 'passed': parsed['numPassedTests'], 'failed': parsed['numFailedTests'], 'classification': 'KILLED' if should_fail else 'SURVIVED', 'failedAssertions': [case['fullName'] for case in failures]})
finally:
    source.write_bytes(original)
    resolver.write_bytes(resolver_original)
assert source.read_bytes() == original and resolver.read_bytes() == resolver_original
summary = {'sourceRestoredSha256': hashlib.sha256(original).hexdigest(), 'results': results}
(out / 'security-path-mutations.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
