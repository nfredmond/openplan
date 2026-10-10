"""Exercise attempt coordination with disposable sources and real private journals."""
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
source_path = app / 'src/lib/gtfs/managed-worker-attempt.ts'
test_path = app / 'src/test/gtfs-managed-worker-attempt.test.ts'
source, tests = source_path.read_text(), test_path.read_text()
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)

def changed(old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new)

cases = [('baseline', source, False), ('harmless-comment', source + '\n// Harmless comment.\n', False)]
cases.extend([
    ('changed-claim', changed('if (!isDeepStrictEqual(snapshot.claim, claim.claim))', 'if (false)'), True),
    ('terminal-history', changed('if (["ready", "failed", "cancelled"].includes(snapshot.state))', 'if (false)'), True),
    ('inactive-claim', changed('!claim.active || !snapshot.active', '!snapshot.active'), True),
    ('inactive-snapshot', changed('!claim.active || !snapshot.active', '!claim.active'), True),
    ('missing-initial-renewal', changed('    await renew();\n    signal.throwIfAborted();', '    signal.throwIfAborted();'), True),
    ('missing-final-renewal', changed('      await renew();\n      const result', '      const result'), True),
    ('ignored-false-renewal', changed('if (!await renewGtfsAttempt(service, scope, signal)) throw new Error("GTFS attempt ownership is unconfirmed");', 'await renewGtfsAttempt(service, scope, signal);'), True),
    ('unpropagated-ownership-loss', changed('lost.abort(error);', 'void 0;'), True),
    ('late-work-write', changed('if (!processing)', 'if (false)'), True),
    ('terminal-slot-bypass', changed('slot === "terminal" ||', 'false ||'), True),
    ('terminal-operation-bypass', changed('["complete", "fail", "adopt"].includes(command.operation)', 'false'), True),
    ('unsettled-work-write', changed('if (pendingWrites.size !== 0)', 'if (false)'), True),
    ('terminal-outcome', changed('if (!terminal || !["complete", "fail"].includes(terminal.operation))', 'if (false)'), True),
    ('mutable-terminal', changed('structuredClone(await work({', '(await work({'), True),
    ('renewal-race', changed('await heartbeat;\n      signal.throwIfAborted();', 'void 0;\n      signal.throwIfAborted();'), True),
    ('unsafe-interval', changed('.min(1).max(60_000).parse', '.min(1).parse'), True),
    ('ignored-retained-terminal', changed('if (retained) {', 'if (false) {'), True),
    ('missing-recovery-renewal', changed('if (!retained.resolved && claim.active && snapshot.active) await renew();', 'void 0;'), True),
    ('renew-closed-terminal', changed('if (!retained.resolved && claim.active && snapshot.active) await renew();', 'await renew();'), True),
    ('renew-cached-terminal', changed('!retained.resolved && claim.active && snapshot.active', 'claim.active && snapshot.active'), True),
    ('restored', source, False),
])

results = []
filters = {
    'missing-initial-renewal': 'confirms current ownership before work',
    'missing-final-renewal': 'confirms current ownership before work',
}
try:
    for name, candidate, broken in cases:
        suffix = uuid.uuid4().hex
        candidate_file = source_path.with_name(f'.managed-worker-attempt-{suffix}.ts')
        candidate_test = test_path.with_name(f'gtfs-managed-attempt-control-{suffix}.test.ts')
        try:
            candidate_file.write_text(candidate)
            candidate_test.write_text(tests.replace('@/lib/gtfs/managed-worker-attempt', f'@/lib/gtfs/{candidate_file.stem}'))
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
