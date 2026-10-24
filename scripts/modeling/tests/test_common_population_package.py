"""Supplied package construction checks, without Census or native assignment."""
from __future__ import annotations

import copy
import csv
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
for path in (ROOT / 'workers' / 'aequilibrae_worker', ROOT / 'scripts' / 'modeling', Path(__file__).parent):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import pandas as pd
import test_common_population as supplied
import model_common_population_package as package
import common_population as common
import data_pipeline as pipeline


class CommonPopulationPackageTests(unittest.TestCase):
    def setUp(self):
        self.fixture = supplied.CommonPopulationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.source.write_text(json.dumps({
            "run_name": "Original selected population", "custody": "legacy_stage_snapshot",
            "selection_coverage": {"candidate_tracts": 3, "matched_tracts": 2, "unmatched_tracts": 1,
                                   "geography_index_truncated": True, "source_label": "Original coverage"},
        }))
        for row in self.fixture.zones:
            row['jobs_source'] = 'lodes_wac'
        supplied.write_csv(self.fixture.zone_file, self.fixture.zones)
        descriptor = self.fixture.retain()
        self.population = self.fixture.read(descriptor)
        self.frame = pd.DataFrame(self.fixture.zones)
        self.prepared = {'mode': 'reuse', 'custody': 'legacy_stage_snapshot', 'population': self.population,
                         'zone_rows': self.fixture.zones, 'source': {'fixture': 'scoped-source'}}
        self.output = self.fixture.root / 'package'
        self.output.mkdir()

    def write_package(self):
        loaded = package.prepare_reused_population(self.output, self.prepared)
        zones = package.apply_realized_counts(self.frame, loaded)
        zones.to_csv(self.output / 'zone_attributes.csv', index=False)
        record = {'directory': 'common_population', 'manifest': loaded['manifest'],
                  'custody': 'legacy_stage_snapshot', **package.identity(loaded)}
        (self.output / 'manifest.json').write_text(json.dumps({'common_population': record}))
        return zones

    def test_actual_counts_replace_all_person_marginals_by_zone_identity(self):
        zones = package.apply_realized_counts(self.frame.iloc[::-1], self.population)
        self.assertEqual(zones['zone_id'].tolist(), [9, 7])
        self.assertEqual(zones['est_population'].tolist(), [0, 1])
        self.assertEqual(zones['households'].tolist(), [0, 1])
        self.assertEqual(zones['worker_residents'].tolist(), [0, 1])
        self.assertEqual(zones['source_est_population'].tolist(), [100, 100])
        self.assertEqual(zones['population_universe'].tolist(), ['household_residents'] * 2)
        od = pipeline.build_daily_od_matrix(zones)
        self.assertEqual(int(od.loc[9].sum()), 0)
        self.assertGreater(int(od.loc[7].sum()), 0)
        self.assertLess(int(od.to_numpy().sum()), 30)

    def test_reuse_preserves_exact_raw_files_and_fails_changed_assignment_demographics(self):
        zones = self.write_package()
        actual = package.read_package_population(self.output)
        self.assertEqual(actual, {**package.identity(self.population), 'population_custody': 'legacy_stage_snapshot'})
        for role, path in common.ROLES.items():
            self.assertEqual((self.output / 'common_population' / path).read_bytes(),
                             (self.fixture.directory / path).read_bytes(), role)
        zones.loc[0, 'est_population'] = 100
        zones.to_csv(self.output / 'zone_attributes.csv', index=False)
        with self.assertRaisesRegex(ValueError, 'Assignment demographics differ'):
            package.read_package_population(self.output)

    def test_package_record_and_raw_population_are_both_verified(self):
        self.write_package()
        path = self.output / 'manifest.json'
        record = json.loads(path.read_text())
        record['common_population']['population_basis_digest'] = '0' * 64
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'identity differs'):
            package.read_package_population(self.output)
        path.write_text(json.dumps({'common_population': {'directory': '../retained'}}))
        with self.assertRaisesRegex(ValueError, 'fixed retained role'):
            package.read_package_population(self.output)

    def test_refuses_changed_zone_map_before_replacing_counts(self):
        changed = self.frame.copy()
        changed.loc[0, 'GEOID'] = '01001000300'
        with self.assertRaisesRegex(ValueError, 'selected zones'):
            package.apply_realized_counts(changed, self.population)

    def test_original_selection_coverage_rejects_missing_or_untyped_counts(self):
        for note in (None, {"candidate_tracts": True}, {"geography_index_truncated": 1},
                     {"candidate_tracts": 3, "matched_tracts": 3, "unmatched_tracts": 1}):
            with self.subTest(note=note), self.assertRaises(ValueError):
                package.validate_selection_coverage(note)

    def test_supplied_coverage_keeps_absent_true_false_and_malformed_distinct(self):
        payload = {'version': pipeline.ZONE_ATTRIBUTE_PAYLOAD_VERSION,
                   'source': {'id': 'fixture-source', 'vintage': 2023},
                   'tables': {'demographics': {'status': 'supplied', 'table': {
                       'measures': ['est_population'], 'rows': {'01001000100': [100]}}}}}
        rows, note = pipeline.supplied_measure_table(payload, 'demographics')
        self.assertEqual(rows, {'01001000100': {'est_population': 100.0}})
        self.assertNotIn('geography_index_truncated', package.validate_selection_coverage(note))
        for value in (True, False):
            with self.subTest(value=value):
                payload['source']['geography_index_truncated'] = value
                _, note = pipeline.supplied_measure_table(payload, 'demographics')
                self.assertIs(package.validate_selection_coverage(note)['geography_index_truncated'], value)
        for value in (None, 0, 1, 'false'):
            with self.subTest(malformed=value), self.assertRaisesRegex(ValueError, 'truncation flag'):
                payload['source']['geography_index_truncated'] = value
                _, note = pipeline.supplied_measure_table(payload, 'demographics')
                package.validate_selection_coverage(note)

    def test_package_custody_is_consumed_and_cannot_be_changed_or_omitted(self):
        self.write_package()
        path = self.output / 'manifest.json'
        original = json.loads(path.read_bytes())
        for custody in ('managed_attempt', 'unknown', None):
            record = copy.deepcopy(original)
            record['common_population']['custody'] = custody
            path.write_text(json.dumps(record))
            with self.subTest(custody=custody), self.assertRaisesRegex(ValueError, 'custody differs'):
                package.read_package_population(self.output)

    def test_legacy_package_population_is_unassessed(self):
        (self.output / 'manifest.json').write_text(json.dumps({'version': 'legacy'}))
        self.assertEqual(package.read_package_population(self.output), {})

    def test_reuse_skips_geography_population_and_jobs_fetch_before_od(self):
        with mock.patch.object(pipeline, 'fetch_tracts_for_study_area', side_effect=AssertionError('tract fetch')), \
             mock.patch.object(pipeline, 'fetch_lodes_jobs_by_tract', side_effect=AssertionError('job fetch')), \
             mock.patch.object(pipeline, '_refine_zones_to_block_groups', side_effect=AssertionError('refine zones')), \
             mock.patch.object(pipeline, 'fetch_lodes_od_by_tract_pair', return_value=({}, [], [])), \
             mock.patch('synthetic_population.synthesize_study_area', side_effect=AssertionError('population refit')):
            result = pipeline.generate_package(str(self.output), bbox=(-88, 31, -86, 33),
                                               population_input=self.prepared)
        self.assertEqual(result['total_population'], 1)
        self.assertEqual(result['total_households'], 1)
        self.assertEqual(result['demographics_provenance'].get('candidate_tracts'), 3)
        self.assertEqual(result['demographics_provenance'].get('unmatched_tracts'), 1)
        self.assertIs(result['demographics_provenance'].get('geography_index_truncated'), True)
        self.assertEqual(result['demographics_provenance']['published_demographics']['source_label'], 'Original coverage')
        self.assertEqual(result['common_population']['population_basis_digest'],
                         package.identity(self.population)['population_basis_digest'])
        self.assertEqual(package.read_package_population(self.output),
                         {**package.identity(self.population), 'population_custody': 'legacy_stage_snapshot'})

    def test_reuse_refuses_geography_change_without_refitting(self):
        with self.assertRaisesRegex(pipeline.DataPipelineError, 'zone geography differs'):
            pipeline.generate_package(str(self.output), bbox=(-88, 31, -86, 33),
                                      zone_geography='block_group', population_input=self.prepared)

    def test_source_zero_population_does_not_remove_retained_selected_zone(self):
        prepared = copy.deepcopy(self.prepared)
        frame = package.retained_zone_frame(prepared)
        self.assertEqual(frame['zone_id'].tolist(), [7, 9])
        transformed = package.apply_realized_counts(frame, self.population)
        self.assertEqual(transformed['est_population'].tolist(), [1, 0])


if __name__ == '__main__':
    unittest.main()
