"""Selected state transfer preserves original paths and bytes, not execution mapping."""
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_handoff_files as files
import test_model_attempt_outputs as outputs
import test_model_predecessor_inputs as predecessors
from test_model_skip_dispatch import aeq


class ManagedStateTests(unittest.TestCase):
    setUp = predecessors.BoundPredecessorTests.setUp
    response = outputs.OutputTests.response
    def prepare(self, content=None):
        root = self.writer.workspace(self.directory/'runs', self.writer.context.run_id)
        installation = hashlib.sha256(self.writer.context.destination.encode()).hexdigest()
        producer = self.writer.files.root/self.writer.context.run_id/'attempts'/installation/self.artifact['stage_id']/self.artifact['attempt_id']
        producer.mkdir(parents=True)
        path = producer/'predecessor_state.json'
        content = content if content is not None else b'{"package":{"package_dir":"/original/package"},"setup":{"bbox":[-122,38,-120,40]}}\n'
        path.write_bytes(content)
        self.artifact.update(artifact_type='model_predecessor_state', file_url='local://'+str(path),
            content_hash=hashlib.sha256(content).hexdigest(),file_size_bytes=len(content),metadata_json={'schema':'openplan.predecessor-state.v1'})
        return root,path,content
    def test_preserves_original_bytes_and_paths_with_provenance(self):
        root,source,content = self.prepare()
        with managed.bind(self.writer):
            result=aeq.retain_managed_predecessor_state()
        retained=Path(result['retained_path'])
        self.assertEqual(retained,root/'predecessor_state_input.json')
        self.assertEqual(retained.read_bytes(),content)
        self.assertEqual(source.read_bytes(),content)
        self.assertNotEqual(retained.stat().st_ino,source.stat().st_ino)
        self.assertEqual(result['state'],json.loads(content))
        self.assertEqual(result['state']['package']['package_dir'],'/original/package')
        payload=self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'],'model_state_consumption')
        self.assertFalse(payload['metadata_json']['paths_relocated'])
        self.assertEqual(payload['metadata_json']['producer']['artifact_id'],self.artifact['id'])
    def test_foreign_path_refused_before_copy(self):
        self.prepare()
        self.artifact['file_url']='local://'+str(self.directory/'foreign.json')
        with managed.bind(self.writer),patch.object(files,'copy_registered',side_effect=AssertionError('Foreign read')) as copy:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_state()
        self.assertIsInstance(error.exception.__cause__,ValueError)
        copy.assert_not_called();self.post.assert_not_called()
    def test_tampered_state_refused_before_registration(self):
        root,path,content=self.prepare()
        path.write_bytes(content.replace(b'original',b'modified'))
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_state()
        self.assertIn('bytes differ',str(error.exception.__cause__))
        self.assertFalse((root/'predecessor_state_input.json').exists())
        self.post.assert_not_called()
    def test_duplicate_keys_refused(self):
        self.prepare(b'{"package":{},"package":{"package_dir":"other"}}')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_state()
        self.assertIn('Duplicate',str(error.exception.__cause__))
        self.post.assert_not_called()
    def test_nonfinite_state_refused(self):
        self.prepare(b'{"value":NaN}')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_state()
        self.assertIn('Nonfinite',str(error.exception.__cause__))
        self.post.assert_not_called()
    def test_lost_reply_stops_and_preserves_pending_record(self):
        import model_command_journal as journal
        root,path,content=self.prepare()
        self.post.side_effect=TimeoutError('synthetic lost reply')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.retain_managed_predecessor_state()
        self.assertTrue(self.writer.stopped)
        self.assertEqual((root/'predecessor_state_input.json').read_bytes(),content)
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'],'model_state_consumption')
    def test_copy_changed_before_decode_is_refused(self):
        root,path,content=self.prepare()
        original=files.copy_registered
        def changed(*args,**kwargs):
            result=original(*args,**kwargs)
            Path(result).write_bytes(content.replace(b'original',b'modified'))
            return result
        with managed.bind(self.writer),patch.object(files,'copy_registered',side_effect=changed):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_predecessor_state()
        self.assertIn('changed before decoding',str(error.exception.__cause__))
        self.post.assert_not_called()
