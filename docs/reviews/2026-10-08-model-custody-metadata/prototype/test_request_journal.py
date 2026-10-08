"""Native process-exit custody checks, without a worker or network request."""
from pathlib import Path
import copy
import json
import subprocess
import sys
import tempfile
import unittest
import request_journal as journal

COMMAND = {'request_id': 'synthetic-request', 'destination': 'synthetic-deployment', 'operation': 'record_model_attempt_instrument', 'arguments': {'attempt_id': 'synthetic-attempt', 'payload': {'scientific_outcome': 'inconclusive'}}}
RECEIPT = {'id': 'synthetic-custody', 'scientific_outcome': 'inconclusive'}


class Journal(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'

    def test_exact_prepare_and_destination_filter(self):
        first = journal.prepare(self.directory, COMMAND)
        self.assertEqual(journal.prepare(self.directory, copy.deepcopy(COMMAND)), first)
        self.assertEqual(journal.pending(self.directory, COMMAND['destination']), [first])
        self.assertEqual(journal.pending(self.directory, 'other-deployment'), [])
        self.assertEqual((self.directory.stat().st_mode & 0o777), 0o700)
        self.assertEqual(((self.directory / 'model-commands.sqlite3').stat().st_mode & 0o777), 0o600)

    def test_changed_request_is_refused_and_original_survives(self):
        first = journal.prepare(self.directory, COMMAND)
        for key, value in [('destination', 'other-deployment'), ('operation', 'different-command'), ('arguments', {'attempt_id': 'old'})]:
            changed = {**COMMAND, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'different contents'):
                journal.prepare(self.directory, changed)
        self.assertEqual(journal.pending(self.directory, COMMAND['destination']), [first])

    def test_receipt_is_immutable_and_requires_preparation(self):
        with self.assertRaisesRegex(ValueError, 'no matching prepared request'):
            journal.resolve(self.directory, COMMAND, RECEIPT)
        journal.prepare(self.directory, COMMAND)
        with self.assertRaisesRegex(ValueError, 'no matching prepared request'):
            journal.resolve(self.directory, {**COMMAND, 'operation': 'different-command'}, RECEIPT)
        resolved = journal.resolve(self.directory, COMMAND, RECEIPT)
        self.assertEqual(journal.resolve(self.directory, COMMAND, RECEIPT), resolved)
        with self.assertRaisesRegex(ValueError, 'cannot change'):
            journal.resolve(self.directory, COMMAND, {**RECEIPT, 'id': 'other'})
        self.assertEqual(journal.prepare(self.directory, COMMAND), resolved)
        self.assertTrue(resolved['resolved'])
        self.assertEqual(journal.pending(self.directory, COMMAND['destination']), [])

    def test_native_exit_after_prepare_and_after_receipt(self):
        for finish, code in [(False, 77), (True, 78)]:
            script = 'from pathlib import Path; import json,os; import request_journal as j; '
            script += f'd=Path({str(self.directory)!r}); c=json.loads({json.dumps(COMMAND)!r}); j.prepare(d,c); '
            if finish:
                script += f'j.resolve(d,c,json.loads({json.dumps(RECEIPT)!r})); '
            script += f'os._exit({code})'
            result = subprocess.run([sys.executable, '-B', '-c', script], cwd=Path(__file__).resolve().parent, timeout=15)
            self.assertEqual(result.returncode, code)
            retained = journal.prepare(self.directory, COMMAND)
            self.assertEqual(retained['command'], COMMAND)
            self.assertEqual(retained['resolved'], finish)
            self.assertEqual(retained['response'], RECEIPT if finish else None)


if __name__ == '__main__':
    unittest.main()
