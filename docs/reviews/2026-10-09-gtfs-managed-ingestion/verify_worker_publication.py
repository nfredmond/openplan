"""Check ordered publication with private artifacts and controlled delivery."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
source_path = app / 'src/lib/gtfs/managed-worker-publication.ts'
test_path = app / 'src/test/gtfs-managed-worker-publication.test.ts'
source, tests = source_path.read_text(), test_path.read_text()
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)

def changed(old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new)

cases = [('baseline', source, False), ('harmless-comment', source + '\n// Harmless comment.\n', False)]
for message in re.findall(r',\s*"(GTFS[^"]+)"\);', source):
    position = source.index('"' + message + '"')
    start = source.rfind('requireMatch(', 0, position)
    assert start >= 0
    end = source.index(');', position) + 2
    cases.append((re.sub(r'[^a-z0-9]+', '-', message.lower()), source[:start] + 'void 0;' + source[end:], True))
cases.extend([
    ('missing-preparation', changed('await owned.deliver("prepare-output", { operation: "prepare_output", input: plan });', 'void 0;'), True),
    ('changed-row-workspace', changed('toRouteServiceLevelRows(feed, scope)', 'toRouteServiceLevelRows(feed, { ...scope, workspaceId: null })'), True),
    ('incomplete-batches', changed('offset < allRows.length;', 'offset + batchSize <= allRows.length;'), True),
    ('wrong-manifest-hash', changed('hash: checked.hash', 'hash: "0".repeat(64)'), True),
    ('wrong-adoption-count', changed('routeCount: feed.routes.length', 'routeCount: routeRows.length'), True),
    ('wrong-metadata-count', changed('route_count: feed.routes.length', 'route_count: routeRows.length'), True),
    ('late-metadata-check', changed('verifyGtfsCompletionMetadata({', '({'), True),
    ('ignored-cancellation', source.replace('owned.signal.throwIfAborted();', 'void 0;'), True),
    ('lost-artifact-signal', changed('{ ...options.owned, signal }', 'options.owned'), True),
    ('unchecked-batch-size', changed('z.number().int().min(1).max(1000).parse(options.batchSize);\n  const bound', 'z.number().parse(options.batchSize);\n  const bound'), True),
    ('unchecked-output-bound', changed('z.number().int().positive().max(bound)', 'z.number().int().positive()'), True),
    ('restored', source, False),
])

results = []
filters = {
    'gtfs-publication-artifact-read-is-incomplete': 'refuses a short descriptor read',
    'unchecked-batch-size': 'refuses invalid batch size 1001',
    'lost-artifact-signal': 'propagates artifact-lock cancellation',
}

try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.managed-worker-publication-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-publication-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/managed-worker-publication', f'@/lib/gtfs/{candidate_file.stem}'))
            selected = ['-t', filters[name]] if name in filters else []
            result = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', str(candidate_test.relative_to(app)), '--maxWorkers=1', *selected],
                cwd=app, env={**os.environ, 'NODE_OPTIONS': '--max-old-space-size=1024'}, text=True, capture_output=True, timeout=30)
            log = result.stdout + result.stderr
            (out / f'{name}.log').write_text(log)
            results.append({'case': name, 'exitCode': result.returncode, 'expectedFailure': broken, 'testFilter': filters.get(name),
                            'logSha256': hashlib.sha256(log.encode()).hexdigest()})
            assert (result.returncode != 0) == broken, (name, log)
            assert not broken or 'AssertionError' in log, (name, 'not an assertion failure', log)
            print(name, 'EXPECTED FAILURE' if broken else 'PASS', flush=True)
        finally:
            candidate_file.unlink(missing_ok=True)
            candidate_test.unlink(missing_ok=True)
            assert source_path.read_text() == source and test_path.read_text() == tests
finally:
    (out / 'controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
        'testSha256': hashlib.sha256(tests.encode()).hexdigest(), 'checks': results}, indent=2) + '\n')
