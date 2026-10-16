"""Run the bounded integration checks without services or dependency writes."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
APP = ROOT / 'openplan'

if __name__ == '__main__':
    out = HERE / 'evidence' / sys.argv[1]
    out.mkdir(exist_ok=False)
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    resources = {key: (group / key).read_text().strip() for key in ['memory.max', 'memory.swap.max']}
    if resources != {'memory.max': '1073741824', 'memory.swap.max': '0'}:
        raise RuntimeError('Run in the required 1 GiB, zero-swap scope')
    sources = subprocess.check_output(['git', 'diff', '--name-only', 'b259d73e56d22d4935ef2789874cf69901786b33', '--', 'openplan/src'], cwd=ROOT, text=True).splitlines()
    original = {p: (ROOT / p).read_bytes() for p in sources}
    tests = json.loads((HERE / 'tests.json').read_text())
    commands = [
        ('tests', ['node', '--max-old-space-size=640', 'node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--config', str(HERE / 'vitest.config.mts'), *[str(Path(p).relative_to('openplan')) for p in tests], '--reporter=json', '--outputFile=' + str(out / 'tests.json')]),
        ('types', ['node', '--max-old-space-size=768', 'node_modules/typescript/bin/tsc', '-p', str(HERE / 'tsconfig.json')]),
        ('lint', ['node', '--max-old-space-size=640', 'node_modules/eslint/bin/eslint.js', '--max-warnings=0', *[str(Path(p).relative_to('openplan')) for p in sources]]),
        ('direction', ['npm', 'run', 'product:direction:check']),
        ('whitespace-source', ['git', 'diff', '--check', 'b259d73e56d22d4935ef2789874cf69901786b33', '--', 'openplan/src', 'openplan/supabase', 'CHANGELOG.md']),
    ]
    if sys.argv[2:] == ['--static-only']:
        commands = commands[1:]
    elif sys.argv[2:]:
        raise ValueError('Only --static-only is supported after the evidence name')
    results = []
    try:
        for name, command in commands:
            with (out / (name + '.log')).open('w') as log:
                result = subprocess.run(command, cwd=ROOT if name == 'whitespace-source' else APP, stdout=log, stderr=subprocess.STDOUT)
            results.append({'name': name, 'command': command, 'exitCode': result.returncode})
            (out / 'checks.json').write_text(json.dumps(results, indent=2) + '\n')
            print(name, result.returncode, flush=True)
            if result.returncode:
                raise SystemExit(result.returncode)
    finally:
        resources.update({key: (group / key).read_text().strip() for key in ['memory.peak', 'memory.events']})
        (out / 'resources.json').write_text(json.dumps(resources, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({p: hashlib.sha256(data).hexdigest() for p, data in original.items()}, indent=2) + '\n')
        changed = [p for p, data in original.items() if (ROOT / p).read_bytes() != data]
        if changed:
            raise RuntimeError('Source changed during checks: ' + ', '.join(changed))
