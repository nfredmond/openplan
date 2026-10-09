"""Mutation controls for cleanup response handling; restore source on every exit."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
p = app / 'src/lib/gtfs/persist.ts'
original = p.read_text()
cases = [('baseline', original, True), ('harmless_comment', original+'\n// harmless control\n', True),
         ('ignore_false_receipt', original.replace('    if (!result.data) continue;', '    // receipt ignored'), False),
         ('wrong_version', original.replace('p_version_id: row.id,', 'p_version_id: "wrong",'), False),
         ('accept_invalid_shape', original.replace('result.error || typeof result.data !== "boolean"', 'result.error'), False),
         ('restored', original, True)]
results = []
try:
    for name, content, expected in cases:
        if name not in ('baseline','restored') and content == original:
            raise SystemExit('Control did not change source: '+name)
        p.write_text(content)
        r = subprocess.run([str(app/'node_modules/.bin/vitest'), 'run', 'src/test/gtfs-reaper-rpc.test.ts', '--maxWorkers=1'], cwd=app, text=True, capture_output=True, timeout=60)
        if (r.returncode == 0) != expected:
            raise SystemExit(f'{name}: {r.stdout}\n{r.stderr}')
        if not expected and 'AssertionError' not in r.stdout+r.stderr:
            raise SystemExit(f'{name} did not fail an assertion')
        results.append({'case':name,'expectedPass':expected,'returnCode':r.returncode,'output':r.stdout+r.stderr})
finally:
    p.write_text(original)
print(json.dumps(results,indent=2))
