"""Separate mutable output files from the registered predecessor copy."""
import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_command_journal as journal
import test_managed_output_handoff as handoff
from test_model_skip_dispatch import aeq


class OutputWorkingCopyTests(unittest.TestCase):
    setUp = handoff.OutputHandoffTests.setUp
    response = handoff.OutputHandoffTests.response
    prepare = handoff.OutputHandoffTests.prepare

    def consumed(self):
        self.prepare()
        with managed.bind(self.writer):
            return aeq.retain_managed_predecessor_outputs()

    def test_mutating_working_file_preserves_retained_input(self):
        record = self.consumed()
        original = Path(record['outputs_directory']) / 'link_volumes.csv'
        original_bytes = original.read_bytes()
        result = self.writer.prepare_output_working_copy(record)
        copied = Path(result['outputs_directory']) / original.name
        self.assertNotEqual(copied.stat().st_ino, original.stat().st_ino)
        self.assertEqual(copied.read_bytes(), original_bytes)
        payload = self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'], 'model_output_working_copy')
        self.assertEqual(payload['content_hash'], hashlib.sha256(Path(result['initial_manifest_path']).read_bytes()).hexdigest())
        metadata = payload['metadata_json']
        self.assertEqual(metadata['input_manifest_sha256'], record['manifest_sha256'])
        self.assertEqual(metadata['producer'], record['producer'])
        self.assertEqual(metadata['role'], 'initial_working_inventory')
        self.assertIs(metadata['files_mutable'], True)
        self.assertIs(metadata['execution_ready'], False)
        self.assertIs(result['execution_ready'], False)
        copied.write_bytes(b'zone,population\n1,999\n')
        self.assertNotEqual(copied.read_bytes(), original_bytes)
        self.assertEqual(original.read_bytes(), original_bytes)
        with self.assertRaises(FileExistsError):
            self.writer.prepare_output_working_copy(record)
        self.assertTrue(self.writer.stopped)

    def test_foreign_manifest_stops_before_copy(self):
        record = self.consumed()
        record['manifest_path'] = str(self.directory / 'foreign/manifest.json')
        self.post.reset_mock()
        import model_package_inputs
        with patch.object(model_package_inputs, 'consume', side_effect=AssertionError('Foreign read')) as consume:
            with self.assertRaisesRegex(ValueError, 'owned consumed outputs'):
                self.writer.prepare_output_working_copy(record)
        consume.assert_not_called()
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_changed_retained_file_stops_before_registration(self):
        record = self.consumed()
        (Path(record['outputs_directory']) / 'link_volumes.csv').write_bytes(b'changed')
        self.post.reset_mock()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            self.writer.prepare_output_working_copy(record)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_lost_reply_retains_initial_inventory_and_stops(self):
        record = self.consumed()
        self.post.side_effect = TimeoutError('Synthetic lost reply')
        with self.assertRaises(Exception):
            self.writer.prepare_output_working_copy(record)
        self.assertTrue(self.writer.stopped)
        self.assertIsNone(self.writer._working_outputs)
        pending = journal.pending(self.directory, self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        payload = pending[0]['command']['arguments']['payload']
        self.assertEqual(payload['artifact_type'], 'model_output_working_copy')
        self.assertEqual(payload, self.post.call_args.kwargs['json']['p_payload'])
        self.assertTrue((self.writer.files.path / 'output_working/manifest.json').exists())

    def test_confirmed_directory_is_bound_to_current_attempt(self):
        record = self.consumed()
        result = self.writer.prepare_output_working_copy(record)
        self.assertEqual(self.writer.output_directory(self.writer.files.path), result['outputs_directory'])
        with self.assertRaisesRegex(ValueError, 'confirmed working copy'):
            self.writer.output_directory(self.directory)
        self.assertTrue(self.writer.stopped)

    def test_replaced_working_directory_refused(self):
        record = self.consumed()
        result = self.writer.prepare_output_working_copy(record)
        path = Path(result['outputs_directory'])
        path.rename(path.with_name('original-files'))
        path.mkdir()
        with self.assertRaisesRegex(ValueError, 'directory changed'):
            self.writer.output_directory(self.writer.files.path)
        self.assertTrue(self.writer.stopped)


if __name__ == '__main__':unittest.main()
