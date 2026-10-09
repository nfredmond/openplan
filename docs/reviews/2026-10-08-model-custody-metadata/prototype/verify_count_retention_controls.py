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
import test_model_count_inputs as tests


def main():
    source = (WORKER / 'model_count_inputs.py').read_text()
    adapter = inspect.getsource(tests.aeq.retain_assignment_counts)
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Count-retention mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, None, None), ('harmless', source + '\n# Harmless comment.\n', None, None),
        ('harmless-adapter', source, adapter + '\n# Harmless adapter comment.\n', None),
        ('return-external-source', change(source, "'counts_path': str(destination / 'counts.csv')", "'counts_path': str(source)"), None,
         'CountRetentionTests.test_original_bytes_and_sidecars_survive_source_changes'),
        ('follow-source-symlink', change(source, 'FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK', 'FLAGS = os.O_RDONLY | os.O_NONBLOCK'), None,
         'CountRetentionTests.test_symlink_hardlink_and_fifo_sources_are_refused'),
        ('accept-hardlink', change(source, 'if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:', 'if not stat.S_ISREG(before.st_mode):'), None,
         'CountRetentionTests.test_symlink_hardlink_and_fifo_sources_are_refused'),
        ('ignore-source-replacement', change(source, 'if identity(before) != identity(after) or identity(after) != identity(named):', 'if False:'), None,
         'CountRetentionTests.test_source_replacement_before_manifest_refuses_completion'),
        ('ignore-new-sidecar', change(source, "raise ValueError('Previously absent count input appeared during retention')", 'continue'), None,
         'CountRetentionTests.test_sidecar_appearance_before_manifest_refuses_completion'),
        ('foreign-destination', source, change(adapter, 'if writer.files is None or not Path(out_dir).resolve(strict=True).is_relative_to(writer.files.path):', 'if False:'),
         'BoundCountRetentionTests.test_bound_helper_refuses_foreign_destination'),
        ('restored', source, None, None)]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_count_inputs.py'
        adapter_file = Path(temp) / 'adapter.py'
        runner = """
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_count_inputs',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_model_count_inputs as tests
if sys.argv[3]:
 namespace=dict(tests.aeq.__dict__)
 exec(compile(open(sys.argv[3]).read(),'<count-adapter-control>','exec'),namespace)
 compiled=namespace['retain_assignment_counts']
 replacement=FunctionType(compiled.__code__,tests.aeq.__dict__,argdefs=compiled.__defaults__)
 replacement.__kwdefaults__=compiled.__kwdefaults__
 tests.aeq.retain_assignment_counts=replacement
name='test_model_count_inputs'+('.'+sys.argv[2] if sys.argv[2] else '')
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
              'limits': 'Native synthetic CSV/sidecars, actual assignment entry before engine open and bound manifest adapter with injected HTTP. No native manifest registration or engine/scientific acceptance.'}
    (ROOT / 'count-retention-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
