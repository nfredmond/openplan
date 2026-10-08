"""Reserved engine launch owns the inherited progress socket lifetime."""
import json,os,sys
from pathlib import Path
import unittest
from unittest.mock import patch
from model_engine_process import EngineProcess
from model_engine_channel import CHANNEL_FD_ENV
import test_model_attempt_writer as fixtures


class LaunchChannelTests(unittest.TestCase):
    setUp=fixtures.WriterTests.setUp
    response=fixtures.WriterTests.response

    def prepare(self):
        self.writer.workspace(self.directory/'work',self.writer.context.run_id)
        return dict(os.environ,PYTHONPATH=str(Path(__file__).parent))

    def test_reserved_child_uses_parent_writer_then_closes_channel(self):
        env=self.prepare()
        code='''
import os
from pathlib import Path
from model_engine_channel import inherited_progress_client,CHANNEL_FD_ENV,ChannelStopped
client=inherited_progress_client()
try:
 assert CHANNEL_FD_ENV not in os.environ
 assert not client.connection.get_inheritable()
 client.progress('Native iteration through reserved launch')
 try:inherited_progress_client()
 except ChannelStopped:pass
 else:raise AssertionError('Endpoint setting replayed')
 Path('child-confirmed').write_text('confirmed')
finally:client.stop()
'''
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',code],env=env,progress=True)
        handle.progress.connection.settimeout(5)
        try:
            handle.progress.serve_one()
            self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
            receipt=handle.confirm_exit()
            self.assertEqual(receipt['returncode'],0)
            self.assertIs(receipt['execution_ready'],False)
            self.assertEqual((self.writer.files.path/'child-confirmed').read_text(),'confirmed')
            self.assertEqual(self.post.call_args.kwargs['json']['p_attempt_id'],self.writer.context.attempt_id)
            self.assertTrue(handle.progress.stopped)
            self.assertEqual(handle.progress.connection.fileno(),-1)
            self.assertNotIn(CHANNEL_FD_ENV,env)
        finally:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)

    def test_spawn_failure_closes_both_endpoints_and_retains_reservation(self):
        import socket
        env=self.prepare();left,right=socket.socketpair()
        self.addCleanup(left.close);self.addCleanup(right.close)
        with patch('model_engine_process.socket.socketpair',return_value=(left,right)),patch('model_engine_process.subprocess.Popen',side_effect=OSError('Synthetic spawn failure')):
            with self.assertRaisesRegex(OSError,'spawn failure'):
                EngineProcess(self.writer,[sys.executable,'-c','pass'],env=env,progress=True)
        self.assertEqual(left.fileno(),-1);self.assertEqual(right.fileno(),-1)
        self.assertTrue(self.writer.stopped)
        self.assertTrue((self.writer.files.path/'engine_process/launch-reserved.json').is_file())

    def test_foreign_descriptor_setting_refused_before_launch(self):
        env=self.prepare();env[CHANNEL_FD_ENV]='99'
        with patch('model_engine_process.subprocess.Popen') as launch:
            with self.assertRaisesRegex(ValueError,'this launch'):
                EngineProcess(self.writer,[sys.executable,'-c','pass'],env=env,progress=True)
        launch.assert_not_called()


if __name__=='__main__':unittest.main()
