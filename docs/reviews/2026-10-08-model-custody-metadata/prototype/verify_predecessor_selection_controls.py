"""Predecessor selection faults, without modifying checkout sources."""
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
import test_model_predecessor_inputs as tests


def main():
    source = (WORKER / 'model_predecessor_inputs.py').read_text()
    adapter = inspect.getsource(tests.aeq.select_managed_predecessor_input)
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Count-retention mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, None, None), ('harmless', source + '\n# Harmless comment.\n', adapter + '\n# Harmless comment.\n', None),
        ('ignore-producer-completion', change(source, "producer.get('status') != 'succeeded'", 'False'), None,
         'PredecessorTests.test_incomplete_wrong_run_late_or_legacy_producer_refused'),
        ('ignore-consumer-attempt', change(source, "consumer.get('active_attempt_id') != context.attempt_id", 'False'), None,
         'PredecessorTests.test_revoked_consumer_and_superseded_artifact_refused'),
        ('ignore-artifact-attempt', change(source, "selected.get('attempt_id') != producer['active_attempt_id']", 'False'), None,
         'PredecessorTests.test_revoked_consumer_and_superseded_artifact_refused'),
        ('ignore-ambiguous-producer', change(source, 'if len(producers) != 1:', 'if False:'), None,
         'PredecessorTests.test_ambiguous_producer_or_artifact_refused'),
        ('omit-stage-order-projection', source, change(adapter, 'id,run_id,stage_name,sort_order,status,attempt_managed,active_attempt_id', 'id,run_id,stage_name,status,attempt_managed,active_attempt_id'),
         'BoundPredecessorTests.test_adapter_uses_bound_installation_and_complete_projections'),
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
import test_model_predecessor_inputs as tests
if sys.argv[3]:
 namespace=dict(tests.aeq.__dict__)
 exec(compile(open(sys.argv[3]).read(),'<count-adapter-control>','exec'),namespace)
 tests.aeq.select_managed_predecessor_input=FunctionType(namespace['select_managed_predecessor_input'].__code__,tests.aeq.__dict__)
name='test_model_predecessor_inputs'+('.'+sys.argv[2] if sys.argv[2] else '')
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
              'limits': 'Explicit stage and attempt selection with mocked HTTP projections. No native read proof, concurrent revocation fence, file transfer or scientific acceptance.'}
    (ROOT / 'predecessor-selection-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
