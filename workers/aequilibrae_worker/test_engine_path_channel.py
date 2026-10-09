"""Channel paths come only from confirmed parent-owned working copies."""
import json,os,socket,sys
from pathlib import Path
import unittest
from model_engine_process import EngineProcess
from model_engine_channel import Channel,ChannelStopped,ProgressParent
import test_project_execution_path as fixtures


class PathChannelTests(unittest.TestCase):
    setUp=fixtures.ProjectPathTests.setUp
    response=fixtures.ProjectPathTests.response
    prepared=fixtures.ProjectPathTests.prepared

    def pair(self):
        left,right=socket.socketpair();left.settimeout(5);right.settimeout(5)
        self.addCleanup(left.close);self.addCleanup(right.close)
        return ProgressParent(left,self.writer),Channel(right)

    def test_reserved_child_gets_only_confirmed_working_paths(self):
        root,project=self.prepared()
        package=self.writer.package_directory(root)
        self.post.reset_mock()
        code='''
import json
from pathlib import Path
from model_engine_channel import inherited_progress_client
client=inherited_progress_client()
try:
 paths=client.read_paths()
 assert Path(paths['project_directory'],'project_database.sqlite').is_file()
 assert Path(paths['package_directory'],'zones.csv').is_file()
 Path('paths.json').write_text(json.dumps(paths))
finally:client.stop()
'''
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',code],
            env=dict(os.environ,PYTHONPATH=str(Path(__file__).parent)),progress=True)
        handle.progress.connection.settimeout(5)
        try:
            handle.progress.serve_one()
            self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
            self.assertEqual(json.loads((root/'paths.json').read_text()),{
                'work_directory':str(root),'project_directory':project,'package_directory':package})
            handle.confirm_exit();self.post.assert_not_called()
        finally:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)

    def test_child_path_override_refused(self):
        self.prepared();parent,peer=self.pair()
        peer.send({'version':1,'sequence':1,'operation':'read_paths','work_directory':'/foreign'})
        with self.assertRaises(ChannelStopped):parent.serve_one()
        self.assertTrue(self.writer.stopped)

    def test_replaced_working_project_closes_channel(self):
        root,project=self.prepared();path=Path(project)
        path.rename(path.with_name('original-project'));path.mkdir()
        parent,peer=self.pair();peer.send({'version':1,'sequence':1,'operation':'read_paths'})
        with self.assertRaises(ValueError):parent.serve_one()
        with self.assertRaises(ChannelStopped):peer.receive()
        self.assertTrue(self.writer.stopped)

    def test_unprepared_package_is_not_substituted(self):
        self.prepared();self.writer._working_package=None
        parent,peer=self.pair();peer.send({'version':1,'sequence':1,'operation':'read_paths'})
        with self.assertRaises(ValueError):parent.serve_one()
        with self.assertRaises(ChannelStopped):peer.receive()
        self.assertTrue(self.writer.stopped)


if __name__=='__main__':unittest.main()
