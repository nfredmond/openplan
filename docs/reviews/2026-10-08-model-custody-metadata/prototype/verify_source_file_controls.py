"""Check local retention tests against harmless and targeted broken behavior."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'workers/aequilibrae_worker/model_validation_source_files.py'
original = source.read_text()
mutations = [
    ('logical-hash', " or digest.hexdigest() != record['sha256']", ''),
    ('logical-size', "if size > record['bytes']:", 'if False:'),
    ('context', "if catalog['context'] != expected_context:", 'if False:'),
    ('output-alias', "if entry['phase'] == 'preparation' and paths[entry['role']].samefile(output):", 'if False:'),
    ('disk-budget', 'if shutil.disk_usage(destination.parent).free < required:', 'if False:'),
    ('unpublished-status', "catalog['publication_state'] = 'retained_locally'", "catalog['publication_state'] = 'published'"),
]
variants = [('harmless', original + '\n# Harmless formatting control.\n')]
for name, before, after in mutations:
    assert original.count(before) == 1, name
    variants.append((name, original.replace(before, after)))
variants.append(('restored', original))
cases = []
try:
    for name, content in variants:
        source.write_text(content)
        result = subprocess.run([sys.executable, '-B', 'workers/aequilibrae_worker/test_model_validation_source_files.py'],
                                cwd=ROOT, capture_output=True, text=True, timeout=30)
        detail = result.stdout + result.stderr
        if name in ('harmless', 'restored'):
            assert result.returncode == 0, detail
        else:
            assert result.returncode != 0 and 'AssertionError' in detail, detail
        cases.append({'control': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_text(original)
report = {'source_sha256': hashlib.sha256(original.encode()).hexdigest(), 'cases': cases,
          'limits': 'Synthetic local files. No native producer authority, Storage upload, crash recovery, scientific or human acceptance.'}
Path(__file__).with_name('source-file-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
