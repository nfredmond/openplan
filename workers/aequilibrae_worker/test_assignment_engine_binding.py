"""Actual assignment adapters refuse direct fallback inside a child binding."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
import model_engine_binding as bindings
from test_model_skip_dispatch import aeq

class AssignmentEngineBindingTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.client=Mock()
        self.client.read_run.return_value={'id':'run','workspace_id':'workspace'}
        self.client.read_paths.return_value={'work_directory':str(self.root),'project_directory':str(self.root/'project'),'package_directory':str(self.root/'package')}
        self.client.create_outputs.return_value={'output_directory':str(self.root/'run_output')}
        self.binding=bindings.EngineBinding(self.client,run_id='run',stage_id='stage',work_directory=self.root,output_name='run_output')

    def test_actual_adapters_route_to_parent(self):
        with bindings.bind(self.binding),patch.object(aeq.requests,'get',side_effect=AssertionError('Direct read')),patch.object(aeq,'_confirmed_state_patch',side_effect=AssertionError('Direct write')):
            self.assertEqual(aeq.sb_get_run('run')['workspace_id'],'workspace')
            aeq.sb_patch_stage('stage',{'log_tail':'progress'})
            self.assertEqual(aeq.project_work_directory(str(self.root)),str(self.root/'project'))
            self.assertEqual(aeq.package_work_directory(str(self.root),str(self.root/'package')),str(self.root/'package'))
            self.assertEqual(aeq.create_assignment_output_directory(str(self.root),'run_output'),str(self.root/'run_output'))
        self.client.progress.assert_called_once_with('progress')
        self.client.read_run.assert_called_once_with()
        self.client.create_outputs.assert_called_once_with()
        self.assertFalse((self.root/'run_output').exists())
        self.assertIsNone(bindings.current())

    def test_foreign_scope_and_terminal_write_refused(self):
        with bindings.bind(self.binding):
            for call in (lambda:aeq.sb_get_run('foreign'),lambda:aeq.sb_patch_stage('foreign',{'log_tail':'bad'}),lambda:aeq.sb_patch_stage('stage',{'status':'complete'}),lambda:aeq.project_work_directory('/foreign'),lambda:aeq.create_assignment_output_directory(str(self.root),'foreign')):
                with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):call()
        self.assertEqual(self.client.mock_calls,[])

    def test_channel_failure_never_falls_back(self):
        self.client.read_run.side_effect=RuntimeError('Synthetic channel loss')
        with bindings.bind(self.binding),patch.object(aeq.requests,'get') as direct:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.sb_get_run('run')
        direct.assert_not_called()

    def test_foreign_parent_reply_and_package_refused(self):
        self.client.read_run.return_value={'id':'foreign'}
        with bindings.bind(self.binding):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.sb_get_run('run')
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.package_work_directory(str(self.root),'/foreign')

if __name__=='__main__':unittest.main()
