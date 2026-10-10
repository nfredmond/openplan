"""Native source registration controls use separate retained database clones."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
preparation = os.environ.get('OPENPLAN_SOURCE_REGISTRATION_KIND') == 'preparation'
output = Path(os.environ['OPENPLAN_SOURCE_REGISTRATION_CONTROLS'])
output.mkdir(mode=0o700, parents=True, exist_ok=False)
cases = []
for method, control in [('aequilibrae', 'normal'), ('activitysim', 'normal'),
                        ('activitysim', 'harmless'), ('activitysim', 'drop-write'),
                        ('activitysim', 'wrong-request'), ('activitysim', 'bypass-stop'),
                        ('activitysim', 'restored')]:
    name = method + '-' + control
    result = subprocess.run([sys.executable, '-B', str(HERE / 'verify_activity_handoff_copy_http.py')],
        env={**os.environ, 'OPENPLAN_STAGE_PUBLICATION_CONTROL':'source-registration',
             'OPENPLAN_SOURCE_REGISTRATION_CONTROL':control, 'OPENPLAN_SOURCE_LOSS_METHOD':method,
             'OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT':str(output / name)},
        capture_output=True, text=True, timeout=90)
    (output / (name + '.log')).write_text(result.stdout + result.stderr)
    reason = {'drop-write':'Native source reply loss did not stop writer',
              'wrong-request':'Fresh source receipt recovery failed',
              'bypass-stop':'Stopped source writer accepted completion'}.get(control)
    if reason:
        assert result.returncode != 0 and 'AssertionError: ' + reason in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr
        report = json.loads((output / name / 'activity-stage-publication.json').read_text())
        assert report['gateway_removed'] is True
        check = next(row for row in report['controls'] if row['control'] == ('native-preparation-registration' if preparation else 'native-source-registration'))
        assert check['registered_manifests'] == (1 if method == 'aequilibrae' else 2)
        assert check['fresh_process_exact_receipt_recovered'] and check['native_tables_unchanged'] == 6
        assert check['storage_uploaded'] is False and check['execution_resumed'] is False
    cases.append({'method':method, 'control':control, 'returncode':result.returncode, 'expected_behavior_observed':True})
report = {'cases':cases, 'proof_sha256':hashlib.sha256((HERE / 'verify_native_source_registration.py').read_bytes()).hexdigest(),
          'limits':'Native artifact registration, local object hashes and separate-process receipt recovery over synthetic fixtures. No Storage upload, native model execution, independent preparation, normal dispatch or scientific acceptance.'}
content = json.dumps(report, indent=2) + '\n'
(output / 'controls.json').write_text(content)
(HERE / ('native-preparation-registration-controls.json' if preparation else 'native-source-registration-controls.json')).write_text(content)
print(content)
