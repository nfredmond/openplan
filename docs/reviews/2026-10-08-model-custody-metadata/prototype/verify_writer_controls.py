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
        ('erase-existing-log', 'state = {**self.state}', "state = {'status': 'running', 'log_tail': None, 'error': None}", 'test_partial_progress_and_failure_preserve_last_confirmed_log'),
        ('omit-log-projection', 'active_attempt_id,log_tail,error_message,model_runs', 'active_attempt_id,error_message,model_runs', 'test_partial_progress_and_failure_preserve_last_confirmed_log'),
        ('allow-missing-log', "log = stage['log_tail']", "log = stage.get('log_tail')", 'test_missing_existing_log_refuses_without_a_write'),
        ('ignore-pending-command', 'if journal.pending(self.directory, self.context.destination):', 'if False:', 'test_existing_pending_command_stops_new_write'),
        ('ignore-terminal-stop', "self.stopped = state['status'] != 'running'", 'self.stopped = False', 'test_completion_uses_database_receipt_time_without_parent_patch'),
        ('cross-stage-patch', 'if stage_id != self.context.stage_id:', 'if False:', 'test_wrong_stage_or_unsupported_patch_refuses_before_transport'),
        ('cross-thread-writer', 'if self.stopped or self.thread_id != threading.get_ident():', 'if self.stopped:', 'test_binding_is_scoped_and_both_worker_adapters_use_command'),
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
name='test_model_attempt_writer'+('.WriterTests.'+sys.argv[2] if sys.argv[2] else '')
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
              'limits': 'Real journals and both bound worker stage adapters; injected HTTP. No native database, normal managed claim dispatch, output or filesystem ownership acceptance.'}
    (ROOT / 'writer-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
