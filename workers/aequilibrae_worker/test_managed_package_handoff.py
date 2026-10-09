"""Actual selected-package join with native files and mocked transport."""
import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_package_inputs as package
import test_model_attempt_outputs as outputs
import test_model_predecessor_inputs as predecessors
from test_model_skip_dispatch import aeq


class ManagedPackageHandoffTests(unittest.TestCase):
    setUp = predecessors.BoundPredecessorTests.setUp
    response = outputs.OutputTests.response
    def prepare(self):
        root = self.writer.workspace(self.directory / 'runs', self.writer.context.run_id)
        installation = hashlib.sha256(self.writer.context.destination.encode()).hexdigest()
        producer = self.writer.files.root / self.writer.context.run_id / 'attempts' / installation / self.artifact['stage_id'] / self.artifact['attempt_id']
        producer.mkdir(parents=True)
        source = producer / 'package'
        source.mkdir()
        (source / 'zones.csv').write_bytes(b'zone,population\n1,123\n')
        retained = package.retain(source, producer / 'package_inputs')
        self.artifact.update(file_url='local://' + retained['manifest_path'], content_hash=retained['manifest_sha256'],
                             file_size_bytes=retained['manifest_size_bytes'], metadata_json={'schema':'openplan.package-inputs.v1'})
        return root, retained
    def test_selected_package_is_copied_and_consumer_provenance_registered(self):
        root, source = self.prepare()
        with managed.bind(self.writer):
            result = aeq.retain_managed_predecessor_package()
        copied = Path(result['package_directory']) / 'zones.csv'
        original = Path(source['package_directory']) / 'zones.csv'
        self.assertEqual(copied, root / 'predecessor_package/files/zones.csv')
        self.assertEqual(copied.read_bytes(), original.read_bytes())
        self.assertNotEqual(copied.stat().st_ino, original.stat().st_ino)
        payload = self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'], 'model_package_consumption')
        self.assertEqual(payload['content_hash'], hashlib.sha256(Path(result['manifest_path']).read_bytes()).hexdigest())
        self.assertEqual(payload['metadata_json']['producer']['artifact_id'], self.artifact['id'])
        self.assertEqual(payload['metadata_json']['producer']['attempt_id'], self.artifact['attempt_id'])
    def test_foreign_manifest_is_refused_before_file_copy(self):
        root, source = self.prepare()
        self.artifact['file_url'] = 'local://' + str(self.directory / 'foreign/manifest.json')
        with managed.bind(self.writer), patch.object(package,'consume',side_effect=AssertionError('Foreign package was read')) as consumer:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_package()
        self.assertIsInstance(error.exception.__cause__, ValueError)
        consumer.assert_not_called()
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)
    def test_tampered_producer_files_stop_before_registration(self):
        root, source = self.prepare()
        (Path(source['package_directory'])/'zones.csv').write_bytes(b'changed')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_package()
        self.assertIn('differs from recorded inventory',str(error.exception.__cause__))
        self.assertTrue(self.writer.stopped)
        self.post.assert_not_called()
    def test_uncertain_registration_preserves_pending_consumer_record(self):
        import model_command_journal as journal
        root, source = self.prepare()
        self.post.side_effect=TimeoutError('synthetic lost reply')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.retain_managed_predecessor_package()
        self.assertTrue(self.writer.stopped)
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'],'model_package_consumption')
        self.assertTrue((root/'predecessor_package/manifest.json').is_file())
