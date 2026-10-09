"""Real child requests parent-owned count retention; HTTP remains mocked."""
import os,socket,sys
from pathlib import Path
import unittest
from unittest.mock import Mock
import model_command_journal as journal
from model_engine_channel import Channel,ChannelStopped,ProgressParent
from model_engine_process import EngineProcess
import test_model_count_inputs as fixtures
from test_model_skip_dispatch import aeq


class CountChannelTests(unittest.TestCase):
    setUp=fixtures.BoundCountRetentionTests.setUp
    response=fixtures.BoundCountRetentionTests.response

    def prepare(self):
        self.writer.workspace(self.directory/'work',self.writer.context.run_id)
        self.source=self.directory/'source.csv'
        self.source.write_text('station_id,count_year,aadt\nA,2020,123\n')
        self.callback=Mock(side_effect=lambda output: aeq.prepare_assignment_count_inputs(
            {},{},'unused-project',output,calibrate_requested=False,
            counts_path_override=str(self.source)))
        return dict(os.environ,PYTHONPATH=str(Path(__file__).parent))

    def pair(self):
        left,right=socket.socketpair();left.settimeout(5);right.settimeout(5)
        self.addCleanup(left.close);self.addCleanup(right.close)
        return ProgressParent(left,self.writer,output_name='run_output',count_preparer=self.callback),Channel(right)

    def send(self,parent,peer,operation,sequence,**extra):
        peer.send({'version':1,'sequence':sequence,'operation':operation,**extra})
        parent.serve_one()
        return peer.receive()['result']

    def test_reserved_child_receives_registered_counts(self):
        env=self.prepare()
        code='''
from pathlib import Path
from model_engine_channel import inherited_progress_client
client=inherited_progress_client()
try:
 client.create_outputs()
 result=client.prepare_counts()
 Path('child-counts').write_bytes(Path(result['counts_path']).read_bytes())
finally:client.stop()
'''
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',code],env=env,
            progress=True,output_name='run_output',count_preparer=self.callback)
        handle.progress.connection.settimeout(5)
        try:
            handle.progress.serve_one();handle.progress.serve_one()
            self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
            handle.confirm_exit()
            self.assertEqual((self.writer.files.path/'child-counts').read_bytes(),self.source.read_bytes())
            self.post.assert_called_once()
            self.assertEqual(self.post.call_args.kwargs['json']['p_payload']['artifact_type'],'model_count_inputs')
            self.assertEqual(journal.pending(self.directory,self.writer.context.destination),[])
        finally:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)

    def test_lost_registration_stops_without_response(self):
        self.prepare();parent,peer=self.pair()
        self.send(parent,peer,'create_outputs',1)
        self.post.side_effect=TimeoutError('Synthetic lost reply')
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.send(parent,peer,'prepare_counts',2)
        with self.assertRaises(ChannelStopped):peer.receive()
        self.assertTrue(self.writer.stopped)
        self.assertEqual(len(journal.pending(self.directory,self.writer.context.destination)),1)

    def test_request_before_outputs_refused(self):
        self.prepare();parent,peer=self.pair()
        with self.assertRaises(ChannelStopped):self.send(parent,peer,'prepare_counts',1)
        self.callback.assert_not_called()

    def test_repeated_preparation_refused_before_callback(self):
        self.prepare();parent,peer=self.pair()
        self.send(parent,peer,'create_outputs',1);self.send(parent,peer,'prepare_counts',2)
        self.callback.side_effect=None;self.callback.return_value={}
        with self.assertRaisesRegex(ChannelStopped,'already requested'):self.send(parent,peer,'prepare_counts',3)
        self.callback.assert_called_once()

    def test_child_source_override_refused(self):
        self.prepare();parent,peer=self.pair()
        self.send(parent,peer,'create_outputs',1)
        with self.assertRaises(ChannelStopped):self.send(parent,peer,'prepare_counts',2,counts_path=str(self.source))
        self.callback.assert_not_called()

    def test_replaced_output_refused_before_callback(self):
        self.prepare();parent,peer=self.pair()
        result=self.send(parent,peer,'create_outputs',1)
        output=Path(result['output_directory']);output.rename(output.with_name('old-output'));output.mkdir()
        self.callback.side_effect=None;self.callback.return_value={}
        with self.assertRaisesRegex(ChannelStopped,'identity changed'):self.send(parent,peer,'prepare_counts',2)
        self.callback.assert_not_called()


if __name__=='__main__':unittest.main()
