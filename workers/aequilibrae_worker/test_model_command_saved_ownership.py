"""Saved-claim inspection checks current facts without sending saved writes."""
from contextlib import closing, redirect_stdout
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery
from test_model_command_client import command, receipt, IDS, URL
from test_model_command_ownership import snapshot


class SavedOwnershipTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.command = command()
        journal.prepare(self.directory, self.command)

    def resolve(self):
        journal.resolve(self.directory, self.command, receipt(self.command))

    def inspect(self, get, **overrides):
        args = dict(workspace_id=IDS[4], base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', get=get)
        args.update(overrides)
        return recovery.inspect_saved_ownership(self.directory, IDS[0], **args)

    def rows(self):
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as db:
            return db.execute('SELECT * FROM commands').fetchall()

    def test_saved_receipt_reads_current_snapshot_without_writes(self):
        self.resolve()
        before = self.rows()
        for active in (IDS[3], None):
            row = snapshot(); row['active_attempt_id'] = active
            response = Mock(status_code=200, json=Mock(return_value=[row]))
            get = Mock(return_value=response)
            with patch.object(client, 'deliver', side_effect=AssertionError('Inspection replayed a command')):
                result = self.inspect(get)
            self.assertEqual(result['ownership']['owns_stage'], active == IDS[3])
            self.assertIs(result['point_in_time_only'], True)
            self.assertIs(result['continuation_authorized'], False)
            self.assertIs(result['model_resumed'], False)
            self.assertEqual(result['workspace_id'], IDS[4])
            self.assertEqual(result['run_id'], IDS[1])
            self.assertEqual(result['stage_id'], IDS[2])
            get.assert_called_once()
            self.assertEqual(get.call_args.kwargs['params']['model_runs.workspace_id'], 'eq.' + IDS[4])
            response.close.assert_called_once()
            self.assertEqual(self.rows(), before)

    def test_pending_wrong_deployment_missing_scope_or_credentials_never_read(self):
        get = Mock(side_effect=AssertionError('Invalid request reached transport'))
        with self.assertRaises(ValueError):
            self.inspect(get)
        self.resolve()
        for overrides in ({'workspace_id': None}, {'workspace_id': 'bad'}, {'service_key': ''}, {'deployment_id': 'other'}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.inspect(get, **overrides)
        get.assert_not_called()

    def test_unconfirmed_read_is_not_a_negative_ownership_result(self):
        self.resolve()
        with self.assertRaises(client.OwnershipUnconfirmed):
            self.inspect(Mock(side_effect=OSError('synthetic-secret')))

    def test_cli_reports_unconfirmed_without_exposing_transport_details(self):
        self.resolve()
        output = io.StringIO()
        with patch.dict('os.environ', {'SUPABASE_SERVICE_ROLE_KEY': 'synthetic-secret'}), patch('requests.get', side_effect=OSError('synthetic-secret')), redirect_stdout(output):
            code = recovery.main(['--journal', str(self.directory), '--base-url', URL,
                                  '--deployment-id', 'synthetic', '--inspect-ownership', IDS[0], '--workspace-id', IDS[4]])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue()), {'outcome': 'ownership_unconfirmed', 'continuation_authorized': False, 'model_resumed': False})
        self.assertNotIn('synthetic-secret', output.getvalue())


if __name__ == '__main__':
    unittest.main()
