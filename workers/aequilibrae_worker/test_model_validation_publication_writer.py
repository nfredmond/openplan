"""Admitted source publication join with actual journals and a synthetic peer."""
import unittest
from unittest.mock import patch

import model_command_client as client
import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired
import test_model_validation_source_writer as source_writer
from test_model_validation_source_publication import MultiPeer


class PublicationWriterTests(unittest.TestCase):
    setUp = source_writer.BoundSourceTests.setUp
    response = source_writer.BoundSourceTests.response
    prepare = source_writer.BoundSourceTests.prepare

    def test_publish_registers_remote_manifest_without_replacing_local_record(self):
        local = self.writer.retain_validation_sources(**self.prepare())
        with patch('model_storage_resumable.requests.request', side_effect=MultiPeer().request):
            published = self.writer.publish_validation_sources(method='aequilibrae')
        self.assertEqual(self.post.call_count, 2)
        rows = [call.kwargs['json']['p_payload'] for call in self.post.call_args_list]
        self.assertEqual(rows[0]['artifact_type'], 'model_validation_sources')
        self.assertEqual(rows[1]['artifact_type'], 'model_validation_source_publication')
        self.assertEqual(rows[0]['content_hash'], rows[1]['content_hash'])
        self.assertEqual(rows[0]['file_url'], 'local://' + local['manifest_path'])
        self.assertEqual(rows[1]['file_url'], published['manifest_uri'])
        self.assertEqual(rows[1]['metadata_json']['publication_state'], 'remote_verified')
        self.assertEqual(rows[1]['metadata_json']['role_count'], 23)
        self.assertEqual(rows[1]['metadata_json']['scientific_acceptance'], 'unassessed')

    def test_unacknowledged_sources_cannot_publish(self):
        with self.assertRaisesRegex(ValueError, 'Acknowledged local'):
            self.writer.publish_validation_sources(method='aequilibrae')
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_interrupted_upload_stops_without_remote_artifact_registration(self):
        self.writer.retain_validation_sources(**self.prepare())
        peer = MultiPeer(); peer.lose_once = True
        with patch('model_storage_resumable.requests.request', side_effect=peer.request):
            with self.assertRaises(RuntimeError):
                self.writer.publish_validation_sources(method='aequilibrae')
        self.assertEqual(self.post.call_count, 1)
        self.assertTrue(self.writer.stopped)
        with self.assertRaises(ReconciliationRequired): self.writer.require_open()

    def test_lost_remote_registration_reply_retains_exact_command(self):
        self.writer.retain_validation_sources(**self.prepare())
        self.post.side_effect = TimeoutError('synthetic reply loss')
        with patch('model_storage_resumable.requests.request', side_effect=MultiPeer().request):
            with self.assertRaises(client.DeliveryUnconfirmed):
                self.writer.publish_validation_sources(method='aequilibrae')
        self.assertTrue(self.writer.stopped)
        pending = journal.pending(self.directory, self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        payload = pending[0]['command']['arguments']['payload']
        self.assertEqual(payload['artifact_type'], 'model_validation_source_publication')
        self.assertTrue(payload['file_url'].startswith('storage://run-artifacts/'))


if __name__ == '__main__': unittest.main()
