"""Parent adapter fixes inputs and resolves current ownership before acquisition."""
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
from model_engine_channel import ChannelStopped
import test_engine_count_channel as fixtures
import test_managed_run_read as reads
from test_model_skip_dispatch import aeq


class ManagedCountPreparerTests(fixtures.CountChannelTests):
    def prepare(self):
        env=super().prepare()
        reads.RunReadTests.configure(self)
        self.get.return_value.json.return_value[0]['model_runs']['input_snapshot_json']={'calibrate':True}
        self.setup={'bbox':[-121,38,-120,39]}
        project=patch.object(self.writer,'project_directory',return_value='synthetic-owned-project')
        self.project=project.start();self.addCleanup(project.stop)
        with managed.bind(self.writer):
            self.adapter=aeq.managed_assignment_count_preparer(self.setup,counts_path_override=str(self.source))
        self.callback.side_effect=self.adapter
        return env

    def test_requires_binding_at_configuration(self):
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.managed_assignment_count_preparer({})

    def test_requires_original_binding_at_invocation(self):
        self.prepare()
        with patch.object(aeq,'prepare_assignment_count_inputs',return_value={}) as prepare:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.adapter('unused')
        prepare.assert_not_called()
        self.get.assert_not_called();self.post.assert_not_called()

    def test_changed_ownership_stops_before_preparation(self):
        self.prepare();parent,peer=self.pair();self.send(parent,peer,'create_outputs',1)
        self.get.return_value.json.return_value[0]['active_attempt_id']='foreign-attempt'
        with patch.object(aeq,'prepare_assignment_count_inputs') as prepare:
            with self.assertRaises(Exception):self.send(parent,peer,'prepare_counts',2)
        prepare.assert_not_called();self.post.assert_not_called()
        with self.assertRaises(ChannelStopped):peer.receive()

    def test_original_setup_and_current_calibration_reach_acquisition(self):
        self.prepare()
        with managed.bind(self.writer):self.callback.side_effect=aeq.managed_assignment_count_preparer(self.setup)
        self.setup['bbox'][0]=0
        parent,peer=self.pair();self.send(parent,peer,'create_outputs',1)
        with patch.object(aeq,'auto_ingest_counts',return_value=str(self.source)) as acquire:
            result=self.send(parent,peer,'prepare_counts',2)
        args=acquire.call_args
        self.assertEqual(args.args[1],[-121,38,-120,39])
        self.assertEqual(args.args[2],'synthetic-owned-project')
        self.assertIs(args.kwargs['calibrate_requested'],True)
        self.assertEqual(Path(result['counts_path']).read_bytes(),self.source.read_bytes())
        self.project.assert_called_once_with(self.writer.files.path)
        self.post.assert_called_once()


if __name__=='__main__':unittest.main()
