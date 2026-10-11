"""Check the retained parser protocol with disposable decoder mutations."""
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
source_path = app / 'src/lib/gtfs/parsed-artifact.ts'
test_path = app / 'src/test/gtfs-parsed-artifact.test.ts'
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
for index, match in enumerate(re.finditer(r'\.strict\(\)', source)):
    candidate = source[:match.start()] + '.strip()' + source[match.end():]
    cases.append((f'loose-schema-{index}', candidate, True))
cases.extend([
    ('unchecked-shape', changed('const result = resultSchema.parse(raw);', 'const result = raw as GtfsParseResult;'), True),
    ('invalid-coordinate', changed('z.number().min(-90).max(90)', 'z.number()'), True),
    ('invalid-longitude', changed('z.number().min(-180).max(180)', 'z.number()'), True),
    ('invalid-date', changed('z.iso.date().nullable()', 'z.string().nullable()'), True),
    ('fractional-counts', changed('z.number().int().nonnegative().safe()', 'z.number().nonnegative()'), True),
    ('restored', source, False),
])

results = []
filters = {}

try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.parsed-artifact-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-parsed-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/parsed-artifact', f'@/lib/gtfs/{candidate_file.stem}'))
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
