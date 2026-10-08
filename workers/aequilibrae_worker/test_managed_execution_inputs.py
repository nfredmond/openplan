"""Actual state/package/project preparation with native files and mocked HTTP."""
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import Mock, patch
import model_attempt_writer as managed
import model_command_journal as journal
import model_project_inputs as project
import test_managed_paired_inputs as paired
from test_model_skip_dispatch import aeq


class ExecutionInputsTests(unittest.TestCase):
    setUp = paired.PairedInputTests.setUp
    response = paired.PairedInputTests.response

    def prepare(self):
        original, state_path, content = paired.PairedInputTests.prepare(self)
        source = state_path.parent / 'aeq_project'
        source.mkdir()
        db = sqlite3.connect(source / 'project_database.sqlite')
        db.execute('CREATE TABLE evidence (id INTEGER)')
        db.execute('INSERT INTO evidence VALUES (7)')
        db.commit()
        db.close()
        retained = project.retain(source, state_path.parent / 'project_inputs')
        artifact = {**copy.deepcopy(self.artifact), 'id':'00000009-1111-4111-8111-111111111111', 'artifact_type':'model_project_inputs',
                    'file_url':'local://'+retained['manifest_path'], 'content_hash':retained['manifest_sha256'],
                    'file_size_bytes':retained['manifest_size_bytes'],
                    'metadata_json':{'schema':'openplan.project-inputs.v1','inventory_schema':'openplan.package-inputs.v1',
                                     'database_checks':retained['database_checks'],'database_consistency':retained['database_consistency'],
                                     'engine_closure':'unassessed','cross_database_consistency':'unassessed',
                                     'scientific_acceptance':'unassessed','execution_ready':False}}
        read = self.read.side_effect
        def joined_read(url, **kwargs):
            if kwargs.get('params', {}).get('artifact_type') == 'eq.model_project_inputs':
                return Mock(status_code=200, json=lambda:[artifact])
            return read(url, **kwargs)
        self.read.side_effect = joined_read
        return original, state_path, content

    def test_three_inputs_and_working_path_are_retained_without_rewriting_state(self):
        original, path, content = self.prepare()
        with managed.bind(self.writer):
            result = aeq.retain_managed_state_and_package(include_project=True)
            selected = aeq.project_work_directory(str(self.writer.files.path))
        mapping = json.loads(Path(result['mapping_record']['path']).read_bytes())
        self.assertEqual(mapping['execution_paths']['project_directory'], selected)
        self.assertEqual(mapping['inputs']['project'], result['project_input']['producer'])
        self.assertEqual(mapping['working_project']['input_manifest_sha256'], result['project_input']['manifest_sha256'])
        self.assertEqual(mapping['working_project']['initial_manifest_sha256'], hashlib.sha256(Path(mapping['working_project']['initial_manifest_path']).read_bytes()).hexdigest())
        self.assertEqual(mapping['mapped_fields'], ['package.package_dir'])
        self.assertIs(mapping['execution_ready'], False)
        self.assertEqual(result['state_input']['state'], original)
        self.assertEqual(path.read_bytes(), content)
        self.assertEqual(mapping['state']['assignment'], original['assignment'])
        self.assertEqual(mapping['state']['package']['source_label'], original['package']['source_label'])
        kinds = [call.kwargs['json']['p_payload']['artifact_type'] for call in self.post.call_args_list]
        self.assertEqual(kinds, ['model_state_consumption','model_package_consumption','model_project_consumption','model_project_working_copy','model_input_mapping'])

    def test_different_project_attempt_refuses_before_working_copy(self):
        self.prepare()
        real = aeq.retain_managed_predecessor_project
        def changed_identity():
            result = real()
            result['producer']['attempt_id'] = '00000009-1111-4111-8111-111111111111'
            return result
        with managed.bind(self.writer), patch.object(aeq,'retain_managed_predecessor_project',side_effect=changed_identity):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as error:
                aeq.retain_managed_state_and_package(include_project=True)
        self.assertIn('same producer attempt', str(error.exception.__cause__))
        self.assertFalse((self.writer.files.path / 'project_working').exists())
        self.assertFalse((self.writer.files.path / 'input_mapping.json').exists())
        self.assertTrue(self.writer.stopped)

    def test_lost_mapping_response_keeps_files_but_blocks_project_use(self):
        self.prepare()
        response = self.response
        def lose(url, **kwargs):
            if kwargs.get('json',{}).get('p_payload',{}).get('artifact_type') == 'model_input_mapping':
                raise TimeoutError('Synthetic mapping reply loss')
            return response(url, **kwargs)
        self.post.side_effect = lose
        with managed.bind(self.writer), self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
            aeq.retain_managed_state_and_package(include_project=True)
        self.assertTrue(self.writer.stopped)
        saved = json.loads((self.writer.files.path / 'input_mapping.json').read_bytes())
        self.assertEqual(set(saved['inputs']), {'state','package','project'})
        pending = journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'], 'model_input_mapping')
        with self.assertRaises(Exception):self.writer.project_directory(self.writer.files.path)


if __name__ == '__main__':unittest.main()
