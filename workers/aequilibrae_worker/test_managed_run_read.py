"""Claimed run configuration is read with explicit projection and ownership."""
import copy
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_command_client as client
import test_model_attempt_writer as fixtures
from test_model_skip_dispatch import aeq, activity


class RunReadTests(unittest.TestCase):
    worker = aeq
    read_error = aeq.WorkerStateWriteUnconfirmed
    setUp=fixtures.WriterTests.setUp
    response=fixtures.WriterTests.response

    def configure(self):
        row=self.get.return_value.json.return_value[0]
        row['model_runs'].update({key:None for key in managed.RUN_CONFIGURATION_FIELDS})
        row['model_runs']['input_snapshot_json']={'calibration':False,'source':'synthetic'}
        return row

    def test_actual_worker_uses_owned_projection_without_legacy_read(self):
        row=self.configure()
        expected={key:copy.deepcopy(row['model_runs'][key]) for key in ('id','workspace_id',*managed.RUN_CONFIGURATION_FIELDS)}
        with managed.bind(self.writer),patch.object(self.worker.requests,'get',side_effect=AssertionError('Legacy read')):
            actual=self.worker.sb_get_run(self.writer.context.run_id)
        self.assertEqual(actual,expected)
        self.get.assert_called_once()
        self.assertEqual(self.get.call_args.kwargs['params'],{
            'id':'eq.'+self.writer.context.stage_id,'run_id':'eq.'+self.writer.context.run_id,
            'model_runs.workspace_id':'eq.'+self.writer.context.workspace_id,
            'select':'id,run_id,status,attempt_managed,active_attempt_id,log_tail,error_message,model_runs!inner(id,workspace_id,status,attempt_managed,scenario_entry_id,corridor_geojson,query_text,engine_key,run_title,input_snapshot_json)'})
        self.get.return_value.close.assert_called_once()
        self.post.assert_not_called()

    def test_missing_configuration_field_refuses(self):
        row=self.configure();del row['model_runs']['input_snapshot_json']
        with self.assertRaises(client.OwnershipUnconfirmed):self.writer.read_run(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)
        self.post.assert_not_called()

    def test_revoked_attempt_refuses_actual_worker_without_fallback(self):
        row=self.configure();row['active_attempt_id']='foreign-attempt'
        with managed.bind(self.writer),patch.object(self.worker.requests,'get',side_effect=AssertionError('Legacy fallback')):
            with self.assertRaises(self.read_error):self.worker.sb_get_run(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)
        self.get.return_value.close.assert_called_once()

    def test_foreign_requested_run_refused_before_transport(self):
        self.configure()
        with self.assertRaisesRegex(ValueError,'crosses invocation'):self.writer.read_run('foreign-run')
        self.get.assert_not_called();self.assertTrue(self.writer.stopped)


class ActivityRunReadTests(RunReadTests):
    worker = activity
    read_error = activity.WorkerStateReadUnconfirmed


if __name__=='__main__':unittest.main()
