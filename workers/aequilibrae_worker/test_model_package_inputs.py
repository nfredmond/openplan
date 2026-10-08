"""Package retention checks use real trees and injected source changes."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_package_inputs as package


class PackageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        (self.source / 'manifest.json').write_bytes(b'{"files":{"zones":"zones.csv"}}')
        (self.source / 'zones.csv').write_bytes(b'zone,population\n1,123\n')
        (self.source / 'od_auto_matrix_calibrated.csv').write_bytes(b'zone,1\n1,17\n')
        (self.source / 'nested').mkdir()
        (self.source / 'nested/empty').mkdir()
        (self.source / 'nested/source.json').write_bytes(b'{"year":2020}')
        self.target = self.root / 'retained'

    def retain(self):
        return package.retain(self.source, self.target)

    def test_all_generated_files_and_empty_directories_retained(self):
        result = self.retain()
        content = Path(result['manifest_path']).read_bytes()
        self.assertEqual(result['manifest_sha256'], hashlib.sha256(content).hexdigest())
        self.assertEqual(result['manifest_size_bytes'], len(content))
        record = json.loads(content)
        self.assertEqual(set(record['entries']), {'manifest.json','zones.csv','od_auto_matrix_calibrated.csv','nested','nested/empty','nested/source.json'})
        for name, entry in record['entries'].items():
            copied = self.target / 'files' / name
            original = self.source / name
            self.assertNotEqual(copied.stat().st_ino, original.stat().st_ino)
            if entry['kind'] == 'file':
                self.assertEqual(copied.read_bytes(), original.read_bytes())
                self.assertEqual(entry['sha256'], hashlib.sha256(copied.read_bytes()).hexdigest())
                self.assertEqual(entry['size_bytes'], len(copied.read_bytes()))
                self.assertEqual(copied.stat().st_mode & 0o777, 0o600)
            else:
                self.assertTrue(copied.is_dir())
        self.assertEqual(record['database_consistency'], 'unassessed')
        self.assertEqual(record['scientific_acceptance'], 'unassessed')

    def test_no_existing_destination_or_source_reuse(self):
        self.retain()
        with self.assertRaises(FileExistsError):
            self.retain()
        with self.assertRaisesRegex(ValueError, 'inside'):
            package.retain(self.source, self.source / 'new')

    def test_links_and_special_files_refused(self):
        for kind in ('symlink','hardlink','fifo'):
            path = self.source / 'bad'
            if kind == 'symlink':
                path.symlink_to(self.source / 'zones.csv')
            elif kind == 'hardlink':
                os.link(self.source / 'zones.csv', path)
            else:
                os.mkfifo(path)
            self.target = self.root / kind
            with self.assertRaisesRegex(ValueError, 'private regular'):
                self.retain()
            self.assertFalse((self.target / 'manifest.json').exists())
            path.unlink()

    def test_changed_earlier_file_refuses_manifest(self):
        real_stat = package.os.stat
        changed = False
        def mutate(path, *args, **kwargs):
            nonlocal changed
            if path == 'zones.csv' and not changed:
                changed = True
                (self.source / 'manifest.json').write_bytes(b'changed after copying')
            return real_stat(path, *args, **kwargs)
        with patch.object(package.os, 'stat', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'entry changed'):
                self.retain()
        self.assertFalse((self.target / 'manifest.json').exists())

    def test_late_added_file_refuses_manifest(self):
        real_listdir = package.os.listdir
        calls = 0
        def mutate(path):
            nonlocal calls
            calls += 1
            if calls == 2:
                (self.source / 'new.csv').write_bytes(b'late')
            return real_listdir(path)
        with patch.object(package.os, 'listdir', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'directory changed'):
                self.retain()
        self.assertFalse((self.target / 'manifest.json').exists())

    def test_root_symlink_refused(self):
        link = self.root / 'link'
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(OSError):
            package.retain(link, self.target)
        self.assertFalse(self.target.exists())


class BoundPackageTests(unittest.TestCase):
    from test_model_attempt_outputs import OutputTests
    response = OutputTests.response
    def setUp(self):
        from test_model_attempt_writer import WriterTests
        WriterTests.setUp(self)

    def prepare(self):
        from test_model_command_client import IDS
        root = self.writer.workspace(self.directory / 'runs', IDS[1])
        source = root / 'package'
        source.mkdir()
        (source / 'zones.csv').write_bytes(b'zone,population\n1,123\n')
        return source

    def test_owned_package_registers_exact_manifest(self):
        source = self.prepare()
        retained = self.writer.retain_package(source)
        payload = self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'], 'model_package_inputs')
        self.assertEqual(payload['file_url'], 'local://' + retained['manifest_path'])
        self.assertEqual(payload['content_hash'], hashlib.sha256(Path(retained['manifest_path']).read_bytes()).hexdigest())
        self.assertEqual(payload['metadata_json']['database_consistency'], 'unassessed')

    def test_foreign_package_refused_without_registration(self):
        self.prepare()
        foreign = self.directory / 'foreign'
        foreign.mkdir()
        with self.assertRaisesRegex(ValueError, 'owned attempt'):
            self.writer.retain_package(foreign)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_lost_reply_stops_and_preserves_pending_command(self):
        import model_command_journal as journal
        source = self.prepare()
        self.post.side_effect = TimeoutError('synthetic lost reply')
        with self.assertRaises(Exception):
            self.writer.retain_package(source)
        self.assertTrue(self.writer.stopped)
        self.assertTrue((self.writer.files.path / 'package_inputs/manifest.json').exists())
        pending = journal.pending(self.directory, self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'], 'model_package_inputs')
