"""Exercise admission controls without editing the implementation checkout."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_attempt_invocation.py').read_text()
    changes = [
        ('recovered-claim-replay',
         "raise ReconciliationRequired('Saved claim requires reconciliation; receipt recovery cannot start computation')",
         'return', 'test_lost_claim_recovery_never_admits_handler'),
        ('revoked-ownership', "if not snapshot['owns_stage']:", 'if False:',
         'test_revoked_or_unconfirmed_ownership_never_runs_or_writes_failure'),
        ('missing-durable-entry', '_enter(directory, command, workspace_id)', 'pass',
         'test_claim_and_admission_precede_transport_and_callback'),
    ]
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None)]
    for name, anchor, replacement, test in changes:
        if source.count(anchor) != 1:
            raise AssertionError('Mutation anchor changed: ' + name)
        cases.append((name, source.replace(anchor, replacement), test))
    cases.append(('restored', source, None))
    records = []
    with tempfile.TemporaryDirectory() as temp:
        candidate = Path(temp) / 'model_attempt_invocation.py'
        runner = '''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_attempt_invocation',sys.argv[1])
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)
name='test_model_attempt_invocation'+('.InvocationTests.'+sys.argv[2] if sys.argv[2] else '')
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
              'limits': 'Real local SQLite, competing threads and a fresh process; injected HTTP. No native database, cross-host admission, filesystem ownership or normal dispatcher acceptance.'}
    (ROOT / 'invocation-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
