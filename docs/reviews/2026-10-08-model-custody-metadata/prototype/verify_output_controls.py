"""Exercise managed stage-write controls without editing the implementation checkout."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_attempt_writer.py').read_text()
    changes = [
        ('mutable-output-identity', "'operation': operation, 'name': name}", "'operation': operation, 'name': name, 'payload': payload}", 'test_changed_named_artifact_bytes_do_not_create_another_request'),
        ('null-to-zero-replacement', "'operation': operation, 'name': name}", "'operation': operation, 'name': name, 'payload': payload}", 'test_null_kpi_cannot_be_replaced_with_zero'),
        ('ignore-workspace', 'if workspace_id is not None and workspace_id != ctx.workspace_id:', 'if False:', 'test_foreign_workspace_refuses_without_transport'),
    ]
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None)]
    for name, anchor, replacement, test in changes:
        if source.count(anchor) != 1:
            raise AssertionError('Mutation anchor changed: ' + name)
        cases.append((name, source.replace(anchor, replacement), test))
    cases.append(('restored', source, None))
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_attempt_writer.py'
        runner = '''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_attempt_writer',sys.argv[1])
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)
name='test_model_attempt_outputs'+('.OutputTests.'+sys.argv[2] if sys.argv[2] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
sys.exit(0 if result.wasSuccessful() else 1)
'''
        for name, body, test in cases:
            candidate.write_text(body)
            result = subprocess.run([sys.executable, '-B', '-c', runner, str(candidate), test or ''],
                                    cwd=WORKER, text=True, capture_output=True, timeout=30)
            if test:
                if result.returncode != 1 or 'FAIL: ' + test not in result.stderr:
                    raise AssertionError('Targeted behavior did not fail: ' + name + '\n' + result.stderr)
            elif result.returncode:
                raise AssertionError('Expected passing control failed: ' + name + '\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': test})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': records,
              'limits': 'Real journals and both bound worker output adapters; injected HTTP. No native output HTTP, normal managed claim dispatch, filesystem or scientific acceptance.'}
    (ROOT / 'output-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
