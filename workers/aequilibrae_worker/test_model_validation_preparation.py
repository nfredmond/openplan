"""Real owned files and shared v2 builder; no execution or scientific acceptance."""
import json
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

import model_validation_preparation as preparation
from model_attempt_workspace import AttemptWorkspace
from model_attempt_invocation import AttemptContext
from test_model_command_client import IDS
sys.path.insert(0,str(preparation.MODELING/'tests'))
import test_validation_source_records as source_fixtures


class PreparationTests(unittest.TestCase):
    def setUp(self):
        source_fixtures.SourceRecordsTests.setUp(self)
        old=self.root
        context=AttemptContext('synthetic-destination',IDS[4],IDS[1],IDS[2],IDS[3],IDS[0])
        self.files=AttemptWorkspace(old/'runs',context)
        inputs=self.files.path/'inputs';inputs.mkdir()
        for source in old.glob('*'):
            if source.is_file():shutil.copyfile(source,inputs/source.name)
        self.arguments={key:(inputs/value.name if isinstance(value,Path) and key!='relative_to' else value) for key,value in self.arguments.items()}
        self.arguments.update(relative_to=inputs,source_artifacts=[self.record],created_at='2026-10-09T00:00:00Z')
        self.destination=self.files.path/'validation_preparation_aequilibrae'

    def run_prepare(self,method='aequilibrae'):
        return preparation.retain(files=self.files,method=method,bundle_arguments=self.arguments)

    def test_retains_explicit_sources_and_separate_methods_without_authorizing_execution(self):
        for method in ('aequilibrae','activitysim'):
            result=self.run_prepare(method)
            manifest=json.loads(Path(result['manifest_path']).read_text())
            self.assertEqual(manifest['context']['method'],method)
            self.assertEqual(manifest['context']['run_id'],self.files.owner['run_id'])
            self.assertFalse(manifest['execution_authorized'])
            self.assertEqual(manifest['preparation_independence'],'unassessed')
            self.assertEqual(len(manifest['entries']),6)
            for entry in manifest['entries']:
                data=(Path(result['manifest_path']).parent/entry['object_name']).read_bytes()
                self.assertEqual(preparation.hashlib.sha256(data).hexdigest(),entry['sha256'])
                self.assertEqual(len(data),entry['bytes'])

    def test_existing_or_partial_directory_is_not_reused(self):
        self.run_prepare(); before=(self.destination/'manifest.json').read_bytes()
        with self.assertRaises(FileExistsError):self.run_prepare()
        self.assertEqual((self.destination/'manifest.json').read_bytes(),before)
        other=self.files.path/'validation_preparation_activitysim';other.mkdir()
        with self.assertRaises(FileExistsError):self.run_prepare('activitysim')

    def test_foreign_source_refuses_before_builder(self):
        self.arguments['network_path']=self.root/'network.json'
        with patch.object(preparation.instrument,'build_input_bundle',side_effect=AssertionError('Foreign source reached builder')) as build:
            with self.assertRaisesRegex(ValueError,'owned attempt'):self.run_prepare()
            build.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_changed_source_refuses_and_leaves_partial_without_manifest(self):
        (self.arguments['relative_to']/'source.dat').write_bytes(b'changed source')
        with self.assertRaises(preparation.instrument.InstrumentV2Error):self.run_prepare()
        self.assertTrue(self.destination.is_dir())
        self.assertFalse((self.destination/'manifest.json').exists())

    def test_changed_during_copy_never_publishes_manifest(self):
        original=preparation.model_handoff_files.copy_registered
        def changed(root,run,source,target,**kwargs):
            Path(source).write_bytes(b'changed after bundle hashing')
            return original(root,run,source,target,**kwargs)
        with patch.object(preparation.model_handoff_files,'copy_registered',changed):
            with self.assertRaises(ValueError):self.run_prepare()
        self.assertFalse((self.destination/'manifest.json').exists())

    def test_copy_failure_never_publishes_manifest(self):
        with patch.object(preparation.model_handoff_files,'copy_registered',side_effect=OSError('disk full')):
            with self.assertRaisesRegex(OSError,'disk full'):self.run_prepare()
        self.assertFalse((self.destination/'manifest.json').exists())


if __name__=='__main__':unittest.main()
