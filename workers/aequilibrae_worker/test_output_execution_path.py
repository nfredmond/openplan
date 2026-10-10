"""Actual artifact entry points use the confirmed output working directory."""
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import test_output_working_copy as working
from test_model_skip_dispatch import aeq


class OutputPathTests(unittest.TestCase):
    setUp = working.OutputWorkingCopyTests.setUp
    response = working.OutputWorkingCopyTests.response
    prepare = working.OutputWorkingCopyTests.prepare
    consumed = working.OutputWorkingCopyTests.consumed

    def prepared(self):
        return self.writer.prepare_output_working_copy(self.consumed())['outputs_directory']

    def test_legacy_layout_preserved(self):
        self.assertEqual(aeq.output_work_directory('/synthetic'), '/synthetic/run_output')

    def test_artifact_counts_use_confirmed_output_directory(self):
        expected = self.prepared()
        class StopBeforeEvidence(Exception):pass
        with managed.bind(self.writer), patch.object(aeq,'package_work_directory'), patch.object(aeq,'retain_assignment_counts',side_effect=StopBeforeEvidence) as counts:
            with self.assertRaises(StopBeforeEvidence):
                aeq.stage_artifacts(self.writer.context.run_id,self.writer.context.stage_id,str(self.writer.files.path),{}, {'count_inputs':{}})
        self.assertEqual(counts.call_args.args[1],expected)
        self.assertEqual(counts.call_args.kwargs['status_directory'],expected)

    def test_unprepared_artifact_stage_stops_before_count_writes(self):
        self.consumed()
        with managed.bind(self.writer), patch.object(aeq,'package_work_directory'), patch.object(aeq,'retain_assignment_counts',side_effect=AssertionError('Counts reached')) as counts:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.stage_artifacts(self.writer.context.run_id,self.writer.context.stage_id,str(self.writer.files.path),{}, {'count_inputs':{}})
        counts.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_primary_preparation_uses_working_volume_file(self):
        import model_stage_preparation
        expected = self.prepared()
        with managed.bind(self.writer), patch.object(aeq,'package_work_directory'), patch.object(aeq,'project_work_directory',return_value='/synthetic/project'), patch.object(model_stage_preparation,'prepare_files',return_value={}) as prepare:
            aeq.prepare_primary_model_output(self.writer.context.run_id,self.writer.context.stage_id,str(self.writer.files.path),{}, {},None)
        self.assertEqual(prepare.call_args.kwargs['source_paths']['link_volumes'],Path(expected)/'link_volumes.csv')

    def test_volume_publication_refuses_unprepared_outputs_before_database(self):
        self.consumed()
        with managed.bind(self.writer), patch.object(aeq,'project_work_directory',side_effect=AssertionError('Project reached')) as project:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.publish_volume_geojson(self.writer.context.run_id,self.writer.context.stage_id,str(self.writer.files.path),'synthetic',{},workspace_id=self.writer.context.workspace_id)
        project.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_evidence_packet_uses_working_outputs(self):
        import model_stage_computation
        expected = self.prepared()
        with managed.bind(self.writer), patch.object(model_stage_computation,'compute_once',return_value={'synthetic':True}):
            result, content = aeq.retain_model_evidence_packet(self.writer.context.run_id,self.writer.context.stage_id,str(self.writer.files.path),{'synthetic':True})
        self.assertTrue((Path(expected)/'evidence_packet.json').is_file())
        self.assertEqual((Path(expected)/'evidence_packet.json').read_bytes(),content)
        self.assertFalse((self.writer.files.path/'predecessor_outputs/files/evidence_packet.json').exists())
        self.assertFalse((self.writer.files.path/'run_output/evidence_packet.json').exists())


if __name__=='__main__':unittest.main()
