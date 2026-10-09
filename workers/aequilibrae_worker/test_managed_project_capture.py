"""Owned project registration with real SQLite files and injected transport."""
import hashlib
from pathlib import Path
import sqlite3
import unittest
import model_command_journal as journal
from test_model_command_client import IDS
import test_model_attempt_outputs as output_tests
import test_model_attempt_writer as writer_tests


class ProjectCaptureTests(unittest.TestCase):
    setUp = writer_tests.WriterTests.setUp
    response = output_tests.OutputTests.response

    def prepare(self):
        root = self.writer.workspace(self.directory / 'runs', IDS[1])
        source = root / 'aeq_project'
        source.mkdir()
        connection = sqlite3.connect(source / 'project_database.sqlite')
        connection.execute('CREATE TABLE evidence (id INTEGER)')
        connection.execute('INSERT INTO evidence VALUES (7)')
        connection.commit()
        connection.close()
        return source

    def test_owned_project_registers_exact_files_checks_and_limits(self):
        source = self.prepare()
        result = self.writer.retain_project(source)
        request = self.post.call_args.kwargs['json']
        payload = request['p_payload']
        self.assertEqual(request['p_attempt_id'], self.writer.context.attempt_id)
        self.assertEqual(payload['artifact_type'], 'model_project_inputs')
        self.assertEqual(payload['file_url'], 'local://' + result['manifest_path'])
        content = Path(result['manifest_path']).read_bytes()
        self.assertEqual(payload['content_hash'], hashlib.sha256(content).hexdigest())
        self.assertEqual(payload['file_size_bytes'], len(content))
        metadata = payload['metadata_json']
        self.assertEqual(metadata['schema'], 'openplan.project-inputs.v1')
        self.assertEqual(metadata['database_consistency'], 'individual_sqlite_integrity_checked')
        self.assertEqual(metadata['database_checks'], result['database_checks'])
        self.assertEqual(metadata['database_checks']['project_database.sqlite']['sha256'], hashlib.sha256((source / 'project_database.sqlite').read_bytes()).hexdigest())
        for field in ('engine_closure', 'cross_database_consistency', 'scientific_acceptance'):
            self.assertEqual(metadata[field], 'unassessed')
        self.assertIs(metadata['execution_ready'], False)

    def test_foreign_source_stops_without_registration(self):
        self.prepare()
        foreign = self.directory / 'foreign'
        foreign.mkdir()
        with self.assertRaisesRegex(ValueError, 'owned attempt'):
            self.writer.retain_project(foreign)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_journal_refuses_registration(self):
        source = self.prepare()
        (source / 'project_database.sqlite-journal').write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'sidecar'):
            self.writer.retain_project(source)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_lost_reply_retains_exact_pending_payload(self):
        source = self.prepare()
        self.post.side_effect = TimeoutError('Synthetic response loss')
        with self.assertRaises(Exception):
            self.writer.retain_project(source)
        self.assertTrue(self.writer.stopped)
        pending = journal.pending(self.directory, self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        payload = pending[0]['command']['arguments']['payload']
        self.assertEqual(payload, self.post.call_args.kwargs['json']['p_payload'])
        self.assertEqual(payload['artifact_type'], 'model_project_inputs')
        self.assertTrue((self.writer.files.path / 'project_inputs/manifest.json').exists())


if __name__ == '__main__':unittest.main()
