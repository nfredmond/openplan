"""Synthetic evidence, never real station calibration or scientific acceptance."""
from __future__ import annotations
import copy
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [os.environ.get('S1_MODULE_DIR', str(ROOT / 'workers/aequilibrae_worker')),
                str(ROOT / 'scripts/modeling'), str(ROOT / 'scripts/modeling/tests')]
import count_observation_uncertainty as uncertainty
import model_validation_core_v5 as core
import test_validation_instrument_v2 as fixtures


def fixture(count_type='short_duration'):
    item = fixtures.observation(direction='two_way')
    item['source'] = {'artifact_sha256': 'a' * 64}
    item['direction_lane_carriageway'].update(direction='combined', lane='all_lanes', carriageway='combined')
    item['vehicle_basis']['vehicle_class'] = 'all_motor_vehicles'
    item['qa'] = {'status': 'accepted'}
    item['measurement'] = {
        'count_type': count_type, 'method': 'source_derived',
        'duration': {'start': '2024-04-09T00:00:00Z', 'end': '2024-04-11T00:00:00Z', 'complete_hours': 48},
        'factors': {'method': 'validated_cluster', 'group_id': 'fixture-group',
                    'seasonal': 'documented', 'day_of_week': 'documented', 'axle': 'not_applied_vehicle_counter'},
        'missing_data_method': 'publisher_documented', 'estimation_method': 'publisher_documented',
    }
    return item


def evidence(item, model=uncertainty.PUBLISHED):
    return {
        'schema': uncertainty.EVIDENCE_SCHEMA,
        'observation_sha256': uncertainty.digest(item),
        'source_artifact_sha256': item['source']['artifact_sha256'],
        'dimensions': uncertainty.observation_dimensions(item),
        'measurement': copy.deepcopy(item['measurement']),
        'citation': {'id': 'synthetic-only', 'url': 'https://example.test/fixture',
                     'title': 'Synthetic fixture, not public evidence', 'locator': 'table 1 page 1'},
        'review_status': 'source_verified', 'interval_scope': 'station_aadt',
        'coverage_probability': .95, 'applicability': 'same_station_or_validated_factor_group',
        'independent_of_evaluated_model': True, 'error_components': ['sampling_and_expansion'],
        'error_model_id': model, 'bounds': {'lower': 80, 'upper': 130},
        'error_definition': '(estimate-reference)/reference',
        'relative_error_quantiles': {'p025': -.2, 'p975': .25},
        'calibration': {'artifact_sha256': 'c' * 64, 'sampling_design': 'independent held-out calibration sites',
                        'count_duration_hours': 48, 'factor_group_id': 'fixture-group',
                        'factor_assignment_method': 'validated_cluster'},
    }


def payload(record):
    return json.dumps(record, allow_nan=False).encode()


def change_path(record, path, value):
    parts = path.split('.')
    for part in parts[:-1]:
        record = record[part]
    record[parts[-1]] = value


# Each fixture changes a scientific fact, not the expected implementation branch.
OBSERVATION_REFUSALS = {
    'count_type_unavailable': ('measurement.count_type', 'unknown'),
    'invalid_center': ('estimate.center', -1),
    'source_hash_unavailable': ('source.artifact_sha256', 'unknown'),
    'year_unavailable': ('time_basis.year', 'unknown'),
    'not_annual_aadt': ('time_basis.day_basis', 'weekday_average'),
    'period_unavailable': ('time_basis.period', 'peak_hour'),
    'direction_unavailable': ('direction_lane_carriageway.direction', 'unknown'),
    'lane_unavailable': ('direction_lane_carriageway.lane', 'unknown'),
    'carriageway_unavailable': ('direction_lane_carriageway.carriageway', 'unknown'),
    'vehicle_class_unavailable': ('vehicle_basis.vehicle_class', 'unknown'),
    'not_vehicle_counts': ('vehicle_basis.unit', 'pce'),
    'qa_unavailable': ('qa.status', 'failed'),
    'duration_unavailable': ('measurement.duration.complete_hours', 0),
    'count_dates_unavailable': ('measurement.duration.start', 'unknown'),
    'factor_metadata_unavailable': ('measurement.factors.group_id', 'unknown'),
}
EVIDENCE_REFUSALS = {
    'interval_evidence_schema': ('schema', 'unsupported'),
    'observation_binding_mismatch': ('observation_sha256', '0' * 64),
    'source_binding_mismatch': ('source_artifact_sha256', 'b' * 64),
    'evidence_dimensions_mismatch': ('dimensions.year', 2023),
    'evidence_process_mismatch': ('measurement.duration.complete_hours', 24),
    'citation_unverified': ('citation.locator', '[VERIFY]'),
    'evidence_not_verified': ('review_status', 'unverified'),
    'not_station_interval': ('interval_scope', 'factor_group_mean'),
    'unsupported_coverage': ('coverage_probability', .90),
    'applicability_unproved': ('applicability', 'generic_national_range'),
    'dependent_evidence': ('independent_of_evaluated_model', False),
    'error_components_unavailable': ('error_components', []),
    'invalid_bounds': ('bounds.lower', 105),
    'unsupported_error_model': ('error_model_id', 'national_plus_minus_28_percent'),
}


