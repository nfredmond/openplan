"""Actual legacy record builder reuses retained computation without claim promotion."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from worker_import_for_tests import import_worker_main
main=import_worker_main()


class RetainedLegacyComputation(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.output=self.root/'volumes.csv';self.output.write_bytes(b'synthetic volumes')
        self.args=dict(run_id='11111111-1111-4111-8111-111111111111',stage_id='22222222-2222-4222-8222-222222222222',journal_dir=str(self.root/'journal'),model_output_artifact_id='33333333-3333-4333-8333-333333333333',model_output_artifact_type='link_volumes',link_volumes_csv=str(self.output),counts_path=None,validation={},run_row={'workspace_id':'synthetic-workspace'},verified_engine_stamp={},assignment_profile={},assignment_profile_digest_value='a'*64,network_settings={},network_settings_digest='b'*64,network_state_digest='c'*64,population_vintage='unknown')
        for p in (patch.object(main,'SUPABASE_URL','http://127.0.0.1:54321'),patch.dict(main.os.environ,{'OPENPLAN_DEPLOYMENT_ID':'synthetic'}),patch.object(main,'sb_get_scenario_role',return_value='unknown')):
            p.start();self.addCleanup(p.stop)

    def test_exact_records_reused_and_detached(self):
        with patch.object(main.model_validation_core,'uncontracted_v4_assessment',wraps=main.model_validation_core.uncontracted_v4_assessment) as assess:
            first=main.build_rules_v4_validation_records(**self.args)
            second=main.build_rules_v4_validation_records(**self.args)
            self.assertEqual(first,second);assess.assert_called_once()
            self.assertEqual(first[2]['scientific_outcome'],'inconclusive')
            first[1]['basis_id']='changed'
            self.assertEqual(main.build_rules_v4_validation_records(**self.args),second)

    def test_changed_bytes_and_scenario_stop_before_assessment(self):
        main.build_rules_v4_validation_records(**self.args)
        with patch.object(main.model_validation_core,'uncontracted_v4_assessment') as assess:
            with patch.object(main,'sb_get_scenario_role',return_value='build'):
                with self.assertRaises(main.WorkerStateWriteUnconfirmed):main.build_rules_v4_validation_records(**self.args)
            self.output.write_bytes(b'changed bytes')
            with self.assertRaises(main.WorkerStateWriteUnconfirmed):main.build_rules_v4_validation_records(**self.args)
            assess.assert_not_called()

    def test_interrupted_assessment_is_not_recomputed(self):
        with patch.object(main.model_validation_core,'uncontracted_v4_assessment',side_effect=RuntimeError('synthetic secret')) as assess:
            for _ in range(2):
                with self.assertRaises(main.WorkerStateWriteUnconfirmed) as error:main.build_rules_v4_validation_records(**self.args)
                self.assertNotIn('synthetic secret',str(error.exception))
            assess.assert_called_once()

if __name__=='__main__':unittest.main()
