"""Check that the pipeline test detects deletion of retained container evidence."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[4]
source = root / 'scripts/modeling/run_behavioral_demand_prototype.py'
original = source.read_bytes()
guard = b'if custody.exists() or custody.is_symlink():'
assert original.count(guard) == 1
cases = []
try:
    for name, content, expected in (
        ('harmless', original + b'\n# Harmless custody control.\n', 0),
        ('erase-retained-pipeline', original.replace(guard, b'if False:'), 1),
        ('restored', original, 0),
    ):
        source.write_bytes(content)
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover',
            '-s', 'scripts/modeling/tests', '-p', 'test_run_behavioral_demand_prototype.py', '-v'],
            cwd=root, text=True, capture_output=True)
        output = result.stdout + result.stderr
        observed = result.returncode == expected
        if expected:
            observed = observed and 'FAIL: test_force_preserves_retained_container_custody_and_runtime_log' in output and 'RuntimeError not raised' in output
        cases.append({'case': name, 'returncode': result.returncode, 'expected_behavior_observed': observed})
        if not observed:
            raise RuntimeError(output)
finally:
    source.write_bytes(original)
print(json.dumps({'cases': cases, 'source_sha256': hashlib.sha256(original).hexdigest(),
    'limits': ['Synthetic pipeline filesystem regression; no database, native model or scientific acceptance']}, indent=2))
