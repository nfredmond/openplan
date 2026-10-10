"""Read-only operator inspection distinguishes saved and interrupted calculations."""
from pathlib import Path
from contextlib import closing
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import model_stage_computation as computation
import model_command_journal as journal

ROOT = Path(__file__).resolve().parent
ARGS = dict(base_url='http://127.0.0.1:54321', deployment_id='synthetic',
    run_id='11111111-1111-4111-8111-111111111111',
    stage_id='22222222-2222-4222-8222-222222222222',
    name='demand-model-agreement', inputs={'private_source': '/private/source'})


class InspectionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name) / 'journal'

    def inspect(self):
        return computation.summaries(self.directory, base_url=ARGS['base_url'], deployment_id=ARGS['deployment_id'])

    def create(self):
        computation.compute_once(self.directory, **ARGS, compute=lambda: {'private_result': 37})

    def test_fresh_cli_lists_scoped_states_without_payload_or_dispatch(self):
        self.create()
        computation.compute_once(self.directory, **{**ARGS, 'deployment_id': 'other'}, compute=lambda: {'other': 1})
        try:
            computation.compute_once(self.directory, **{**ARGS, 'name': 'interrupted'}, compute=lambda: (_ for _ in ()).throw(RuntimeError('stop')))
        except RuntimeError:
            pass
        path = self.directory / 'model-commands.sqlite3'
        before = path.read_bytes()
        run = subprocess.run([sys.executable, '-B', str(ROOT / 'model_command_recovery.py'),
            '--journal', str(self.directory), '--base-url', ARGS['base_url'],
            '--deployment-id', ARGS['deployment_id'], '--list-computations'],
            capture_output=True, text=True, timeout=15)
        self.assertEqual(run.returncode, 0, run.stderr)
        records = json.loads(run.stdout)['computations']
        self.assertEqual([item['state'] for item in records], ['result_retained', 'started_without_result'])
        self.assertTrue(all(item['model_resumed'] is False for item in records))
        self.assertTrue(all(set(item) == {'run_id', 'stage_id', 'name', 'state', 'model_resumed'} for item in records))
        self.assertNotIn('private', run.stdout)
        self.assertEqual(path.read_bytes(), before)

    def test_missing_journal_is_not_created_and_old_journal_is_empty(self):
        with self.assertRaises(sqlite3.OperationalError): self.inspect()
        self.assertFalse(self.directory.exists())
        self.directory.mkdir()
        with self.assertRaises(sqlite3.OperationalError): self.inspect()
        self.assertEqual(list(self.directory.iterdir()), [])
        connection = journal.connect(self.directory); connection.close()
        self.assertEqual(self.inspect(), [])

    def test_damaged_records_refuse_instead_of_reporting_retained(self):
        self.create()
        path = self.directory / 'model-commands.sqlite3'
        with closing(sqlite3.connect(path)) as db, db:
            original = db.execute('SELECT run_id,stage_id,name,inputs_json,result_json,result_sha256 FROM stage_computations').fetchone()
        fields = ('run_id', 'stage_id', 'name', 'inputs_json', 'result_json', 'result_sha256')
        changes = {'run_id': 'invalid', 'stage_id': 'invalid', 'name': '',
            'inputs_json': '[]', 'result_json': None, 'result_sha256': 'wrong'}
        for field, changed in changes.items():
            with self.subTest(field=field):
                with closing(sqlite3.connect(path)) as db, db:
                    db.execute(f'UPDATE stage_computations SET {field}=?', (changed,))
                with self.assertRaises(ValueError): self.inspect()
                with closing(sqlite3.connect(path)) as db, db:
                    db.execute('UPDATE stage_computations SET run_id=?,stage_id=?,name=?,inputs_json=?,result_json=?,result_sha256=?', original)

if __name__ == '__main__': unittest.main()
