"""Replacement entry points must preserve host launch records and logs."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'workers/activitysim_worker'))
sys.path.insert(0,str(ROOT/'scripts/modeling'))
import runtime
import run_behavioral_demand_prototype as pipeline


class HostRecordPreservationTests(unittest.TestCase):
    def check_preservation(self, entry):
        for alias in (False,True):
            with self.subTest(dangling_record_alias=alias), tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                output=root/'pipeline'
                run=output/'runtime'
                stage=run/'stages/030-run-activitysim'
                stage.mkdir(parents=True)
                log=stage/'activitysim_stdout.log'
                log.write_bytes(b'retained host output\n')
                records=stage/'host_supervision'
                if alias:
                    records.symlink_to(root/'missing-records',target_is_directory=True)
                else:
                    records.mkdir()
                    (records/'launch-reserved.json').write_text('{"synthetic":true}\n')
                screening=root/'screening'
                screening.mkdir()
                with patch.object(pipeline,'build_activitysim_input_bundle',side_effect=AssertionError('Retained pipeline was replaced')):
                    with self.assertRaisesRegex(RuntimeError,'Retained host custody'):
                        if entry=='runtime':
                            runtime.prepare_runtime_directory(bundle_dir=root,runtime_dir=str(run),run_label=None,force=True)
                        else:
                            pipeline.run_behavioral_demand_prototype(screening_run_dir=str(screening),output_root=str(output),force=True)
                self.assertEqual(log.read_bytes(),b'retained host output\n')
                if alias:
                    self.assertTrue(records.is_symlink())
                    self.assertEqual(records.readlink(),root/'missing-records')
                else:
                    self.assertEqual((records/'launch-reserved.json').read_text(),'{"synthetic":true}\n')

    def test_runtime_force_preserves_host_records(self):
        self.check_preservation('runtime')

    def test_pipeline_force_preserves_host_records(self):
        self.check_preservation('pipeline')


if __name__=='__main__':
    unittest.main()
