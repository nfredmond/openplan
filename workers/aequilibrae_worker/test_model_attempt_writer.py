"""Real journals and both worker adapters; injected HTTP, no engine execution."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_command_client as client
import model_command_journal as journal
from test_model_command_client import command, receipt, IDS, URL, STAMP
from test_model_command_ownership import snapshot
from test_model_skip_dispatch import aeq, activity


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.cmd = command()
        row = {**snapshot(), 'log_tail': 'Existing stage log', 'error_message': None}
        self.get = Mock(return_value=Mock(status_code=200, json=Mock(return_value=[row])))
        self.post = Mock(side_effect=self.response)
        self.writer = invocation._invoke_fresh_claim(self.directory, self.cmd, workspace_id=IDS[4],
            base_url=URL, deployment_id='synthetic', service_key='synthetic-secret',
            post=self.post, get=self.get, handler=lambda context: managed.AttemptWriter(
                self.directory, context, base_url=URL, deployment_id='synthetic',
                service_key='synthetic-secret', post=self.post, get=self.get))
        self.post.reset_mock()
        self.get.reset_mock()

    def response(self, url, **kwargs):
        if url.endswith('/claim_model_stage_attempt'):
            body = receipt(self.cmd)
        else:
            args = kwargs['json']
            saved = journal.pending(self.directory, self.cmd['destination'])
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]['command']['request_id'], args['p_request_id'])
            status = args['p_status']
            body = {'request_id': args['p_request_id'], 'stage_id': IDS[2], 'attempt_id': IDS[3],
                    'status': status, 'completed_at': None if status == 'running' else STAMP,
                    'run_status': status, 'run_completed_at': None if status == 'running' else STAMP}
        return Mock(status_code=200, json=Mock(return_value=body))

    def test_partial_progress_and_failure_preserve_last_confirmed_log(self):
        self.writer.patch_stage(IDS[2], {'status': 'running'})
        self.assertEqual(self.post.call_args.kwargs['json']['p_log_tail'], 'Existing stage log')
        self.assertEqual(self.get.call_args.kwargs['params'], {
            'id': 'eq.' + IDS[2], 'run_id': 'eq.' + IDS[1], 'model_runs.workspace_id': 'eq.' + IDS[4],
            'select': 'id,run_id,status,attempt_managed,active_attempt_id,log_tail,error_message,model_runs!inner(id,workspace_id,status,attempt_managed)'})
        self.writer.patch_stage(IDS[2], {'log_tail': 'Useful partial computation log'})
        result = self.writer.patch_stage(IDS[2], {'status': 'failed', 'error_message': 'Synthetic failure'})
        self.assertEqual(result['run_status'], 'failed')
        args = self.post.call_args.kwargs['json']
        self.assertEqual(args['p_log_tail'], 'Useful partial computation log')
        self.assertEqual(args['p_error'], 'Synthetic failure')
        self.get.assert_called_once()
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.patch_stage(IDS[2], {'status': 'running'})

    def test_completion_uses_database_receipt_time_without_parent_patch(self):
        result = self.writer.patch_stage(IDS[2], {'status': 'succeeded', 'completed_at': '2026-10-01T00:00:00Z'})
        self.assertEqual(result['completed_at'], STAMP)
        self.assertNotIn('p_completed_at', self.post.call_args.kwargs['json'])
        self.post.assert_called_once()
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.require_open()
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.patch_run(IDS[1], {'status': 'succeeded'})

    def test_existing_pending_command_stops_new_write(self):
        pending = command('write_model_stage_attempt')
        pending['request_id'] = IDS[4]
        journal.prepare(self.directory, pending)
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.require_open()
        self.post.assert_not_called()

    def test_uncertain_progress_stops_failure_and_later_output_intent(self):
        self.post.side_effect = TimeoutError('synthetic-secret')
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.writer.patch_stage(IDS[2], {'log_tail': 'May already be committed'})
        saved = journal.pending(self.directory, self.cmd['destination'])
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['command']['arguments']['log_tail'], 'May already be committed')
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.patch_stage(IDS[2], {'status': 'failed', 'error_message': 'Incorrect inferred failure'})
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.require_open()
        self.post.assert_called_once()

    def test_missing_existing_log_refuses_without_a_write(self):
        del self.get.return_value.json.return_value[0]['log_tail']
        with self.assertRaises(client.OwnershipUnconfirmed):
            self.writer.patch_stage(IDS[2], {'status': 'failed', 'error_message': 'Synthetic failure'})
        self.post.assert_not_called()

    def test_wrong_stage_or_unsupported_patch_refuses_before_transport(self):
        for stage, payload in [(IDS[4], {'status': 'running'}), (IDS[2], {'started_at': STAMP})]:
            with self.assertRaises(ValueError):
                self.writer.patch_stage(stage, payload)
        self.post.assert_not_called()
        self.get.assert_not_called()

    def test_binding_is_scoped_and_both_worker_adapters_use_command(self):
        self.assertIsNone(managed.current())
        with managed.bind(self.writer):
            with self.assertRaises(invocation.ReconciliationRequired):
                with managed.bind(self.writer):
                    self.fail('Nested invocation admitted')
            with ThreadPoolExecutor(max_workers=1) as executor:
                self.assertIsNone(executor.submit(managed.current).result())
                with self.assertRaises(invocation.ReconciliationRequired):
                    executor.submit(self.writer.require_open).result()
            for worker in (aeq, activity):
                with patch.object(worker.requests, 'patch', side_effect=AssertionError('Legacy PATCH forbidden')):
                    worker.sb_patch_stage(IDS[2], {'log_tail': worker.__name__})
                    self.assertEqual(self.post.call_args.kwargs['json']['p_log_tail'], worker.__name__)
                    with self.assertRaises(worker.WorkerStateWriteUnconfirmed):
                        worker.sb_patch_run(IDS[1], {'status': 'running'})
        self.assertIsNone(managed.current())

    def test_both_worker_adapters_stop_on_uncertainty_without_fallback(self):
        with managed.bind(self.writer):
            for worker in (aeq, activity):
                with patch.object(worker.requests, 'patch', side_effect=AssertionError('Legacy PATCH forbidden')):
                    with patch.object(self.writer, 'patch_stage', side_effect=client.DeliveryUnconfirmed('Uncertain')):
                        with self.assertRaises(worker.WorkerStateWriteUnconfirmed):
                            worker.sb_patch_stage(IDS[2], {'status': 'failed'})
        self.assertIsNone(managed.current())

    def test_callback_error_restores_binding(self):
        with self.assertRaisesRegex(RuntimeError, 'Synthetic callback'):
            with managed.bind(self.writer):
                raise RuntimeError('Synthetic callback')
        self.assertIsNone(managed.current())


if __name__ == '__main__':
    unittest.main()
