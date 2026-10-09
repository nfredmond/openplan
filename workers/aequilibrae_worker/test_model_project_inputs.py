"""Real SQLite files, with no engine or cross-database acceptance claim."""
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import model_project_inputs as project


class ProjectInputsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.database = self.source / 'project_database.sqlite'
        connection = sqlite3.connect(self.database)
        connection.execute('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT)')
        connection.execute("INSERT INTO evidence VALUES (1, 'original')")
        connection.commit()
        connection.close()
        (self.source / 'parameters.yml').write_text('system: synthetic\n')
        self.target = self.root / 'retained'

    def retain(self):
        return project.retain(self.source, self.target)

    def test_snapshot_and_consumer_preserve_independent_database(self):
        original = self.database.read_bytes()
        result = self.retain()
        copy = project.consume(result, self.root / 'consumer')
        for record in (result, copy):
            path = Path(record['package_directory']) / self.database.name
            self.assertEqual(path.read_bytes(), original)
            self.assertNotEqual(path.stat().st_ino, self.database.stat().st_ino)
            self.assertEqual(record['database_checks'][self.database.name]['sha256'], hashlib.sha256(original).hexdigest())
            self.assertEqual(record['cross_database_consistency'], 'unassessed')
            self.assertEqual(record['scientific_acceptance'], 'unassessed')
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute('SELECT * FROM evidence').fetchall(), [(1, 'original')])
            connection.close()
        self.assertEqual(self.database.read_bytes(), original)

    def test_harmless_extra_text_file(self):
        (self.source / 'notes.txt').write_text('Harmless note')
        result = self.retain()
        self.assertEqual(len(result['database_checks']), 1)
        self.assertEqual((Path(result['package_directory']) / 'notes.txt').read_text(), 'Harmless note')

    def test_missing_and_corrupt_database_refused(self):
        self.database.unlink()
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.retain()
        self.target = self.root / 'corrupt'
        self.database.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'header'):
            self.retain()

    def test_sidecars_refused(self):
        for suffix in ('-wal', '-shm', '-journal', '-mj synthetic'):
            with self.subTest(suffix=suffix):
                marker = Path(str(self.database) + suffix)
                marker.write_bytes(b'')
                self.target = self.root / ('copy' + suffix)
                with self.assertRaisesRegex(ValueError, 'sidecar'):
                    self.retain()
                marker.unlink()

    def test_committed_wal_not_silently_omitted(self):
        connection = sqlite3.connect(self.database)
        self.addCleanup(connection.close)
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute("INSERT INTO evidence VALUES (2, 'in WAL')")
        connection.commit()
        self.assertTrue(Path(str(self.database) + '-wal').exists())
        with self.assertRaisesRegex(ValueError, 'sidecar'):
            self.retain()
        self.assertEqual(connection.execute('SELECT COUNT(*) FROM evidence').fetchone(), (2,))

    def test_secondary_database_checked(self):
        (self.source / 'results_database.sqlite').write_bytes(b'bad secondary database')
        with self.assertRaisesRegex(ValueError, 'header'):
            self.retain()

    def test_registered_database_tamper_refused(self):
        result = self.retain()
        connection = sqlite3.connect(Path(result['package_directory']) / self.database.name)
        connection.execute("UPDATE evidence SET value='changed'")
        connection.commit()
        connection.close()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            project.consume(result, self.root / 'consumer')

    def test_source_change_during_capture_refused(self):
        real_stat = project.package.os.stat
        changed = False
        def mutate(path, *args, **kwargs):
            nonlocal changed
            if path == 'project_database.sqlite' and not changed:
                changed = True
                (self.source / 'parameters.yml').write_text('changed during capture')
            return real_stat(path, *args, **kwargs)
        with patch.object(project.package.os, 'stat', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'entry changed'):
                self.retain()

    def test_integrity_failure_refused(self):
        class Connection:
            def execute(self, query): return self
            def fetchall(self): return [('corrupt page',)]
            def close(self): pass
        with patch.object(project.sqlite3, 'connect', return_value=Connection()):
            with self.assertRaisesRegex(ValueError, 'integrity check failed'):
                self.retain()


if __name__ == '__main__':
    unittest.main()
