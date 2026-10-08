"""Actual stage path selection, stopping before scientific computation."""
import inspect
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import test_project_working_copy as working
from test_model_skip_dispatch import aeq


class ProjectPathTests(unittest.TestCase):
    setUp = working.ProjectWorkingCopyTests.setUp
    response = working.ProjectWorkingCopyTests.response
    prepare = working.ProjectWorkingCopyTests.prepare
    consumed = working.ProjectWorkingCopyTests.consumed

    def prepared(self):
        from test_managed_execution_inputs import ExecutionInputsTests
        ExecutionInputsTests.prepare(self)
        with managed.bind(self.writer):
            result = aeq.retain_managed_state_and_package(include_project=True)
        return self.writer.files.path, result['project_working_copy']['project_directory']

    def test_legacy_layout_outside_binding(self):
        self.assertEqual(aeq.project_work_directory('/synthetic'), '/synthetic/aeq_project')

    def test_unprepared_managed_path_never_falls_back(self):
        self.prepare()
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.project_work_directory(str(self.writer.files.path))
        self.assertTrue(self.writer.stopped)

    def test_actual_assignment_uses_confirmed_copy_before_computation(self):
        root, expected = self.prepared()
        seen = []
        class StopBeforeComputation(Exception):pass
        def stop(*args, **kwargs):
            seen.append(inspect.currentframe().f_back.f_locals['proj_dir'])
            raise StopBeforeComputation()
        with managed.bind(self.writer), patch.object(aeq, 'create_assignment_output_directory', new=stop):
            with self.assertRaises(StopBeforeComputation):
                aeq.stage_assignment(self.writer.context.run_id, self.writer.context.stage_id, str(root), {}, self.writer.package_directory(root))
        self.assertEqual(seen, [expected])

    def test_primary_output_preparation_uses_same_working_database(self):
        import model_stage_preparation
        root, expected = self.prepared()
        with managed.bind(self.writer), patch.object(aeq, 'output_work_directory', return_value=str(root/'synthetic-output')), patch.object(model_stage_preparation, 'prepare_files', return_value={}) as prepare:
            aeq.prepare_primary_model_output(self.writer.context.run_id, self.writer.context.stage_id, str(root), {}, {}, {'package_dir':self.writer.package_directory(root)})
        self.assertEqual(prepare.call_args.kwargs['source_paths']['network'], Path(expected) / 'project_database.sqlite')

    def test_other_attempt_path_refused(self):
        self.prepared()
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.project_work_directory(str(self.directory))
        self.assertTrue(self.writer.stopped)

    def test_replaced_working_directory_refused(self):
        root, expected = self.prepared()
        path = Path(expected)
        path.rename(path.with_name('original-files'))
        path.mkdir()
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.project_work_directory(str(root))
        self.assertTrue(self.writer.stopped)

    def test_lost_preparation_reply_does_not_activate_path(self):
        consumed = self.consumed()
        self.post.side_effect = TimeoutError('Synthetic lost reply')
        with self.assertRaises(Exception):self.writer.prepare_project_working_copy(consumed)
        self.assertIsNone(self.writer._working_project)
        with self.assertRaises(Exception):self.writer.project_directory(self.writer.files.path)


if __name__ == '__main__':unittest.main()
