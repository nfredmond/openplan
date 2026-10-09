"""Run native adapter controls in an owned checkout and seeded proof database."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'openplan/src/lib/engagement/synthesis-generation-requests-server.ts'
original = SOURCE.read_bytes()
text = original.decode()
command = ['node', '--import', './openplan/node_modules/tsx/dist/loader.mjs',
    'docs/reviews/2026-10-09-synthesis-read-contention/verify_native.mts', sys.argv[1]]
results = []
try:
    for name, before, after, expected in [
        ('baseline', None, None, True),
        ('harmless-comment', 'Request reads take', 'Retained request reads take', True),
        ('omit-read-retry', 'for (const waitMs of [50, 150])', 'for (const waitMs of [] as number[])', False),
        ('restored', None, None, True),
    ]:
        if before:
            assert text.count(before) == 1
        SOURCE.write_text(text if before is None else text.replace(before, after))
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=30)
        assert (run.returncode == 0) == expected, run.stdout + run.stderr
        if expected:
            evidence = json.loads(run.stdout)
        else:
            assert 'Synthesis request unavailable' in run.stderr, run.stderr
            evidence = {'expectedFailure': 'Synthesis request unavailable after the first native PT503'}
        results.append({'control': name, 'exitCode': run.returncode, 'evidence': evidence})
finally:
    SOURCE.write_bytes(original)
print(json.dumps(results, indent=2))
