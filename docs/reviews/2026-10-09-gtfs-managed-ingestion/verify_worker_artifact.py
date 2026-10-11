"""Exercise artifact custody with disposable sources and real private journals."""
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
source_path = app / 'src/lib/gtfs/managed-worker-artifact.ts'
test_path = app / 'src/test/gtfs-managed-worker-artifact.test.ts'
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
    ('follow-symlink', changed(' | constants.O_NOFOLLOW', ''), True),
    ('missing-archive-sync', changed('await file.writeFile(read.bytes); await file.sync();', 'await file.writeFile(read.bytes);'), True),
    ('missing-output-sync', changed('await writing.sync(); await syncDirectory(directory);', 'await syncDirectory(directory);'), True),
    ('missing-directory-sync', changed('try { await file.sync(); } finally', 'try { /* omitted */ } finally'), True),
    ('missing-completion-record', changed('await writeConnectorJournal(directory, saved);\n      } finally', 'void 0;\n      } finally'), True),
    ('unconfirmed-archive', changed('await owned.deliver("archive-confirmation", { operation: "confirm_archive", input: archive });', 'void 0;'), True),
    ('missing-parsing-stage', changed('await owned.deliver("parsing", { operation: "stage", input: "parsing" });', 'void 0;'), True),
    ('ignored-cancellation', source.replace('owned.signal.throwIfAborted();', 'void 0;').replace('signal.throwIfAborted();', 'void 0;'), True),
    ('cached-archive-refetch', changed(' || saved.output) throw error;', ') throw error;'), True),
    ('unsafe-output-name', changed('z.string().regex(/^parsed-[a-f0-9-]{36}\\.json$/)', 'z.string()'), True),
    ('loose-saved-root', changed('}).strict();\n\nexport type GtfsArtifactOptions', '}).strip();\n\nexport type GtfsArtifactOptions'), True),
    ('loose-binding', changed('}).strict();\nconst savedSchema', '}).strip();\nconst savedSchema'), True),
    ('loose-saved-output', changed('receipt: receiptSchema }).strict().nullable()', 'receipt: receiptSchema }).strip().nullable()'), True),
    ('loose-receipt', changed('parsed: z.boolean() }).strict()', 'parsed: z.boolean() }).strip()'), True),
    ('loose-archive', changed('bytes: positive }).strict()', 'bytes: positive }).strip()'), True),
    ('invalid-installation', changed('const id = z.string().uuid();', 'const id = z.string();'), True),
    ('invalid-build', changed('z.string().regex(/^[a-f0-9]{40,64}$/)', 'z.string()'), True),
    ('zero-output-bound', changed('const positive = z.number().int().positive().safe();', 'const positive = z.number().int().nonnegative().safe();'), True),
    ('restored', source, False),
])

results = []
filters = {
    'gtfs-artifact-read-is-incomplete': 'rejects a short local read',
    'gtfs-artifact-parsing-was-interrupted': 'leaves an interrupted parse',
    'gtfs-retained-archive-could-not-be-verified': 'refuses unconfirmed Storage bytes',
    'gtfs-artifact-needs-an-active-retained-archive': 'refuses inactive',
    'gtfs-artifact-ownership-is-unconfirmed': 'refuses an unconfirmed renewal',
}

try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.managed-worker-artifact-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-artifact-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/managed-worker-artifact', f'@/lib/gtfs/{candidate_file.stem}'))
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
