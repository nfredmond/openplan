"""Exercise disposable GTFS journal guards against real private files and locks."""
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
source_path = app / 'src/lib/gtfs/managed-worker-journal.ts'
test_path = app / 'src/test/gtfs-managed-worker-journal.test.ts'
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
    ('unsafe-slot', changed('z.string().regex(/^[a-z][a-z0-9_-]{0,100}$/).parse(rawSlot)', 'z.string().parse(rawSlot)'), True),
    ('mutable-caller-payload', changed('payloadSchema.parse(rawPayload)', 'rawPayload'), True),
    ('loose-identity', changed('token: id }).strict();', 'token: id }).strip();'), True),
    ('loose-command', changed('resolved: z.boolean(), receipt: z.json() }).strict();', 'resolved: z.boolean(), receipt: z.json() }).strip();'), True),
    ('missing-parent-sync', changed('try { await parent.sync(); } finally', 'try { /* missing sync */ } finally'), True),
    ('missing-attempt-save', changed('await save(rootDirectory, identity);', 'void 0;'), True),
    ('missing-command-save', changed('await save(directory, command);', 'void 0;'), True),
    ('missing-receipt-save', changed('await save(directory, { ...command, resolved: true, receipt });', 'void 0;'), True),
    ('no-cached-verification', changed('delivery.verify(structuredClone(command.receipt), command.commandId)', 'command.receipt'), True),
    ('no-new-verification', changed('delivery.verify(structuredClone(receipt), command.commandId)', 'receipt'), True),
    ('mutable-verifier-receipt', changed('delivery.verify(structuredClone(receipt), command.commandId)', 'delivery.verify(receipt, command.commandId)'), True),
    ('mutable-submitted-payload', changed('structuredClone(command.payload)', 'command.payload'), True),
    ('no-pre-cancel', changed('callerSignal.throwIfAborted();', 'void 0;'), True),
    ('no-inflight-cancel', changed('signal.throwIfAborted();', 'void 0;'), True),
    ('claim-cache', changed('z.enum(["stage",', 'z.enum(["claim", "stage",'), True),
    ('restored', source, False),
])

results = []
try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.managed-worker-journal-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-journal-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/managed-worker-journal', f'@/lib/gtfs/{candidate_file.stem}'))
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
