"""Native WAL copies and retained command/computation behavior, without dispatch."""
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get('WORKER_JOURNAL_SNAPSHOT_TEST_SOURCE', Path(__file__).resolve().parents[1] / 'worker_journal_snapshot.py'))
spec = importlib.util.spec_from_file_location('worker_journal_snapshot', SOURCE)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'workers/aequilibrae_worker'))
import model_command_journal as journal
import model_stage_computation as computation
import model_command_client as client

BASE = 'http://127.0.0.1:39999'
DEPLOYMENT = 'synthetic-recovery-installation'
RUN = '98b50e2a-00ea-4a01-a1a4-a14e3bd764da'
STAGE = 'b2a5116c-ccbc-4914-9898-aed1c822e957'
COMMAND = {'request_id': 'synthetic-unresolved', 'destination': client.destination(BASE, DEPLOYMENT), 'operation': 'synthetic-custody', 'arguments': {'scientific_outcome': 'inconclusive'}}


class WorkerJournalSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source_directory = self.root / 'source'
        self.connection = journal.connect(self.source_directory)
        self.addCleanup(self.connection.close)
        self.connection.commit()
        self.connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.connection.execute('PRAGMA wal_autocheckpoint=0')
        self.source = self.source_directory / 'model-commands.sqlite3'
        self.destination = self.root / 'snapshot'

    def capture(self, **options):
        return snapshot.snapshot(self.source, self.destination, writers_quiesced=True, **options)

    def populate(self):
        journal.prepare(self.source_directory, COMMAND)
        resolved = {**COMMAND, 'request_id': 'synthetic-resolved'}
        journal.prepare(self.source_directory, resolved)
        journal.resolve(self.source_directory, resolved, {'id': 'synthetic-receipt', 'scientific_outcome': 'inconclusive'})
        computation.compute_once(self.source_directory, base_url=BASE, deployment_id=DEPLOYMENT, run_id=RUN, stage_id=STAGE, name='completed', inputs={'synthetic': True}, compute=lambda: {'scientific_outcome': 'inconclusive'})
        def interrupted():
            raise RuntimeError('Synthetic interruption after retained start')
        with self.assertRaisesRegex(RuntimeError, 'Synthetic interruption'):
            computation.compute_once(self.source_directory, base_url=BASE, deployment_id=DEPLOYMENT, run_id=RUN, stage_id=STAGE, name='interrupted', inputs={'synthetic': True}, compute=interrupted)

    def rows(self, path):
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as connection:
            tables = connection.execute("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").fetchall()
            return {name: connection.execute('SELECT * FROM "' + name.replace('"', '""') + '" ORDER BY rowid').fetchall() for (name,) in tables}

    def test_committed_wal_records_and_receipts_survive(self):
        self.populate()
        expected_rows = self.rows(self.source)
        self.assertGreater(Path(str(self.source) + '-wal').stat().st_size, 0)
        main_only = self.root / 'main-only.sqlite3'
        shutil.copyfile(self.source, main_only)
        self.assertNotEqual(self.rows(main_only), self.rows(self.source), 'fixture must expose main-file WAL loss')
        record = self.capture()
        copied = self.destination / 'model-commands.sqlite3'
        self.assertEqual(self.rows(copied), expected_rows, 'missing committed WAL records')
        self.assertEqual(self.rows(self.source), expected_rows, 'snapshot changed source records')
        self.assertEqual(journal.read_existing(self.destination, COMMAND['destination'], include_resolved=True), journal.read_existing(self.source_directory, COMMAND['destination'], include_resolved=True))
        self.assertEqual(record['sha256'], hashlib.sha256(copied.read_bytes()).hexdigest(), 'snapshot digest does not match bytes')
        self.assertEqual(record['sizeBytes'], copied.stat().st_size, 'snapshot size does not match bytes')
        self.assertEqual(json.loads((self.destination / 'snapshot.json').read_text()), record)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700)
        for path in [copied, self.destination / 'snapshot.json']:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(Path(str(copied) + '-wal').exists(), 'snapshot depends on a WAL sidecar')
        self.assertFalse((self.destination / '.snapshot.partial.json').exists())
        self.assertEqual(record['installationConsistency'], 'unassessed')

    def test_interrupted_start_refuses_replay_and_saved_result_needs_no_computation(self):
        self.populate()
        self.capture()
        calls = []
        options = dict(base_url=BASE, deployment_id=DEPLOYMENT, run_id=RUN, stage_id=STAGE, inputs={'synthetic': True}, compute=lambda: calls.append('called') or {'synthetic': True})
        self.assertEqual(computation.compute_once(self.destination, name='completed', **options), {'scientific_outcome': 'inconclusive'})
        with self.assertRaisesRegex(computation.ComputationUnconfirmed, 'previously started'):
            computation.compute_once(self.destination, name='interrupted', **options)
        self.assertEqual(calls, [], 'restored computation callback ran')

    def test_source_connection_refuses_database_writes(self):
        self.populate()
        native_connect = sqlite3.connect
        observations = []
        def connect(database, *args, **kwargs):
            connection = native_connect(database, *args, **kwargs)
            if str(database).startswith(self.source.as_uri()):
                observations.append('source opened')
                try:
                    with self.assertRaisesRegex(sqlite3.OperationalError, 'readonly'):
                        connection.execute('DELETE FROM commands')
                except BaseException:
                    connection.close()
                    raise
            return connection
        with patch.object(snapshot.sqlite3, 'connect', side_effect=connect):
            self.capture()
        self.assertEqual(observations, ['source opened'])

    def test_requires_declared_quiescence_before_destination_creation(self):
        with self.assertRaisesRegex(ValueError, 'Quiesce writers'):
            snapshot.snapshot(self.source, self.destination, writers_quiesced=False)
        self.assertFalse(self.destination.exists())

    def test_requires_positive_finite_deadline(self):
        for index, timeout in enumerate([float('inf'), float('nan'), 0, -1]):
            with self.subTest(timeout=timeout), self.assertRaisesRegex(ValueError, 'positive and finite'):
                snapshot.snapshot(self.source, self.root / f'invalid-timeout-{index}', writers_quiesced=True, timeout=timeout)
        self.assertFalse(self.destination.exists())

    def test_refuses_source_alias_before_destination_creation(self):
        aliases = self.root / 'aliases'
        aliases.mkdir(mode=0o700)
        alias = aliases / 'model-commands.sqlite3'
        alias.symlink_to(self.source)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            snapshot.snapshot(alias, self.destination, writers_quiesced=True)
        self.assertFalse(self.destination.exists())

    def test_refuses_accessible_journal(self):
        self.source.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'accessible'):
            self.capture()
        self.assertFalse(self.destination.exists())

    def test_refuses_hard_link_before_destination_creation(self):
        aliases = self.root / 'aliases'
        aliases.mkdir(mode=0o700)
        os.link(self.source, aliases / 'model-commands.sqlite3')
        with self.assertRaisesRegex(ValueError, 'hard-link alias'):
            self.capture()
        self.assertFalse(self.destination.exists())

    def test_refuses_foreign_owner_predicate(self):
        with patch.object(snapshot.os, 'getuid', return_value=os.getuid() + 1):
            with self.assertRaisesRegex(ValueError, 'another owner'):
                self.capture()
        self.assertFalse(self.destination.exists())

    def test_refuses_wrong_source_file_type(self):
        invalid = self.root / 'invalid-source'
        invalid.mkdir(mode=0o700)
        folder = invalid / 'model-commands.sqlite3'
        folder.mkdir(mode=0o700)
        try:
            snapshot.snapshot(folder, self.destination, writers_quiesced=True)
        except (OSError, ValueError, sqlite3.Error) as error:
            refused = error
        else:
            self.fail('invalid source type was admitted')
        self.assertFalse(self.destination.exists(), 'invalid source type created a destination')
        self.assertIsInstance(refused, ValueError)
        self.assertIn('wrong file type', str(refused))

    def test_refuses_another_database_name(self):
        other = self.source_directory / 'project_database.sqlite'
        shutil.copyfile(self.source, other)
        other.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'Expected a model'):
            snapshot.snapshot(other, self.destination, writers_quiesced=True)
        self.assertFalse(self.destination.exists())

    def test_refuses_output_inside_source_directory(self):
        with self.assertRaisesRegex(ValueError, 'outside the source'):
            snapshot.snapshot(self.source, self.source_directory / 'nested', writers_quiesced=True)
        self.assertFalse((self.source_directory / 'nested').exists())

    def test_normalizes_destination_parent_before_nested_refusal(self):
        sibling = self.root / 'sibling'
        sibling.mkdir(mode=0o700)
        disguised = sibling / '..' / 'source' / 'nested'
        with self.assertRaisesRegex(ValueError, 'outside the source'):
            snapshot.snapshot(self.source, disguised, writers_quiesced=True)
        self.assertFalse((self.source_directory / 'nested').exists())

    def test_normalizes_source_before_nested_refusal(self):
        sibling = self.root / 'sibling'
        sibling.mkdir(mode=0o700)
        disguised = sibling / '..' / 'source' / 'model-commands.sqlite3'
        with self.assertRaisesRegex(ValueError, 'outside the source'):
            snapshot.snapshot(disguised, self.source_directory / 'nested', writers_quiesced=True)
        self.assertFalse((self.source_directory / 'nested').exists())

    def test_preserves_an_existing_destination(self):
        self.destination.mkdir(mode=0o700)
        sentinel = self.destination / 'keep'
        sentinel.write_bytes(b'original retained point')
        with self.assertRaises(FileExistsError):
            self.capture()
        self.assertEqual(sentinel.read_bytes(), b'original retained point')
        self.assertEqual(list(self.destination.iterdir()), [sentinel])

    def test_rejects_native_index_corruption_without_completion_receipt(self):
        self.connection.close()
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.executescript('CREATE TABLE probe(a INTEGER); CREATE INDEX probe_index ON probe(a); INSERT INTO probe VALUES(7);')
            page = connection.execute("SELECT rootpage FROM sqlite_schema WHERE name='probe_index'").fetchone()[0]
            page_size = connection.execute('PRAGMA page_size').fetchone()[0]
            connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        data = bytearray(self.source.read_bytes())
        offset = (page - 1) * page_size
        cell = int.from_bytes(data[offset + 8:offset + 10], 'big')
        self.assertEqual(data[offset + cell:offset + cell + 5], b'\x04\x03\x01\x09\x07')
        data[offset + cell + 4] = 8
        self.source.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'integrity check failed'):
            self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists())

    def test_rejects_valid_sqlite_without_command_schema(self):
        self.connection.execute('DROP TABLE commands')
        self.connection.commit()
        with self.assertRaisesRegex(ValueError, 'not a model command journal'):
            self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists())

    def test_locked_source_cli_exits_at_deadline_without_receipt(self):
        self.connection.close()
        with closing(sqlite3.connect(self.source)) as connection:
            connection.execute('PRAGMA journal_mode=DELETE')
            connection.execute('BEGIN EXCLUSIVE')
            try:
                result = subprocess.run([sys.executable, '-B', str(SOURCE), '--source', str(self.source), '--destination', str(self.destination), '--writers-quiesced', '--timeout', '0.1'], capture_output=True, text=True, timeout=3)
            except subprocess.TimeoutExpired:
                self.fail('backup did not enforce its deadline')
            self.assertEqual(result.returncode, 1)
            self.assertIn('TimeoutError', result.stderr)
            self.assertFalse((self.destination / 'snapshot.json').exists())

    def test_completed_cli_emits_only_snapshot_metadata(self):
        self.populate()
        result = subprocess.run([sys.executable, '-B', str(SOURCE), '--source', str(self.source), '--destination', str(self.destination), '--writers-quiesced'], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('synthetic-unresolved', result.stdout, 'CLI disclosed command contents')
        self.assertNotIn(str(self.source), result.stdout)
        self.assertEqual(json.loads(result.stdout), json.loads((self.destination / 'snapshot.json').read_text()))

    def test_syncs_database_then_receipt_then_both_directories(self):
        synced = []
        native_sync, native_link = os.fsync, os.link
        def sync(fd):
            synced.append(('sync', os.readlink(f'/proc/self/fd/{fd}')))
            native_sync(fd)
        def link(source, target):
            synced.append(('publish', str(target)))
            native_link(source, target)
        with patch.object(snapshot.os, 'fsync', side_effect=sync), patch.object(snapshot.os, 'link', side_effect=link):
            self.capture()
        expected = [
            ('sync', str(self.destination / 'model-commands.sqlite3')),
            ('sync', str(self.destination / '.snapshot.partial.json')),
            ('publish', str(self.destination / 'snapshot.json')),
            ('sync', str(self.destination)),
            ('sync', str(self.destination.parent)),
        ]
        self.assertEqual(synced, expected, 'snapshot durability order changed')

    def test_failed_database_sync_never_publishes_receipt(self):
        with patch.object(snapshot, 'sync_file', side_effect=OSError('Synthetic database fsync failure')):
            with self.assertRaisesRegex(OSError, 'Synthetic database fsync failure'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists())

    def test_failed_atomic_publication_never_returns_completed_snapshot(self):
        with patch.object(snapshot.os, 'link', side_effect=OSError('Synthetic publication failure')):
            with self.assertRaisesRegex(OSError, 'Synthetic publication failure'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists())
        self.assertTrue((self.destination / '.snapshot.partial.json').exists())

    def test_failed_directory_sync_removes_completion_receipt(self):
        native_sync = os.fsync
        def sync(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError('Synthetic directory fsync failure')
            native_sync(fd)
        with patch.object(snapshot.os, 'fsync', side_effect=sync):
            with self.assertRaisesRegex(OSError, 'Synthetic directory fsync failure'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'failed directory durability retained a completion receipt')


if __name__ == '__main__':
    unittest.main()
