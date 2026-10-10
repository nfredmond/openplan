"""The parent fixes the output destination and refuses adoption or repetition."""
import json,os,socket,sys
from pathlib import Path
import unittest
from unittest.mock import patch
from model_engine_process import EngineProcess
from model_engine_channel import Channel,ChannelStopped,ProgressParent
import test_engine_launch_channel as launch


class OutputChannelTests(unittest.TestCase):
    setUp=launch.LaunchChannelTests.setUp
    response=launch.LaunchChannelTests.response
    prepare=launch.LaunchChannelTests.prepare

    def pair(self,output_name):
        left,right=socket.socketpair();left.settimeout(5);right.settimeout(5)
        self.addCleanup(left.close);self.addCleanup(right.close)
        return ProgressParent(left,self.writer,output_name=output_name),Channel(right)

    def request(self,sequence=1,**extra):
        return {'version':1,'sequence':sequence,'operation':'create_outputs',**extra}

    def test_reserved_child_uses_parent_selected_output_name(self):
        env=self.prepare()
        code='''
from pathlib import Path
from model_engine_channel import inherited_progress_client
client=inherited_progress_client()
try:
 result=client.create_outputs()
 Path(result['output_directory'],'synthetic.txt').write_text('owned')
finally:client.stop()
'''
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',code],env=env,
            progress=True,output_name='activitysim_assignment_output')
        handle.progress.connection.settimeout(5)
        try:
            handle.progress.serve_one()
            self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
            handle.confirm_exit()
            path=self.writer.files.path/'activitysim_assignment_output'
            self.assertEqual((path/'synthetic.txt').read_text(),'owned')
            self.assertEqual(path.stat().st_mode & 0o777,0o700)
            self.assertFalse((self.writer.files.path/'run_output').exists())
            self.post.assert_not_called()
        finally:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)

    def test_repeated_creation_preserves_existing_bytes_and_stops(self):
        self.prepare();parent,peer=self.pair('run_output')
        peer.send(self.request());parent.serve_one();result=peer.receive()['result']
        file=Path(result['output_directory'])/'keep';file.write_text('original')
        peer.send(self.request(sequence=2))
        with self.assertRaises(FileExistsError):parent.serve_one()
        self.assertEqual(file.read_text(),'original')
        self.assertTrue(self.writer.stopped)
        with self.assertRaises(ChannelStopped):peer.receive()

    def test_unconfigured_destination_refused(self):
        self.prepare();parent,peer=self.pair(None);peer.send(self.request())
        with patch.object(self.writer,'create_assignment_outputs',return_value='/synthetic') as create:
            with self.assertRaisesRegex(ChannelStopped,'not configured'):parent.serve_one()
        create.assert_not_called()
        self.assertFalse((self.writer.files.path/'run_output').exists())

    def test_child_cannot_select_an_output_name(self):
        self.prepare();parent,peer=self.pair('run_output')
        peer.send(self.request(output_name='activitysim_assignment_output'))
        with self.assertRaises(ChannelStopped):parent.serve_one()
        self.assertFalse((self.writer.files.path/'run_output').exists())
        self.assertFalse((self.writer.files.path/'activitysim_assignment_output').exists())


if __name__=='__main__':unittest.main()
