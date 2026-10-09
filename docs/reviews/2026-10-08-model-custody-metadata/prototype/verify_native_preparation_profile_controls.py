"""Serial native transactions for profile agreement and refusal controls."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
proof = root / 'verify_native_preparation_profile.py'
output = Path(os.environ['OPENPLAN_PREPARATION_PROFILE_CONTROLS'])
output.mkdir(mode=0o700, parents=True, exist_ok=False)
results = []
for control in ('baseline', 'harmless', 'mismatch', 'incomplete', 'skip-comparison',
                'network-metadata','network-mismatch','skip-network-comparison','restored'):
    env = dict(os.environ, OPENPLAN_PREPARATION_PROFILE_CONTROL=control,
               OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT=str(output/control))
    result = subprocess.run([sys.executable, '-B', str(proof)], env=env,
                            capture_output=True, text=True, timeout=120)
    log = result.stdout + result.stderr
    (output/(control+'.log')).write_text(log)
    failure = 'Prepared input defect reached assignment without refusal' if control in ('skip-comparison','skip-network-comparison') else None
    matched = result.returncode == 0 if failure is None else result.returncode != 0 and failure in log
    results.append({'control': control, 'returncode': result.returncode, 'expected_failure': failure, 'matched': matched})
    if not matched: raise AssertionError(f'{control}: {log[-4000:]}')
report = {'proof_sha256': hashlib.sha256(proof.read_bytes()).hexdigest(),
    'handoff_sha256': hashlib.sha256((root/'verify_native_preparation_handoff.py').read_bytes()).hexdigest(),
    'controls': results, 'limits': 'Native PostgreSQL and PostgREST transactions for both methods, with synthetic prepared inputs and solver objects. Declared profile comparison does not establish full live solver settings, network or demand equivalence, normal dispatch or scientific acceptance.'}
(output/'controls.json').write_text(json.dumps(report, indent=2)+'\n')
(root/'native-preparation-profile-controls.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
