"""Native configured-root capture, refusal and publication tests."""
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))
import worker_root_snapshot as snapshot
WORKER = OPS.parents[2] / 'workers/aequilibrae_worker'
sys.path.insert(0, str(WORKER))
import model_command_journal as journal


class WorkerRootSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'source'
        self.source.mkdir(mode=0o700)
        self.destination = self.base / 'point'
        old_mask = os.umask(0o077)
        self.addCleanup(os.umask, old_mask)
        (self.source / 'inputs').mkdir(mode=0o700)
        (self.source / 'inputs/source.bin').write_bytes(bytes(range(256)))
        (self.source / 'outputs/empty').mkdir(parents=True, mode=0o700)
        (self.source / 'state.json').write_text('{"fixture":"synthetic","credential":"private-marker"}\n')
        self.connections = []
        for name, entered in [('claim', 0), ('progress', 1)]:
            directory = self.source / 'journals' / name
            connection = journal.connect(directory)
            self.connections.append(connection)
            self.addCleanup(connection.close)
            connection.execute('CREATE TABLE execution_admissions(request_id TEXT PRIMARY KEY, entered INTEGER)')
            connection.execute('CREATE TABLE retained_starts(name TEXT PRIMARY KEY, status TEXT)')
            connection.commit()
            connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            connection.execute('PRAGMA wal_autocheckpoint=0')
            command = {'request_id': 'synthetic-' + name, 'destination': 'original-installation', 'operation': 'synthetic', 'arguments': {}}
            journal.prepare(directory, command)
            if entered:
                journal.resolve(directory, command, {'synthetic': True})
            connection.execute('INSERT INTO execution_admissions VALUES(?,?)', (command['request_id'], entered))
            connection.execute('INSERT INTO retained_starts VALUES(?,?)', (name, 'interrupted'))
            connection.commit()
        project = self.source / 'project.sqlite'
        self.database = sqlite3.connect(project)
        self.addCleanup(self.database.close)
        self.database.execute('PRAGMA journal_mode=WAL')
        self.database.execute('CREATE TABLE artifacts(id INTEGER PRIMARY KEY,payload BLOB,value TEXT)')
        self.database.commit()
        self.database.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.database.execute('PRAGMA wal_autocheckpoint=0')
        self.database.execute('INSERT INTO artifacts VALUES(?,?,?)', (1, bytes(range(256)), 'original native blob'))
        self.database.commit()

    def capture(self, **kwargs):
        return snapshot.capture(self.source, self.destination, writers_quiesced=True, **kwargs)

    def logical(self, path):
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
            schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
            tables = {}
            for kind, name, _, _ in schema:
                if kind == 'table':
                    rows = db.execute('SELECT * FROM "' + name.replace('"', '""') + '" ORDER BY rowid').fetchall()
                    tables[name] = rows
            return schema, tables

    def test_complete_root_and_committed_wal_records(self):
        expected = {str(path.relative_to(self.source)): self.logical(path) for path in self.source.rglob('*') if path.name in ('model-commands.sqlite3', 'project.sqlite')}
        main_only = self.base / 'main-only.sqlite'
        shutil.copyfile(self.source / 'project.sqlite', main_only)
        self.assertNotEqual(self.logical(main_only), self.logical(self.source / 'project.sqlite'), 'fixture must expose lost WAL records')
        record = self.capture()
        self.assertEqual(len(record['sqliteCopies']), 3, 'missing a native database')
        for name, rows in expected.items():
            with closing(sqlite3.connect((self.destination / 'root' / name).as_uri() + '?mode=ro', uri=True)) as copied:
                self.assertEqual(copied.execute('PRAGMA journal_mode').fetchone(), ('delete',), 'retained mode requires DELETE')
            self.assertEqual(self.logical(self.destination / 'root' / name), rows, 'lost SQLite logical records')
            self.assertEqual(self.logical(self.source / name), rows, 'source records changed')
        self.assertTrue((self.destination / 'root/inputs/source.bin').is_file(), 'input file lost')
        self.assertTrue((self.destination / 'root/state.json').is_file(), 'state file lost')
        self.assertEqual((self.destination / 'root/inputs/source.bin').read_bytes(), bytes(range(256)), 'input bytes changed')
        self.assertEqual((self.destination / 'root/state.json').read_bytes(), (self.source / 'state.json').read_bytes(), 'state bytes changed')
        self.assertTrue((self.destination / 'root/outputs/empty').is_dir(), 'empty directory lost')
        self.assertFalse(any(p.name.endswith(('-wal', '-shm')) for p in (self.destination / 'root').rglob('*')), 'retained database depends on sidecars')
        self.assertEqual(snapshot.verify(self.destination), record, 'package does not verify')
        self.assertEqual(record['installationConsistency'], 'unassessed')
        self.assertEqual(record['quiescence'], 'operator_declared')
        self.assertEqual(record, json.loads((self.destination / 'snapshot.json').read_text()))
        self.assertEqual({p.name for p in self.destination.iterdir()}, {'root', 'snapshot.json'}, 'partial or extra publication')

    def test_closed_wal_databases_allow_only_reader_sidecars(self):
        for connection in self.connections:
            connection.close()
        self.database.close()
        record = self.capture()
        self.assertEqual(len(record['sqliteCopies']), 3)
        self.assertEqual(snapshot.verify(self.destination), record)

    def test_crashed_writer_committed_wal_and_blob_survive(self):
        path = self.source / 'crashed.sqlite'
        code = "import os,sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA journal_mode=WAL');c.execute('CREATE TABLE custody(id INTEGER,payload BLOB)');c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.execute('PRAGMA wal_autocheckpoint=0');c.execute('INSERT INTO custody VALUES(1,?)',(bytes(range(256)),));c.commit();os._exit(0)"
        result = subprocess.run([sys.executable, '-B', '-c', code, str(path)], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertGreater(Path(str(path) + '-wal').stat().st_size, 0, 'crash fixture lacks committed WAL')
        self.capture()
        with closing(sqlite3.connect(self.destination / 'root/crashed.sqlite')) as copied:
            self.assertEqual(copied.execute('SELECT id,payload FROM custody').fetchall(), [(1, bytes(range(256)))], 'crashed committed blob lost')
        snapshot.verify(self.destination)

    def test_new_nonempty_wal_cannot_be_ignored_as_reader_artifact(self):
        before = {'project.sqlite': {'kind': 'file', 'sqlite': True}}
        for size, digest in [(1, hashlib.sha256(b'x').hexdigest()), (0, 'not-empty-hash')]:
            after = {**before, 'project.sqlite-wal': {'kind': 'file', 'sizeBytes': size, 'sha256': digest}}
            with self.subTest(size=size), self.assertRaisesRegex(ValueError, 'source changed'):
                snapshot.stable_source(before, after, {'project.sqlite'})

    def test_existing_populated_wal_change_refused(self):
        before = {'project.sqlite': {'kind': 'file', 'sqlite': True}, 'project.sqlite-wal': {'kind': 'file', 'sizeBytes': 1, 'sha256': 'original'}}
        after = {**before, 'project.sqlite-wal': {'kind': 'file', 'sizeBytes': 0, 'sha256': hashlib.sha256(b'').hexdigest()}}
        with self.assertRaisesRegex(ValueError, 'source changed'):
            snapshot.stable_source(before, after, {'project.sqlite'})

    def test_verify_nonobject_manifest_refused(self):
        self.capture()
        (self.destination / 'snapshot.json').write_text('[]')
        with self.assertRaisesRegex(ValueError, 'manifest format differs'):
            snapshot.verify(self.destination)

    def test_busy_native_sqlite_backup_deadline_refused(self):
        path = self.source / 'blocked.sqlite'
        with closing(sqlite3.connect(path)) as locked:
            locked.execute('CREATE TABLE blocking(id INTEGER)')
            locked.commit()
            locked.execute('BEGIN EXCLUSIVE')
            try:
                with self.assertRaisesRegex(TimeoutError, 'exceeded its deadline'):
                    self.capture(timeout=0.03)
            finally:
                locked.rollback()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'busy native backup published success')

    def test_private_modes_and_read_only_subdirectory_preserved(self):
        (self.source / 'inputs').chmod(0o500)
        (self.source / 'inputs/source.bin').chmod(0o400)
        self.capture()
        self.assertEqual((self.destination / 'root/inputs').stat().st_mode & 0o777, 0o500, 'directory mode changed')
        self.assertEqual((self.destination / 'root/inputs/source.bin').stat().st_mode & 0o777, 0o400, 'file mode changed')
        self.assertEqual((self.destination / 'snapshot.json').stat().st_mode & 0o777, 0o600, 'manifest is not private')
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700, 'package is not private')

    def test_requires_declared_quiescence(self):
        with self.assertRaisesRegex(ValueError, 'Quiesce writers'):
            snapshot.capture(self.source, self.destination, writers_quiesced=False)
        self.assertFalse(self.destination.exists(), 'refusal created a destination')

    def test_finite_positive_deadline_required(self):
        for value in (0, -1, float('nan'), float('inf')):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'positive and finite'):
                self.capture(timeout=value)
        self.assertFalse(self.destination.exists())

    def test_capture_infinite_timeout_refused(self):
        with self.assertRaisesRegex(ValueError, 'positive and finite'):
            self.capture(timeout=float('inf'))
        self.assertFalse(self.destination.exists())

    def test_verify_infinite_timeout_refused(self):
        self.capture()
        with self.assertRaisesRegex(ValueError, 'positive and finite'):
            snapshot.verify(self.destination, timeout=float('inf'))

    def test_existing_destination_not_reused(self):
        self.destination.mkdir(mode=0o700)
        (self.destination / 'retained').write_bytes(b'original')
        with self.assertRaises(FileExistsError):
            self.capture()
        self.assertEqual((self.destination / 'retained').read_bytes(), b'original', 'existing point was altered')

    def test_nested_destination_refused(self):
        for destination in (self.source, self.source / 'point'):
            with self.subTest(destination=destination), self.assertRaisesRegex(ValueError, 'outside the source'):
                snapshot.capture(self.source, destination, writers_quiesced=True)

    def test_extra_retained_path_refuses_publication(self):
        native = snapshot.copy_file
        def extra(*args):
            native(*args)
            (self.destination / 'root/unexpected').mkdir(mode=0o700, exist_ok=True)
        with mock.patch.object(snapshot, 'copy_file', side_effect=extra):
            with self.assertRaisesRegex(ValueError, 'worker-root paths differ'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'extra retained path published success')

    def test_copied_sqlite_mode_change_refused(self):
        (self.source / 'project.sqlite').chmod(0o400)
        native = Path.chmod
        def changed(path, mode, *args, **kwargs):
            if path == self.destination / 'root/project.sqlite':
                mode = 0o600
            return native(path, mode, *args, **kwargs)
        with mock.patch.object(Path, 'chmod', changed):
            with self.assertRaisesRegex(ValueError, 'SQLite file mode or type differs'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'changed SQLite mode published success')

    def test_manifest_file_is_synced_before_publication(self):
        native = os.fsync
        observed = []
        def sync(descriptor):
            observed.append(Path(os.readlink('/proc/self/fd/' + str(descriptor))))
            return native(descriptor)
        with mock.patch.object(os, 'fsync', side_effect=sync):
            self.capture()
        self.assertIn(self.destination / '.snapshot.partial.json', observed, 'manifest bytes were not synced')

    def test_aliases_and_accessible_sources_refused(self):
        original = self.source / 'inputs/source.bin'
        for kind in ('symlink', 'hardlink', 'accessible'):
            bad = self.source / 'bad'
            try:
                if kind == 'symlink':
                    bad.symlink_to(original)
                elif kind == 'hardlink':
                    os.link(original, bad)
                else:
                    bad.write_bytes(b'private');bad.chmod(0o644)
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'symlink|hard-link alias|accessible'):
                    self.capture()
                self.assertFalse(self.destination.exists())
            finally:
                bad.unlink()

    def test_orphan_sidecar_refused(self):
        (self.source / 'missing.sqlite-wal').write_bytes(b'orphan')
        with self.assertRaisesRegex(ValueError, 'orphan SQLite sidecar'):
            self.capture()
        self.assertFalse(self.destination.exists())

    def test_named_journal_requires_sqlite_header(self):
        directory = self.source / 'bad-journal'
        directory.mkdir(mode=0o700)
        (directory / 'model-commands.sqlite3').write_bytes(b'not sqlite')
        with self.assertRaisesRegex(ValueError, 'no SQLite header'):
            self.capture()
        self.assertFalse(self.destination.exists())

    def test_named_journal_requires_command_schema(self):
        directory = self.source / 'bad-journal'
        directory.mkdir(mode=0o700)
        with closing(sqlite3.connect(directory / 'model-commands.sqlite3')) as db:
            db.execute('CREATE TABLE unrelated(id INTEGER)')
        with self.assertRaisesRegex(ValueError, 'command schema differs'):
            self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'refused schema published a manifest')

    def test_observed_source_mutation_refused(self):
        native = snapshot.copy_file
        def mutate(*args):
            native(*args)
            (self.source / 'inputs/source.bin').write_bytes(b'changed source after original copy')
        with mock.patch.object(snapshot, 'copy_file', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'source changed'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'changing source published a manifest')

    def test_read_only_sqlite_connections(self):
        native = snapshot.sqlite3.connect
        observed = []
        def connect(path, *args, **kwargs):
            if kwargs.get('uri'):
                self.assertTrue(str(path).endswith('?mode=ro'), 'source connection is writable')
                observed.append(str(path))
            return native(path, *args, **kwargs)
        with mock.patch.object(snapshot.sqlite3, 'connect', side_effect=connect):
            self.capture()
        self.assertEqual(len(observed), 3, 'native source backup was bypassed')

    def test_copy_deadline_refuses_publication(self):
        with mock.patch.object(snapshot.time, 'monotonic', side_effect=range(100000)):
            with self.assertRaisesRegex(TimeoutError, 'exceeded its deadline'):
                self.capture(timeout=0.01)
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'deadline failure published a manifest')

    def test_directory_sync_failure_refuses_success_receipt(self):
        native = snapshot.sync_directory
        def sync(path):
            if path == self.destination:
                raise OSError('synthetic publication sync failure')
            return native(path)
        with mock.patch.object(snapshot, 'sync_directory', side_effect=sync):
            with self.assertRaisesRegex(OSError, 'publication sync failure'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'failed publication retained a success receipt')

    def test_verify_changed_file_missing_directory_and_extra_entry(self):
        self.capture()
        for kind in ('bytes', 'directory', 'extra'):
            target = self.destination / 'root/inputs/source.bin'
            try:
                if kind == 'bytes':
                    target.write_bytes(b'changed')
                elif kind == 'directory':
                    (self.destination / 'root/outputs/empty').rmdir()
                else:
                    (self.destination / 'extra').write_bytes(b'extra')
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'content differs|extra or incomplete'):
                    snapshot.verify(self.destination)
            finally:
                if kind == 'bytes':target.write_bytes(bytes(range(256)))
                elif kind == 'directory':(self.destination / 'root/outputs/empty').mkdir(mode=0o700)
                else:(self.destination / 'extra').unlink()
            snapshot.verify(self.destination)

    def test_copy_byte_corruption_refuses_publication(self):
        native = snapshot.copy_file
        def corrupt(*args):
            native(*args)
            args[1].write_bytes(b'broken copied bytes')
        with mock.patch.object(snapshot, 'copy_file', side_effect=corrupt):
            with self.assertRaisesRegex(ValueError, 'ordinary bytes or directories differ'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'corrupt ordinary bytes published success')

    def test_private_sqlite_mode_preserved(self):
        (self.source / 'project.sqlite').chmod(0o400)
        self.capture()
        self.assertEqual((self.destination / 'root/project.sqlite').stat().st_mode & 0o777, 0o400, 'SQLite mode changed')

    def test_changed_copied_sqlite_header_refused(self):
        native = snapshot.copy_database
        def corrupt(source, target, deadline):
            native(source, target, deadline)
            content = target.read_bytes()
            target.write_bytes(b'not-sqlite-header' + content[17:])
        with mock.patch.object(snapshot, 'copy_database', side_effect=corrupt):
            with self.assertRaisesRegex(ValueError, 'SQLite file mode or type differs'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists(), 'changed SQLite type published success')

    def test_native_copy_reports_bad_integrity_or_mode_refused(self):
        native = snapshot.sqlite3.connect
        class Result:
            def __init__(self, rows):self.rows = rows
            def fetchone(self):return self.rows[0]
            def fetchall(self):return self.rows
        class Copied:
            def __init__(self, connection, bad):self.connection, self.bad = connection, bad
            def execute(self, sql):
                if sql == 'PRAGMA integrity_check' and self.bad == 'integrity':return Result([('synthetic bad integrity',)])
                if sql == 'PRAGMA journal_mode=DELETE' and self.bad == 'mode':return Result([('wal',)])
                return self.connection.execute(sql)
            def close(self):self.connection.close()
        class Original:
            def __init__(self, connection):self.connection = connection
            def backup(self, target, **kwargs):return self.connection.backup(target.connection, **kwargs)
            def close(self):self.connection.close()
        for bad, reason in [('integrity', 'integrity check failed'), ('mode', 'mode is not DELETE')]:
            def connect(path, *args, **kwargs):
                connection = native(path, *args, **kwargs)
                return Original(connection) if kwargs.get('uri') else Copied(connection, bad)
            self.destination = self.base / ('point-' + bad)
            with self.subTest(bad=bad), mock.patch.object(snapshot.sqlite3, 'connect', side_effect=connect):
                with self.assertRaisesRegex(ValueError, reason):self.capture()
            self.assertFalse((self.destination / 'snapshot.json').exists(), 'bad SQLite report published success')

    def test_files_and_directories_and_parent_are_synced(self):
        native_file, native_directory = snapshot.journal.sync_file, snapshot.sync_directory
        with mock.patch.object(snapshot.journal, 'sync_file', wraps=native_file) as file_sync, mock.patch.object(snapshot, 'sync_directory', wraps=native_directory) as directory_sync:
            record = self.capture()
        expected_files = {self.destination / 'root' / name for name, row in record['retainedEntries'].items() if row['kind'] == 'file'}
        self.assertEqual({call.args[0] for call in file_sync.call_args_list}, expected_files, 'retained files were not all synced')
        expected_directories = {self.destination, self.destination.parent} | {self.destination / 'root' / name for name, row in record['retainedEntries'].items() if row['kind'] == 'directory'}
        self.assertEqual({call.args[0] for call in directory_sync.call_args_list}, expected_directories, 'directories or parent were not synced')

    def test_verify_missing_or_changed_sqlite_mappings_refused(self):
        original = self.capture()
        for kind in ('missing', 'nonlist', 'empty', 'changed-method', 'changed-path'):
            record = json.loads(json.dumps(original))
            if kind == 'missing':del record['sqliteCopies']
            elif kind == 'nonlist':record['sqliteCopies'] = 'not-a-list'
            elif kind == 'empty':record['sqliteCopies'] = []
            elif kind == 'changed-method':record['sqliteCopies'][0]['method'] = 'main-file-only'
            else:record['sqliteCopies'][0]['retainedRelativePath'] = 'other.sqlite'
            (self.destination / 'snapshot.json').write_text(json.dumps(record))
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'SQLite mappings differ'):
                snapshot.verify(self.destination)

    def test_cli_missing_sqlite_mapping_has_controlled_refusal(self):
        record = self.capture()
        del record['sqliteCopies']
        (self.destination / 'snapshot.json').write_text(json.dumps(record))
        result = subprocess.run([sys.executable, '-B', str(OPS / 'worker_root_snapshot.py'), '--destination', str(self.destination), '--verify'], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b'Worker-root snapshot refused (ValueError)', result.stderr, 'manifest refusal was not controlled')
        self.assertNotIn(b'Traceback', result.stderr, 'malformed manifest leaked an uncaught traceback')
        self.assertEqual(result.stdout, b'')

    def test_verify_foreign_manifest_format_refused(self):
        record = self.capture()
        record['format'] = 'foreign'
        (self.destination / 'snapshot.json').write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'manifest format differs'):
            snapshot.verify(self.destination)

    def test_cli_missing_source_and_mixed_verify_refused(self):
        self.capture()
        original_manifest = (self.destination / 'snapshot.json').read_bytes()
        common = [sys.executable, '-B', str(OPS / 'worker_root_snapshot.py'), '--destination', str(self.destination)]
        for extra in ([], ['--verify', '--source', str(self.source)], ['--verify', '--writers-quiesced']):
            result = subprocess.run(common + extra, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 2, 'invalid CLI scope accepted')
        self.assertEqual((self.destination / 'snapshot.json').read_bytes(), original_manifest, 'invalid CLI changed existing package')

    def test_cli_capture_and_verify_do_not_print_private_metadata(self):
        common = [sys.executable, '-B', str(OPS / 'worker_root_snapshot.py'), '--destination', str(self.destination)]
        first = subprocess.run(common + ['--source', str(self.source), '--writers-quiesced'], capture_output=True, timeout=10)
        self.assertEqual(first.returncode, 0, first.stderr.decode())
        result = json.loads(first.stdout)
        self.assertEqual(result['sqliteCopies'], 3)
        self.assertFalse(result['verified'])
        self.assertEqual(result['manifestSha256'], hashlib.sha256((self.destination / 'snapshot.json').read_bytes()).hexdigest())
        second = subprocess.run(common + ['--verify'], capture_output=True, timeout=10)
        self.assertEqual(second.returncode, 0, second.stderr.decode())
        self.assertTrue(json.loads(second.stdout)['verified'])
        for output in (first.stdout, second.stdout):
            self.assertNotIn(b'private-marker', output, 'private state was printed')
            self.assertNotIn(str(self.source).encode(), output, 'private source path was printed')


if __name__ == '__main__':
    unittest.main()
