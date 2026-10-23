"""Synthetic source conservation and missingness checks."""
import csv
import gzip
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lodes_wac_inputs import aggregate_wac


class WacInputs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'wac.gz'
        self.row = {'w_geocode': '010010001001001', 'C000': 21,
                    **{f'CNS{i:02d}': 1 for i in range(1, 21)}}
        self.row['CNS07'] = 2

    def write(self, rows):
        with gzip.open(self.path, 'wt') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def test_counts_and_outside_scope(self):
        self.write([self.row, {**self.row, 'w_geocode': '010010001001002'},
                    {**self.row, 'w_geocode': '020010001001001'}])
        totals, record = aggregate_wac(self.path, {'01001000100'})
        self.assertEqual(totals, {'01001000100': {'total_jobs': 42, 'retail_jobs': 4,
            'health_jobs': 2, 'education_jobs': 2, 'accommodation_jobs': 2, 'govt_jobs': 2}})
        self.assertEqual(record, {'selected_tracts': 1, 'selected_blocks': 2,
            'selected_jobs': 42, 'outside_jobs': 21, 'source_blocks': 3})

    def test_missing_tract_is_not_zero(self):
        self.write([self.row])
        with self.assertRaisesRegex(ValueError, 'coverage'):
            aggregate_wac(self.path, {'01001000100', '02001000100'})

    def test_invalid_sources_refuse(self):
        cases = [([self.row, self.row], 'duplicate'),
                 ([{**self.row, 'w_geocode': 'bad'}], 'Invalid'),
                 ([{**self.row, 'CNS01': -1, 'C000': 19}], 'Negative'),
                 ([{**self.row, 'C000': 20}], 'conservation'),
                 ([{k: v for k, v in self.row.items() if k != 'CNS01'}], 'columns')]
        for rows, reason in cases:
            with self.subTest(reason=reason):
                self.write(rows)
                with self.assertRaisesRegex(ValueError, reason):
                    aggregate_wac(self.path, {'01001000100'})


if __name__ == '__main__':
    unittest.main()
