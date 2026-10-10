"""Native retained-count faults, without modifying checkout sources."""
import hashlib
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'
sys.path.insert(0, str(WORKER))
import test_managed_paired_inputs as tests


def main():
    source = (WORKER / 'model_predecessor_inputs.py').read_text()
    adapter = inspect.getsource(tests.aeq.retain_managed_state_and_package)
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Count-retention mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, None, None), ('harmless', source + '\n# Harmless comment.\n', adapter + '\n# Harmless comment.\n', None),
        ('ignore-producer-attempt', change(source, "for key in ('stage_id', 'attempt_id')):", "for key in ('stage_id',)):") , None,
         'PairedInputTests.test_different_attempts_cannot_be_paired'),
        ('ignore-package-source', change(source, "if package['package_dir'] != package_input['source_package_directory']:", 'if False:'), None,
         'PairedInputTests.test_recorded_package_mismatch_stops_join'),
        ('share-original-nested-state', change(source, 'mapped = copy.deepcopy(original)', 'mapped = original.copy()'), None,
         'PairedInputTests.test_real_join_maps_only_package_and_preserves_original'),
        ('claim-execution-readiness', source, change(adapter, '"execution_ready": mapping["execution_ready"]', '"execution_ready": True'),
         'PairedInputTests.test_real_join_maps_only_package_and_preserves_original'),
        ('restored', source, None, None)]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_predecessor_inputs.py'
        adapter_file = Path(temp) / 'adapter.py'
        runner = """
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_predecessor_inputs',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_managed_paired_inputs as tests
if sys.argv[3]:
 namespace=dict(tests.aeq.__dict__)
 exec(compile(open(sys.argv[3]).read(),'<count-adapter-control>','exec'),namespace)
 tests.aeq.retain_managed_state_and_package=FunctionType(namespace['retain_managed_state_and_package'].__code__,tests.aeq.__dict__)
name='test_managed_paired_inputs'+('.'+sys.argv[2] if sys.argv[2] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
sys.exit(0 if result.wasSuccessful() else 1)
"""
        for name, body, adapter_body, target in cases:
            candidate.write_text(body)
            adapter_file.write_text(adapter_body or '')
            result = subprocess.run([sys.executable, '-B', '-c', runner, str(candidate), target or '', str(adapter_file) if adapter_body else ''],
                                    cwd=WORKER, capture_output=True, text=True, timeout=30)
            if target:
                if result.returncode != 1 or 'FAIL: ' + target.split('.')[1] not in result.stderr:
                    raise AssertionError('Targeted count fault did not fail: ' + name + '\n' + result.stderr)
            elif result.returncode:
                raise AssertionError('Count baseline failed: ' + name + '\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': target})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'worker_sha256': hashlib.sha256((WORKER / 'main.py').read_bytes()).hexdigest(), 'controls': records,
              'limits': 'Actual paired handoff with real state/package files and mocked HTTP. Only package path mapping; no native paired proof, project/output/count relocation, normal dispatch or scientific acceptance.'}
    (ROOT / 'paired-input-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
