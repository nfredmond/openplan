"""Original preparation bytes survive a distinct consumer copy."""
import json
from pathlib import Path
import unittest

import model_predecessor_inputs as selection
import model_validation_preparation as preparation
import test_model_validation_preparation as fixtures
import test_model_predecessor_inputs as predecessor


class ConsumptionTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.PreparationTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.record=self.fixture.run_prepare()
        self.context=json.loads(Path(self.record['manifest_path']).read_text())['context']
        self.destination=self.fixture.files.path/'consumer-copy'
    def consume(self):
        return preparation.consume(root=self.fixture.files.root.parent,source=self.record,
                                   destination=self.destination,expected_context=self.context)
    def rehash(self,change):
        path=Path(self.record['manifest_path']);value=json.loads(path.read_text());change(value)
        content=preparation.instrument.canonical_json_bytes(value);path.write_bytes(content)
        self.record.update(manifest_sha256=preparation.hashlib.sha256(content).hexdigest(),manifest_size_bytes=len(content))
    def test_original_bundle_and_manifest_are_preserved(self):
        original=Path(self.record['manifest_path']).read_bytes()
        result=self.consume()
        self.assertEqual((self.destination/'producer_manifest.json').read_bytes(),original)
        self.assertEqual(Path(result['bundle_path']).read_bytes(),(Path(self.record['manifest_path']).parent/'validation_input_bundle.json').read_bytes())
        self.assertFalse(result['execution_authorized']);self.assertEqual(len(result['source_paths']),6)
        for source in result['source_paths'].values():self.assertTrue(Path(source).is_file())
    def test_changed_scope_refused_before_destination(self):
        self.context={**self.context,'method':'activitysim'}
        with self.assertRaisesRegex(ValueError,'scope or state'):self.consume()
        self.assertFalse(self.destination.exists())
    def test_rehashed_missing_duplicate_or_redirected_roles_refused(self):
        for change in (lambda v:v['entries'].pop(),lambda v:v['entries'].__setitem__(1,v['entries'][0]),lambda v:v['entries'][0].update(object_name='../outside')):
            self.setUp();self.rehash(change)
            with self.assertRaisesRegex(ValueError,'role (inventory|binding)'):self.consume()
            self.assertFalse(self.destination.exists())
    def test_changed_object_refused_without_completion(self):
        manifest=json.loads(Path(self.record['manifest_path']).read_text())
        (Path(self.record['manifest_path']).parent/manifest['entries'][0]['object_name']).write_bytes(b'changed')
        with self.assertRaises(ValueError):self.consume()
        self.assertFalse((self.destination/'manifest.json').exists())
    def test_existing_consumer_is_not_reused(self):
        self.consume()
        with self.assertRaises(FileExistsError):self.consume()


class SelectionTests(unittest.TestCase):
    def setUp(self):
        f=predecessor.PredecessorTests();f.setUp()
        self.context=f.context;self.consumer=f.consumer;self.producer=f.producer;self.artifact=f.artifact
        self.consumer['stage_name']='Network Assignment';self.producer['stage_name']='AequilibraE Setup'
        self.artifact.update(artifact_type='model_validation_preparation',metadata_json={'demand_method':'aequilibrae'})
    def select(self,method='aequilibrae'):
        return selection.select(self.context,[self.consumer,self.producer],[self.artifact],'model_validation_preparation',method=method)
    def test_named_method_specific_producer_is_required(self):
        self.assertEqual(self.select(),self.artifact)
        self.consumer['stage_name']='ActivitySim Network Assignment';self.producer['stage_name']='ActivitySim Bundle & Preflight'
        self.artifact['metadata_json']['demand_method']='activitysim'
        self.assertEqual(self.select('activitysim'),self.artifact)
    def test_wrong_method_or_prior_assignment_cannot_supply_preparation(self):
        with self.assertRaisesRegex(ValueError,'method differs'):self.select('activitysim')
        self.producer['stage_name']='Network Assignment'
        with self.assertRaisesRegex(ValueError,'stage must be unique'):self.select()
    def test_foreign_method_artifact_is_not_selected(self):
        self.artifact['metadata_json']['demand_method']='activitysim'
        with self.assertRaisesRegex(ValueError,'artifact must be unique'):self.select()


if __name__=='__main__':unittest.main()
