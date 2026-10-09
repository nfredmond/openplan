"""Harmless and changed-content checks for the synthetic integration fixture."""
import json
from pathlib import Path
import tempfile

from synthetic_assessed_instrument import prepare, check_bindings

cases = []
changes = {
    'wrong-run': ('comparison_basis', ('model_run_id',), 'different', 'Instrument scope differs'),
    'wrong-method': ('assessment', ('method',), 'activitysim', 'Instrument scope differs'),
    'promoted-outcome': ('assessment', ('scientific_outcome',), 'pass', 'Synthetic outcome promoted'),
    'changed-comparison-output': ('comparison_basis', ('model_output_artifact', 'sha256'), '0'*64, 'Comparison output hash differs'),
    'changed-comparison': ('comparison_basis', ('fixture_extra',), True, 'Comparison logical hash differs'),
    'changed-diagnosis': ('diagnosis', ('assessment_sha256',), '0'*64, 'Diagnosis assessment hash differs'),
}
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    controls = ('normal', 'harmless', *changes, 'changed-input-bundle', 'changed-match-audit', 'changed-output', 'restored')
    for control in controls:
        paths = prepare(root/control, 'synthetic-run', 'aequilibrae')
        reason = None
        if control == 'harmless': (root/control/'unrelated-note.txt').write_text('Harmless fixture note')
        if control in changes:
            role, keys, replacement, reason = changes[control]
            value = json.loads(paths[role].read_text()); target = value
            for key in keys[:-1]: target = target[key]
            target[keys[-1]] = replacement
            paths[role].write_text(json.dumps(value))
        elif control in ('changed-input-bundle', 'changed-match-audit', 'changed-output'):
            role = {'changed-input-bundle': 'input_bundle', 'changed-match-audit': 'match_audit', 'changed-output': 'model_output'}[control]
            paths[role].write_bytes(paths[role].read_bytes() + b' ')
            reason = 'Evaluated bytes differ from publication bytes'
        try:
            check_bindings(paths, 'aequilibrae', 'synthetic-run')
        except AssertionError as error:
            assert reason is not None and str(error) == reason, (control, str(error))
        else:
            assert reason is None, 'Changed content escaped: ' + control
        cases.append({'control': control, 'expected_behavior_observed': True})
report = {'cases': cases, 'limits': ['Synthetic fixture bindings only; not a general preparation validator or source acceptance']}
Path(__file__).with_name('synthetic-instrument-binding-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