class Intervals(unittest.TestCase):
    def assert_refusal(self, item, source, reason):
        result = uncertainty.attach_observation_interval(item, source)['observation_uncertainty']
        self.assertIn(reason, result['reasons'])
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['bounds'])

    def test_every_count_type_preserves_original_and_custody(self):
        for kind in ('continuous', 'short_duration', 'estimated', 'modeled'):
            item = fixture(kind)
            original = copy.deepcopy(item)
            result = uncertainty.attach_observation_interval(item, payload(evidence(item)))
            annotation = result.pop('observation_uncertainty')
            self.assertEqual(annotation['status'], 'available')
            self.assertEqual(annotation['bounds'], {'lower': 80, 'upper': 130})
            self.assertEqual(annotation['error_model_id'], uncertainty.PUBLISHED)
            self.assertEqual(annotation['citation_id'], 'synthetic-only')
            self.assertEqual(len(annotation['evidence_sha256']), 64)
            self.assertEqual(item, original)
            self.assertEqual(result, original)
            self.assertEqual(item['evidence_grade'], 'C')
            self.assertEqual(item['estimate']['source_supported_bounds'], 'unknown')

    def test_duration_specific_quantiles_invert_error_denominator(self):
        for hours in (24, 48, 72, 168):
            item = fixture()
            item['measurement']['duration']['complete_hours'] = hours
            item['measurement']['duration']['end'] = (datetime.fromisoformat('2024-04-09T00:00:00+00:00') + timedelta(hours=hours)).isoformat()
            record = evidence(item, uncertainty.QUANTILES)
            record['calibration']['count_duration_hours'] = hours
            result = uncertainty.attach_observation_interval(item, payload(record))['observation_uncertainty']
            self.assertEqual(result['status'], 'available')
            self.assertEqual(result['bounds'], {'lower': 80, 'upper': 125})

    def test_duration_dates_invalid(self):
        item = fixture()
        item['measurement']['duration']['end'] = '2024-04-08T00:00:00Z'
        self.assert_refusal(item, payload(evidence(item)), 'duration_dates_invalid')

    def test_count_year_mismatch(self):
        item = fixture()
        item['time_basis']['year'] = 2023
        self.assert_refusal(item, payload(evidence(item)), 'count_year_mismatch')

    def test_computed_bounds_invalid(self):
        item = fixture()
        item['estimate']['center'] = 1e308
        record = evidence(item, uncertainty.QUANTILES)
        record['relative_error_quantiles']['p025'] = -.9
        self.assert_refusal(item, payload(record), 'computed_bounds_invalid')

    def test_missing_evidence_has_no_default(self):
        item = fixture()
        self.assert_refusal(item, None, 'interval_evidence_unavailable')

    def test_invalid_json(self):
        self.assert_refusal(fixture(), b'not JSON', 'interval_evidence_invalid_json')

    def test_continuous_missing_data_method(self):
        item = fixture('continuous')
        item['measurement']['missing_data_method'] = 'unknown'
        self.assert_refusal(item, payload(evidence(item)), 'missing_data_method_unavailable')

    def test_estimated_method(self):
        for kind in ('estimated', 'modeled'):
            item = fixture(kind)
            item['measurement']['estimation_method'] = 'unknown'
            self.assert_refusal(item, payload(evidence(item)), 'estimation_method_unavailable')

    def test_quantiles_require_short_duration(self):
        item = fixture('continuous')
        self.assert_refusal(item, payload(evidence(item, uncertainty.QUANTILES)), 'quantiles_require_short_duration')

    def test_invalid_quantiles(self):
        for low, high in ((-1, .25), (.1, .25), (-.1, -.2), (True, .2)):
            item = fixture()
            record = evidence(item, uncertainty.QUANTILES)
            record['relative_error_quantiles'] = {'p025': low, 'p975': high}
            self.assert_refusal(item, payload(record), 'invalid_error_quantiles')

    def test_error_definition(self):
        item = fixture()
        record = evidence(item, uncertainty.QUANTILES)
        record['error_definition'] = '(estimate-reference)/estimate'
        self.assert_refusal(item, payload(record), 'error_definition_mismatch')

    def test_calibration_scope(self):
        for field, value in [('count_duration_hours', 24), ('factor_group_id', 'other'),
                             ('factor_assignment_method', 'nearest_station'), ('artifact_sha256', 'unknown'),
                             ('sampling_design', 'unknown')]:
            item = fixture()
            record = evidence(item, uncertainty.QUANTILES)
            record['calibration'][field] = value
            self.assert_refusal(item, payload(record), 'calibration_scope_mismatch')

    def test_bounds_nonfinite_negative_reversed_or_missing(self):
        for bounds in ({'lower': -1, 'upper': 130}, {'lower': 130, 'upper': 80},
                       {'lower': None, 'upper': 130}, {'lower': True, 'upper': 130}):
            item = fixture()
            record = evidence(item)
            record['bounds'] = bounds
            self.assert_refusal(item, payload(record), 'invalid_bounds')

    def test_raw_and_excess_are_separate_and_zero_is_retained(self):
        item = fixture()
        source = payload(evidence(item))
        comparison = uncertainty.observation_dimensions(item)
        for modeled, residual, excess in ((90, -10, 0), (150, 50, 20), (0, -100, 80)):
            row = uncertainty.uncertainty_residual(item, modeled, comparison, evidence_bytes=source)
            self.assertEqual(row['status'], 'available')
            self.assertEqual(row['raw_signed_residual'], residual)
            self.assertEqual(row['interval_excess_error'], excess)
            self.assertEqual(row['interval_excess_percent_error'], excess)
            self.assertEqual(row['inside_interval'], excess == 0)

    def test_all_alignment_dimensions_refuse_without_changing_raw(self):
        item = fixture()
        for field in uncertainty.DIMENSIONS:
            comparison = uncertainty.observation_dimensions(item)
            comparison[field] = 'different'
            row = uncertainty.uncertainty_residual(item, 150, comparison, evidence_bytes=payload(evidence(item)))
            self.assertIn('alignment_' + field, row['reasons'])
            self.assertEqual(row['raw_signed_residual'], 50)
            self.assertIsNone(row['interval_excess_error'])

    def test_invalid_modeled_value(self):
        item = fixture()
        for modeled in (-1, float('nan'), float('inf'), True, 'unknown'):
            row = uncertainty.uncertainty_residual(item, modeled, uncertainty.observation_dimensions(item), evidence_bytes=payload(evidence(item)))
            self.assertIn('invalid_modeled_value', row['reasons'])
            self.assertIsNone(row['interval_excess_error'])

    def test_existing_annotation_is_not_trusted(self):
        item = fixture()
        item['observation_uncertainty'] = {'status': 'available', 'bounds': {'lower': 0, 'upper': 1e10}}
        self.assert_refusal(item, None, 'interval_evidence_unavailable')

    def test_opt_in_wrapper_preserves_default_and_refuses_synthetic_aadt(self):
        item = fixture()
        match = {'observation_id': item['observation_id'], 'status': 'matched',
                 'selected_link_ids': ['a'], 'direction_aggregation': 'two_way'}
        basis = fixtures.basis(item)
        basis['observation_facts'][item['observation_id']]['uncertainty_comparison'] = uncertainty.observation_dimensions(item)
        kwargs = dict(assessment_id='fixture', input_bundle_sha256=fixtures.HASH, created_at='fixed')
        baseline = core.assess_validation([item], fixtures.audit(item, match), basis, {'a': 150}, **kwargs)
        result = core.assess_validation_with_uncertainty([item], fixtures.audit(item, match), basis, {'a': 150},
                    interval_evidence_by_id={item['observation_id']: payload(evidence(item))}, **kwargs)
        diagnostic = result.pop('uncertainty_analysis')
        self.assertEqual(result, baseline)
        row = diagnostic['observation_results'][0]
        self.assertIn('model_quantity_not_aadt', row['reasons'])
        self.assertIsNone(row['interval_excess_error'])
        self.assertEqual(diagnostic['available'], 0)
        self.assertEqual(result['scientific_outcome'], 'inconclusive')
        basis['model_base_year'] = 'unknown'
        missing = core.assess_validation_with_uncertainty([item], fixtures.audit(item, match), basis, {},
                    interval_evidence_by_id={}, **kwargs)['uncertainty_analysis']['observation_results'][0]
        self.assertIn('rules_v5_basis_unproved', missing['reasons'])
        self.assertIn('match_unavailable', missing['reasons'])
        self.assertIsNone(missing['interval_excess_error'])


def make_observation_test(reason, path, value):
    def test(self):
        item = fixture()
        change_path(item, path, value)
        self.assert_refusal(item, payload(evidence(item)), reason)
    return test


def make_evidence_test(reason, path, value):
    def test(self):
        item = fixture()
        record = evidence(item)
        change_path(record, path, value)
        self.assert_refusal(item, payload(record), reason)
    return test


for reason, (path, value) in OBSERVATION_REFUSALS.items():
    setattr(Intervals, 'test_refuse_' + reason, make_observation_test(reason, path, value))
for reason, (path, value) in EVIDENCE_REFUSALS.items():
    setattr(Intervals, 'test_refuse_' + reason, make_evidence_test(reason, path, value))

if __name__ == '__main__':
    unittest.main(verbosity=2)
