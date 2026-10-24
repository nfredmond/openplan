import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import openmatrix as omx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from activitysim_geographic_subset import subset_bundle, descriptor


class GeographicSubsetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.parent = self.root / 'parent'
        self.parent.mkdir()
        (self.parent / 'configs').mkdir()
        (self.parent / 'configs/settings.yaml').write_text('recode_columns: zero-based\n')
        (self.parent / 'skims').mkdir()
        (self.parent / 'manifest.json').write_text('{"full":true}\n')
        self.write('land_use.csv', ['zone_id', 'TOTPOP'], [[5, 2], [2, 1], [9, 1]])
        self.write('households.csv', ['household_id', 'home_zone_id', 'hhsize'], [[10, 5, 2], [20, 2, 1], [30, 9, 1]])
        self.write('persons.csv', ['person_id', 'household_id'], [[1, 10], [2, 20], [3, 10], [4, 30]])
        with omx.open_file(str(self.parent / 'skims/mtc_skims.omx'), 'w') as f:
            f['time'] = np.arange(9).reshape(3, 3)
        self.dest = self.root / 'subset'

    def write(self, name, fields, rows):
        with (self.parent / name).open('w', newline='') as f:
            w = csv.writer(f); w.writerow(fields); w.writerows(rows)

    def run_subset(self, excluded=(2,), **kwargs):
        return subset_bundle(self.parent, self.dest, excluded, reason=kwargs.get('reason', 'missing service'), source=kwargs.get('source', 'published policy'))

    def test_subset_preserves_order_whole_households_and_parent(self):
        before = {str(p): descriptor(p) for p in self.parent.rglob('*') if p.is_file()}
        result = self.run_subset()
        self.assertEqual(result['retained_zone_ids'], [5, 9])
        self.assertEqual(result['retained_matrix_positions'], [0, 2])
        self.assertEqual(result['households'], {'parent': 3, 'retained': 2, 'excluded': 1})
        self.assertEqual(result['persons'], {'parent': 4, 'retained': 3, 'excluded': 1})
        with (self.dest / 'households.csv').open() as f:
            self.assertEqual([r['household_id'] for r in csv.DictReader(f)], ['10', '30'])
        with (self.dest / 'persons.csv').open() as f:
            self.assertEqual([r['person_id'] for r in csv.DictReader(f)], ['1', '3', '4'])
        with omx.open_file(str(self.dest / 'skims/mtc_skims.omx'), 'r') as f:
            np.testing.assert_array_equal(f['time'][:], [[0, 2], [6, 8]])
        self.assertEqual(before, {str(p): descriptor(p) for p in self.parent.rglob('*') if p.is_file()})
        self.assertEqual(result['files']['persons.csv'], descriptor(self.dest / 'persons.csv'))
        self.assertEqual((self.dest / 'configs/settings.yaml').read_bytes(), (self.parent / 'configs/settings.yaml').read_bytes())

    def test_unknown_zone_refused(self):
        with self.assertRaisesRegex(ValueError, 'Unknown excluded'):
            self.run_subset([22])

    def test_all_zones_refused(self):
        with self.assertRaisesRegex(ValueError, 'All zones'):
            self.run_subset([2, 5, 9])

    def test_unknown_home_refused(self):
        self.write('households.csv', ['household_id', 'home_zone_id', 'hhsize'], [[10, 22, 2], [20, 2, 1], [30, 9, 1]])
        with self.assertRaisesRegex(ValueError, 'Invalid household'):
            self.run_subset()

    def test_unknown_person_household_refused(self):
        self.write('persons.csv', ['person_id', 'household_id'], [[1, 100]])
        with self.assertRaisesRegex(ValueError, 'Invalid person'):
            self.run_subset()

    def test_household_size_refused(self):
        self.write('persons.csv', ['person_id', 'household_id'], [[1, 10], [2, 20], [4, 30]])
        with self.assertRaisesRegex(ValueError, 'Household person counts'):
            self.run_subset()

    def test_existing_destination_refused(self):
        self.dest.mkdir()
        with self.assertRaisesRegex(ValueError, 'Destination already'):
            self.run_subset()

    def test_source_required(self):
        with self.assertRaisesRegex(ValueError, 'reason and source'):
            self.run_subset(source='')

    def test_matrix_shape_refused(self):
        with omx.open_file(str(self.parent / 'skims/mtc_skims.omx'), 'w') as f:
            f['time'] = np.zeros((2, 2))
        with self.assertRaisesRegex(ValueError, 'Matrix shape'):
            self.run_subset()

    def test_duplicate_person_refused(self):
        self.write('persons.csv', ['person_id', 'household_id'], [[1, 10], [1, 10], [2, 20], [4, 30]])
        with self.assertRaisesRegex(ValueError, 'Invalid person'):
            self.run_subset()

    def test_duplicate_zone_refused(self):
        self.write('land_use.csv', ['zone_id'], [[5], [2], [2]])
        with self.assertRaisesRegex(ValueError, 'Duplicate parent'):
            self.run_subset()

    def test_duplicate_household_refused(self):
        self.write('households.csv', ['household_id', 'home_zone_id', 'hhsize'], [[10, 5, 2], [10, 5, 2]])
        with self.assertRaisesRegex(ValueError, 'Invalid household'):
            self.run_subset()

    def test_empty_retained_population_refused(self):
        self.write('households.csv', ['household_id', 'home_zone_id', 'hhsize'], [[20, 2, 1]])
        self.write('persons.csv', ['person_id', 'household_id'], [[2, 20]])
        with self.assertRaisesRegex(ValueError, 'No resident households'):
            self.run_subset()

    def test_mapped_parent_refused(self):
        with omx.open_file(str(self.parent / 'skims/mtc_skims.omx'), 'a') as f:
            f.create_mapping('zone_id', [5, 2, 9])
        with self.assertRaisesRegex(ValueError, 'positional parent OMX'):
            self.run_subset()

if __name__ == '__main__':
    unittest.main()
