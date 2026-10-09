"""Selected-project handoff faults, without modifying checkout sources."""
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
import test_managed_project_handoff as tests


def main():
    source = (WORKER / 'model_project_inputs.py').read_text()
    adapter = inspect.getsource(tests.aeq.retain_managed_predecessor_project)
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Project-handoff mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, None, None), ('harmless', source + '\n# Harmless comment.\n', adapter + '\n# Harmless comment.\n', None),
        ('ignore-foreign-path', source, change(adapter, 'if selected.get("file_url") != "local://" + str(expected) or expected.resolve(strict=True) != expected:', 'if False:'),
         'ManagedProjectHandoffTests.test_foreign_manifest_is_refused_before_file_copy'),
        ('ignore-database-checks', source, change(adapter, 'if retained["database_checks"] != metadata.get("database_checks"):', 'if False:'),
         'ManagedProjectHandoffTests.test_contradictory_database_checks_stop_registration'),
        ('ignore-readiness', source, change(adapter, 'or metadata.get("execution_ready") is not False', 'or False'),
         'ManagedProjectHandoffTests.test_promoted_readiness_refused_before_copy'),
        ('erase-producer-attempt', source, change(adapter, '"attempt_id": selected["attempt_id"], "manifest_sha256"', '"attempt_id": None, "manifest_sha256"'),
         'ManagedProjectHandoffTests.test_selected_project_is_copied_and_consumer_provenance_registered'),
        ('register-as-producer-output', source, change(adapter, '"artifact_type": "model_project_consumption"', '"artifact_type": "model_project_inputs"'),
         'ManagedProjectHandoffTests.test_selected_project_is_copied_and_consumer_provenance_registered'),
        ('restored', source, None, None)]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_project_inputs.py'
        adapter_file = Path(temp) / 'adapter.py'
        runner = """
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_project_inputs',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_managed_project_handoff as tests
if sys.argv[3]:
 namespace=dict(tests.aeq.__dict__)
 exec(compile(open(sys.argv[3]).read(),'<project-adapter-control>','exec'),namespace)
 tests.aeq.retain_managed_predecessor_project=FunctionType(namespace['retain_managed_predecessor_project'].__code__,tests.aeq.__dict__)
name='test_managed_project_handoff'+('.'+sys.argv[2] if sys.argv[2] else '')
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
                    raise AssertionError('Targeted project fault did not fail: ' + name + '\n' + result.stderr)
            elif result.returncode:
                raise AssertionError('Project baseline failed: ' + name + '\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': target})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'worker_sha256': hashlib.sha256((WORKER / 'main.py').read_bytes()).hexdigest(), 'controls': records,
              'limits': 'Actual selected-project join and independent local files, mocked transport. No native joined recovery, complete state mapping, closure enforcement, normal dispatch or scientific acceptance.'}
    (ROOT / 'managed-project-handoff-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
