"""Bound worker adapter with real files/journal and injected native responses."""
import json
import shutil
import unittest
import uuid
from unittest.mock import Mock

from model_attempt_invocation import AttemptContext
from model_attempt_workspace import AttemptWorkspace
import model_attempt_writer as managed
import model_validation_preparation as preparation
import test_model_attempt_writer as writer_fixtures
import test_model_validation_preparation as file_fixtures
import test_model_validation_source_writer as source_fixtures
from test_model_skip_dispatch import aeq


class HandoffTests(unittest.TestCase):
    response=source_fixtures.BoundSourceTests.response
    def setUp(self, *, assignment_profile=None):
        writer_fixtures.WriterTests.setUp(self)
        consumer=self.writer.context
        self.writer.workspace(self.directory/'runs',consumer.run_id)
        producer=AttemptContext(consumer.destination,consumer.workspace_id,consumer.run_id,str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4()))
        files=AttemptWorkspace(self.writer.files.root,producer)
        source=file_fixtures.PreparationTests();source.setUp();self.addCleanup(source.doCleanups)
        inputs=files.path/'inputs';shutil.copytree(source.arguments['relative_to'],inputs)
        arguments={key:(inputs/value.name if key in preparation.PATH_FIELDS else value) for key,value in source.arguments.items()}
        arguments['relative_to']=inputs
        if assignment_profile is not None:
            arguments['assignment_profile_path'].write_text(json.dumps(assignment_profile))
            from test_assignment_network_source import prepare_fixture
            prepare_fixture(arguments)
        retained=preparation.retain(files=files,method='aequilibrae',bundle_arguments=arguments)
        self.producer={'id':producer.stage_id,'run_id':consumer.run_id,'stage_name':'AequilibraE Setup','status':'succeeded',
                       'sort_order':1,'attempt_managed':True,'active_attempt_id':producer.attempt_id}
        self.consumer={'id':consumer.stage_id,'run_id':consumer.run_id,'stage_name':'Network Assignment','status':'running',
                       'sort_order':2,'attempt_managed':True,'active_attempt_id':consumer.attempt_id}
        self.artifact={'id':str(uuid.uuid4()),'run_id':consumer.run_id,'stage_id':producer.stage_id,'attempt_id':producer.attempt_id,
            'artifact_type':'model_validation_preparation','file_url':'local://'+retained['manifest_path'],
            'content_hash':retained['manifest_sha256'],'file_size_bytes':retained['manifest_size_bytes'],
            'metadata_json':{'schema':'openplan.validation-preparation-files.v1','demand_method':'aequilibrae','execution_authorized':False},
            'model_run_stages':self.producer}
        self.read=Mock(side_effect=[Mock(status_code=200,json=lambda:[self.consumer,self.producer]),Mock(status_code=200,json=lambda:[self.artifact])])
        self.writer.get=self.read
    def test_worker_registers_owned_consumption_and_preserves_producer(self):
        with managed.bind(self.writer):result=aeq.retain_managed_validation_preparation('aequilibrae')
        self.assertEqual(self.post.call_count,1)
        self.assertEqual(result['producer']['artifact_id'],self.artifact['id'])
        self.assertFalse(result['execution_authorized'])
        self.assertEqual(self.post.call_count,1)
        payload=self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'],'model_validation_preparation_consumption')
        self.assertEqual(payload['metadata_json']['producer']['attempt_id'],self.producer['active_attempt_id'])
        self.assertNotEqual(self.producer['active_attempt_id'],self.writer.context.attempt_id)
        projection=self.read.call_args_list[1].kwargs['params']['select']
        for field in ('metadata_json','content_hash','file_size_bytes','model_run_stages(id,run_id,status,attempt_managed,active_attempt_id)'):
            self.assertIn(field,projection)
    def test_failed_read_stops_before_consumption_registration(self):
        self.read.side_effect=TimeoutError('uncertain read')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.retain_managed_validation_preparation('aequilibrae')
        self.assertTrue(self.writer.stopped);self.post.assert_not_called()
    def test_unregistered_reference_stops_before_consumption_registration(self):
        self.artifact['file_url']+='-different'
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.retain_managed_validation_preparation('aequilibrae')
        self.assertTrue(self.writer.stopped);self.post.assert_not_called()


if __name__=='__main__':unittest.main()
