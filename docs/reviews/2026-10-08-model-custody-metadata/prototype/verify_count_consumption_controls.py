"""Check acquisition/current-file distinctions with temporary module mutations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_count_inputs.py').read_text()
    def change(old, new):
        if source.count(old) != 1:
            raise AssertionError('Availability mutation anchor changed')
        return source.replace(old, new)
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None),
        ('ignore-manifest-hash', change("hashlib.sha256(content).hexdigest() != expected_hash", "False"), 'test_manifest_tampering'),
        ('ignore-file-identity', change("if any(expected.get(key) != actual.get(key) for key in ('status', 'sha256', 'size_bytes')):", "if False:"), 'test_changed_missing_and_new_files'),
        ('ignore-copy-race', change("if any(expected.get(key) != actual.get(key) for key in ('status', 'sha256', 'size_bytes')):", "if False:"), 'test_change_during_recopy'),
        ('accept-duplicate-keys', change('if key in result:', 'if False:'), 'test_duplicate_keys'),
        ('restored', source, None)]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / 'model_count_inputs.py'
        runner = """
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_count_inputs',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
name='test_count_manifest_consumption'+('.ConsumptionTests.'+sys.argv[2] if sys.argv[2] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
sys.exit(0 if result.wasSuccessful() else 1)
"""
        for name, body, test in cases:
            path.write_text(body)
            result = subprocess.run([sys.executable, '-B', '-c', runner, str(path), test or ''],
                                    cwd=WORKER, capture_output=True, text=True, timeout=30)
            if test:
                if result.returncode != 1 or 'FAIL: ' + test not in result.stderr:
                    raise AssertionError('Targeted availability fault did not fail: ' + name + '\n' + result.stderr)
            elif result.returncode:
                raise AssertionError('Availability baseline failed: ' + name + '\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': test})
    join_runner = """
import unittest
from unittest.mock import patch
from test_model_skip_dispatch import aeq
original = aeq.retain_assignment_counts
def bypass(*args, **kwargs):
    kwargs.pop('retained_record', None)
    return original(*args, **kwargs)
with patch.object(aeq, 'retain_assignment_counts', side_effect=bypass):
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(
        'test_count_manifest_consumption.ConsumptionTests.test_assignment_verifies_before_engine_open'))
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
    result = subprocess.run([sys.executable, '-B', '-c', join_runner], cwd=WORKER,
                            capture_output=True, text=True, timeout=30)
    if result.returncode != 1 or 'FAIL: test_assignment_verifies_before_engine_open' not in result.stderr:
        raise AssertionError('Assignment bypass did not fail at the expected boundary: ' + result.stderr)
    records.append({'control': 'bypass-assignment-verification', 'exit_code': result.returncode,
                    'targeted_test': 'test_assignment_verifies_before_engine_open'})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': records,
              'limits': 'Synthetic local-file verification and assignment refusal before engine entry. No engine computation, browser journey, arbitrary host confinement or scientific acceptance.'}
    (ROOT / 'count-consumption-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
