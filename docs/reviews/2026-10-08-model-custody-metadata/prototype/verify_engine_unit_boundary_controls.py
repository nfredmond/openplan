"""Prove unit engine fixtures cannot retain imports or manufacture computation."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'
source = (WORKER / 'worker_import_for_tests.py').read_text()
allow = source.replace('raise AssertionError("Unit fixture reached unconfigured native computation")', 'pass')
no_restore = source.replace('with patch.dict(sys.modules, {"aequilibrae": engine, "aequilibrae.matrix": matrix, "aequilibrae.paths": paths}):\n            yield', 'sys.modules.update({"aequilibrae": engine, "aequilibrae.matrix": matrix, "aequilibrae.paths": paths})\n        yield')
assert allow != source and no_restore != source
runner = '''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('worker_import_for_tests',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName('test_engine_unit_boundary'))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
cases = [('baseline', source, None), ('harmless', source+'\n# Harmless comment.\n', None), ('allow-computation', allow, 'test_unconfigured_computation_cannot_succeed'), ('retain-imports', no_restore, 'test_restores_modules_even_after_interruption'), ('restored', source, None)]
records = []
with tempfile.TemporaryDirectory() as temp:
    path = Path(temp) / 'candidate.py'
    for name, body, target in cases:
        path.write_text(body)
        result = subprocess.run([sys.executable, '-B', '-c', runner, str(path)], cwd=WORKER, capture_output=True, text=True, timeout=30)
        if target:
            assert result.returncode == 1 and 'FAIL: '+target in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
        records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': target})
report = {'controls': records, 'fixture_sha256': hashlib.sha256(source.encode()).hexdigest(), 'test_sha256': hashlib.sha256((WORKER/'test_engine_unit_boundary.py').read_bytes()).hexdigest(), 'limits': 'Explicit mocked import boundary only. No native numerical engine, installed runtime, process cleanup or scientific acceptance.'}
content = json.dumps(report, indent=2)+'\n'
(ROOT/'engine-unit-boundary-controls.json').write_text(content)
print(content)
