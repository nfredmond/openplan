"""Test local ownership faults using temporary modules, leaving source intact."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    workspace = (WORKER / 'model_attempt_workspace.py').read_text()
    writer = (WORKER / 'model_attempt_writer.py').read_text()
    def change(source, anchor, replacement):
        if source.count(anchor) != 1:
            raise AssertionError('Workspace mutation anchor changed')
        return source.replace(anchor, replacement)
    reused = change(workspace,
        "raise ValueError('Attempt directory already exists; reconcile instead of reusing it') from None", 'pass')
    reused = change(reused, "os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,\n                             0o600", "os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW,\n                             0o600")
    cases = [
        ('baseline', 'model_attempt_workspace', workspace, None),
        ('harmless', 'model_attempt_workspace', workspace + '\n# Harmless comment.\n', None),
        ('reuse-attempt', 'model_attempt_workspace', reused, 'WorkspaceTests.test_exclusive_identity_and_private_owner_record'),
        ('follow-run-symlink', 'model_attempt_workspace', change(workspace,
            'FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW', 'FLAGS = os.O_RDONLY | os.O_DIRECTORY'),
            'WorkspaceTests.test_symlinked_run_refuses_without_writing_foreign_directory'),
        ('ignore-owner-record', 'model_attempt_workspace', change(workspace,
            'if stream.read(len(self.owner_bytes) + 1) != self.owner_bytes:', 'if False:'),
            'WorkspaceTests.test_modified_or_linked_owner_refuses_state_publication'),
        ('redirect-state-publication', 'model_attempt_workspace', change(workspace,
            "os.replace(name, 'state.json', src_dir_fd=descriptor, dst_dir_fd=descriptor)", "os.replace('/proc/self/fd/' + str(descriptor) + '/' + name, self.path / 'state.json')"),
            'WorkspaceTests.test_rename_during_replace_cannot_redirect_state_write'),
        ('cross-run-workspace', 'model_attempt_writer', change(writer,
            'if run_id != self.context.run_id:', 'if False:'),
            'WorkspaceBindingTests.test_activitysim_uses_attempt_directory_and_refuses_other_run'),
        ('skip-owner-recheck', 'model_attempt_writer', change(writer,
            'if self.files is not None:', 'if False:'),
            'WorkspaceBindingTests.test_changed_owner_stops_later_database_write'),
        ('overwrite-predecessor-state', 'model_attempt_workspace', change(workspace,
            "os.link(name, 'predecessor_state.json', src_dir_fd=descriptor,\n                        dst_dir_fd=descriptor, follow_symlinks=False)",
            "os.replace(name, 'predecessor_state.json', src_dir_fd=descriptor, dst_dir_fd=descriptor)\n                temporary = False\n                return {'path': str(self.path / 'predecessor_state.json'), 'sha256': hashlib.sha256(content).hexdigest(), 'size_bytes': len(content)}"),
            'WorkspaceTests.test_exclusive_identity_and_private_owner_record'),
        ('wrong-state-hash', 'model_attempt_writer', change(writer,
            "'content_hash': retained['sha256']", "'content_hash': '0' * 64"),
            'WorkspaceBindingTests.test_bound_state_registers_exact_original_bytes_before_completion'),
        ('restored', 'model_attempt_workspace', workspace, None),
    ]
    records = []
    with tempfile.TemporaryDirectory() as temp:
        runner = '''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location(sys.argv[1],sys.argv[2])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
name='test_model_attempt_workspace'+('.'+sys.argv[3] if sys.argv[3] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
sys.exit(0 if result.wasSuccessful() else 1)
'''
        for name, module, body, test in cases:
            path = Path(temp) / (module + '.py')
            path.write_text(body)
            result = subprocess.run([sys.executable, '-B', '-c', runner, module, str(path), test or ''],
                                    cwd=WORKER, text=True, capture_output=True, timeout=30)
            if test:
                if result.returncode != 1 or 'FAIL: ' + test.split('.')[1] not in result.stderr:
                    raise AssertionError('Targeted workspace behavior did not fail: ' + name + '\n' + result.stderr)
            elif result.returncode:
                raise AssertionError('Expected passing workspace control failed: ' + name + '\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': test})
    report = {'workspace_sha256': hashlib.sha256(workspace.encode()).hexdigest(),
              'writer_sha256': hashlib.sha256(writer.encode()).hexdigest(), 'controls': records,
              'limits': 'Native local directories, descriptor publication, process competition and bound allocation hooks. Not engine confinement, predecessor handoff, native model execution or whole-host restart.'}
    (ROOT / 'workspace-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
