"""Check that the retained SQL-result join detects an incomplete preparation."""
from pathlib import Path
import json
import subprocess

review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
engine = app / 'src/lib/engagement/synthesis-preparation.ts'
original = engine.read_bytes()
results = []
try:
    for name in ['baseline', 'harmless-comment', 'drop-native-tail']:
        source = original.decode()
        if name == 'harmless-comment': source = '// Native join harmless control.\n' + source
        if name == 'drop-native-tail':
            assert source.count('for (const item of snapshot.items)') == 1
            source = source.replace('for (const item of snapshot.items)', 'for (const item of snapshot.items.slice(0, 300))')
        engine.write_text(source)
        run = subprocess.run(['npm', 'exec', '--', 'tsx', str(review / 'native-preparation.ts')], cwd=app, text=True, capture_output=True, timeout=60)
        ok = run.returncode == 0 if name != 'drop-native-tail' else run.returncode != 0 and 'Preparation source counts differ' in run.stderr
        results.append({'case': name, 'exitCode': run.returncode, 'expectedOutcome': ok})
        if not ok: raise RuntimeError(run.stdout + run.stderr)
finally:
    engine.write_bytes(original)
(review / 'native-preparation-mutations.json').write_text(json.dumps({'sourcesRestored': engine.read_bytes() == original, 'cases': results}, indent=2) + '\n')
print(json.dumps(results))
