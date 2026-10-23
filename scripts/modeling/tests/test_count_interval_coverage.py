from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [os.environ.get('S1_AUDIT_DIR', str(ROOT / 'scripts/modeling')),
                str(ROOT / 'workers/aequilibrae_worker'), str(ROOT / 'scripts/modeling')]
import audit_count_interval_coverage as coverage
import count_validation


def stations():
    base = {'label': 'Fixture', 'facility_name': 'Test Road', 'candidate_model_names': 'Test Road',
            'candidate_link_types': 'primary', 'bbox_min_lon': '-1', 'bbox_max_lon': '1',
            'bbox_min_lat': '-1', 'bbox_max_lat': '1', 'direction': 'two_way', 'count_year': '2024'}
    return [{**base, 'station_id': str(i), 'observed_volume': str(value)} for i, value in enumerate((100, 110, 120))]


def features():
    return [{'link_id': 1, 'name': 'Test Road', 'link_type': 'primary', 'lon': 0, 'lat': 0,
             'volume': 0, 'is_one_way': False}]


class Coverage(unittest.TestCase):
    def test_eligibility_parity_on_synthetic_inputs(self):
        for values in ((100, 110, 120), (100, 500, 900), (0, 100, 100), (100, 100, 100)):
            source = stations()
            for row, value in zip(source, values):
                row['observed_volume'] = value
            actual = coverage.eligible_station_rows(source, features())
            for value in (0, 500, 10000):
                modeled = [{**features()[0], 'volume': value}]
                reference = count_validation.validate_against_counts(source, modeled)['results']
                self.assertEqual([row['match_status'] for row in actual], [row['match_status'] for row in reference])
        source = stations()
        source[0]['station_role'] = 'ramp'
        source[1]['candidate_link_types'] = 'motorway'
        actual = coverage.eligible_station_rows(source, features())
        reference = count_validation.validate_against_counts(source, features())['results']
        self.assertEqual([row['match_status'] for row in actual], [row['match_status'] for row in reference])

    def test_refuse_assignment_volumes(self):
        with self.assertRaisesRegex(ValueError, 'refuses assignment volumes'):
            coverage.eligible_station_rows(stations(), [{**features()[0], 'volume': 1}])

    def run_audit(self, mutate=lambda r: None, wrong_registry=False, change_db=False, geography='00000'):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'inputs.zip'
            member_data = {f'{geography}/counts/published_counts.csv': b'station_id,observed_volume\n1,100\n',
                           f'{geography}/work/aeq_project/project_database.sqlite': b'synthetic network bytes'}
            with zipfile.ZipFile(archive, 'w') as bundle:
                for name, value in member_data.items():
                    bundle.writestr(name, value)
                bundle.writestr('forbidden-model-output.csv', b'NEVER OPEN')
            registry = {'partition': 'original five development counties only', 'study_id': 'fixture',
                        'archive': {'path': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()},
                        'geographies': [{'id': geography}],
                        'members': [{'member': name, 'sha256': hashlib.sha256(value).hexdigest(), 'bytes': len(value)}
                                    for name, value in member_data.items()]}
            mutate(registry)
            path = root / 'registry.json'
            path.write_text(json.dumps(registry))
            digest = '0' * 64 if wrong_registry else hashlib.sha256(path.read_bytes()).hexdigest()
            def load(path, lookup, field):
                self.assertEqual(lookup, {})
                if change_db:
                    path.write_bytes(b'changed')
                return features()
            original_read = zipfile.ZipFile.read
            opened = []
            def read(instance, name, *args, **kwargs):
                opened.append(name)
                self.assertIn(name, member_data)
                return original_read(instance, name, *args, **kwargs)
            with patch.object(coverage, 'load_project_db_features', load), patch.object(zipfile.ZipFile, 'read', read):
                result = coverage.audit(path, digest)
            self.assertEqual(set(opened), set(member_data))
            self.assertEqual(result['assignment_output_files_opened'], 0)
            self.assertEqual(result['residuals_computed'], 0)
            return result

    def test_input_only_audit(self):
        self.run_audit()

    def test_registry_hash(self):
        with self.assertRaisesRegex(ValueError, 'registry hash mismatch'):
            self.run_audit(wrong_registry=True)

    def test_partition(self):
        with self.assertRaisesRegex(ValueError, 'authorized development'):
            self.run_audit(lambda r: r.update(partition='holdout'))

    def test_archive_hash(self):
        with self.assertRaisesRegex(ValueError, 'archive hash mismatch'):
            self.run_audit(lambda r: r['archive'].update(sha256='0' * 64))

    def test_geography_path(self):
        with self.assertRaisesRegex(ValueError, 'geography key'):
            self.run_audit(geography='nonnumeric-fixture')

    def test_member_hash(self):
        with self.assertRaisesRegex(ValueError, 'retained member mismatch'):
            self.run_audit(lambda r: r['members'][0].update(sha256='0' * 64))

    def test_network_unchanged(self):
        with self.assertRaisesRegex(ValueError, 'network input changed'):
            self.run_audit(change_db=True)

if __name__ == '__main__':
    unittest.main(verbosity=2)
