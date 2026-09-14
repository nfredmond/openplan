"""Run on an owned checkout with its server stopped; preserve cache and probe real builds."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
evidence = Path(os.environ['OPENPLAN_BUILD_HEAP_EVIDENCE'])
evidence.mkdir(parents=True, exist_ok=True)
probe = app / 'src/test/v060-build-heap-control.ts'
assert not probe.exists(), 'Refuse to overwrite an existing source'
cache = app / '.next/cache'
if cache.exists():
    preserved_cache = evidence / 'previous-next-cache'
    assert not preserved_cache.exists(), 'Use a fresh evidence directory'
    cache.rename(preserved_cache)
results = []
preloader = evidence / 'observe-heap.mjs'
preloader.write_text("import fs from 'node:fs';import v8 from 'node:v8';fs.appendFileSync(process.env.OPENPLAN_HEAP_RECORD, JSON.stringify({pid:process.pid,argv:process.argv,heapLimitMiB:v8.getHeapStatistics().heap_size_limit/1024/1024})+'\\n');\n")
try:
    for label, source in [
        ('cold-baseline', None),
        ('harmless-comment', '// Build acceptance control; no application behavior.\nexport {};\n'),
        ('target-type-error', 'export const buildHeapControl: string = 42;\n'),
        ('restored', None),
    ]:
        if source is None:
            if probe.exists():
                probe.unlink()
        else:
            probe.write_text(source)
        log = evidence / f'{label}.log'
        heap_log = evidence / f'{label}-heap.jsonl'
        assert not heap_log.exists(), 'Use a fresh evidence directory'
        env = {**os.environ, 'NODE_OPTIONS': f"{os.environ.get('NODE_OPTIONS', '')} --import={preloader}", 'OPENPLAN_HEAP_RECORD': str(heap_log)}
        with log.open('w') as output:
            result = subprocess.run(['npm', 'run', 'build'], cwd=app, env=env, stdout=output, stderr=subprocess.STDOUT)
        text = log.read_text()
        expected = result.returncode == 0 if label != 'target-type-error' else (
            result.returncode != 0 and 'v060-build-heap-control.ts' in text
            and "Type 'number' is not assignable to type 'string'" in text
        )
        heaps = [json.loads(line) for line in heap_log.read_text().splitlines()]
        type_checks = [row for row in heaps if '--noEmit' in row['argv'] and any('/typescript/bin/tsc' in arg for arg in row['argv'])]
        assert type_checks, 'TypeScript subprocess not observed; this probe does not cover another Next checker mode'
        assert all(row['heapLimitMiB'] >= 6144 for row in type_checks), 'TypeScript child did not inherit the build heap allowance'
        results.append({'typeCheckProcesses': type_checks, 'case': label, 'exit': result.returncode, 'expectedOutcome': expected,
                        'log': str(log), 'sha256': hashlib.sha256(log.read_bytes()).hexdigest()})
        (evidence / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        print(label, result.returncode, expected, flush=True)
        assert expected, f'Unexpected build result: {label}; inspect {log}'
finally:
    if probe.exists():
        probe.unlink()
