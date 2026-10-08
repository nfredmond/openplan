"""Explicit predecessor selection, including the bound worker's real read adapter."""
import copy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import model_predecessor_inputs as inputs
import model_attempt_writer as managed
from test_model_command_client import IDS
import test_model_attempt_writer as writer_tests
from test_model_skip_dispatch import aeq
IDS = [*IDS, *[f'{n:08d}-1111-4111-8111-111111111111' for n in range(6, 9)]]


class PredecessorTests(unittest.TestCase):
    def setUp(self):
        self.context = SimpleNamespace(run_id=IDS[1], stage_id=IDS[2], attempt_id=IDS[3])
        self.producer = {'id': IDS[4], 'run_id': IDS[1], 'stage_name': 'Network Assignment',
                         'sort_order': 2, 'status': 'succeeded', 'attempt_managed': True, 'active_attempt_id': IDS[5]}
        self.consumer = {'id': IDS[2], 'run_id': IDS[1], 'stage_name': 'Artifact Extraction',
                         'sort_order': 3, 'status': 'running', 'attempt_managed': True, 'active_attempt_id': IDS[3]}
        self.artifact = {'id': IDS[6], 'run_id': IDS[1], 'stage_id': IDS[4], 'attempt_id': IDS[5],
                         'artifact_type': 'model_package_inputs', 'model_run_stages': copy.deepcopy(self.producer)}
    def select(self):
        return inputs.select(self.context, [self.consumer, self.producer], [self.artifact], 'model_package_inputs')
    def test_exact_predecessor_selected(self):
        self.assertEqual(self.select(), self.artifact)
        unrelated = {**self.artifact, 'stage_id': IDS[7], 'created_at': 'later'}
        self.assertEqual(inputs.select(self.context, [self.consumer,self.producer], [unrelated,self.artifact], 'model_package_inputs'), self.artifact)
    def test_incomplete_wrong_run_late_or_legacy_producer_refused(self):
        for key, value in [('status','running'), ('run_id',IDS[7]), ('sort_order',4), ('sort_order',True), ('attempt_managed',False)]:
            original = self.producer[key]
            self.producer[key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, 'completed earlier'):
                self.select()
            self.producer[key] = original
    def test_revoked_consumer_and_superseded_artifact_refused(self):
        self.consumer['active_attempt_id'] = IDS[7]
        with self.assertRaisesRegex(ValueError, 'this managed attempt'):
            self.select()
        self.consumer['active_attempt_id'] = IDS[3]
        self.artifact['attempt_id'] = IDS[7]
        with self.assertRaisesRegex(ValueError, 'producer ownership'):
            self.select()
    def test_ambiguous_producer_or_artifact_refused(self):
        with self.assertRaisesRegex(ValueError, 'stage must be unique'):
            inputs.select(self.context, [self.consumer,self.producer,self.producer], [self.artifact], 'model_package_inputs')
        with self.assertRaisesRegex(ValueError, 'artifact must be unique'):
            inputs.select(self.context, [self.consumer,self.producer], [self.artifact,self.artifact], 'model_package_inputs')
    def test_wrong_stage_name_cannot_supply_input(self):
        self.producer['stage_name'] = 'ActivitySim Network Assignment'
        with self.assertRaisesRegex(ValueError, 'stage must be unique'):
            self.select()


class BoundPredecessorTests(unittest.TestCase):
    response = writer_tests.WriterTests.response
    def setUp(self):
        writer_tests.WriterTests.setUp(self)
        fixture = PredecessorTests()
        fixture.setUp()
        self.rows = [fixture.consumer,fixture.producer]
        self.artifact = fixture.artifact
        self.read = Mock(side_effect=[Mock(status_code=200,json=lambda: self.rows),Mock(status_code=200,json=lambda:[self.artifact])])
        self.writer.get = self.read
    def test_adapter_uses_bound_installation_and_complete_projections(self):
        with managed.bind(self.writer), patch.object(aeq,'SUPABASE_URL','http://wrong-installation'):
            result = aeq.select_managed_predecessor_input('model_package_inputs')
        self.assertEqual(result,self.artifact)
        for call in self.read.call_args_list:
            self.assertTrue(call.args[0].startswith(self.writer.base_url.rstrip('/')+'/rest/v1/'))
            self.assertEqual(call.kwargs['params']['run_id'],'eq.'+IDS[1])
            self.assertFalse(call.kwargs['allow_redirects'])
        projection = self.read.call_args_list[0].kwargs['params']['select'].split(',')
        self.assertTrue({'id','run_id','stage_name','sort_order','status','attempt_managed','active_attempt_id'} <= set(projection))
        self.assertIn('model_run_stages(id,run_id,status,attempt_managed,active_attempt_id)',self.read.call_args_list[1].kwargs['params']['select'])
    def test_disagreeing_artifact_read_stops_writer(self):
        self.artifact['model_run_stages']['status'] = 'running'
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.select_managed_predecessor_input('model_package_inputs')
        self.assertTrue(self.writer.stopped)
