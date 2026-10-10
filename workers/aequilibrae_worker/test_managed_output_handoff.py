"""Assignment output inventory and selected copies, with mocked registration."""
import hashlib
import json
from pathlib import Path
import unittest
import model_attempt_writer as managed
import model_package_inputs as package
import test_managed_package_handoff as packages
from test_model_skip_dispatch import aeq


class OutputHandoffTests(unittest.TestCase):
    setUp = packages.ManagedPackageHandoffTests.setUp
    response = packages.ManagedPackageHandoffTests.response

    def prepare(self):
        self.writer.workspace(self.directory/'runs',self.writer.context.run_id)
        installation=hashlib.sha256(self.writer.context.destination.encode()).hexdigest()
        producer=self.writer.files.root/self.writer.context.run_id/'attempts'/installation/self.artifact['stage_id']/self.artifact['attempt_id']
        source=producer/'run_output';source.mkdir(parents=True)
        self.contents={'link_volumes.csv':b'link_id,PCE_tot\n1,17\n',
                       'travel_time_skims.omx':b'synthetic skim bytes',
                       'accepted_network_calibration.json':b'{"synthetic":true}',
                       'count_inputs/manifest.json':b'{"source_reference":"/original/counts.csv","scientific_acceptance":"unassessed"}'}
        for name,data in self.contents.items():
            path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        record=package.retain(source,producer/'assignment_outputs')
        self.artifact.update(artifact_type='model_assignment_outputs',file_url='local://'+record['manifest_path'],
            content_hash=record['manifest_sha256'],file_size_bytes=record['manifest_size_bytes'],
            metadata_json={'schema':'openplan.assignment-outputs.v1','inventory_schema':'openplan.package-inputs.v1'})
        return source,record

    def test_selected_outputs_preserve_all_files_and_provenance(self):
        source,record=self.prepare()
        with managed.bind(self.writer):result=aeq.retain_managed_predecessor_outputs()
        for name,data in self.contents.items():
            copied=Path(result['outputs_directory'])/name
            self.assertEqual(copied.read_bytes(),data)
            self.assertNotEqual(copied.stat().st_ino,(Path(record['package_directory'])/name).stat().st_ino)
        self.assertEqual(self.read.call_args_list[1].kwargs['params']['artifact_type'],'eq.model_assignment_outputs')
        payload=self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'],'model_output_consumption')
        self.assertEqual(payload['metadata_json']['producer'],result['producer'])
        self.assertEqual(payload['metadata_json']['producer']['attempt_id'],self.artifact['attempt_id'])
        self.assertEqual(payload['content_hash'],hashlib.sha256(Path(result['manifest_path']).read_bytes()).hexdigest())

    def test_changed_nested_count_record_refuses_consumption(self):
        source,record=self.prepare()
        (Path(record['package_directory'])/'count_inputs/manifest.json').write_bytes(b'changed source reference')
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
            aeq.retain_managed_predecessor_outputs()
        self.assertIn('inventory',str(error.exception.__cause__))
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_foreign_output_reference_refused(self):
        self.prepare();self.artifact['file_url']='local:///foreign/manifest.json'
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
            aeq.retain_managed_predecessor_outputs()
        self.assertIn('selected producer directory',str(error.exception.__cause__))
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_owned_output_capture_registers_complete_inventory(self):
        self.prepare()
        source=self.writer.files.path/'run_output';source.mkdir()
        for name,data in self.contents.items():
            path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        result=self.writer.retain_assignment_outputs(source)
        payload=self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'],'model_assignment_outputs')
        self.assertEqual(payload['metadata_json']['schema'],'openplan.assignment-outputs.v1')
        self.assertEqual(payload['metadata_json']['inventory_schema'],'openplan.package-inputs.v1')
        self.assertEqual(payload['content_hash'],hashlib.sha256(Path(result['manifest_path']).read_bytes()).hexdigest())
        inventory=json.loads(Path(result['manifest_path']).read_bytes())['entries']
        self.assertEqual(set(inventory),set(self.contents)|{'count_inputs'})

    def test_foreign_capture_source_refused(self):
        source,record=self.prepare()
        with self.assertRaisesRegex(ValueError,'owned attempt'):
            self.writer.retain_assignment_outputs(source)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_lost_consumption_reply_stops_with_exact_pending_command(self):
        import model_command_journal as journal
        self.prepare();self.post.side_effect=TimeoutError('Synthetic lost output reply')
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.retain_managed_predecessor_outputs()
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'],'model_output_consumption')
        self.assertTrue(self.writer.stopped)


if __name__=='__main__':unittest.main()
