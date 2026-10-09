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
import test_managed_state_handoff as tests


def main():
    source = (WORKER / 'model_handoff_files.py').read_text()
    adapter = inspect.getsource(tests.aeq.retain_managed_predecessor_state)
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Count-retention mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, None, None), ('harmless', source + '\n# Harmless comment.\n', adapter + '\n# Harmless comment.\n', None),
        ('ignore-foreign-reference', source, change(adapter, 'if selected.get("file_url") != "local://" + str(expected) or expected.resolve(strict=True) != expected:', 'if False:'),
         'ManagedStateTests.test_foreign_path_refused_before_copy'),
        ('ignore-copy-change', source, change(adapter, 'if hashlib.sha256(content).hexdigest() != selected["content_hash"] or len(content) != selected["file_size_bytes"]:', 'if False:'),
         'ManagedStateTests.test_copy_changed_before_decode_is_refused'),
        ('ignore-duplicate-keys', source, change(adapter, 'if key in result:', 'if False:'),
         'ManagedStateTests.test_duplicate_keys_refused'),
        ('accept-nonfinite-state', source, change(adapter, 'raise ValueError("Nonfinite predecessor state value")', 'return None'),
         'ManagedStateTests.test_nonfinite_state_refused'),
        ('erase-producer-provenance', source, change(adapter, '"artifact_id": selected["id"]', '"artifact_id": None'),
         'ManagedStateTests.test_preserves_original_bytes_and_paths_with_provenance'),
        ('restored', source, None, None)]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_handoff_files.py'
        adapter_file = Path(temp) / 'adapter.py'
        runner = """
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_handoff_files',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_managed_state_handoff as tests
if sys.argv[3]:
 namespace=dict(tests.aeq.__dict__)
 exec(compile(open(sys.argv[3]).read(),'<count-adapter-control>','exec'),namespace)
 tests.aeq.retain_managed_predecessor_state=FunctionType(namespace['retain_managed_predecessor_state'].__code__,tests.aeq.__dict__)
name='test_managed_state_handoff'+('.'+sys.argv[2] if sys.argv[2] else '')
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
              'limits': 'Actual selected-state helper and independent local files; mocked HTTP. No native joined recovery, execution-state mapping, project transfer, normal dispatch or scientific acceptance.'}
    (ROOT / 'managed-state-handoff-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
