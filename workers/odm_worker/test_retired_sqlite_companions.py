"""Native companion retirement at the journal's metadata lookup boundary.

The lookup seam pins the same inode before actual SQLite close/unlink. It exposes
its actual zero-link metadata, without weakening the production predicate.
"""
import os
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import admission_journal as module
import test_admission_journal as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.Checks();self.fixture.setUp()
        self.original, _created = self.fixture.admit()
        self.root = self.fixture.root;self.journal = self.fixture.journal

    def tearDown(self):
        self.fixture.tearDown()

    def retire(self, suffix, pin):
        owner = sqlite3.connect(self.root / module.FILENAME)
        owner.execute('SELECT * FROM admissions').fetchall()
        companion = self.root / (module.FILENAME + suffix)
        self.assertTrue(companion.exists(), 'Actual SQLite companion must exist before retirement')
        original_stat = Path.lstat;observed = []
        def lookup(path):
            if path == companion and not observed:
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW) if pin else None
                owner.close()
                try:
                    if pin:
                        value = os.fstat(descriptor);observed.append(value.st_nlink)
                        self.assertEqual(value.st_nlink, 0, 'Actual retired inode must have zero links')
                        return value
                    observed.append('missing')
                    return original_stat(path)
                finally:
                    if descriptor is not None:
                        os.close(descriptor)
            return original_stat(path)
        try:
            with patch.object(Path, 'lstat', lookup):
                try:
                    result = self.journal.get(fixture.request()['requestId'])
                except (FileNotFoundError, ValueError) as error:
                    raise AssertionError('Retired companion must preserve its committed original: ' + type(error).__name__) from None
            self.assertEqual(result, self.original, 'Retired companion must preserve the committed original')
            self.assertEqual(observed, [0] if pin else ['missing'], 'Actual retired companion lookup must be observed')
        finally:
            owner.close()

    def test_unlinked_inode_metadata_does_not_refuse_committed_original(self):
        for suffix in ('-wal', '-shm'):
            with self.subTest(suffix=suffix):
                self.retire(suffix, True)

    def test_missing_companion_retirement_preserves_original(self):
        for suffix in ('-wal', '-shm'):
            with self.subTest(suffix=suffix):
                self.retire(suffix, False)

    def test_present_unsafe_companion_still_refuses_before_sqlite(self):
        for suffix in ('-wal', '-shm'):
            companion = self.root / (module.FILENAME + suffix)
            companion.write_bytes(b'');companion.chmod(0o644)
            try:
                with patch.object(module.sqlite3, 'connect', side_effect=AssertionError('Present unsafe companion reached SQLite')) as opened:
                    with self.assertRaisesRegex(ValueError, 'ODM journal path must be private'):
                        self.journal.get(fixture.request()['requestId'])
                    self.assertEqual(opened.call_count, 0, 'Present unsafe companion cannot open SQLite')
            finally:
                companion.unlink()

    def test_dangling_alias_is_not_a_missing_companion(self):
        companion = self.root / (module.FILENAME + '-wal')
        companion.symlink_to(self.fixture.base / 'missing-target')
        try:
            with patch.object(module.sqlite3, 'connect', side_effect=AssertionError('Dangling companion alias reached SQLite')) as opened:
                with self.assertRaisesRegex(ValueError, 'ODM journal path must be private'):
                    self.journal.get(fixture.request()['requestId'])
                self.assertEqual(opened.call_count, 0, 'Dangling companion alias cannot open SQLite')
        finally:
            companion.unlink()

    def test_reappeared_alias_after_missing_lookup_refuses_before_sqlite(self):
        companion = self.root / (module.FILENAME + '-wal');companion.write_bytes(b'');companion.chmod(0o600)
        actual = Path.lstat;changed = []
        def lookup(path):
            if path == companion and not changed:
                companion.unlink();companion.symlink_to(self.fixture.base / 'missing-target');changed.append(True)
                raise FileNotFoundError('Controlled path lookup finishes after unlink')
            return actual(path)
        try:
            with patch.object(Path, 'lstat', lookup), patch.object(module.sqlite3, 'connect', side_effect=AssertionError('Reappeared companion alias reached SQLite')) as opened:
                with self.assertRaises(FileNotFoundError, msg='Reappeared companion alias must refuse its failed lookup'):
                    self.journal.get(fixture.request()['requestId'])
                self.assertEqual(opened.call_count, 0, 'Reappeared companion alias cannot open SQLite')
        finally:
            companion.unlink()


if __name__ == '__main__':
    unittest.main()
