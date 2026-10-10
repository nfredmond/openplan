"""Verify output alias refusal with restored source after each campaign."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'workers/aequilibrae_worker/model_validation_core_v5.py'
original = source.read_bytes()
needle = b'    def refuse_output_alias(path: Path) -> None:\n'
assert original.count(needle) == 1
cases = []
try:
    for name, replacement in (
        ('harmless', needle + b'        # Harmless control preserves execution.\n'),
        ('bypass-refusal', needle + b'        return\n'),
        ('restored', needle),
    ):
        source.write_bytes(original.replace(needle, replacement))
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/modeling/tests/test_validation_output_alias.py')],
                                capture_output=True, text=True, cwd=ROOT)
        output = result.stdout + result.stderr
        if name == 'bypass-refusal':
            assert result.returncode != 0 and 'test_preparation_refuses_output_identity_before_read' in output, output
            assert 'readiness input aliases model output' in output, output
        else:
            assert result.returncode == 0, output
        cases.append({'case': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_bytes(original)
report = {'cases': cases, 'source_sha256': hashlib.sha256(original).hexdigest(),
          'limits': ['Synthetic files only', 'Metadata checks do not fence concurrent filesystem replacement',
                     'No prepared scientific instrument or native model acceptance']}
Path(__file__).with_name('validation-output-alias-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
