"""Managed package enforcement at actual assignment and artifact entry points."""
import inspect
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import test_project_execution_path as project
from test_model_skip_dispatch import aeq


class PackagePathTests(unittest.TestCase):
    setUp = project.ProjectPathTests.setUp
    response = project.ProjectPathTests.response
    prepared = project.ProjectPathTests.prepared

    def test_legacy_path_preserved_outside_binding(self):
        self.assertEqual(aeq.package_work_directory('/work','/recorded/package'), '/recorded/package')
        self.assertIsNone(aeq.package_work_directory('/work',None))

    def test_actual_assignment_uses_confirmed_working_package(self):
        root, _ = self.prepared()
        expected = self.writer.package_directory(root)
        seen = []
        class StopBeforeComputation(Exception):pass
        def stop(*args, **kwargs):
            seen.append(inspect.currentframe().f_back.f_locals['pkg_dir'])
            raise StopBeforeComputation()
        with managed.bind(self.writer), patch.object(aeq.os,'makedirs',new=stop):
            with self.assertRaises(StopBeforeComputation):
                aeq.stage_assignment(self.writer.context.run_id,self.writer.context.stage_id,str(root),{},expected)
        self.assertEqual(seen,[expected])

    def test_retained_input_cannot_be_used_for_assignment(self):
        root, _ = self.prepared()
        with managed.bind(self.writer), patch.object(aeq.os,'makedirs',side_effect=AssertionError('Stage continued')):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.stage_assignment(self.writer.context.run_id,self.writer.context.stage_id,str(root),{},str(root/'predecessor_package/files'))
        self.assertIn('differs from confirmed',str(error.exception.__cause__))
        self.assertTrue(self.writer.stopped)

    def test_artifact_stage_refuses_missing_package_before_count_writes(self):
        root, _ = self.prepared()
        with managed.bind(self.writer), patch.object(aeq,'retain_assignment_counts',side_effect=AssertionError('Counts reached')):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.stage_artifacts(self.writer.context.run_id,self.writer.context.stage_id,str(root),{}, {'count_inputs':{}},None)
        self.assertIn('differs from confirmed',str(error.exception.__cause__))
        self.assertTrue(self.writer.stopped)

    def test_directory_replacement_refused(self):
        root, _ = self.prepared()
        path = Path(self.writer.package_directory(root))
        path.rename(path.with_name('original-files'))
        path.mkdir()
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.package_work_directory(str(root),str(path))
        self.assertTrue(self.writer.stopped)

    def test_wrong_attempt_directory_refused(self):
        root, _ = self.prepared()
        expected=self.writer.package_directory(root)
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.package_work_directory(str(self.directory),expected)
        self.assertTrue(self.writer.stopped)


if __name__=='__main__':unittest.main()
