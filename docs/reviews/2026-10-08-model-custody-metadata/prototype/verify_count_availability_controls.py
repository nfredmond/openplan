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
    source = (WORKER / 'model_credibility.py').read_text()
    def change(old, new):
        if source.count(old) != 1:
            raise AssertionError('Availability mutation anchor changed')
        return source.replace(old, new)
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None),
        ('trust-stale-availability', change('    if availability_lost:', '    if False:'), 'test_missing_file_cannot_inherit_available_acquisition'),
        ('missing-means-zero', change('"eligible_rows": None if availability_lost else len(eligible_rows)', '"eligible_rows": 0 if availability_lost else len(eligible_rows)'), 'test_missing_file_cannot_inherit_available_acquisition'),
        ('erase-acquisition-status', change('"recorded_acquisition_status": recorded_status', '"recorded_acquisition_status": None'), 'test_missing_file_cannot_inherit_available_acquisition'),
        ('restored', source, None)]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / 'model_credibility.py'
        runner = """
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_credibility',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
name='test_count_source_availability'+('.CountAvailabilityTests.'+sys.argv[2] if sys.argv[2] else '')
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
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': records,
              'limits': 'Real synthetic CSV/metadata, injected read denial and actual summary function. No retained hash verification, rendered browser journey or scientific acceptance.'}
    (ROOT / 'count-availability-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
