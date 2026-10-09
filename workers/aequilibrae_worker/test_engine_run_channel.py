"""Run reads cross the live child channel without child-selected identities."""
import json,os,sys
from pathlib import Path
import unittest
from model_engine_process import EngineProcess
from model_engine_channel import Channel,ChannelStopped,ProgressParent
import socket
from unittest.mock import patch
import test_managed_run_read as reads


class RunChannelTests(unittest.TestCase):
    setUp=reads.RunReadTests.setUp
    response=reads.RunReadTests.response
    configure=reads.RunReadTests.configure

    def pair(self):
        left,right=socket.socketpair();left.settimeout(5);right.settimeout(5)
        self.addCleanup(left.close);self.addCleanup(right.close)
        return ProgressParent(left,self.writer),Channel(right)

    def test_reserved_child_reads_then_reports_progress(self):
        row=self.configure()
        self.writer.workspace(self.directory/'work',self.writer.context.run_id)
        code='''
import json
from pathlib import Path
from model_engine_channel import inherited_progress_client
client=inherited_progress_client()
try:
 run=client.read_run()
 client.progress('Read configuration for '+run['id'])
 Path('run-read.json').write_text(json.dumps(run))
finally:client.stop()
'''
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',code],
            env=dict(os.environ,PYTHONPATH=str(Path(__file__).parent)),progress=True)
        handle.progress.connection.settimeout(5)
        try:
            handle.progress.serve_one();handle.progress.serve_one()
            self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
            actual=json.loads((self.writer.files.path/'run-read.json').read_text())
            self.assertEqual(actual['id'],self.writer.context.run_id)
            self.assertEqual(actual['workspace_id'],self.writer.context.workspace_id)
            self.assertEqual(actual['input_snapshot_json'],row['model_runs']['input_snapshot_json'])
            self.assertEqual(self.post.call_count,1)
            self.assertEqual(handle.progress.sequence,3)
            handle.confirm_exit()
        finally:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)

    def test_extra_run_identity_refused_before_read(self):
        self.configure();parent,peer=self.pair()
        peer.send({'version':1,'sequence':1,'operation':'read_run','run_id':'foreign'})
        with self.assertRaises(ChannelStopped):parent.serve_one()
        self.get.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_revoked_run_read_closes_channel_without_response(self):
        row=self.configure();row['active_attempt_id']='foreign'
        parent,peer=self.pair();peer.send({'version':1,'sequence':1,'operation':'read_run'})
        with self.assertRaises(Exception):parent.serve_one()
        with self.assertRaises(ChannelStopped):peer.receive()
        self.post.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_parent_supplies_run_identity_to_writer(self):
        parent,peer=self.pair();peer.send({'version':1,'sequence':1,'operation':'read_run'})
        with patch.object(self.writer,'read_run',return_value={'source':'owned'}) as read:
            parent.serve_one()
        read.assert_called_once_with(self.writer.context.run_id)
        self.assertEqual(peer.receive(),{'version':1,'sequence':1,'confirmed':True,'result':{'source':'owned'}})


if __name__=='__main__':unittest.main()
