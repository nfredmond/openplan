"""Real count files and actual validation entry point, without model execution."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from worker_import_for_tests import import_worker_main
import model_credibility

main = import_worker_main()


class CountInputTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.default = self.root / 'default.csv'
        self.default.write_text('station_id,year,lon,lat,aadt\nDEFAULT,2026,-121,39,999\n')
        self.database = self.root / 'network.sqlite'
        self.output = self.root / 'volumes.csv'
        self.database.touch()
        self.output.touch()
        for setting, value in (('COUNT_VALIDATION_ENABLED', True), ('VALIDATION_COUNTS_PATH', str(self.default))):
            context = patch.object(main, setting, value)
            context.start()
            self.addCleanup(context.stop)

    def validate(self, path):
        return main._run_count_validation(str(self.database), str(self.output),
            (-122, 38, -120, 40), counts_path=path)

    def test_missing_recorded_source_never_uses_available_default(self):
        with patch.object(main.count_validation, 'describe_count_coverage',
                          side_effect=AssertionError('A substitute count source reached comparison')):
            result = self.validate(str(self.root / 'lost.csv'))
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['stations_total'])
        self.assertIsNone(result['stations_matched'])
        self.assertIsNone(result['median_ape'])
        self.assertIsNone(result['screening_gate'])
        self.assertIsNone(result['coverage']['covered'])
        self.assertIn('No substitute', result['method'])
        evidence = model_credibility.summarize_independent_validation(result, None)
        self.assertFalse(evidence['supports_claim_tier'])
        self.assertIsNone(evidence['stations_matched'])

    def test_absent_assignment_path_remains_unavailable(self):
        with patch.object(main.count_validation, 'describe_count_coverage',
                          side_effect=AssertionError('Unrecorded counts reached comparison')):
            result = self.validate(None)
        self.assertEqual(result['status'], 'unavailable')
        self.assertIn('No assignment count file was recorded', result['method'])

    def test_explicit_source_reaches_coverage_with_its_original_year(self):
        recorded = self.root / 'recorded.csv'
        recorded.write_text('station_id,year,lon,lat,aadt\nRECORDED,2020,-121,39,123\n')
        coverage = {'covered': False, 'status': 'out_of_area', 'reason': 'Synthetic coverage refusal'}
        with patch.object(main.count_validation, 'describe_count_coverage', return_value=coverage) as describe:
            result = self.validate(str(recorded))
        self.assertEqual(describe.call_args.args[0][0]['station_id'], 'RECORDED')
        self.assertEqual(describe.call_args.args[0][0]['year'], '2020')
        self.assertEqual(result['coverage'], coverage)
        self.assertIsNone(result['screening_gate'])

    def test_default_is_usable_when_explicitly_recorded_by_assignment(self):
        with patch.object(main.count_validation, 'describe_count_coverage',
                          return_value={'covered': False, 'status': 'out_of_area'}) as describe:
            self.validate(str(self.default))
        self.assertEqual(describe.call_args.args[0][0]['station_id'], 'DEFAULT')

    def test_disabled_validation_does_not_read_or_substitute_counts(self):
        with patch.object(main, 'COUNT_VALIDATION_ENABLED', False), patch.object(
            main.count_validation, 'describe_count_coverage', side_effect=AssertionError('Disabled validation read counts')):
            self.assertIsNone(self.validate(None))


if __name__ == '__main__':
    unittest.main()
