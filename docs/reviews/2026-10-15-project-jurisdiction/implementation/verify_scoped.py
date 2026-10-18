"""Run only the named jurisdiction regression set, narrow types and changed-file lint.

Invoke from a 1 GiB/no-swap cgroup. This neither installs dependencies nor starts
services. PostgreSQL, production builds and browser acceptance belong to parent.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / 'openplan'
HERE = Path(__file__).resolve().parent
TESTS = [
    'project-jurisdiction.test.ts', 'project-jurisdiction-route.test.ts',
    'project-jurisdiction-editor.test.tsx', 'project-jurisdiction-artifacts.test.ts',
    'project-jurisdiction-picker.test.tsx', 'refused-project-jurisdiction-action.test.ts',
    'jurisdiction-readiness-routes.test.ts', 'jurisdiction-readiness-evidence-bundle.test.ts',
    'project-record-route.test.ts', 'project-identity-editor.test.tsx',
    'project-geopackage.test.ts', 'project-geopackage-route.test.ts',
    'study-area-picker.test.tsx', 'report-generate-route.test.ts',
    'project-evidence-generated-pagination.test.ts', 'project-evidence-bundle-route.test.ts',
]
if __name__ == '__main__':
    out = HERE / (sys.argv[1] if len(sys.argv) > 1 else 'final-checks')
    out.mkdir(exist_ok=False)
    source_paths = json.loads((HERE / 'owned-source-files.json').read_text())
    sources = {p: (ROOT / p).read_bytes() for p in source_paths}
    commands = [
        ('types', ['node', '--max-old-space-size=768', 'node_modules/typescript/bin/tsc', '-p', str(HERE / 'tsconfig.json')]),
        ('lint', ['node', 'node_modules/eslint/bin/eslint.js', '--max-warnings=0', *[str(Path(p).relative_to('openplan')) for p in source_paths]]),
        ('tests', ['node', 'node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--config', str(HERE / 'vitest.config.mts'), *['src/test/' + name for name in TESTS], '--reporter=json', '--outputFile=' + str(out / 'tests.json')]),
    ]
    results = []
    for name, command in commands:
        with (out / (name + '.log')).open('w') as log:
            result = subprocess.run(command, cwd=APP, stdout=log, stderr=subprocess.STDOUT)
        results.append({'name': name, 'command': command, 'exitCode': result.returncode})
        (out / 'checks.json').write_text(json.dumps(results, indent=2) + '\n')
        print(name, result.returncode, flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)
    assert all((ROOT / p).read_bytes() == value for p, value in sources.items()), 'Checked source changed during verification'
    (out / 'source-bindings.json').write_text(json.dumps({p: hashlib.sha256(value).hexdigest() for p, value in sources.items()}, indent=2) + '\n')
