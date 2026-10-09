"""Acknowledged preparation records through an admitted writer and real journal."""
import json
from pathlib import Path
import shutil
import unittest

import model_command_client as client
import model_command_journal as journal
import test_model_attempt_writer as writer_fixtures
import test_model_validation_source_writer as source_fixtures
from model_attempt_invocation import ReconciliationRequired
import test_model_validation_preparation as fixture


class PreparationWriterTests(unittest.TestCase):
    response=source_fixtures.BoundSourceTests.response

    def setUp(self):
        writer_fixtures.WriterTests.setUp(self)
        source=fixture.PreparationTests();source.setUp();self.addCleanup(source.doCleanups)
        owned=self.writer.workspace(self.directory/'runs',self.writer.context.run_id)/'preparation_inputs'
        shutil.copytree(source.arguments['relative_to'],owned)
        self.arguments={key:(owned/value.name if key in fixture.preparation.PATH_FIELDS else value) for key,value in source.arguments.items()}
        self.arguments['relative_to']=owned

    def test_registers_each_method_with_exact_manifest_and_scope(self):
        for method in ('aequilibrae','activitysim'):
            retained=self.writer.prepare_validation_bundle(method=method,bundle_arguments=self.arguments)
            self.assertIsNotNone(self.post.call_args)
            payload=self.post.call_args.kwargs['json']['p_payload']
            self.assertEqual(payload['artifact_type'],'model_validation_preparation')
            self.assertEqual(payload['content_hash'],retained['manifest_sha256'])
            manifest=json.loads(Path(retained['manifest_path']).read_text())
            self.assertEqual(manifest['context']['attempt_id'],self.writer.context.attempt_id)
            self.assertEqual(payload['metadata_json']['demand_method'],method)
            self.assertFalse(payload['metadata_json']['execution_authorized'])
        self.assertEqual(self.post.call_count,2)

    def test_lost_registration_reply_stops_and_retains_exact_command(self):
        self.post.side_effect=TimeoutError('reply lost')
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.writer.prepare_validation_bundle(method='aequilibrae',bundle_arguments=self.arguments)
        self.assertTrue(self.writer.stopped)
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        command=pending[0]['command']
        self.assertEqual(command['operation'],'write_model_attempt_artifact')
        self.assertEqual(command['arguments']['payload']['artifact_type'],'model_validation_preparation')
        with self.assertRaises(ReconciliationRequired):
            self.writer.prepare_validation_bundle(method='aequilibrae',bundle_arguments=self.arguments)
        self.assertEqual(self.post.call_count,1)

    def test_changed_source_stops_without_artifact_command(self):
        (self.arguments['relative_to']/'source.dat').write_bytes(b'changed')
        with self.assertRaises(fixture.preparation.instrument.InstrumentV2Error):
            self.writer.prepare_validation_bundle(method='aequilibrae',bundle_arguments=self.arguments)
        self.assertTrue(self.writer.stopped)
        self.post.assert_not_called()
        self.assertEqual(journal.pending(self.directory,self.writer.context.destination),[])


if __name__=='__main__':unittest.main()
