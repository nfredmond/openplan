"""Detect assessment hashes that follow later filesystem bytes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'workers/aequilibrae_worker/model_validation_core_v5.py'
original = source.read_bytes()
cases = []
variants = [('harmless', original + b'\n# Harmless custody control.\n', None)]
for name, reason in (('bundle', 'Assessment cited replacement bundle bytes'),
                     ('audit', 'Assessment cited replacement audit bytes')):
    old = f'hashlib.sha256(input_bytes[{name}_path]).hexdigest()'.encode()
    new = f'hashlib.sha256({name}_path.read_bytes()).hexdigest()'.encode()
    assert old in original
    variants.append((f'reread-{name}', original.replace(old, new), reason))
for name, reason in (('package', 'frozen observation package bytes changed'),
                     ('audit', 'frozen pre-volume match audit bytes changed')):
    old = f'if hashlib.sha256(input_bytes[{name}_path]).hexdigest()'.encode()
    new = f'if hashlib.sha256({name}_path.read_bytes()).hexdigest()'.encode()
    assert original.count(old) == 1
    variants.append((f'check-replacement-{name}', original.replace(old, new), reason))
variants.append(('restored', original, None))
try:
    for name, content, reason in variants:
        source.write_bytes(content)
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/modeling/tests/test_validation_input_custody.py')],
                                cwd=ROOT, capture_output=True, text=True)
        detail = result.stdout + result.stderr
        if reason:
            assert result.returncode != 0 and reason in detail, detail
        else:
            assert result.returncode == 0, detail
        cases.append({'case': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_bytes(original)
report = {'cases': cases, 'source_sha256': hashlib.sha256(original).hexdigest(),
          'limits': ['Synthetic replacement during readiness checks and after output read', 'No concurrent filesystem fencing or immutable Storage proof',
                     'No source validity or scientific acceptance claim']}
Path(__file__).with_name('validation-input-custody-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
