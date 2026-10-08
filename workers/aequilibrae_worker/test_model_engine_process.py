"""Real child process exit, durable no-relaunch and refusal before completion."""
import json,os,sys,time
from pathlib import Path
import unittest
from unittest.mock import patch
from model_engine_process import EngineProcess,EngineStillRunning
import test_project_execution_path as project


class EngineProcessTests(unittest.TestCase):
    setUp=project.ProjectPathTests.setUp
    response=project.ProjectPathTests.response
    prepared=project.ProjectPathTests.prepared

    def start(self,code):
        self.prepared()
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',code],env=dict(os.environ))
        def cleanup():
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)
        self.addCleanup(cleanup)
        return handle

    def test_completed_child_records_original_identity(self):
        handle=self.start("from pathlib import Path;Path('synthetic-output').write_text('done')")
        handle.process.wait(timeout=10)
        receipt=handle.confirm_exit()
        self.assertEqual(receipt['returncode'],0)
        self.assertEqual(receipt['attempt_id'],self.writer.context.attempt_id)
        self.assertIs(receipt['execution_ready'],False)
        self.assertEqual(json.loads((handle.directory/'observed-exit.json').read_text()),receipt)
        self.assertEqual(handle.confirm_exit(),receipt)
        self.assertEqual((self.writer.files.path/'synthetic-output').read_text(),'done')

    def test_live_child_cannot_produce_exit_receipt(self):
        handle=self.start('import time;time.sleep(30)')
        with self.assertRaises(EngineStillRunning):handle.confirm_exit()
        self.assertFalse((handle.directory/'observed-exit.json').exists())
        self.assertFalse(self.writer.stopped)

    def test_existing_reservation_never_launches_again(self):
        handle=self.start('pass');handle.process.wait(timeout=10);handle.confirm_exit()
        with patch('model_engine_process.subprocess.Popen',side_effect=AssertionError('Replay launched')) as launch:
            with self.assertRaises(FileExistsError) as error:EngineProcess(self.writer,[sys.executable,'-c','pass'],env=dict(os.environ))
        self.assertEqual(Path(error.exception.filename).name,'engine_process')
        launch.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_nonzero_exit_is_retained_and_stops_writer(self):
        handle=self.start('raise SystemExit(7)');handle.process.wait(timeout=10)
        with self.assertRaisesRegex(RuntimeError,'unsuccessfully'):handle.confirm_exit()
        self.assertEqual(json.loads((handle.directory/'observed-exit.json').read_text())['returncode'],7)
        self.assertTrue(self.writer.stopped)

    def test_group_members_prevent_completion(self):
        handle=self.start('pass');handle.process.wait(timeout=10)
        with patch('model_engine_process.os.killpg',return_value=None):
            with self.assertRaisesRegex(EngineStillRunning,'group still'):handle.confirm_exit()
        self.assertFalse((handle.directory/'observed-exit.json').exists())


if __name__=='__main__':unittest.main()
