"""Mutate only the owned archive-reader source, restoring it in finally."""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
source = app / 'src/lib/gtfs/retained-archive.ts'
original = source.read_text()

def changed(old, new):
    if original.count(old) != 1:
        raise AssertionError('Expected one mutation target: ' + old)
    return original.replace(old, new)

cases = [
    ('baseline', original, None),
    ('harmless', original + '\n// Harmless control.\n', None),
    ('ignore-hash', changed(' || hash.digest("hex") !== checksumSha256', ''), 'refuses altered, truncated or oversized bytes'),
    ('ignore-path', changed('    || storagePath !== `${workspaceId}/${feedId}/${versionId}.zip`\n', ''), 'refuses a mismatched path before I/O'),
    ('ignore-size-limit', changed('if (byteSize > limits.maxArchiveBytes)', 'if (false)'), 'refuses declared oversize before I/O'),
    ('wrong-timeout-outcome', changed('timedOut = true; controller.abort();', 'timedOut = false; controller.abort();'), 'times out a stalled body'),
    ('restored', original, None),
]
results = []
try:
    for name, content, failure in cases:
        source.write_text(content)
        result = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', 'src/test/gtfs-retained-archive.test.ts', '--maxWorkers=1'],
                                cwd=app, capture_output=True, text=True, timeout=45)
        if (result.returncode == 0) != (failure is None) or (failure and failure not in result.stdout + result.stderr):
            raise RuntimeError(name + '\n' + result.stdout + result.stderr)
        results.append({'case': name, 'expectedPass': failure is None, 'exitCode': result.returncode,
                        'expectedFailingTest': failure})
finally:
    source.write_text(original)
print(json.dumps({'recordedAt': datetime.now(timezone.utc).isoformat(),
                  'sourceSha256': hashlib.sha256(original.encode()).hexdigest(), 'cases': results}, indent=2))
