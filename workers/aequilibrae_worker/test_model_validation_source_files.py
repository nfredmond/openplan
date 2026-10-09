"""Actual local bytes, relocation and refusal boundaries for source retention."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import model_validation_source_files as files
from model_validation_source_catalog import build_catalog
from test_model_validation_source_catalog import fixture


class SourceFilesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.args, payloads = fixture(include_payloads=True)
        run = self.root / 'runs' / self.args['context']['model_run_id']
        run.mkdir(parents=True)
        for name, content in payloads.items():
            (run / name).write_bytes(content)
        self.paths = {entry['role']: run / entry['artifact']['path']
                      for entry in build_catalog(**self.args)['entries']}
        self.destination = self.root / 'retained'

    def retain(self):
        return files.retain(root=self.root, destination=self.destination,
                            expected_context=self.args['context'], source_paths=self.paths,
                            catalog_arguments=self.args)

    def test_relocated_manifest_preserves_every_role_and_actual_bytes(self):
        result = self.retain()
        payload = Path(result['manifest_path']).read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(), result['manifest_sha256'])
        self.assertEqual(len(payload), result['manifest_size_bytes'])
        relocated = self.root / 'relocated'
        self.destination.rename(relocated)
        manifest = json.loads(payload)
        self.assertEqual(len(manifest['entries']), 23)
        self.assertTrue(manifest['stored_source_bytes_verified'])
        self.assertEqual(manifest['publication_state'], 'retained_locally')
        self.assertEqual(manifest['scientific_acceptance'], 'unassessed')
        for entry in manifest['entries']:
            actual = (relocated / entry['object_name']).read_bytes()
            self.assertEqual(actual, self.paths[entry['role']].read_bytes())
            self.assertEqual(hashlib.sha256(actual).hexdigest(), entry['artifact']['sha256'])

    def test_duplicate_hash_never_skips_a_physical_role(self):
        role = '/match_audit/registry_sha256'
        altered = self.paths[role].with_name('altered.dat')
        altered.write_bytes(b'x' * self.paths[role].stat().st_size)
        self.paths[role] = altered
        with self.assertRaisesRegex(ValueError, 'bytes differ'):
            self.retain()
        self.assertFalse((self.destination / 'manifest.json').exists())

    def test_logical_hash_and_size_are_checked(self):
        original = build_catalog(**self.args)
        for field, value, reason in [('sha256', 'f'*64, 'Logical source bytes differ'),
                                      ('bytes', 1, 'exceeds declared')]:
            catalog = copy.deepcopy(original)
            entry = next(row for row in catalog['entries'] if 'logical_source' in row)
            entry['logical_source'][field] = value
            self.destination = self.root / field
            with patch.object(files, 'build_catalog', return_value=catalog):
                with self.assertRaisesRegex(ValueError, reason): self.retain()
            self.assertFalse((self.destination / 'manifest.json').exists())

    def test_alias_missing_role_context_and_disk_refuse(self):
        saved = self.paths.copy()
        self.paths['/match_audit/network_sha256'] = self.paths['/comparison_basis/model_output_artifact']
        with self.assertRaisesRegex(ValueError, 'aliases'): self.retain()
        self.paths = saved.copy(); self.paths.pop('/match_audit/network_sha256')
        with self.assertRaisesRegex(ValueError, 'Exact source role'): self.retain()
        self.paths = saved
        with patch.object(files.shutil, 'disk_usage') as disk:
            disk.return_value.free = 0
            with self.assertRaisesRegex(ValueError, 'Insufficient'): self.retain()
        context = dict(self.args['context'], method='activitysim')
        with self.assertRaisesRegex(ValueError, 'context differs'):
            files.retain(root=self.root, destination=self.destination, expected_context=context,
                         source_paths=self.paths, catalog_arguments=self.args)
        self.assertFalse(self.destination.exists())

    def test_existing_destination_is_not_replaced(self):
        self.retain()
        before = (self.destination / 'manifest.json').read_bytes()
        with self.assertRaises(FileExistsError): self.retain()
        self.assertEqual(before, (self.destination / 'manifest.json').read_bytes())

    def test_harmless_input_order_does_not_change_retained_catalog(self):
        original = Path(self.retain()['manifest_path']).read_bytes()
        self.destination = self.root / 'reordered'
        self.paths = dict(reversed(list(self.paths.items())))
        self.assertEqual(original, Path(self.retain()['manifest_path']).read_bytes())


if __name__ == '__main__':
    unittest.main()
