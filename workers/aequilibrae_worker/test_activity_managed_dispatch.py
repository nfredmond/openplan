"""Admitted ActivitySim entry with a real journal and injected HTTP receipts."""
import unittest
from unittest.mock import Mock, patch

import os
import sys
import tempfile
from pathlib import Path

import model_attempt_invocation as invocation
import model_attempt_writer as managed
import model_command_journal as journal
from test_model_command_client import command, receipt, IDS, URL, STAMP
from test_model_command_ownership import snapshot

os.environ.setdefault('SUPABASE_URL', 'http://127.0.0.1:9')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-test-only')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'activitysim_worker'))
import supabase_poll as activity


class DispatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.cmd = command()
        row = {**snapshot(), 'log_tail': 'Existing stage log', 'error_message': None}
        self.get = Mock(return_value=Mock(status_code=200, json=Mock(return_value=[row])))
        self.post = Mock(side_effect=self.response)
        self.writer = invocation._invoke_fresh_claim(self.directory, self.cmd, workspace_id=IDS[4],
            base_url=URL, deployment_id='synthetic', service_key='synthetic-secret',
            post=self.post, get=self.get, handler=lambda context: managed.AttemptWriter(
                self.directory, context, base_url=URL, deployment_id='synthetic',
                service_key='synthetic-secret', post=self.post, get=self.get))
        self.post.reset_mock(); self.get.reset_mock()

    def response(self, url, **kwargs):
        if url.endswith('/claim_model_stage_attempt'):
            body = receipt(self.cmd)
        else:
            args = kwargs['json']
            pending = journal.pending(self.directory, self.cmd['destination'])
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]['command']['request_id'], args['p_request_id'])
            status = args['p_status']
            body = {'request_id': args['p_request_id'], 'stage_id': IDS[2], 'attempt_id': IDS[3],
                    'status': status, 'completed_at': STAMP, 'run_status': status, 'run_completed_at': STAMP}
        return Mock(status_code=200, json=Mock(return_value=body))

    def configure(self, name=None):
        self.stage = {'id': IDS[2], 'run_id': IDS[1], 'stage_name': activity.STAGE_BUNDLE_PREFLIGHT}
        row = self.get.return_value.json.return_value[0]
        row['stage_name'] = name or self.stage['stage_name']
        row['model_runs'].update({field: None for field in managed.RUN_CONFIGURATION_FIELDS})
        self.handler = Mock(return_value={'log': 'Synthetic stage complete'})

    def test_admitted_entry_completes_without_legacy_claim_or_parent_write(self):
        self.configure()
        with managed.bind(self.writer), patch.dict(activity.STAGE_DISPATCH, {self.stage['stage_name']: self.handler}), \
                patch.object(activity, 'sb_claim_stage') as claim, patch.object(activity, 'sb_patch_run') as parent, \
                patch.object(activity, 'maybe_mark_run_succeeded') as completion:
            activity.process_stage(self.stage)
        claim.assert_not_called(); parent.assert_not_called(); completion.assert_not_called()
        self.handler.assert_called_once()
        self.assertEqual(self.handler.call_args.args[1]['workspace_id'], IDS[4])
        self.assertIn('stage_name', self.get.call_args_list[0].kwargs['params']['select'].split(','))
        self.assertEqual(self.post.call_args.kwargs['json']['p_status'], 'succeeded')
        self.assertTrue(self.writer.stopped)

    def test_database_stage_name_must_match_handler(self):
        self.configure('Artifact Extraction')
        with managed.bind(self.writer), patch.dict(activity.STAGE_DISPATCH, {self.stage['stage_name']: self.handler}):
            with self.assertRaisesRegex(Exception, 'incomplete or no longer owned'):
                activity.process_stage(self.stage)
        self.handler.assert_not_called(); self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_cross_scope_entry_stops_without_work(self):
        self.configure()
        with managed.bind(self.writer), patch.dict(activity.STAGE_DISPATCH, {self.stage['stage_name']: self.handler}), patch.object(activity, 'sb_patch_stage'):
            with self.assertRaisesRegex(ValueError, 'crosses invocation scope'):
                activity.process_stage({**self.stage, 'id': IDS[4]})
        self.handler.assert_not_called(); self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_handler_failure_does_not_guess_terminal_state(self):
        self.configure()
        self.handler.side_effect = RuntimeError('Synthetic unknown outcome')
        heartbeat = Mock()
        with managed.bind(self.writer), patch.dict(activity.STAGE_DISPATCH, {self.stage['stage_name']: self.handler}), \
                patch.object(activity, '_WORKER_HEARTBEAT', heartbeat):
            with self.assertRaisesRegex(RuntimeError, 'Synthetic unknown outcome'):
                activity.process_stage(self.stage)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)
        heartbeat.set_current_work.assert_called_with(None)

    def test_empty_expected_stage_name_is_refused_before_transport(self):
        self.configure()
        with self.assertRaisesRegex(ValueError, 'Expected stage name must be nonempty'):
            self.writer.read_run(IDS[1], expected_stage_name='')
        self.get.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_unknown_handler_is_refused_before_run_read(self):
        self.configure()
        with managed.bind(self.writer):
            with self.assertRaisesRegex(ValueError, 'no owned handler'):
                activity.process_stage({**self.stage, 'stage_name': 'Synthetic unknown'})
        self.get.assert_not_called(); self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_stopped_writer_never_enters_handler(self):
        self.configure()
        with managed.bind(self.writer), patch.dict(activity.STAGE_DISPATCH, {self.stage['stage_name']: self.handler}):
            self.writer.stopped = True
            with self.assertRaises(Exception):
                activity.process_stage(self.stage)
        self.handler.assert_not_called(); self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
