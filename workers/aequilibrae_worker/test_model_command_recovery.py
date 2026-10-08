"""Operator recovery uses selected saved commands, never reconstructed payloads."""
import copy
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import model_command_recovery as recovery
import model_command_client as client
import model_command_journal as journal
from test_model_command_client import command, receipt, URL, IDS

ROOT = Path(__file__).resolve().parent


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'
        self.cmd = command()

    def recover(self, post, request_id=IDS[0], deployment='synthetic'):
        return recovery.recover_request(self.directory, request_id, base_url=URL,
                                        deployment_id=deployment, service_key='synthetic-secret', post=post)

    def test_saved_request_recovers_and_retained_receipt_avoids_second_post(self):
        journal.prepare(self.directory, self.cmd)
        response = Mock(status_code=200, json=Mock(return_value=receipt(self.cmd)))
        post = Mock(return_value=response)
        self.assertEqual(self.recover(post), receipt(self.cmd))
        self.assertEqual(post.call_args.kwargs['json']['p_request_id'], IDS[0])
        self.assertEqual(self.recover(post), receipt(self.cmd))
        post.assert_called_once()
        self.assertEqual(journal.pending(self.directory, self.cmd['destination']), [])

    def test_missing_or_wrong_target_never_sends_or_creates_journal(self):
        post = Mock()
        with self.assertRaises(sqlite3.OperationalError):
            self.recover(post)
        self.assertFalse(self.directory.exists())
        self.directory.mkdir()
        with self.assertRaises(sqlite3.OperationalError):
            self.recover(post)
        self.assertFalse((self.directory / 'model-commands.sqlite3').exists(), 'read created a journal')
        journal.prepare(self.directory, self.cmd)
        for request_id, deployment in [(IDS[4], 'synthetic'), (IDS[0], 'other')]:
            with self.assertRaisesRegex(ValueError, 'No exact saved request'):
                self.recover(post, request_id, deployment)
        post.assert_not_called()

    def test_failed_delivery_leaves_original_pending(self):
        journal.prepare(self.directory, self.cmd)
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.recover(Mock(side_effect=TimeoutError('synthetic-secret')))
        self.assertEqual(journal.pending(self.directory, self.cmd['destination'])[0]['command'], self.cmd)

    def test_corrupted_request_identity_cannot_dispatch_another_command(self):
        journal.prepare(self.directory, self.cmd)
        changed = copy.deepcopy(self.cmd); changed['request_id'] = IDS[4]
        with sqlite3.connect(self.directory / 'model-commands.sqlite3') as connection:
            connection.execute('UPDATE commands SET request_json=?', (json.dumps(changed),))
        post = Mock()
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.recover(post)
        post.assert_not_called()

    def test_corrupted_request_identity_from_reader_cannot_dispatch(self):
        # The recovery boundary must also reject a mismatched reader result.
        changed = copy.deepcopy(self.cmd)
        changed['request_id'] = IDS[4]
        post = Mock()
        with patch.object(journal, 'read_existing', return_value=[{'command': changed, 'resolved': False, 'response': None}]):
            with self.assertRaisesRegex(ValueError, 'does not match'):
                self.recover(post)
        post.assert_not_called()

    def test_listing_and_cached_cli_do_not_print_payloads_or_need_credentials(self):
        journal.prepare(self.directory, self.cmd)
        args = [sys.executable, '-B', str(ROOT / 'model_command_recovery.py'), '--journal', str(self.directory),
                '--base-url', URL, '--deployment-id', 'synthetic']
        listed = subprocess.run([*args, '--list-pending'], capture_output=True, text=True, timeout=10)
        self.assertEqual(listed.returncode, 0, listed.stderr)
        expected = {'request_id': IDS[0], 'operation': self.cmd['operation'], 'run_id': IDS[1], 'stage_id': IDS[2]}
        self.assertEqual(json.loads(listed.stdout), {'pending': [expected]})
        self.assertNotIn('synthetic-worker', listed.stdout)
        journal.resolve(self.directory, self.cmd, receipt(self.cmd))
        env = {key: value for key, value in os.environ.items() if key != 'SUPABASE_SERVICE_ROLE_KEY'}
        result = subprocess.run([*args, '--request-id', IDS[0]], capture_output=True, text=True, timeout=10, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'request_id': IDS[0], 'outcome': 'command_receipt_retained', 'model_resumed': False})


if __name__ == '__main__':
    unittest.main()
