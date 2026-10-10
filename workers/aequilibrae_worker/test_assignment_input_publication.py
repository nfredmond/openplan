"""Parent-owned snapshot registration with real files, journal and socket framing."""
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import Mock,patch

import model_assignment_input_publication as publication
import model_assignment_input_snapshot as snapshot
import model_attempt_writer as managed
import model_command_journal as journal
from model_engine_channel import ProgressParent,Channel,ChannelStopped
from model_engine_binding import EngineBinding,bind
import test_model_attempt_writer as writers
import test_model_attempt_outputs as outputs
import test_assignment_input_snapshot as inputs


class PublicationTests(unittest.TestCase):
    response=outputs.OutputTests.response
    def setUp(self):
        writers.WriterTests.setUp(self)
        self.root=self.writer.workspace(self.directory/'runs',self.writer.context.run_id)
        self.output=self.root/'run_output';self.output.mkdir()
        fixture=inputs.SnapshotTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        self.engine=fixture.engine;self.profile=fixture.profile
        self.get.return_value.json.return_value[0]['stage_name']='Network Assignment'

    def retain(self):
        return snapshot.retain_and_execute(self.engine,directory=self.output/'initial_assignment_inputs',context={'run_id':self.writer.context.run_id,'stage_id':self.writer.context.stage_id,'demand_method':'aequilibrae'},profile=self.profile,network_state={},network_settings={})

    def test_bound_execution_registers_before_calling_solver(self):
        self.engine.execute.side_effect=lambda:self.assertEqual(self.post.call_count,1)
        with managed.bind(self.writer):record=self.retain()
        self.engine.execute.assert_called_once()
        payload=self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'],'model_initial_assignment_inputs')
        self.assertEqual(payload['content_hash'],record['sha256'])
        self.assertEqual(self.post.call_args.kwargs['json']['p_attempt_id'],self.writer.context.attempt_id)
        self.assertEqual(payload['metadata_json']['scientific_acceptance'],'unassessed')
        self.assertEqual(payload['metadata_json']['preparation_link'],
                         {'status':'not_retained','solver_input_equivalence':'unassessed'})
        self.assertIn('stage_name',self.get.call_args.kwargs['params']['select'])
        self.assertEqual(self.get.call_args.kwargs['params']['id'],'eq.'+self.writer.context.stage_id)

    def test_lost_registration_reply_stops_before_solver(self):
        self.post.side_effect=TimeoutError('lost reply')
        with managed.bind(self.writer),self.assertRaises(Exception):self.retain()
        self.engine.execute.assert_not_called();self.assertTrue(self.writer.stopped)
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'],'model_initial_assignment_inputs')

    def test_wrong_native_stage_refuses_before_registration(self):
        self.get.return_value.json.return_value[0]['stage_name']='ActivitySim Network Assignment'
        with managed.bind(self.writer),self.assertRaises(Exception):self.retain()
        self.engine.execute.assert_not_called();self.post.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_changed_array_refuses_parent_registration(self):
        self.retain();self.engine.execute.reset_mock()
        (self.output/'initial_assignment_inputs/resident_demand.npy').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'array bytes differ'):publication.register(self.writer,self.output)
        self.post.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_parent_channel_registers_fixed_path_once(self):
        record=self.retain()
        left,right=socket.socketpair();self.addCleanup(left.close);self.addCleanup(right.close)
        parent=ProgressParent(left,self.writer,output_name='run_output');peer=Channel(right)
        parent.output_directory=str(self.output);info=self.output.stat();parent.output_identity=(info.st_dev,info.st_ino)
        peer.send({'version':1,'sequence':1,'operation':'register_initial_inputs'})
        parent.serve_one();self.assertEqual(peer.receive()['result'],record)
        self.assertEqual(self.post.call_count,1)
        peer.send({'version':1,'sequence':2,'operation':'register_initial_inputs'})
        with self.assertRaisesRegex(ChannelStopped,'fresh parent-created'):parent.serve_one()
        self.assertEqual(self.post.call_count,1)

    def test_binding_refuses_different_parent_confirmation_before_solver(self):
        client=Mock();client.register_initial_inputs.return_value={'different':'record'}
        engine=EngineBinding(client,run_id=self.writer.context.run_id,stage_id=self.writer.context.stage_id,work_directory=self.root,output_name='run_output')
        engine.output_directory=str(self.output)
        with bind(engine),self.assertRaisesRegex(ValueError,'confirmed different'):self.retain()
        self.engine.execute.assert_not_called()
        client.register_initial_inputs.assert_called_once_with()


if __name__=='__main__':unittest.main()
