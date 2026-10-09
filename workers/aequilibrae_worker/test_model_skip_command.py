"""Real SQLite recovery with injected transport; not native HTTP authorization."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery

URL = 'http://127.0.0.1:54321'
IDS = [f'{n:08d}-1111-4111-8111-111111111111' for n in range(1, 7)]
STAMP = '2026-10-08T19:00:00+00:00'


def command():
    return {'request_id': IDS[0], 'destination': client.destination(URL, 'synthetic'),
            'operation': 'skip_blocked_model_stage', 'arguments': {
                'workspace_id': IDS[1], 'run_id': IDS[2], 'stage_id': IDS[3],
                'blocker_id': IDS[4], 'blocker_status': 'failed'}}


def receipt(cmd):
    return {'request_id': cmd['request_id'],
            **{key: cmd['arguments'][key] for key in ('workspace_id', 'run_id', 'stage_id', 'blocker_id')},
            'observed_blocker_status': 'failed', 'status': 'skipped',
            'outcome': 'skipped', 'completed_at': STAMP}


class SkipCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'
        self.cmd = command()

    def deliver(self, cmd, post):
        return client.deliver(self.directory, cmd, base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', post=post)

    def test_scope_and_exact_rpc_payload_are_retained_before_send(self):
        expected = receipt(self.cmd)
        def post(url, **kwargs):
            self.assertEqual(journal.pending(self.directory, self.cmd['destination'])[0]['command'], self.cmd)
            self.assertEqual(url, URL + '/rest/v1/rpc/skip_blocked_model_stage')
            self.assertEqual(kwargs['json'], {'p_request_id': IDS[0], **{'p_' + key: value for key, value in self.cmd['arguments'].items()}})
            self.assertFalse(kwargs['allow_redirects'])
            return Mock(status_code=200, json=Mock(return_value=expected))
        self.assertEqual(self.deliver(self.cmd, post), expected)
        cached = Mock(side_effect=AssertionError('Cached receipt sent again'))
        self.assertEqual(self.deliver(self.cmd, cached), expected)
        cached.assert_not_called()

    def test_lost_reply_recovers_original_request_without_new_identity(self):
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.deliver(self.cmd, Mock(side_effect=TimeoutError('synthetic-secret')))
        self.assertEqual(journal.pending(self.directory, self.cmd['destination'])[0]['command'], self.cmd)
        expected = receipt(self.cmd)
        post = Mock(return_value=Mock(status_code=200, json=Mock(return_value=expected)))
        actual = recovery.recover_request(self.directory, IDS[0], base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', post=post)
        self.assertEqual(actual, expected)
        self.assertEqual(post.call_args.kwargs['json']['p_request_id'], IDS[0])
        self.assertEqual(journal.pending(self.directory, self.cmd['destination']), [])
        result = subprocess.run([sys.executable, '-B', str(Path(client.__file__).with_name('model_command_recovery.py')),
            '--journal', str(self.directory), '--base-url', URL, '--deployment-id', 'synthetic', '--request-id', IDS[0]],
            text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'request_id': IDS[0], 'outcome': 'command_receipt_retained', 'model_resumed': False})

    def test_not_skipped_is_retained_without_relabeling(self):
        expected = {**receipt(self.cmd), 'outcome': 'not_skipped', 'status': 'queued',
                    'completed_at': None, 'observed_blocker_status': 'succeeded'}
        self.assertEqual(self.deliver(self.cmd, Mock(return_value=Mock(status_code=200, json=Mock(return_value=expected)))), expected)
        self.assertEqual(journal.read_existing(self.directory, self.cmd['destination'], IDS[0])[0]['response'], expected)

    def test_bad_request_is_refused_before_transport_or_journal_creation(self):
        base = self.directory
        for index, (key, value) in enumerate([('workspace_id', 'wrong'), ('blocker_id', IDS[3]), ('blocker_status', 'running'), ('attempt_id', IDS[5])]):
            with self.subTest(key=key):
                self.directory = base / str(index)
                bad = copy.deepcopy(self.cmd)
                bad['arguments'][key] = value
                post = Mock()
                with self.assertRaises(ValueError):
                    self.deliver(bad, post)
                post.assert_not_called()
                self.assertFalse(self.directory.exists())

    def test_foreign_or_inconsistent_receipts_remain_pending(self):
        changes = [(key, IDS[5]) for key in ('request_id', 'workspace_id', 'run_id', 'stage_id', 'blocker_id')]
        changes += [('status', 'succeeded'), ('outcome', 'claimed'), ('observed_blocker_status', 'succeeded'),
                    ('completed_at', None), ('completed_at', 'invalid'), ('attempt_id', IDS[5])]
        base = self.directory
        for index, (key, value) in enumerate(changes):
            with self.subTest(key=key):
                self.directory = base / str(index)
                bad = {**receipt(self.cmd), key: value}
                with self.assertRaises(client.DeliveryUnconfirmed):
                    self.deliver(self.cmd, Mock(return_value=Mock(status_code=200, json=Mock(return_value=bad))))
                self.assertEqual(journal.pending(self.directory, self.cmd['destination'])[0]['command'], self.cmd)

    def test_changed_payload_under_same_request_is_refused(self):
        journal.prepare(self.directory, self.cmd)
        changed = copy.deepcopy(self.cmd)
        changed['arguments']['blocker_status'] = 'cancelled'
        post = Mock()
        with self.assertRaisesRegex(ValueError, 'reused with different contents'):
            self.deliver(changed, post)
        post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
