"""ActivitySim reads only the declared completed producer of its bound run."""
import copy
import unittest
from unittest.mock import Mock, patch
import model_attempt_writer as managed
import model_activitysim_handoff as handoff
import test_model_attempt_writer as fixtures
from test_model_skip_dispatch import activity


class ActivityHandoffTests(unittest.TestCase):
    setUp = fixtures.WriterTests.setUp
    response = fixtures.WriterTests.response

    def configure(self):
        row = self.get.return_value.json.return_value[0]
        row['model_runs'].update({key: None for key in managed.RUN_CONFIGURATION_FIELDS})
        ctx = self.writer.context
        producer = {'id':'11111111-1111-4111-8111-111111111111','run_id':ctx.run_id,
            'stage_name':'Artifact Extraction','sort_order':30,'status':'succeeded',
            'attempt_managed':True,'active_attempt_id':'22222222-2222-4222-8222-222222222222'}
        consumer = {**copy.deepcopy(row),'stage_name':'ActivitySim Bundle & Preflight','sort_order':40}
        stages = [producer, consumer]
        artifacts = [{'id':f'33333333-3333-4333-8333-33333333333{i}', 'run_id':ctx.run_id,
            'stage_id':producer['id'],'attempt_id':producer['active_attempt_id'],
            'artifact_type':kind,'model_run_stages':copy.deepcopy(producer)} for i,kind in enumerate(handoff.KINDS)]
        responses = [Mock(status_code=200,json=Mock(return_value=value)) for value in ([row],stages,artifacts,[row])]
        self.get.side_effect = responses
        return stages, artifacts, responses

    def test_declared_producer_and_exact_projections(self):
        _, artifacts, responses = self.configure()
        with managed.bind(self.writer), patch.object(activity.requests,'get',side_effect=AssertionError('Legacy read')):
            self.assertEqual(activity.sb_get_run_artifacts(self.writer.context.run_id),artifacts)
        for index,table,projection in ((1,'model_run_stages','id,run_id,stage_name,sort_order,status,attempt_managed,active_attempt_id'),(2,'model_run_artifacts','id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json,model_run_stages!inner(id,run_id,status,attempt_managed,active_attempt_id)')):
            call=self.get.call_args_list[index]
            self.assertEqual(call.args[0],self.writer.base_url+'/rest/v1/'+table)
            self.assertEqual(call.kwargs['params'],{'run_id':'eq.'+self.writer.context.run_id,'select':projection})
            self.assertFalse(call.kwargs['allow_redirects'])
        for response in responses:response.close.assert_called_once()
        self.post.assert_not_called()

    def test_revoked_producer_refuses_without_fallback(self):
        stages,_,_=self.configure();stages[0]['active_attempt_id']='44444444-4444-4444-8444-444444444444'
        with managed.bind(self.writer),patch.object(activity.requests,'get',side_effect=AssertionError('Legacy fallback')):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)

    def test_wrong_run_refuses_before_artifact_read(self):
        self.configure()
        with managed.bind(self.writer):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts('foreign')
        self.get.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_consumer_revoked_after_selection_refuses(self):
        _,_,responses=self.configure()
        final=copy.deepcopy(responses[-1].json.return_value);final[0]['status']='failed'
        responses[-1].json.return_value=final
        with managed.bind(self.writer):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)

    def test_wrong_producer_stage_refuses(self):
        stages,_,_=self.configure();stages[0]['stage_name']='Network Assignment'
        with managed.bind(self.writer):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)

    def test_foreign_artifact_kind_refuses(self):
        stages,artifacts,_=self.configure();artifacts[0]['artifact_type']='model_package_inputs'
        with self.assertRaisesRegex(ValueError,'Artifact kind differs'):
            handoff.select(self.writer.context,stages,artifacts,'model_package_inputs')
