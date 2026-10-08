"""Acquisition history cannot stand in for presently readable count bytes."""
import builtins
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_credibility as credibility


class CountAvailabilityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.counts = self.root / 'counts.csv'
        self.record = self.root / 'count_source_status.json'
        self.record.write_text(json.dumps({'status': 'available', 'dataset_id': 'original', 'vintage': '2020'}))

    def summary(self, path=None):
        return credibility.summarize_count_source(str(path or self.counts), str(self.root))

    def assert_unavailable(self, result, file_status):
        self.assertEqual(result['status'], 'source_unavailable')
        self.assertEqual(result['recorded_acquisition_status'], 'available')
        self.assertEqual(result['file_status'], file_status)
        self.assertIsNone(result['eligible_rows'])
        self.assertEqual(result['dataset_id'], 'original')
        self.assertEqual(result['vintage'], '2020')
        self.assertTrue(result['error'])
        self.assertIn(result['error'], result['limitation'])

    def test_missing_file_cannot_inherit_available_acquisition(self):
        before = self.record.read_bytes()
        self.assert_unavailable(self.summary(), 'unavailable')
        self.assertEqual(self.record.read_bytes(), before)

    def test_available_acquisition_without_a_recorded_path_is_unavailable(self):
        self.assert_unavailable(credibility.summarize_count_source(None, str(self.root)), 'not_recorded')

    def test_read_error_cannot_inherit_available_acquisition(self):
        self.counts.write_text('station_id,count_year\nA,2020\n')
        real_open = builtins.open
        def open_without_counts(path, *args, **kwargs):
            if str(path) == str(self.counts):
                raise PermissionError('Synthetic denied input')
            return real_open(path, *args, **kwargs)
        with patch.object(builtins, 'open', side_effect=open_without_counts):
            self.assert_unavailable(self.summary(), 'read_failed')

    def test_invalid_encoding_is_a_read_failure(self):
        self.counts.write_bytes(b'\xff\xfe')
        self.assert_unavailable(self.summary(), 'read_failed')

    def test_readable_source_preserves_original_metadata_and_row_count(self):
        self.counts.write_text('station_id,count_year\nA,2020\n')
        result = self.summary()
        self.assertEqual(result['status'], 'available')
        self.assertEqual(result['file_status'], 'readable')
        self.assertEqual(result['eligible_rows'], 1)
        self.assertEqual(result['measurement_dates'], ['2020'])
        self.assertIsNone(result['error'])

    def test_explicit_failure_categories_are_not_overwritten(self):
        for status in ('source_unavailable', 'geography_unsupported', 'no_eligible_sections', 'no_traffic_found'):
            self.record.write_text(json.dumps({'status': status}))
            result = self.summary()
            self.assertEqual(result['status'], status)
            self.assertEqual(result['recorded_acquisition_status'], status)
            self.assertEqual(result['file_status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
