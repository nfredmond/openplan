"""Read retained publisher bytes from bounded native Storage in a fresh client."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent / '2026-10-09-gtfs-ingest-recovery'))
from isolated_storage import storage

config = json.loads(Path(sys.argv[1]).read_text())
archive = Path(sys.argv[2]).resolve(strict=True)
source = root / 'openplan/src/lib/gtfs/retained-archive.ts'
original = source.read_text()
old = ' || hash.digest("hex") !== checksumSha256'
if original.count(old) != 1:
    raise AssertionError('Checksum mutation target missing')
cases = [('baseline', original, None), ('harmless', original + '\n// harmless comment\n', None),
         ('ignore-hash', original.replace(old, ''), 'Changed archive was accepted'), ('restored', original, None)]
results = []
# Keep relative imports intact without editing tracked application source.
fd, candidate_path = tempfile.mkstemp(prefix='.retained-archive-proof-', suffix='.ts', dir=source.parent)
os.close(fd)
candidate = Path(candidate_path)
try:
    with storage(config) as native:
        env = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=384',
               'OPENPLAN_PROOF_ARCHIVE_MODULE': str(candidate),
               'OPENPLAN_PROOF_STORAGE_URL': native['url'], 'OPENPLAN_PROOF_STORAGE_TOKEN': native['token']}
        command = [str(root / 'openplan/node_modules/.bin/tsx'), str(here / 'verify_native_archive.mts')]
        def run(phase, extra=()):
            return subprocess.run(command + [phase, *extra], cwd=root / 'openplan', env=env,
                                  capture_output=True, text=True, timeout=40)
        for name, code, reason in cases:
            candidate.write_text(code)
            seeded = run('seed', [str(archive)])
            if seeded.returncode:
                raise RuntimeError('Native seed failed: ' + seeded.stderr)
            identity = json.loads(seeded.stdout)
            env['OPENPLAN_PROOF_ARCHIVE_IDENTITY'] = json.dumps(identity)
            try:
                result = run('recover')
                if (result.returncode == 0) != (reason is None) or (reason and reason not in result.stderr):
                    raise RuntimeError(name + '\n' + result.stdout + result.stderr)
                results.append({'case': name, 'expectedPass': reason is None, 'exitCode': result.returncode,
                                'expectedFailure': reason, 'proof': json.loads(result.stdout) if result.returncode == 0 else None})
            finally:
                cleaned = run('cleanup')
                if cleaned.returncode:
                    raise RuntimeError('Native object cleanup failed: ' + cleaned.stderr)
finally:
    candidate.unlink(missing_ok=True)
    if source.read_text() != original:
        raise AssertionError("Tracked archive reader changed during verification")
print(json.dumps({'recordedAt': datetime.now(timezone.utc).isoformat(),
                  'sourceSha256': hashlib.sha256(original.encode()).hexdigest(),
                  'trackedSourceUnchanged': True,
                  'nativeStorageRemoved': True, 'cases': results}, indent=2))
