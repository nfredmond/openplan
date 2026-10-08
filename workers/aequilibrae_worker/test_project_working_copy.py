"""Separate mutable project files from the registered predecessor copy."""
import hashlib
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_command_journal as journal
import test_managed_project_handoff as handoff
from test_model_skip_dispatch import aeq


class ProjectWorkingCopyTests(unittest.TestCase):
    setUp = handoff.ManagedProjectHandoffTests.setUp
    response = handoff.ManagedProjectHandoffTests.response
    prepare = handoff.ManagedProjectHandoffTests.prepare

    def consumed(self):
        self.prepare()
        with managed.bind(self.writer):
            return aeq.retain_managed_predecessor_project()

    def test_mutating_working_database_preserves_retained_input(self):
        record = self.consumed()
        original = Path(record['package_directory']) / 'project_database.sqlite'
        original_bytes = original.read_bytes()
        result = self.writer.prepare_project_working_copy(record)
        copied = Path(result['project_directory']) / original.name
        self.assertNotEqual(copied.stat().st_ino, original.stat().st_ino)
        self.assertEqual(copied.read_bytes(), original_bytes)
        payload = self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'], 'model_project_working_copy')
        self.assertEqual(payload['content_hash'], hashlib.sha256(Path(result['initial_manifest_path']).read_bytes()).hexdigest())
        metadata = payload['metadata_json']
        self.assertEqual(metadata['input_manifest_sha256'], record['manifest_sha256'])
        self.assertEqual(metadata['producer'], record['producer'])
        self.assertEqual(metadata['role'], 'initial_working_inventory')
        self.assertIs(metadata['files_mutable'], True)
        self.assertIs(metadata['execution_ready'], False)
        self.assertIs(result['execution_ready'], False)
        connection = sqlite3.connect(copied)
        connection.execute('INSERT INTO evidence VALUES (99)')
        connection.commit()
        self.assertEqual(connection.execute('SELECT id FROM evidence ORDER BY id').fetchall(), [(7,), (99,)])
        connection.close()
        self.assertEqual(original.read_bytes(), original_bytes)
        with self.assertRaises(FileExistsError):
            self.writer.prepare_project_working_copy(record)
        self.assertTrue(self.writer.stopped)

    def test_foreign_manifest_stops_before_copy(self):
        record = self.consumed()
        record['manifest_path'] = str(self.directory / 'foreign/manifest.json')
        self.post.reset_mock()
        import model_project_inputs
        with patch.object(model_project_inputs, 'consume', side_effect=AssertionError('Foreign read')) as consume:
            with self.assertRaisesRegex(ValueError, 'owned consumed project'):
                self.writer.prepare_project_working_copy(record)
        consume.assert_not_called()
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_changed_retained_database_stops_before_registration(self):
        record = self.consumed()
        (Path(record['package_directory']) / 'project_database.sqlite').write_bytes(b'changed')
        self.post.reset_mock()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            self.writer.prepare_project_working_copy(record)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_lost_reply_retains_initial_inventory_and_stops(self):
        record = self.consumed()
        self.post.side_effect = TimeoutError('Synthetic lost reply')
        with self.assertRaises(Exception):
            self.writer.prepare_project_working_copy(record)
        self.assertTrue(self.writer.stopped)
        pending = journal.pending(self.directory, self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        payload = pending[0]['command']['arguments']['payload']
        self.assertEqual(payload['artifact_type'], 'model_project_working_copy')
        self.assertEqual(payload, self.post.call_args.kwargs['json']['p_payload'])
        self.assertTrue((self.writer.files.path / 'project_working/manifest.json').exists())


if __name__ == '__main__':unittest.main()
