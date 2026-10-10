"""Assignment output handoff faults, without modifying checkout sources."""
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
import test_managed_output_handoff as tests


def main():
    source = (WORKER / 'model_package_inputs.py').read_text()
    adapter = inspect.getsource(tests.aeq.retain_managed_predecessor_outputs)
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Output-handoff mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, None, None), ('harmless', source + '\n# Harmless comment.\n', adapter + '\n# Harmless comment.\n', None),
        ('ignore-foreign-path', source, change(adapter, 'if selected.get("file_url") != "local://" + str(expected) or expected.resolve(strict=True) != expected:', 'if False:'),
         'OutputHandoffTests.test_foreign_output_reference_refused'),
        ('ignore-producer-bytes', change(source, "if actual['entries'] != manifest['entries']:", 'if False:'), None,
         'OutputHandoffTests.test_changed_nested_count_record_refuses_consumption'),
        ('erase-producer-attempt', source, change(adapter, '"attempt_id": selected["attempt_id"], "manifest_sha256"', '"attempt_id": None, "manifest_sha256"'),
         'OutputHandoffTests.test_selected_outputs_preserve_all_files_and_provenance'),
        ('register-as-producer-output', source, change(adapter, '"artifact_type": "model_output_consumption"', '"artifact_type": "model_assignment_outputs"'),
         'OutputHandoffTests.test_selected_outputs_preserve_all_files_and_provenance'),
        ('restored', source, None, None)]
    capture=inspect.getsource(tests.managed.AttemptWriter.retain_assignment_outputs)
    cases.insert(-1,('ignore-capture-ownership',source,change(capture,"if self.files is None or not Path(directory).resolve(strict=True).is_relative_to(self.files.path):",'if False:'),'OutputHandoffTests.test_foreign_capture_source_refused'))
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_package_inputs.py'
        adapter_file = Path(temp) / 'adapter.py'
        runner = """
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_package_inputs',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_managed_output_handoff as tests
if sys.argv[3]:
 import textwrap
 text=textwrap.dedent(open(sys.argv[3]).read())
 capture=text.startswith('def retain_assignment_outputs(')
 context=tests.managed.__dict__ if capture else tests.aeq.__dict__
 namespace=dict(context)
 exec(compile(text,'<output-handoff-control>','exec'),namespace)
 name='retain_assignment_outputs' if capture else 'retain_managed_predecessor_outputs'
 setattr(tests.managed.AttemptWriter if capture else tests.aeq,name,FunctionType(namespace[name].__code__,context))
name='test_managed_output_handoff'+('.'+sys.argv[2] if sys.argv[2] else '')
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
                    raise AssertionError('Targeted output fault did not fail: ' + name + '\n' + result.stderr)
            elif result.returncode:
                raise AssertionError('Output baseline failed: ' + name + '\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': target})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'worker_sha256': hashlib.sha256((WORKER / 'main.py').read_bytes()).hexdigest(),
              'writer_sha256': hashlib.sha256((WORKER / 'model_attempt_writer.py').read_bytes()).hexdigest(), 'controls': records,
              'limits': 'Actual selected assignment-output join with byte-preserved count metadata and synthetic skim bytes; mocked transport. No native receipt recovery, engine file-format validation, output working paths, full dispatch or scientific acceptance.'}
    (ROOT / 'managed-output-handoff-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
