"""Fresh acquisition and retained count consumption stay distinct before execution."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_count_inputs as inputs
from test_model_skip_dispatch import aeq


class PreparationTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)
        self.source=self.root/'counts.csv';self.source.write_text('station_id,aadt\nA,17\n')
        self.output=self.root/'output';self.output.mkdir()
        self.run={'id':'synthetic-run'};self.setup={'bbox':[-121,38,-120,39]}

    def prepare(self,**kwargs):
        return aeq.prepare_assignment_count_inputs(self.run,self.setup,'synthetic-project',str(self.output),
            calibrate_requested=True,**kwargs)

    def test_fresh_acquisition_preserves_run_geography_and_calibration_choice(self):
        with patch.object(aeq,'auto_ingest_counts',return_value=str(self.source)) as acquire:
            result=self.prepare()
        acquire.assert_called_once_with(self.run,self.setup['bbox'],'synthetic-project',str(self.output),calibrate_requested=True)
        self.assertEqual(Path(result['counts_path']).read_bytes(),self.source.read_bytes())
        self.assertEqual(result['counts_status'],'retained')

    def test_explicit_missing_source_does_not_select_default(self):
        with patch.object(aeq,'auto_ingest_counts',side_effect=AssertionError('Unexpected acquisition')),patch.object(aeq,'VALIDATION_COUNTS_PATH',str(self.source)):
            result=self.prepare(counts_path_override=str(self.root/'missing.csv'))
        self.assertEqual(result['counts_status'],'unavailable')
        self.assertFalse(Path(result['counts_path']).exists())

    def test_retained_record_consumes_without_any_new_acquisition(self):
        record=inputs.retain(str(self.source),str(self.root),self.root/'retained')
        self.source.unlink()
        with patch.object(aeq,'auto_ingest_counts',side_effect=AssertionError('Retained record reacquired')):
            result=self.prepare(count_inputs_override=record)
        self.assertEqual(Path(result['counts_path']).read_bytes(),Path(record['counts_path']).read_bytes())
        self.assertNotEqual(Path(result['counts_path']).stat().st_ino,Path(record['counts_path']).stat().st_ino)

    def test_conflicting_override_refused_before_copy(self):
        record=inputs.retain(str(self.source),str(self.root),self.root/'retained')
        with patch.object(aeq,'retain_assignment_counts') as retain:
            with self.assertRaisesRegex(ValueError,'differs from the retained'):
                self.prepare(count_inputs_override=record,counts_path_override=str(self.source))
        retain.assert_not_called()
        self.assertEqual(list(self.output.iterdir()),[])


if __name__=='__main__':unittest.main()
