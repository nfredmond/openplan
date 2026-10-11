"""Run disposable worker-service mutations without changing tracked application files."""
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
source_path = app / 'src/lib/gtfs/managed-worker-service.ts'
test_path = app / 'src/test/gtfs-managed-worker-service.test.ts'
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
    ('loose-attempt', changed('tract: tractSchema.nullable(), completion: completionSchema.nullable() }).strict();', 'tract: tractSchema.nullable(), completion: completionSchema.nullable() }).passthrough();'), True),
    ('loose-status', changed('submitterAccessUnavailable: z.boolean() }).strict();', 'submitterAccessUnavailable: z.boolean() }).passthrough();'), True),
    ('queue-response-bound', changed('.max(boundedLimit).parse(raw)', '.parse(raw)'), True),
    ('queue-input-bound', changed('z.number().int().min(1).max(100).parse(limit)', 'z.number().int().parse(limit)'), True),
    ('coerced-renewal', changed('return z.boolean().parse(await call(', 'return Boolean(await call('), True),
    ('ignored-response-error', changed('finish(result.data, !!result.error)', 'finish(result.data, false)'), True),
    ('missing-deadline', changed('const timer = setTimeout(abort, 10_000);', 'const timer = setTimeout(abort, 20_000);'), True),
    ('missing-pre-dispatch-cancel', changed('if (request.signal.aborted) throw new Error("cancelled");', 'void 0;'), True),
    ('missing-pre-cancel', source.replace('if (signal.aborted) throw new Error("GTFS worker acknowledgement unavailable");', 'void 0;').replace('if (signal.aborted) return abort();', 'void 0;'), True),
    ('restored', source, False),
])
results = []
try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.managed-worker-service-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-worker-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/managed-worker-service', f'@/lib/gtfs/{candidate_file.stem}'))
            result = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', str(candidate_test.relative_to(app)), '--maxWorkers=1'],
                cwd=app, env={**os.environ, 'NODE_OPTIONS': '--max-old-space-size=1024'}, text=True, capture_output=True, timeout=30)
            log = result.stdout + result.stderr
            (out / f'{name}.log').write_text(log)
            results.append({'case': name, 'exitCode': result.returncode, 'expectedFailure': broken,
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
