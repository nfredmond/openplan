"""Exercise the request-reader tests against reversible source mutations.

Run only in an owned checkout with no concurrent compiler or browser acceptance.
This proves mocked adapter checks, not native contention or browser usability.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'openplan/src/lib/engagement/synthesis-generation-requests-server.ts'
TEST = 'src/test/engagement-synthesis-generation-requests-server.test.ts'


def main():
    original = SOURCE.read_bytes()
    text = original.decode()
    cases = [
        ('baseline', None, None, True, None),
        ('harmless-comment', 'Request reads take', 'Retained request reads take', True, None),
        ('omit-read-retry', 'for (const waitMs of [50, 150])', 'for (const waitMs of [] as number[])', False, 'recovers a busy read'),
        ('retry-writes', 'if (name === "read_engagement_synthesis_generation_request")', 'if (true)', False, 'does not retry a busy cancellation'),
        ('retry-other-errors', 'if (response.error?.code !== "PT503") break;', 'if (!response.error) break;', False, 'does not retry a read with'),
        ('wrong-retry-scope', 'response = await client.rpc(name, args).abortSignal(boundedSignal);\n      boundedSignal', 'response = await client.rpc(name, {}).abortSignal(boundedSignal);\n      boundedSignal', False, 'recovers a busy read'),
        ('restored', None, None, True, None),
    ]
    evidence = Path(tempfile.mkdtemp(prefix='openplan-synthesis-read-controls-'))
    results = []
    try:
        for name, before, after, passes, diagnostic in cases:
            if before is not None:
                assert text.count(before) == 1, f'Mutation seam changed: {name}'
            SOURCE.write_text(text if before is None else text.replace(before, after))
            run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', TEST, '--maxWorkers=1'],
                cwd=ROOT / 'openplan', env={**os.environ, 'NODE_OPTIONS': '--max-old-space-size=2048'},
                capture_output=True, text=True, timeout=60)
            output = run.stdout + run.stderr
            (evidence / f'{name}.log').write_text(output)
            assert (run.returncode == 0) == passes, f'Unexpected control outcome: {name}'
            if diagnostic:
                assert diagnostic in output, f'Wrong control failure: {name}'
            results.append({'control': name, 'exitCode': run.returncode, 'expectedPass': passes, 'diagnostic': diagnostic})
    finally:
        SOURCE.write_bytes(original)
        (evidence / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({'evidence': str(evidence), 'controls': results}, indent=2))


if __name__ == '__main__':
    main()
