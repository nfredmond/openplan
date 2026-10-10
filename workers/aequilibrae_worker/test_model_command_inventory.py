"""Read-only inventory distinguishes local receipts from current server facts."""
from contextlib import closing
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery
from test_model_command_client import command, receipt, URL, IDS

ROOT = Path(__file__).resolve().parent


class InventoryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name) / 'journal'
        self.pending = command()
        self.resolved = copy.deepcopy(self.pending)
        self.resolved['request_id'] = IDS[4]
        journal.prepare(self.directory, self.pending)
        journal.prepare(self.directory, self.resolved)
        journal.resolve(self.directory, self.resolved, receipt(self.resolved))

    def inventory(self, deployment='synthetic'):
        return recovery.command_summaries(self.directory, base_url=URL, deployment_id=deployment)

    def rows(self):
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection, connection:
            return connection.execute('SELECT * FROM commands ORDER BY rowid').fetchall()

    def test_local_inventory_includes_pending_and_validated_receipts_without_transport(self):
        before = self.rows()
        with patch.object(client, 'deliver', side_effect=AssertionError('Inventory attempted delivery')):
            result = self.inventory()
        self.assertEqual([item['request_id'] for item in result], [IDS[0], IDS[4]])
        self.assertEqual([item['delivery'] for item in result], ['unconfirmed', 'receipt_retained'])
        self.assertIsNone(result[0]['receipt_sha256'])
        self.assertEqual(result[1]['receipt_sha256'], hashlib.sha256(journal.canonical(receipt(self.resolved)).encode()).hexdigest())
        self.assertEqual(result[0]['request_sha256'], hashlib.sha256(journal.canonical(self.pending).encode()).hexdigest())
        self.assertEqual(set(result[0]), {'request_id', 'operation', 'run_id', 'stage_id', 'delivery', 'request_sha256', 'receipt_sha256'})
        self.assertEqual(self.rows(), before)
        self.assertEqual(len(recovery.pending_summaries(self.directory, base_url=URL, deployment_id='synthetic')), 1)

    def test_wrong_installation_lists_no_records(self):
        self.assertEqual(self.inventory('another-installation'), [])

    def test_missing_journal_is_not_created(self):
        missing = self.directory / 'missing'
        with self.assertRaises(sqlite3.OperationalError):
            recovery.command_summaries(missing, base_url=URL, deployment_id='synthetic')
        self.assertFalse(missing.exists())

    def test_request_key_mismatch_is_refused(self):
        changed = copy.deepcopy(self.pending)
        changed['request_id'] = IDS[3]
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection, connection:
            connection.execute('UPDATE commands SET request_json=? WHERE request_id=?', (json.dumps(changed), IDS[0]))
        with self.assertRaisesRegex(ValueError, 'journal identity'):
            self.inventory()

    def test_destination_column_mismatch_is_refused(self):
        changed = copy.deepcopy(self.pending)
        changed['destination'] = client.destination(URL, 'another-installation')
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection, connection:
            connection.execute('UPDATE commands SET request_json=? WHERE request_id=?', (json.dumps(changed), IDS[0]))
        with self.assertRaisesRegex(ValueError, 'journal identity'):
            self.inventory()

    def test_corrupt_receipt_is_not_reported_as_confirmed(self):
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection, connection:
            connection.execute('UPDATE commands SET response_json=? WHERE request_id=?', ('{}', IDS[4]))
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.inventory()

    def test_cli_without_credentials_reports_limits_and_omits_payloads(self):
        environment = {key: value for key, value in os.environ.items() if key != 'SUPABASE_SERVICE_ROLE_KEY'}
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'model_command_recovery.py'),
                                 '--journal', str(self.directory), '--base-url', URL,
                                 '--deployment-id', 'synthetic', '--list-commands'],
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['commands'], self.inventory())
        self.assertIs(data['server_state_checked'], False)
        self.assertIs(data['ownership_checked'], False)
        self.assertIs(data['model_resumed'], False)
        for private in ('synthetic-worker', 'arguments', 'destination', str(self.directory)):
            self.assertNotIn(private, result.stdout)


if __name__ == '__main__':
    unittest.main()
