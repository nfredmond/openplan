"""Combined verified state/project/package/output join, with mocked transport."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
import model_attempt_writer as managed
import model_count_inputs as counts
import model_package_inputs as packages
import test_managed_execution_inputs as inputs
from test_model_skip_dispatch import aeq


class OutputMappingTests(unittest.TestCase):
    setUp=inputs.ExecutionInputsTests.setUp
    response=inputs.ExecutionInputsTests.response

    def prepare(self):
        original,path,_=inputs.ExecutionInputsTests.prepare(self)
        source=path.parent/'run_output';source.mkdir()
        external=path.parent/'source_counts.csv';external.write_bytes(b'station_id,aadt\nA,17\n')
        record=counts.retain(str(external),str(source),source/'count_inputs')
        (source/'link_volumes.csv').write_bytes(b'link_id,PCE_tot\n1,17\n')
        original['assignment']={'counts_path':record['counts_path'],'count_inputs':record,'source_label':str(external)}
        content=(json.dumps(original)+'\n').encode();path.write_bytes(content)
        retained=packages.retain(source,path.parent/'assignment_outputs')
        artifact={**copy.deepcopy(self.artifact),'id':'00000008-1111-4111-8111-111111111111','artifact_type':'model_assignment_outputs',
                  'file_url':'local://'+retained['manifest_path'],'content_hash':retained['manifest_sha256'],
                  'file_size_bytes':retained['manifest_size_bytes'],
                  'metadata_json':{'schema':'openplan.assignment-outputs.v1','inventory_schema':'openplan.package-inputs.v1'}}
        read=self.read.side_effect
        def joined(url,**kwargs):
            kind=kwargs.get('params',{}).get('artifact_type')
            if kind=='eq.model_assignment_outputs':return Mock(status_code=200,json=lambda:[artifact])
            result=read(url,**kwargs)
            if kind=='eq.model_predecessor_state':
                records=result.json()
                records[0].update(content_hash=hashlib.sha256(content).hexdigest(),file_size_bytes=len(content))
                return Mock(status_code=200,json=lambda:records)
            return result
        self.read.side_effect=joined
        return original,path,content

    def test_complete_mapping_preserves_original_and_consumable_counts(self):
        original,path,content=self.prepare()
        with managed.bind(self.writer):result=aeq.retain_managed_state_and_package(include_project=True,include_outputs=True)
        mapping=json.loads(Path(result['mapping_record']['path']).read_bytes())
        self.assertEqual(set(mapping['inputs']),{'state','package','project','outputs'})
        self.assertEqual(mapping['inputs']['outputs'],result['output_input']['producer'])
        self.assertEqual(mapping['execution_paths']['outputs_directory'],self.writer.output_directory(self.writer.files.path))
        self.assertEqual(mapping['working_outputs']['input_manifest_sha256'],result['output_input']['manifest_sha256'])
        self.assertEqual(mapping['working_outputs']['initial_manifest_sha256'],hashlib.sha256(Path(mapping['working_outputs']['initial_manifest_path']).read_bytes()).hexdigest())
        self.assertEqual(mapping['state'],result['package_mapped_state'])
        self.assertEqual(mapping['state']['package']['package_dir'],self.writer.package_directory(self.writer.files.path))
        self.assertEqual(mapping['state']['assignment']['source_label'],original['assignment']['source_label'])
        self.assertEqual(path.read_bytes(),content)
        self.assertEqual(result['state_input']['state'],original)
        record=mapping['state']['assignment']['count_inputs']
        self.assertEqual(record['counts_input_directory'],str(Path(result['output_input']['outputs_directory'])/'count_inputs'))
        copied=counts.consume(record,self.writer.files.path/'verified_counts')
        self.assertEqual(Path(copied['counts_path']).read_bytes(),b'station_id,aadt\nA,17\n')
        self.assertIs(mapping['execution_ready'],False)
        kinds=[c.kwargs['json']['p_payload']['artifact_type'] for c in self.post.call_args_list]
        self.assertEqual(kinds[-3:],['model_output_consumption','model_output_working_copy','model_input_mapping'])
        self.assertEqual(len(kinds),8)

    def test_different_output_attempt_refuses_before_working_copy(self):
        self.prepare();real=aeq.retain_managed_predecessor_outputs
        def changed():
            result=real();result['producer']['attempt_id']='different';return result
        with managed.bind(self.writer),patch.object(aeq,'retain_managed_predecessor_outputs',side_effect=changed):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_state_and_package(include_project=True,include_outputs=True)
        self.assertIn('same producer attempt',str(error.exception.__cause__))
        self.assertFalse((self.writer.files.path/'output_working').exists())
        self.assertFalse((self.writer.files.path/'input_mapping.json').exists())
        self.assertTrue(self.writer.stopped)

    def test_lost_final_mapping_reply_blocks_output_use(self):
        self.prepare();response=self.response
        def lose(url,**kwargs):
            if kwargs.get('json',{}).get('p_payload',{}).get('artifact_type')=='model_input_mapping':raise TimeoutError('Synthetic lost mapping reply')
            return response(url,**kwargs)
        self.post.side_effect=lose
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.retain_managed_state_and_package(include_project=True,include_outputs=True)
        self.assertTrue((self.writer.files.path/'input_mapping.json').exists())
        with self.assertRaises(Exception):self.writer.output_directory(self.writer.files.path)
        self.assertTrue(self.writer.stopped)

    def test_output_mode_requires_project_preparation(self):
        self.prepare()
        with managed.bind(self.writer),self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
            aeq.retain_managed_state_and_package(include_outputs=True)
        self.assertIn('requires project and package working copies',str(error.exception.__cause__))
        self.read.assert_not_called();self.post.assert_not_called()


if __name__=='__main__':unittest.main()
