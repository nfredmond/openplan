"""Exercise retained file-copy controls without editing the implementation checkout."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_handoff_files.py').read_text()
    changes = [
        ('ignore-content-hash', 'if size != size_bytes or digest.hexdigest() != sha256:', 'if size != size_bytes:', 'test_wrong_hash_never_publishes_a_destination'),
        ('follow-final-symlink', 'os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,', 'os.O_RDONLY | os.O_NONBLOCK,', 'test_source_symlink_swap_is_refused_before_foreign_open'),
        ('follow-parent-symlink', 'DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW', 'DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY', 'test_parent_symlink_swap_is_refused_before_foreign_open'),
        ('ignore-source-replacement', 'if _snapshot(before) != _snapshot(after) or _snapshot(after) != _snapshot(named):', 'if False:', 'test_source_replacement_after_read_refuses_publication'),
        ('accept-linked-source', 'if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:', 'if not stat.S_ISREG(before.st_mode):', 'test_hard_link_and_fifo_sources_are_refused'),
    ]
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None)]
    for name, anchor, replacement, test in changes:
        if source.count(anchor) != 1:
            raise AssertionError('Mutation anchor changed: ' + name)
        cases.append((name, source.replace(anchor, replacement), test))
    cases.append(('restored', source, None))
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_handoff_files.py'
        runner = '''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_handoff_files',sys.argv[1])
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)
name='test_model_handoff_files'+('.HandoffFileTests.'+sys.argv[2] if sys.argv[2] else '')
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
              'limits': 'Native file copies and actual ActivitySim bound destination checks with injected admission HTTP. No native producer authorization, complete AequilibraE predecessor handoff, model execution or scientific acceptance.'}
    (ROOT / 'handoff-file-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
