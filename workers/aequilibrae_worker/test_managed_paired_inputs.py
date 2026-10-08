"""Pair actual selected state/package inputs without rewriting original records."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import Mock
import model_attempt_writer as managed
import model_package_inputs as package
import model_predecessor_inputs as predecessor
import test_model_attempt_outputs as outputs
import test_model_predecessor_inputs as predecessors
from test_model_skip_dispatch import aeq


class PairedInputTests(unittest.TestCase):
    setUp = predecessors.BoundPredecessorTests.setUp
    response = outputs.OutputTests.response
    def prepare(self, wrong_source=False):
        self.writer.workspace(self.directory/'runs',self.writer.context.run_id)
        installation=hashlib.sha256(self.writer.context.destination.encode()).hexdigest()
        root=self.writer.files.root/self.writer.context.run_id/'attempts'/installation/self.artifact['stage_id']/self.artifact['attempt_id']
        source=root/'package';source.mkdir(parents=True)
        (source/'zones.csv').write_bytes(b'zone,population\n1,123\n')
        record=package.retain(source,root/'package_inputs')
        original={'package':{'package_dir':str(source) if not wrong_source else '/different/package','source_label':str(source)},
                  'setup':{'bbox':[-122,38,-120,40]},'assignment':{'counts_path':'/original/counts.csv'}}
        content=(json.dumps(original)+'\n').encode()
        state_path=root/'predecessor_state.json';state_path.write_bytes(content)
        self.artifact.update(file_url='local://'+record['manifest_path'],content_hash=record['manifest_sha256'],file_size_bytes=record['manifest_size_bytes'],metadata_json={'schema':'openplan.package-inputs.v1'})
        state_artifact={**copy.deepcopy(self.artifact),'id':predecessors.IDS[7],'artifact_type':'model_predecessor_state',
                        'file_url':'local://'+str(state_path),'content_hash':hashlib.sha256(content).hexdigest(),
                        'file_size_bytes':len(content),'metadata_json':{'schema':'openplan.predecessor-state.v1'}}
        artifacts=[self.artifact,state_artifact]
        def read(url,**kwargs):
            if url.endswith('/model_run_stages'):
                return Mock(status_code=200,json=lambda:self.rows)
            kind=kwargs['params']['artifact_type'].removeprefix('eq.')
            return Mock(status_code=200,json=lambda:[item for item in artifacts if item['artifact_type']==kind])
        self.read.side_effect=read
        return original,state_path,content
    def test_real_join_maps_only_package_and_preserves_original(self):
        original,path,content=self.prepare()
        with managed.bind(self.writer):
            result=aeq.retain_managed_state_and_package()
        self.assertFalse(result['execution_ready'])
        mapped=result['package_mapped_state']
        self.assertEqual(mapped['package']['package_dir'],result['package_input']['package_directory'])
        self.assertEqual(mapped['package']['source_label'],original['package']['source_label'])
        self.assertEqual(mapped['assignment'],original['assignment'])
        self.assertEqual(result['state_input']['state'],original)
        mapped['setup']['bbox'][0]=0
        self.assertEqual(result['state_input']['state'],original)
        self.assertEqual(path.read_bytes(),content)
        self.assertEqual(Path(result['state_input']['retained_path']).read_bytes(),content)
        types=[call.kwargs['json']['p_payload']['artifact_type'] for call in self.post.call_args_list]
        self.assertEqual(types,['model_state_consumption','model_package_consumption'])
    def test_recorded_package_mismatch_stops_join(self):
        self.prepare(wrong_source=True)
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_state_and_package()
        self.assertIn('source directory disagree',str(error.exception.__cause__))
        self.assertTrue(self.writer.stopped)
    def test_different_attempts_cannot_be_paired(self):
        state={'producer':{'stage_id':'stage','attempt_id':'one'},'state':{'package':{'package_dir':'/source'}}}
        other={'producer':{'stage_id':'stage','attempt_id':'two'},'source_package_directory':'/source','package_directory':'/copy'}
        with self.assertRaisesRegex(ValueError,'same producer attempt'):
            predecessor.map_package(state,other)
