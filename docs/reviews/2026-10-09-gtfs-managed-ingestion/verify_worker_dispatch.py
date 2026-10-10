"""Check typed GTFS dispatch with disposable sources and real private journals."""
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
source_path = app / 'src/lib/gtfs/managed-worker-dispatch.ts'
test_path = app / 'src/test/gtfs-managed-worker-dispatch.test.ts'
source, tests = source_path.read_text(), test_path.read_text()
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)

def changed(old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new)

cases = [('baseline', source, False), ('harmless-comment', source + '\n// Harmless comment.\n', False)]
for operation in ['stage','prepare_archive','confirm_archive','prepare_output','batch','tracts','complete','fail','adopt']:
    line = next(line for line in source.splitlines() if f'case "{operation}":' in line)
    cases.append((f'missing-{operation}', changed(line, f'      case "{operation}": throw new Error("Synthetic missing operation");'), True))
cases.extend([
    ('changed-dispatch-payload', changed('if (!isDeepStrictEqual(retained, payload))', 'if (false)'), True),
    ('unvalidated-retained-receipt', changed('verify: (raw, commandId) => prepare(commandId).verify(raw)', 'verify: (raw, commandId) => raw'), True),
    ('mutable-caller-input', changed('mutation = structuredClone(rawMutation)', 'mutation = rawMutation'), True),
    ('missing-prevalidation', changed('prepare("00000000-0000-4000-8000-000000000000");', 'void 0;'), True),
    ('changed-version', changed('versionId: id.parse(journal.identity.versionId)', 'versionId: "00000000-0000-4000-8000-000000000000"'), True),
    ('changed-token', changed('token: id.parse(journal.identity.token)', 'token: "00000000-0000-4000-8000-000000000000"'), True),
    ('changed-command', changed('sendGtfsPreparedCommand(service, prepare(commandId), signal)', 'sendGtfsPreparedCommand(service, prepare("00000000-0000-4000-8000-000000000000"), signal)'), True),
    ('retained-context', changed('if (!isDeepStrictEqual(saved.arguments.context, expected))', 'if (false)'), True),
    ('unvalidated-completion', changed('if (mutation.operation === "complete") completeGtfsAttemptCommand(scope, { ...mutation.input, id: commandId });', 'if (mutation.operation === "complete") void 0;'), True),
    ('unvalidated-failure', changed('else failGtfsAttemptCommand(scope, { ...mutation.input, id: commandId });', 'else void 0;'), True),
    ('unsupported-terminal', changed('z.enum(["complete", "fail"])', 'z.enum(["complete", "fail", "adopt"])'), True),
    ('loose-terminal-root', changed('}).strict() }).strict().parse(payload)', '}).strict() }).strip().parse(payload)'), True),
    ('loose-terminal-arguments', changed('}).strict() }).strict().parse(payload)', '}).strip() }).strict().parse(payload)'), True),
    ('loose-terminal-context', changed('actorId: id }).strict()', 'actorId: id }).strip()'), True),
    ('restored', source, False),
])

results = []
try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.managed-worker-dispatch-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-dispatch-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/managed-worker-dispatch', f'@/lib/gtfs/{candidate_file.stem}'))
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
