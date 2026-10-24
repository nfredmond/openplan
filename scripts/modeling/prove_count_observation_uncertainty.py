"""Mutate temporary source copies; never edit scientific artifacts or originals."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / 'workers/aequilibrae_worker'
MODELING = ROOT / 'scripts/modeling'
MODULE = WORKER / 'count_observation_uncertainty.py'
CORE = WORKER / 'model_validation_core_v5.py'
AUDIT = MODELING / 'audit_count_interval_coverage.py'
TEST = MODELING / 'tests/test_count_observation_uncertainty.py'
AUDIT_TEST = MODELING / 'tests/test_count_interval_coverage.py'
sys.path[:0] = [str(TEST.parent), str(MODELING), str(WORKER)]
from test_count_observation_uncertainty import OBSERVATION_REFUSALS, EVIDENCE_REFUSALS


def main(output):
    originals = {p: p.read_bytes() for p in (MODULE, CORE, AUDIT)}
    controls = []
    def run(label, path, old, new, test=TEST, selector=None, survives=False):
        text = originals[path].decode()
        if text.count(old) != 1:
            raise ValueError(f'{label}: mutation anchor count {text.count(old)}')
        with tempfile.TemporaryDirectory(prefix='s1-mutation-') as directory:
            target = Path(directory)
            for source, content in originals.items():
                (target / source.name).write_bytes(content)
            (target / path.name).write_text(text.replace(old, new, 1))
            environment = {**os.environ, 'S1_MODULE_DIR': str(target), 'S1_AUDIT_DIR': str(target),
                           'PYTHONDONTWRITEBYTECODE': '1'}
            command = [sys.executable, '-B', str(test)] + ([selector] if selector else [])
            result = subprocess.run(command, capture_output=True, text=True, env=environment, timeout=60)
            combined = result.stdout + result.stderr
            correct = result.returncode == 0 if survives else (result.returncode == 1 and 'AssertionError' in combined and 'errors=' not in combined)
            controls.append({'control': label, 'expected': 'survive' if survives else 'assertion_failure',
                             'observed_exit': result.returncode, 'correct': correct,
                             'output_sha256': hashlib.sha256(combined.encode()).hexdigest(),
                             'test_selector': selector or 'whole focused suite'})
            if not correct:
                print(combined)
                raise AssertionError(f'Unexpected mutation outcome: {label}')

    run('harmless_comment_all_interval_tests', MODULE, '\nSCHEMA = ', '\n# Harmless custody comment.\nSCHEMA = ', survives=True)
    run('harmless_comment_all_coverage_tests', AUDIT, 'ROOT = ', '# Harmless audit comment.\nROOT = ', test=AUDIT_TEST, survives=True)
    reasons = set(OBSERVATION_REFUSALS) | (set(EVIDENCE_REFUSALS) - {'unsupported_error_model'}) | {
        'missing_data_method_unavailable', 'estimation_method_unavailable', 'quantiles_require_short_duration',
        'invalid_error_quantiles', 'error_definition_mismatch', 'calibration_scope_mismatch',
        'duration_dates_invalid', 'count_year_mismatch', 'computed_bounds_invalid',
    }
    for reason in sorted(reasons):
        run(reason, MODULE, 'if not condition:', f'if not condition and reason != {reason!r}:')
    for reason in ('interval_evidence_unavailable', 'interval_evidence_invalid_json', 'unsupported_error_model'):
        run(reason, MODULE, f'reasons.append("{reason}")', 'pass')
    run('each_alignment_dimension', MODULE,
        'if not _known(dimensions[field]) or dimensions[field] != comparison.get(field):',
        'if False:', selector='Intervals.test_all_alignment_dimensions_refuse_without_changing_raw')
    run('invalid_modeled_value', MODULE, 'if modeled is None or modeled < 0:', 'if False:',
        selector='Intervals.test_invalid_modeled_value')
    run('raw_residual_arithmetic', MODULE, 'signed = modeled - center if', 'signed = modeled + center if',
        selector='Intervals.test_raw_and_excess_are_separate_and_zero_is_retained')
    run('quantile_inversion', MODULE, 'center / (1 + high_error), center / (1 + low_error)',
        'center * (1 - high_error), center * (1 - low_error)', selector='Intervals.test_duration_specific_quantiles_invert_error_denominator')
    run('grade_preservation', MODULE, 'result.pop("observation_uncertainty", None)',
        'result.pop("observation_uncertainty", None)\n    result["evidence_grade"] = "A"',
        selector='Intervals.test_every_count_type_preserves_original_and_custody')
    for reason in ('rules_v5_basis_unproved', 'match_unavailable', 'model_quantity_not_aadt'):
        run(reason, CORE, f'diagnostic["reasons"].append("{reason}")', 'pass',
            selector='Intervals.test_opt_in_wrapper_preserves_default_and_refuses_synthetic_aadt')
    audit_guards = [
        ('assignment_volume_refusal', "if any(feature.get('volume', 0) != 0 for feature in features):", 'Coverage.test_refuse_assignment_volumes'),
        ('registry_hash', "if hashlib.sha256(raw).hexdigest() != registry_sha256:", 'Coverage.test_registry_hash'),
        ('partition', "if registry.get('partition') != 'original five development counties only':", 'Coverage.test_partition'),
        ('archive_hash', "if archive_hash != archive['sha256']:", 'Coverage.test_archive_hash'),
        ('geography_path', "if not isinstance(identifier, str) or not identifier.isdigit():", 'Coverage.test_geography_path'),
        ('member_hash', "if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:", 'Coverage.test_member_hash'),
        ('network_read_only', "if hashlib.sha256(database.read_bytes()).hexdigest() != members[paths[1]]['sha256']:", 'Coverage.test_network_unchanged'),
    ]
    for label, guard, selector in audit_guards:
        run(label, AUDIT, guard, 'if False:', test=AUDIT_TEST, selector=selector)
    run('shared_link_eligibility', AUDIT, "if low > 0 and high / low <= 1 + count_validation.DEFAULT_READY_MEDIAN_APE / 100:",
        'if True:', test=AUDIT_TEST, selector='Coverage.test_eligibility_parity_on_synthetic_inputs')
    restored = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}
    if any(p.read_bytes() != content for p, content in originals.items()):
        raise AssertionError('Original bytes changed')
    record = {'schema': 'openplan.s1-uncertainty-mutation-controls.v1', 'python': sys.version,
              'controls': controls, 'survivors': sum(c['expected'] == 'survive' for c in controls),
              'intended_assertion_failures': sum(c['expected'] == 'assertion_failure' for c in controls),
              'skips': [],
              'original_bytes_unchanged': True, 'source_sha256': restored,
              'blind_categories': ['Publisher authenticity and calibration transfer', 'Real station precision',
                                   'Holdout independence', 'Browser, hosted and database delivery']}
    output.write_text(json.dumps(record, indent=2, sort_keys=True) + '\n')
    print(json.dumps({k: record[k] for k in ('survivors', 'intended_assertion_failures', 'skips')}))

if __name__ == '__main__':
    main(Path(sys.argv[1]))
