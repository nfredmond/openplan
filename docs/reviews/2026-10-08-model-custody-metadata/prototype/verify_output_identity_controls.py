"""Check output-identity refusal with targeted faults and a harmless control."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'workers/aequilibrae_worker/model_validation_core_v5.py'
original = source.read_bytes()
mutations = (
    ('duplicate-columns', 'if len(fields) != len(set(fields)):', 'test_duplicate_columns_refused'),
    ('duplicate-links', 'if identifier in volumes:', 'test_duplicate_link_rows_refused'),
    ('empty-link', 'if not isinstance(identifier, str) or not identifier.strip():', 'test_empty_identity_refused'),
)
cases = []
try:
    variants = [('harmless', original + b'\n# Harmless output identity control.\n', None)]
    for name, before, test in mutations:
        assert original.count(before.encode()) == 1, name
        variants.append((name, original.replace(before.encode(), b'if False:'), test))
    variants.append(('restored', original, None))
    for name, content, test in variants:
        source.write_bytes(content)
        command = [sys.executable, '-B', str(ROOT / 'scripts/modeling/tests/test_validation_output_identity.py')]
        if test:
            command.append('OutputIdentityTests.' + test)
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        detail = result.stdout + result.stderr
        if test:
            assert result.returncode != 0 and test in detail and 'AssertionError' in detail, detail
        else:
            assert result.returncode == 0, detail
        cases.append({'control': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_bytes(original)
report = {'cases': cases, 'source_sha256': hashlib.sha256(original).hexdigest(),
          'limits': ['Synthetic CSV identity integrity only',
                     'No complete output schema, source validity, general quantity comparability or scientific acceptance proof']}
Path(__file__).with_name('output-identity-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
