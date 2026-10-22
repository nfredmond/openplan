"""Prepare descriptors from real retained fixtures without issuing download URLs."""
import hashlib
import json
import stat
import unittest
from unittest.mock import patch

import runtime_artifact_plan as module
from retained_source import json_bytes
import test_runtime_georef as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.plan = module.ArtifactPlan(self.f.inspection, timeout=4)
        self.request = self.f.f.f.request_id
        self.observation = self.f.f.f.observed['task']['bodySha256']
        self.pack = self.f.f.f.root/'private-artifact-plan'

    def call(self):
        with self.f.f.f.runtime.owner():
            return self.plan.advance(self.request, self.observation)

    def test_original_scope_and_descriptors_remain_exact(self):
        result = self.call()
        manifest = result['manifest']
        # Read the saved dispatch without reopening network authority outside ownership.
        with self.f.f.f.runtime.owner():
            original = self.f.inspection.products.intake.observer.reader.dispatch.load(self.request)
        self.assertEqual(manifest['binding'], {
            'installationId': self.f.f.f.runtime.installation['installationId'],
            'targetId': self.f.inspection.products.intake.observer.reader.dispatch.target, 'requestId': self.request,
            'jobReference': original['binding']['jobReference'],
            'originalApplicationJob': original['applicationJob'],
            'originalDispatchSha256': original['payloadSha256'],
            'originalTaskUuid': self.f.f.f.plan['taskUuid'],
            'observationSha256': self.observation}, 'Preparation keeps every original job and actor binding')
        self.assertEqual([row['kind'] for row in manifest['artifacts']],
            ['orthomosaic', 'dsm', 'dtm', 'point_cloud'], 'Preparation preserves the selected ordered product census')
        self.assertEqual(manifest['unselectedContractKinds'], ['mesh', 'ortho_preview'],
            'Unselected contract kinds cannot disappear or become delivered')
        self.assertEqual([row['nativeInspectionStatus'] for row in manifest['artifacts']],
            ['read', 'failed', 'unavailable', 'unassessed'], 'Preparation preserves each native inspection state')
        for row in manifest['artifacts']:
            if row['availability'] == 'retained':
                path = self.f.f.f.root/row['localRelativePath']
                self.assertEqual(row['checksumSha256'], hashlib.sha256(path.read_bytes()).hexdigest(),
                    'Preparation checksums identify actual original bytes')
                self.assertEqual(row['sizeBytes'], path.stat().st_size,
                    'Preparation sizes identify actual original bytes')
                self.assertEqual(row['contentType'], 'application/octet-stream'
                    if row['kind'] == 'point_cloud' else 'image/tiff',
                    'Original file descriptors use their supported content types')
            else:
                self.assertIsNone(row['localRelativePath'], 'Absent products have no local file')
                self.assertIsNone(row['sizeBytes'], 'Absent products cannot become zero bytes')
                self.assertIsNone(row['checksumSha256'])
            self.assertNotIn('downloadUrl', row, 'Private preparation issues no bearer URLs')
            self.assertNotIn('boundsWgs84', row, 'Native declarations cannot become map placement')
        for record in result.values():
            for key, value in {'processingQualityVerification': 'unassessed',
                    'requestedDeliverableCompletenessVerification': 'unassessed',
                    'mapPlacementVerification': 'unassessed',
                    'callbackPermission': False, 'publicationPermission': False}.items():
                self.assertEqual(record[key], value, 'Preparation cannot promote '+key)
                self.assertIs(type(record[key]), type(value))
        for key, relative in [('productReceiptSha256', 'private-products/receipt.json'),
                ('inspectionReceiptSha256', 'private-raster-inspection/receipt.json'),
                ('inspectionReportSha256', 'private-raster-inspection/report.json')]:
            original_bytes = (self.pack.parent/relative).read_bytes()
            self.assertEqual(manifest[key], hashlib.sha256(original_bytes).hexdigest(),
                'Preparation binds exact original '+key)
        self.assertEqual(result['receipt']['manifestSha256'], hashlib.sha256(json_bytes(manifest)).hexdigest(),
            'Completion binds exact manifest bytes')
        for name in ('manifest.json', 'receipt.json'):
            self.assertEqual(stat.S_IMODE((self.pack/name).stat().st_mode), 0o600,
                'Preparation records remain private')

    def test_replay_keeps_original_records_without_fetch_or_parse(self):
        first = self.call()
        requests = len(self.f.f.f.requests)
        saved = {name: (self.pack/name).stat().st_ino for name in ('manifest.json', 'receipt.json')}
        with patch.object(self.f.inspection, '_inspect', side_effect=AssertionError('Preparation cannot reinterpret saved tags')):
            self.assertEqual(self.call(), first)
        self.assertEqual(len(self.f.f.f.requests), requests, 'Preparation cannot fetch a second original archive')
        self.assertEqual({name: (self.pack/name).stat().st_ino for name in saved}, saved,
            'Preparation replay keeps original record inodes')

    def test_interrupted_manifest_recovers_original_bytes(self):
        original = module.publish
        def interrupted(root, name, payload, **options):
            original(root, name, payload, **options)
            if root == self.pack and name == 'manifest.json':
                raise InterruptedError('Prepared original manifest before receipt')
        with patch.object(module, 'publish', side_effect=interrupted), self.assertRaisesRegex(
                InterruptedError, 'Prepared original manifest before receipt'):
            self.call()
        before = (self.pack/'manifest.json').read_bytes()
        self.assertFalse((self.pack/'receipt.json').exists())
        result = self.call()
        self.assertEqual(json_bytes(result['manifest']), before, 'Interrupted preparation preserves original manifest')

    def test_altered_manifest_refuses_replacement(self):
        self.call()
        path = self.pack/'manifest.json'
        changed = path.read_bytes()+b'Other manifest'
        path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call()
        self.assertEqual(path.read_bytes(), changed)

    def test_altered_completion_refuses_replacement(self):
        self.call()
        path = self.pack/'receipt.json'
        changed = path.read_bytes()+b'Other completion'
        path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call()
        self.assertEqual(path.read_bytes(), changed)

    def test_lost_manifest_cannot_be_inferred_from_completion(self):
        self.call()
        (self.pack/'manifest.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Artifact preparation has no original manifest'):
            self.call()

    def test_product_receipt_change_between_inspection_and_preparation_refuses(self):
        original = self.f.inspection.advance
        def changed(*args):
            result = original(*args)
            path = self.f.f.pack/'receipt.json'
            record = json.loads(path.read_bytes()); record['products'][0]['sha256'] = '0'*64
            path.write_bytes(json_bytes(record))
            return result
        with patch.object(self.f.inspection, 'advance', side_effect=changed), self.assertRaisesRegex(
                ValueError, 'Artifact preparation original product receipt differs'):
            self.call()
        self.assertFalse(self.pack.exists())

    def test_revoked_actor_after_inspection_refuses_manifest(self):
        original = self.f.inspection.advance
        def revoked(*args):
            result = original(*args)
            self.f.f.f.app.f.receipt['authorizedNow'] = False
            return result
        with patch.object(self.f.inspection, 'advance', side_effect=revoked), self.assertRaisesRegex(
                PermissionError, 'current application access refused'):
            self.call()
        self.assertFalse((self.pack/'manifest.json').exists(), 'Current actor access precedes artifact preparation')

    def test_revoked_actor_after_manifest_refuses_completion(self):
        original = module.publish
        def revoked(root, name, payload, **options):
            original(root, name, payload, **options)
            if root == self.pack and name == 'manifest.json':
                self.f.f.f.app.f.receipt['authorizedNow'] = False
        with patch.object(module, 'publish', side_effect=revoked), self.assertRaisesRegex(
                PermissionError, 'current application access refused'):
            self.call()
        self.assertTrue((self.pack/'manifest.json').exists())
        self.assertFalse((self.pack/'receipt.json').exists(), 'Current actor access precedes preparation completion')

    def test_cancellation_after_manifest_refuses_completion(self):
        original = module.publish
        def canceled(root, name, payload, **options):
            original(root, name, payload, **options)
            if root == self.pack and name == 'manifest.json':
                self.f.f.f.intake.cancelled = lambda: True
        # Isolate new preparation checks from the already covered access adapter.
        original_advance = self.f.inspection.advance
        def prepared(*args):
            result = original_advance(*args)
            self.f.f.f.intake._access = lambda *_: None
            return result
        with patch.object(self.f.inspection, 'advance', side_effect=prepared), patch.object(
                module, 'publish', side_effect=canceled), self.assertRaisesRegex(
                InterruptedError, 'Original output intake cancelled'):
            self.call()
        self.assertFalse((self.pack/'receipt.json').exists(), 'Cancellation precedes preparation completion')

    def test_unsupported_descriptor_refuses(self):
        class ImplicitType(dict):
            def __missing__(self, _key):
                return 'image/tiff'
        # An implicit fallback must not bypass the explicit supported-kind guard.
        with patch.object(module, 'CONTENT_TYPES', ImplicitType()), self.assertRaisesRegex(
                ValueError, 'Artifact preparation has no supported original descriptor'):
            self.call()
        self.assertFalse(self.pack.exists())

    def test_constructor_requires_original_inspection_and_finite_timeout(self):
        for value, timeout in [(object(), 1), (self.f.inspection, 0),
                (self.f.inspection, float('inf')), (self.f.inspection, True)]:
            with self.assertRaisesRegex(ValueError, 'Artifact preparation requires original inspection'):
                module.ArtifactPlan(value, timeout=timeout)


if __name__ == '__main__':
    unittest.main()
