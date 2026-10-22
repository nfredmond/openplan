"""Captured ordinary-byte fixtures, without image decoding or engine execution."""
import copy
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import unittest
from unittest.mock import patch

import draft_custody as module
from engine_effects import commands
import test_engine_effects as original_fixtures

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO/'openplan/scripts/ops'))
import odm_draft_custody as cli
import worker_root_snapshot as snapshot


class Checks(unittest.TestCase):
    def setUp(self):
        self.original = original_fixtures.Checks();self.original.setUp()
        self.effects = self.original.open();self.plan = copy.deepcopy(self.effects.plan)
        self.root = self.original.base/'engine';self.root.mkdir(mode=0o700)
        (self.root/'tmp').mkdir(mode=0o700)
        self.draft = self.root/'tmp'/self.plan['taskUuid'];self.draft.mkdir(mode=0o700)
        self.body = self.draft/'body.json'
        self.body.write_bytes(json.dumps(commands(self.plan)['init']['form']).encode());self.body.chmod(0o600)
        for row in self.plan['uploads']:
            shutil.copy2(self.original.source/row['objectRelativePath'], self.draft/row['filename'])
        self.budget = sum(row['bytes'] for row in self.plan['uploads'])
        self.package = self.original.base/'package'

    def tearDown(self):
        self.original.tearDown()

    def inspect(self, **changes):
        return module.inspect(**{'root': self.root, 'plan': self.plan, 'max_bytes': self.budget, **changes})

    def capture(self):
        return snapshot.capture(self.root, self.package, writers_quiesced=True, timeout=2)

    def verify(self, **changes):
        return cli.verify_draft(**{'snapshot': self.package, 'plan_path': self.original.root/'plan.json',
            'expected_plan_hash': self.effects.plan_hash, 'max_bytes': self.budget, 'timeout': 2, **changes})

    def test_complete_draft_reports_exact_bytes_without_permission(self):
        result = self.inspect()
        self.assertEqual(result['state'], 'complete_matching_draft', 'complete exact draft must report matched bytes')
        self.assertIs(result['transportPermission'], False, 'captured matching bytes must not grant transport permission')
        self.assertEqual(result['metadata']['sha256'], hashlib.sha256(self.body.read_bytes()).hexdigest())
        self.assertEqual([row['sha256'] for row in result['matchingUploads']], [row['sha256'] for row in self.plan['uploads']])
        self.assertEqual(result['planSha256'], self.effects.plan_hash, 'draft result must bind exact original plan')
        self.assertEqual(result['engineIdentityVerification'], 'unassessed')
        self.assertEqual(result['sourceProvenanceVerification'], 'unassessed')

    def test_partial_draft_accounts_for_missing_planned_upload(self):
        (self.draft/'slot-b.jpg').unlink();result = self.inspect()
        self.assertEqual(result['state'], 'partial_matching_draft', 'known missing upload must remain partial')
        self.assertEqual(result['missingUploads'], [1]);self.assertEqual([row['slot'] for row in result['matchingUploads']], [0])
        self.assertIs(result['transportPermission'], False)

    def test_absent_draft_is_inconclusive(self):
        shutil.rmtree(self.draft);result = self.inspect()
        self.assertEqual(result['state'], 'inconclusive', 'absence cannot establish that an engine effect did not run')
        self.assertEqual(result['reason'], 'draft_absent');self.assertEqual(result['missingUploads'], [0,1])
        self.assertIs(result['transportPermission'], False)

    def test_missing_metadata_remains_inconclusive(self):
        self.body.unlink();result = self.inspect()
        self.assertEqual(result['state'], 'inconclusive', 'missing metadata can follow an uncertain commit')
        self.assertEqual(result['reason'], 'metadata_missing');self.assertEqual(len(result['matchingUploads']), 2)
        self.assertIs(result['transportPermission'], False)

    def test_changed_native_metadata_refuses(self):
        value = commands(self.plan)['init']['form'];value['name'] = 'Changed initialization'
        self.body.write_bytes(json.dumps(value).encode())
        with self.assertRaisesRegex(ValueError, 'metadata differs'): self.inspect()

    def test_changed_upload_bytes_refuse(self):
        path = self.draft/'slot-b.jpg';raw = path.read_bytes();path.write_bytes(b'X'+raw[1:])
        with self.assertRaisesRegex(ValueError, 'original bytes'): self.inspect()

    def test_unknown_duplicate_files_and_directories_refuse(self):
        (self.draft/'slot-b.jpg').unlink()
        path = self.draft/'slot-a_.jpg';path.write_bytes((self.draft/'slot-a.jpg').read_bytes());path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'mixed or duplicate'): self.inspect()
        path.unlink();path.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'mixed or duplicate'): self.inspect()

    def test_filename_enumeration_is_bounded(self):
        for name in ['extra-a', 'extra-b']:
            path = self.draft/name;path.write_bytes(b'ordinary');path.chmod(0o600)
        scan = module.os.scandir
        @contextmanager
        def bounded(path):
            with scan(path) as entries:
                def actual_entries():
                    for index, entry in enumerate(entries):
                        if index >= len(self.plan['uploads'])+2:
                            raise AssertionError('Draft enumeration read beyond declared bound')
                        yield entry
                yield actual_entries()
        with patch.object(module.os, 'scandir', bounded), self.assertRaisesRegex(ValueError, 'too many'):
            self.inspect()

    def test_original_plan_shape_and_source_hash_guards(self):
        for changes in ({'format': 'unknown'}, {'sourceManifestSha256': 'bad'}, {'extra': True}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'plan shape'): self.inspect(plan={**self.plan, **changes})

    def test_original_upload_mapping_and_typed_rows_refuse(self):
        with self.assertRaisesRegex(ValueError, 'mapping'): self.inspect(plan={**self.plan,'uploads': []})
        for changes in ({'slot': True}, {'slot': 2}, {'bytes': True}, {'bytes': -1}, {'sha256': 'bad'}, {'objectRelativePath': '../source.bin'}, {'extra': True}):
            changed = copy.deepcopy(self.plan);changed['uploads'][0].update(changes)
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'record differs'): self.inspect(plan=changed)

    def test_original_engine_plan_bindings_reconstructed(self):
        changed = copy.deepcopy(self.plan);changed['binding'] = {}
        with self.assertRaisesRegex(ValueError, 'binding is unsupported'): self.inspect(plan=changed)
        changed = copy.deepcopy(self.plan);changed['taskUuid'] = changed['taskUuid'].upper()
        with self.assertRaisesRegex(ValueError, 'UUID'): self.inspect(plan=changed)
        changed = copy.deepcopy(self.plan);changed['name'] = 'Synthetic altered helper output'
        with patch.object(module, 'make_plan', return_value=changed), self.assertRaisesRegex(ValueError, 'plan identity differs'):
            module.original_plan(self.plan)

    def test_metadata_duplicate_keys_and_nonfinite_values_refuse(self):
        original = commands(self.plan)['init']['form']
        # The second value otherwise exactly matches the original form.
        self.body.write_bytes(('{"name":"changed",'+json.dumps(original)[1:]).encode())
        with self.assertRaisesRegex(ValueError, 'repeats a JSON key'): self.inspect()
        self.body.write_bytes(b'{"name":NaN,"options":"[]"}')
        with self.assertRaises(ValueError): self.inspect()

    def test_metadata_bound_rejects_oversized_valid_json(self):
        self.body.write_bytes(self.body.read_bytes()+b' '*module.METADATA_LIMIT)
        with self.assertRaisesRegex(ValueError, 'metadata exceeds'): self.inspect()

    def test_alias_public_and_special_files_refuse(self):
        path = self.draft/'slot-a.jpg';original = path.read_bytes();path.unlink();path.symlink_to(self.original.input/'a.jpg')
        with self.assertRaises((OSError, ValueError)): self.inspect()
        path.unlink();path.write_bytes(original);path.chmod(0o644)
        with self.assertRaises(ValueError): self.inspect()
        path.unlink();path.mkdir(mode=0o700)
        with self.assertRaises(ValueError): self.inspect()

    def test_private_roots_and_aliases_refuse(self):
        alias = self.original.base/'engine-alias';alias.symlink_to(self.root)
        with self.assertRaises(ValueError): self.inspect(root=alias)
        for directory in (self.root, self.root/'tmp', self.draft):
            directory.chmod(0o755)
            try:
                with self.subTest(directory=str(directory)), self.assertRaises(ValueError): self.inspect()
            finally: directory.chmod(0o700)

    def test_byte_budgets_and_deadlines_refuse(self):
        with patch.object(module, 'digest', side_effect=AssertionError('Draft bytes read before planned-budget admission')):
            with self.assertRaisesRegex(ValueError, 'planned images exceed'): self.inspect(max_bytes=self.budget-1)
        for timeout in (True, 0, -1, float('nan'), float('inf')):
            with self.assertRaisesRegex(ValueError, 'timeout'): self.inspect(timeout=timeout)
        for budget in (True, 0, -1):
            with self.assertRaises(ValueError): self.inspect(max_bytes=budget)
        empty = copy.deepcopy(self.plan)
        for row in empty['uploads']:
            row['bytes'] = 0;row['sha256'] = hashlib.sha256(b'').hexdigest()
            (self.draft/row['filename']).write_bytes(b'')
        for budget in (True, 0):
            with self.assertRaises(ValueError): self.inspect(plan=empty, max_bytes=budget)
        with self.assertRaises(TimeoutError): self.inspect(timeout=1e-12)

    def test_late_planned_filename_refuses_partial_snapshot(self):
        second = self.draft/'slot-b.jpg';raw = second.read_bytes();second.unlink();digest = module.digest
        def changed(*args, **kwargs):
            result = digest(*args, **kwargs);second.write_bytes(raw);second.chmod(0o600);return result
        with patch.object(module, 'digest', changed), self.assertRaisesRegex(ValueError, 'filenames changed'): self.inspect()

    def test_inspection_preserves_all_ordinary_files_and_modes(self):
        before = self.original.image(self.root);self.inspect()
        self.assertEqual(self.original.image(self.root), before, 'draft inspection must leave ordinary bytes and modes unchanged')

    def test_actual_cli_verifies_package_before_inspection(self):
        self.capture();result = self.verify()
        self.assertEqual(result['rootPackageVerification'], 'verified', 'actual root package must be verified')
        self.assertEqual(result['rootPackageAuthenticity'], 'unassessed');self.assertEqual(result['writerQuiescenceVerification'], 'unassessed')
        self.assertIs(result['transportPermission'], False)

    def test_cli_refuses_original_plan_hash_mismatch(self):
        self.capture()
        with patch.object(cli, 'read_json', side_effect=AssertionError('Plan bytes read before hash format admission')):
            with self.assertRaisesRegex(ValueError, 'plan hash'): self.verify(expected_plan_hash='bad')
        with self.assertRaisesRegex(ValueError, 'plan hash'): self.verify(expected_plan_hash='0'*64)

    def test_cli_refuses_corrupt_package_before_draft_parse(self):
        self.capture();body = self.package/'root/tmp'/self.plan['taskUuid']/'body.json';body.write_bytes(body.read_bytes()+b' ')
        with patch.object(cli, 'inspect', side_effect=AssertionError('Draft parsed before package verification')):
            with self.assertRaisesRegex(ValueError, 'package content differs'): self.verify()

    def test_cli_reverifies_package_after_inspection(self):
        self.capture();inspect = cli.inspect
        def changed(*args, **kwargs):
            result = inspect(*args, **kwargs);body = self.package/'root/tmp'/self.plan['taskUuid']/'body.json'
            body.write_bytes(body.read_bytes()+b' ');return result
        with patch.object(cli, 'inspect', changed), self.assertRaisesRegex(ValueError, 'package content differs'): self.verify()

    def test_cli_refuses_changed_manifest_after_inspection(self):
        self.capture();inspect = cli.inspect
        def changed(*args, **kwargs):
            result = inspect(*args, **kwargs);path = self.package/'snapshot.json';value = json.loads(path.read_bytes())
            value['sourceDirectory'] = 'Synthetic changed source';path.write_text(json.dumps(value));return result
        with patch.object(cli, 'inspect', changed), self.assertRaisesRegex(ValueError, 'manifest changed'): self.verify()

    def test_cli_private_plan_parent_and_time_budget(self):
        self.capture()
        for timeout in (True, 0, -1, float('nan'), float('inf')):
            with self.assertRaisesRegex(ValueError, 'timeout'): self.verify(timeout=timeout)
        self.original.root.chmod(0o755)
        with self.assertRaises(ValueError): self.verify()


if __name__ == '__main__':
    unittest.main()
