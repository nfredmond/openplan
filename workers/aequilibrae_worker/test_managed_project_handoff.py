"""Actual selected-project join with native files and mocked transport."""
import hashlib
import sqlite3
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_project_inputs as project
import test_model_attempt_outputs as outputs
import test_model_predecessor_inputs as predecessors
from test_model_skip_dispatch import aeq


class ManagedProjectHandoffTests(unittest.TestCase):
    setUp = predecessors.BoundPredecessorTests.setUp
    response = outputs.OutputTests.response
    def prepare(self):
        root = self.writer.workspace(self.directory / 'runs', self.writer.context.run_id)
        installation = hashlib.sha256(self.writer.context.destination.encode()).hexdigest()
        producer = self.writer.files.root / self.writer.context.run_id / 'attempts' / installation / self.artifact['stage_id'] / self.artifact['attempt_id']
        producer.mkdir(parents=True)
        source = producer / 'project'
        source.mkdir()
        connection = sqlite3.connect(source / 'project_database.sqlite')
        connection.execute('CREATE TABLE evidence (id INTEGER)')
        connection.execute('INSERT INTO evidence VALUES (7)')
        connection.commit()
        connection.close()
        self.artifact['artifact_type'] = 'model_project_inputs'
        retained = project.retain(source, producer / 'project_inputs')
        self.artifact.update(file_url='local://' + retained['manifest_path'], content_hash=retained['manifest_sha256'],
                             file_size_bytes=retained['manifest_size_bytes'], metadata_json={'schema':'openplan.project-inputs.v1', 'inventory_schema':'openplan.package-inputs.v1', 'database_checks':retained['database_checks'], 'database_consistency':retained['database_consistency'], 'engine_closure':'unassessed', 'cross_database_consistency':'unassessed', 'scientific_acceptance':'unassessed', 'execution_ready':False})
        return root, retained
    def test_selected_project_is_copied_and_consumer_provenance_registered(self):
        root, source = self.prepare()
        with managed.bind(self.writer):
            result = aeq.retain_managed_predecessor_project()
        copied = Path(result['package_directory']) / 'project_database.sqlite'
        original = Path(source['package_directory']) / 'project_database.sqlite'
        self.assertEqual(copied, root / 'predecessor_project/files/project_database.sqlite')
        self.assertEqual(copied.read_bytes(), original.read_bytes())
        self.assertNotEqual(copied.stat().st_ino, original.stat().st_ino)
        payload = self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'], 'model_project_consumption')
        self.assertEqual(payload['content_hash'], hashlib.sha256(Path(result['manifest_path']).read_bytes()).hexdigest())
        self.assertEqual(payload['metadata_json']['producer']['artifact_id'], self.artifact['id'])
        self.assertEqual(payload['metadata_json']['producer']['attempt_id'], self.artifact['attempt_id'])
        metadata = payload['metadata_json']
        self.assertEqual(metadata['database_checks'], source['database_checks'])
        self.assertEqual(metadata['database_consistency'], 'individual_sqlite_integrity_checked')
        self.assertIs(metadata['execution_ready'], False)
        for field in ('engine_closure', 'cross_database_consistency', 'scientific_acceptance'):
            self.assertEqual(metadata[field], 'unassessed')
        self.assertEqual(self.read.call_args_list[1].kwargs['params']['artifact_type'], 'eq.model_project_inputs')
    def test_foreign_manifest_is_refused_before_file_copy(self):
        root, source = self.prepare()
        self.artifact['file_url'] = 'local://' + str(self.directory / 'foreign/manifest.json')
        with managed.bind(self.writer), patch.object(project,'consume',side_effect=AssertionError('Foreign project was read')) as consumer:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_project()
        self.assertIsInstance(error.exception.__cause__, ValueError)
        consumer.assert_not_called()
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)
    def test_tampered_producer_files_stop_before_registration(self):
        root, source = self.prepare()
        (Path(source['package_directory'])/'project_database.sqlite').write_bytes(b'changed')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_project()
        self.assertIn('differs from recorded inventory',str(error.exception.__cause__))
        self.assertTrue(self.writer.stopped)
        self.post.assert_not_called()
    def test_uncertain_registration_preserves_pending_consumer_record(self):
        import model_command_journal as journal
        root, source = self.prepare()
        self.post.side_effect=TimeoutError('synthetic lost reply')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.retain_managed_predecessor_project()
        self.assertTrue(self.writer.stopped)
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'],'model_project_consumption')
        self.assertTrue((root/'predecessor_project/manifest.json').is_file())

    def test_contradictory_database_checks_stop_registration(self):
        self.prepare()
        self.artifact['metadata_json']['database_checks'] = {}
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
            aeq.retain_managed_predecessor_project()
        self.assertIn('checks differ', str(error.exception.__cause__))
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_promoted_readiness_refused_before_copy(self):
        root, source = self.prepare()
        self.artifact['metadata_json']['execution_ready'] = True
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
            aeq.retain_managed_predecessor_project()
        self.assertIn('readiness claims', str(error.exception.__cause__))
        self.assertFalse((root / 'predecessor_project').exists())
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)
