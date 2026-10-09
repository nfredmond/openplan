"""Exercise both normal skip paths with real journals and injected HTTP."""
from contextlib import ExitStack
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from worker_import_for_tests import import_worker_main
import model_command_journal as journal
import model_skip_command

aeq = import_worker_main()
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'activitysim_worker'))
import supabase_poll as activity

IDS = [f'{n:08d}-1111-4111-8111-111111111111' for n in range(1, 5)]
STAMP = '2026-10-08T19:00:00+00:00'
STAGE = {'id': IDS[0], 'run_id': IDS[1], 'sort_order': 2, 'stage_name': 'Synthetic dependent', 'status': 'queued', 'updated_at': STAMP}
BLOCKER = {'id': IDS[2], 'sort_order': 1, 'stage_name': 'Synthetic prerequisite', 'status': 'failed', 'updated_at': STAMP}


class SkipDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def environment(self, worker):
        stack = ExitStack()
        stack.enter_context(patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': 'synthetic-skip'}))
        stack.enter_context(patch.object(worker, 'SUPABASE_URL', 'http://127.0.0.1:9'))
        stack.enter_context(patch.object(worker, 'SUPABASE_KEY', 'synthetic-secret'))
        key = 'RUN_WORK_ROOT' if worker is aeq else 'ACTIVITYSIM_WORK_DIR'
        stack.enter_context(patch.object(worker, key, str(self.root / worker.__name__)))
        stack.enter_context(patch.object(worker, 'sb_get_run', return_value={'id': IDS[1], 'workspace_id': IDS[3]}))
        stack.enter_context(patch.object(worker.requests, 'patch', side_effect=AssertionError('Direct skip PATCH is forbidden')))
        return stack

    def response(self, payload, outcome='skipped'):
        args = {key[2:]: value for key, value in payload.items()}
        result = {key: args[key] for key in ('request_id', 'workspace_id', 'run_id', 'stage_id', 'blocker_id')}
        result.update(observed_blocker_status='failed' if outcome == 'skipped' else 'succeeded', outcome=outcome,
                      status='skipped' if outcome == 'skipped' else 'queued', completed_at=STAMP if outcome == 'skipped' else None)
        return Mock(status_code=200, json=Mock(return_value=result))

    def test_both_workers_retain_recover_and_do_not_patch(self):
        for worker in (aeq, activity):
            with self.subTest(worker=worker.__name__), self.environment(worker):
                with patch.object(worker.requests, 'get', return_value=Mock(status_code=200, json=lambda: [BLOCKER])) as get:
                    with patch.object(worker.requests, 'post', side_effect=TimeoutError('synthetic-secret')):
                        with self.assertRaisesRegex(worker.WorkerStateWriteUnconfirmed, 'saved request'):
                            worker.mark_stage_skipped(STAGE, 'stale display text')
                    self.assertIn('updated_at', get.call_args.args[0].split('select=')[1])
                    files = list((self.root / worker.__name__).rglob('model-commands.sqlite3'))
                    self.assertEqual(len(files), 1)
                    directory = files[0].parent
                    destination = model_skip_command.client.destination(worker.SUPABASE_URL, 'synthetic-skip')
                    pending = journal.pending(directory, destination)
                    self.assertEqual(len(pending), 1)
                    request = pending[0]['command']['request_id']
                    seen = []
                    def post(url, **kwargs):
                        self.assertTrue(url.endswith('/rpc/skip_blocked_model_stage'))
                        self.assertEqual(kwargs['json']['p_request_id'], request)
                        seen.append(kwargs['json'])
                        return self.response(kwargs['json'])
                    with patch.object(worker.requests, 'post', side_effect=post):
                        self.assertTrue(worker.mark_stage_skipped(STAGE, 'different display text'))
                        self.assertTrue(worker.mark_stage_skipped(STAGE, 'same observation'))
                    self.assertEqual(len(seen), 1)
                    self.assertEqual(journal.pending(directory, destination), [])

    def test_changed_observation_gets_new_decision_and_noop_stays_false(self):
        for worker in (aeq, activity):
            with self.subTest(worker=worker.__name__), self.environment(worker):
                seen = []
                def post(url, **kwargs):
                    seen.append(kwargs['json']['p_request_id'])
                    return self.response(kwargs['json'], 'not_skipped')
                with patch.object(worker.requests, 'get', return_value=Mock(status_code=200, json=lambda: [BLOCKER])), patch.object(worker.requests, 'post', side_effect=post):
                    self.assertFalse(worker.mark_stage_skipped(STAGE, 'observed blocker'))
                    self.assertFalse(worker.mark_stage_skipped(STAGE, 'same observation'))
                    changed = {**STAGE, 'updated_at': '2026-10-08T19:01:00+00:00'}
                    self.assertFalse(worker.mark_stage_skipped(changed, 'new observation'))
                    changed_blocker = {**BLOCKER, 'updated_at': '2026-10-08T19:02:00+00:00'}
                    with patch.object(worker.requests, 'get', return_value=Mock(status_code=200, json=lambda: [changed_blocker])):
                        self.assertFalse(worker.mark_stage_skipped(changed, 'new predecessor observation'))
                self.assertEqual(len(seen), 3)
                self.assertEqual(len(set(seen)), 3)

    def test_no_current_blocker_sends_no_write(self):
        for worker in (aeq, activity):
            with self.subTest(worker=worker.__name__), self.environment(worker):
                with patch.object(worker.requests, 'get', return_value=Mock(status_code=200, json=lambda: [{**BLOCKER, 'status': 'succeeded'}])), patch.object(worker.requests, 'post') as post:
                    self.assertFalse(worker.mark_stage_skipped(STAGE, 'old failure'))
                    post.assert_not_called()

    def test_missing_observation_cannot_send_or_create_a_journal(self):
        for worker in (aeq, activity):
            with self.subTest(worker=worker.__name__), self.environment(worker):
                incomplete = copy.deepcopy(STAGE)
                del incomplete['updated_at']
                with patch.object(worker.requests, 'get', return_value=Mock(status_code=200, json=lambda: [BLOCKER])), patch.object(worker.requests, 'post') as post:
                    with self.assertRaises(worker.WorkerStateWriteUnconfirmed):
                        worker.mark_stage_skipped(incomplete, 'old failure')
                    post.assert_not_called()
                    self.assertEqual(list(self.root.rglob('model-commands.sqlite3')), [])

    def test_aeq_dispatch_does_not_report_noop_as_skipped(self):
        with self.environment(aeq), patch.object(aeq, 'classify_stage_readiness', return_value=('blocked_terminal', 'synthetic')), patch.object(aeq, 'mark_stage_skipped', return_value=False):
            self.assertEqual(aeq.process_first_actionable_stage([STAGE]), 'lost')

    def test_normal_queue_reads_include_observation_version(self):
        with self.environment(aeq), patch.object(aeq.requests, 'get', return_value=Mock(status_code=200, json=lambda: [])) as get:
            aeq.fetch_queued_stages()
            self.assertIn('updated_at', get.call_args.args[0].split('select=')[1].split('&')[0])
        class StopPoll(BaseException):
            pass
        def read(url, **kwargs):
            if 'status=eq.queued' in url:
                self.assertIn('updated_at', url.split('select=')[1].split('&')[0])
            return Mock(status_code=200, json=lambda: [])
        with self.environment(activity), patch.object(activity, 'WorkerHeartbeat'), patch.object(activity.requests, 'get', side_effect=read), patch.object(activity.time, 'sleep', side_effect=StopPoll):
            with self.assertRaises(StopPoll):
                activity.poll_for_jobs()


if __name__ == '__main__':
    unittest.main()
