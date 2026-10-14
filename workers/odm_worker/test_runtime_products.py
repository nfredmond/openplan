"""Original private product custody using the real intake and loopback archive."""
import hashlib
import io
import json
import os
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import runtime_products as module
from retained_source import json_bytes
import test_runtime_output_intake as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.pack = self.f.root/'private-products'
        self.products = module.Products(self.f.intake, timeout=4)
        self.members = {
            'odm_orthophoto/odm_orthophoto.tif': b'Synthetic original orthomosaic bytes',
            'odm_dem/dsm.tif': b'Synthetic original DSM bytes',
            'odm_georeferencing/odm_georeferenced_model.laz': b'Synthetic original point cloud bytes',
            'unselected/report.txt': b'Retained only in the complete archive',
        }
        self.archive()

    def archive(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, payload in self.members.items():
                archive.writestr(name, payload)
        self.f.raw = stream.getvalue()

    def call(self):
        with self.f.runtime.owner():
            return self.products.advance(self.f.request_id, self.f.observed['task']['bodySha256'])

    def test_exact_original_products_and_absence_grant_no_delivery(self):
        before = len(self.f.app.f.calls)
        result = self.call()
        self.assertEqual(len(self.f.app.f.calls)-before, 7, 'Current access must bracket private materialization')
        self.assertEqual(len(self.f.requests), 1, 'Products use only the original archive GET')
        self.assertEqual((self.f.root/'output-archive/archive.zip').read_bytes(), self.f.raw)
        self.assertEqual(result['enginePlan'], self.f.plan, 'Products remain bound to the original task plan')
        self.assertEqual(result['archive']['sha256'], hashlib.sha256(self.f.raw).hexdigest())
        for row in result['products']:
            if row['availability'] == 'retained':
                path = self.pack/'objects'/row['filename']
                self.assertEqual(path.read_bytes(), self.members[row['member']], 'Product bytes must match the original member')
                self.assertEqual(row['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            else:
                self.assertEqual(row['kind'], 'dtm')
                self.assertEqual(row['reason'], 'absent_from_original_archive')
                self.assertIsNone(row['bytes'])
        for key in ['processingQualityVerification', 'requestedDeliverableCompletenessVerification', 'archiveTaskProvenanceVerification']:
            self.assertEqual(result[key], 'unassessed', 'Private products cannot promote '+key)
        self.assertIs(result['callbackPermission'], False, 'Private products cannot authorize callbacks')
        self.assertIs(result['publicationPermission'], False, 'Private products cannot authorize publication')

    def test_replay_preserves_files_without_another_external_get(self):
        first = self.call()
        path = self.pack/'objects/orthophoto.tif'
        inode = path.stat().st_ino
        held = path.open('rb')
        self.addCleanup(held.close)
        self.f.observer.resolve = lambda _engine: self.fail('Saved products cannot resolve another engine')
        self.assertEqual(self.call(), first)
        self.assertEqual(len(self.f.requests), 1, 'Saved product recovery cannot refetch an archive')
        self.assertEqual(path.stat().st_ino, inode, 'Product recovery cannot replace original objects')

    def test_changed_saved_product_refuses_without_overwriting_it(self):
        self.call()
        path = self.pack/'objects/orthophoto.tif'
        changed = b'X'+path.read_bytes()[1:]
        path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'Saved original product bytes differ'):
            self.call()
        self.assertEqual(path.read_bytes(), changed, 'Refused recovery cannot overwrite another object')

    def test_original_plan_change_refuses(self):
        self.call()
        p = self.pack/'plan.json'
        value = json.loads(p.read_bytes())
        value['archive']['sha256'] = '0'*64
        p.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call()

    def test_missing_required_orthomosaic_refuses_before_product_plan(self):
        del self.members['odm_orthophoto/odm_orthophoto.tif']
        self.archive()
        with self.assertRaisesRegex(ValueError, 'no required orthomosaic member'):
            self.call()
        self.assertFalse(self.pack.exists(), 'Missing required member cannot prepare products')

    def test_empty_selected_member_refuses(self):
        self.members['odm_dem/dsm.tif'] = b''
        self.archive()
        with self.assertRaisesRegex(ValueError, 'nonempty regular file'):
            self.call()

    def test_mid_copy_interruption_recovers_without_another_get(self):
        original = self.products._check
        stopped = False
        def interrupted(request, deadline):
            nonlocal stopped
            partial = self.pack/'objects/.orthophoto.tif.partial'
            if partial.exists() and not stopped:
                stopped = True
                raise InterruptedError('Product copy interrupted')
            return original(request, deadline)
        with patch.object(self.products, '_check', side_effect=interrupted), self.assertRaisesRegex(InterruptedError, 'Product copy interrupted'):
            self.call()
        self.assertFalse((self.pack/'receipt.json').exists())
        result = self.call()
        self.assertEqual(len(self.f.requests), 1, 'Interrupted member copy cannot trigger another archive GET')
        self.assertEqual(result['products'][0]['sha256'], hashlib.sha256(self.members['odm_orthophoto/odm_orthophoto.tif']).hexdigest())

    def test_interrupted_publication_alias_recovers(self):
        original = os.link
        def linked(*args, **kwargs):
            original(*args, **kwargs)
            if str(args[1]).endswith('/private-products/objects/orthophoto.tif'):
                raise InterruptedError('Product linked before alias removal')
        with patch.object(module.os, 'link', side_effect=linked), self.assertRaisesRegex(InterruptedError, 'Product linked before alias removal'):
            self.call()
        path = self.pack/'objects/orthophoto.tif'
        self.assertEqual(path.stat().st_nlink, 2)
        inode = path.stat().st_ino
        self.call()
        self.assertEqual(path.stat().st_nlink, 1)
        self.assertEqual(path.stat().st_ino, inode, 'Recovery keeps the published original member inode')

    def test_unknown_object_refuses(self):
        self.call()
        p = self.pack/'objects/unknown.bin'
        p.write_bytes(b'Unknown')
        p.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'object inventory differs'):
            self.call()

    def test_aliased_product_refuses(self):
        self.call()
        path = self.pack/'objects/orthophoto.tif'
        os.link(path, self.pack/'alias.tif')
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            self.call()

    def test_lost_plan_refuses(self):
        self.call()
        (self.pack/'plan.json').unlink()
        with self.assertRaisesRegex(ValueError, 'no original plan'):
            self.call()

    def test_current_access_after_copy_refuses_completion(self):
        original = self.products._copy
        def revoke(*args):
            original(*args)
            if args[2]['filename'] == 'georeferenced_model.laz':
                self.f.app.f.receipt['authorizedNow'] = False
        with patch.object(self.products, '_copy', side_effect=revoke), self.assertRaisesRegex(PermissionError, 'current application access refused'):
            self.call()
        self.assertTrue((self.pack/'objects/orthophoto.tif').exists(), 'Revocation retains private original bytes')
        self.assertFalse((self.pack/'receipt.json').exists(), 'Current access must precede product completion')

    def test_cancellation_precedes_member_writing(self):
        original = zipfile.ZipExtFile.read
        def cancelled(stream, *args):
            value = original(stream, *args)
            if (self.pack/'objects/.orthophoto.tif.partial').exists():
                self.f.cancelled = True
            return value
        with patch.object(zipfile.ZipExtFile, 'read', cancelled), self.assertRaisesRegex(InterruptedError, 'cancelled'):
            self.call()
        self.assertEqual((self.pack/'objects/.orthophoto.tif.partial').stat().st_size, 0,
            'Cancellation must stop before member bytes are written')
        self.assertFalse((self.pack/'receipt.json').exists())

    def test_inflated_member_cannot_exceed_retained_size(self):
        original = zipfile.ZipExtFile.read
        def excessive(stream, *args):
            value = original(stream, *args)
            if value and (self.pack/'objects/.orthophoto.tif.partial').exists():
                return value+b'Unretained bytes'
            return value
        with patch.object(zipfile.ZipExtFile, 'read', excessive), self.assertRaisesRegex(ValueError, 'exceeds its retained member size'):
            self.call()
        self.assertFalse((self.pack/'objects/orthophoto.tif').exists())

    def test_changed_member_cannot_be_published(self):
        original = zipfile.ZipExtFile.read
        def changed(stream, *args):
            value = original(stream, *args)
            if value and (self.pack/'objects/.orthophoto.tif.partial').exists():
                return b'X'+value[1:]
            return value
        with patch.object(zipfile.ZipExtFile, 'read', changed), self.assertRaisesRegex(ValueError, 'differs from its retained member'):
            self.call()
        self.assertFalse((self.pack/'objects/orthophoto.tif').exists(), 'Different member bytes cannot be published')

    def test_changed_receipt_refuses(self):
        self.call()
        p = self.pack/'receipt.json'
        value = json.loads(p.read_bytes())
        value['publicationPermission'] = True
        p.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call()

    def test_unrelated_partial_cannot_be_deleted_as_publication_alias(self):
        self.call()
        p = self.pack/'objects/.orthophoto.tif.partial'
        p.write_bytes(b'Unrelated retained bytes')
        p.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'publication alias differs'):
            self.call()
        self.assertEqual(p.read_bytes(), b'Unrelated retained bytes', 'Unrelated bytes must remain retained')

    def test_arguments_require_real_intake_and_finite_positive_timeout(self):
        with self.assertRaisesRegex(ValueError, 'original intake and a finite timeout'):
            module.Products(object())
        for timeout in [0, -1, False, float('nan'), float('inf')]:
            with self.subTest(timeout=timeout), self.assertRaisesRegex(ValueError, 'finite timeout'):
                module.Products(self.f.intake, timeout=timeout)

    def product_space(self, free):
        actual = module.shutil.disk_usage
        return patch.object(module.shutil, 'disk_usage', side_effect=lambda path:
            SimpleNamespace(free=free) if path == self.pack else actual(path))

    def test_shortage_refuses_before_any_product_bytes(self):
        with self.product_space(0), self.assertRaisesRegex(ValueError,
                'Insufficient free space for remaining original products'):
            self.call()
        self.assertEqual(list((self.pack/'objects').iterdir()), [],
            'Expanded-space refusal must precede every product write')
        self.assertFalse((self.pack/'receipt.json').exists())
        self.assertEqual((self.f.root/'output-archive/archive.zip').read_bytes(), self.f.raw,
            'Expanded-space refusal keeps the original retained archive')

    def test_space_check_covers_all_missing_products(self):
        selected = [self.members[row[2]] for row in module.PRODUCTS if row[2] in self.members]
        free = 2*max(map(len, selected))
        with self.product_space(free), self.assertRaisesRegex(ValueError,
                'Insufficient free space for remaining original products'):
            self.call()
        self.assertEqual(list((self.pack/'objects').iterdir()), [],
            'Cumulative product shortage cannot start a partial extraction')

    def test_resume_budgets_only_missing_products(self):
        original = self.products._copy
        def interrupted(*args):
            original(*args)
            raise InterruptedError('First product retained before interruption')
        with patch.object(self.products, '_copy', side_effect=interrupted), self.assertRaisesRegex(
                InterruptedError, 'First product retained before interruption'):
            self.call()
        path = self.pack/'objects/orthophoto.tif'
        inode = path.stat().st_ino
        remaining = sum(len(self.members[row[2]]) for row in module.PRODUCTS
            if row[2] in self.members and row[1] != 'orthophoto.tif')
        with self.product_space(2*remaining):
            result = self.call()
        self.assertEqual(path.stat().st_ino, inode,
            'Space accounting cannot replace a completed original product')
        self.assertIs(result['publicationPermission'], False)

    def test_saved_replay_requires_no_new_product_space(self):
        first = self.call()
        with self.product_space(0):
            self.assertEqual(self.call(), first,
                'Completed product replay requires no expanded file allocation')


if __name__ == '__main__':
    unittest.main()
