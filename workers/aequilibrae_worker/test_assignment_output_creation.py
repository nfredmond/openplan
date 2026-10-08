"""Exclusive managed assignment directories, before engine work."""
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import test_project_execution_path as project
from test_model_skip_dispatch import aeq


class OutputCreationTests(unittest.TestCase):
    setUp=project.ProjectPathTests.setUp
    response=project.ProjectPathTests.response
    prepared=project.ProjectPathTests.prepared

    def test_owned_names_create_private_independent_directories(self):
        root,_=self.prepared()
        with managed.bind(self.writer):
            for name in ('run_output','activitysim_assignment_output'):
                path=Path(aeq.create_assignment_output_directory(str(root),name))
                self.assertEqual(path,root/name)
                self.assertTrue(path.is_dir())
                self.assertEqual(path.stat().st_mode & 0o777,0o700)

    def test_existing_outputs_are_not_adopted_or_changed(self):
        root,_=self.prepared();path=root/'run_output';path.mkdir()
        (path/'evidence').write_bytes(b'original')
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.create_assignment_output_directory(str(root),'run_output')
        self.assertEqual((path/'evidence').read_bytes(),b'original')
        self.assertTrue(self.writer.stopped)

    def test_foreign_attempt_refused(self):
        self.prepared()
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.create_assignment_output_directory(str(self.directory),'run_output')
        self.assertFalse((self.directory/'run_output').exists())
        self.assertTrue(self.writer.stopped)

    def test_traversal_name_refused(self):
        root,_=self.prepared()
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.create_assignment_output_directory(str(root),'../escaped')
        self.assertFalse((root.parent/'escaped').exists())
        self.assertTrue(self.writer.stopped)

    def test_actual_assignment_refuses_existing_outputs_before_run_read(self):
        root,_=self.prepared();(root/'run_output').mkdir()
        with managed.bind(self.writer),patch.object(aeq,'sb_get_run',side_effect=AssertionError('Run read reached')) as read:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.stage_assignment(self.writer.context.run_id,self.writer.context.stage_id,str(root),{'centroid_map':{}},self.writer.package_directory(root))
        read.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_legacy_existing_directory_remains_usable(self):
        path=self.directory/'legacy';path.mkdir()
        self.assertEqual(aeq.create_assignment_output_directory(str(self.directory),'legacy'),str(path))


if __name__=='__main__':unittest.main()
