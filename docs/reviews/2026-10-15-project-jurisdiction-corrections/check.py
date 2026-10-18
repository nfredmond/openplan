"""Run bounded serial regression, scoped types and changed-file lint after controls."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
APP = ROOT / 'openplan'
TESTS = [
    'project-jurisdiction-editor.test.tsx', 'project-jurisdiction-export-corrections.test.ts',
    'project-jurisdiction-artifacts.test.ts', 'project-jurisdiction.test.ts',
    'jurisdiction-readiness-routes.test.ts', 'jurisdiction-readiness-evidence-bundle.test.ts',
    'report-generate-route.test.ts', 'project-evidence-generated-pagination.test.ts',
    'project-geopackage.test.ts', 'project-geopackage-route.test.ts', 'project-evidence-bundle-route.test.ts',
]
if __name__ == '__main__':
    out = HERE / sys.argv[1]
    out.mkdir(exist_ok=False)
    changed = subprocess.check_output(['git', 'diff', '--name-only', '--', 'openplan/src'], cwd=ROOT, text=True).splitlines()
    changed += ['openplan/src/test/project-jurisdiction-export-corrections.test.ts', 'openplan/src/test/project-jurisdiction-export-fixture.ts']
    originals = {p: (ROOT / p).read_bytes() for p in changed}
    commands = [
        ('types', ['node', '--max-old-space-size=768', 'node_modules/typescript/bin/tsc', '-p', str(HERE / 'tsconfig.json')]),
        ('lint', ['node', '--max-old-space-size=640', 'node_modules/eslint/bin/eslint.js', '--max-warnings=0', *[str(Path(p).relative_to('openplan')) for p in changed]]),
        ('tests', ['node', '--max-old-space-size=640', 'node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--config', str(HERE / 'vitest.config.mts'), *['src/test/' + p for p in TESTS], '--reporter=json', '--outputFile=' + str(out / 'tests.json')]),
    ]
    results = []
    try:
        for name, command in commands:
            with (out / (name + '.log')).open('w') as log:
                result = subprocess.run(command, cwd=APP, stdout=log, stderr=subprocess.STDOUT)
            results.append({'name': name, 'command': command, 'exitCode': result.returncode})
            (out / 'checks.json').write_text(json.dumps(results, indent=2) + '\n')
            print(name, result.returncode, flush=True)
            if result.returncode:
                raise SystemExit(result.returncode)
    finally:
        unchanged = all((ROOT / p).read_bytes() == value for p, value in originals.items())
        (out / 'source-bindings.json').write_text(json.dumps({p: hashlib.sha256(value).hexdigest() for p, value in originals.items()}, indent=2) + '\n')
        group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
        (out / 'resources.json').write_text(json.dumps({key: (group / key).read_text().strip() for key in ['memory.max', 'memory.swap.max', 'memory.peak', 'memory.events']}, indent=2) + '\n')
        if not unchanged:
            raise RuntimeError('Source changed during final checks')
