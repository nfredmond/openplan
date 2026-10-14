"""Inspect retained TIFF declarations without granting quality or delivery claims."""
import copy
from contextlib import contextmanager
import hashlib
import json
import os
import unittest
from unittest.mock import patch

import georef
import runtime_georef as module
from retained_source import json_bytes
import test_georef as tags
import test_rotated_georef as rotated
import test_runtime_products as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.f.members['odm_orthophoto/odm_orthophoto.tif'] = tags.build_geotiff()
        self.f.archive()
        self.inspection = module.Inspection(self.f.products, timeout=4)
        self.pack = self.f.f.root/'private-raster-inspection'

    def call(self):
        with self.f.f.runtime.owner():
            return self.inspection.advance(self.f.f.request_id, self.f.f.observed['task']['bodySha256'])

    def plan_report(self, change):
        plan = json.loads((self.pack/'plan.json').read_bytes())
        report = json.loads(plan['reportText'])
        change(report)
        plan['reportText'] = json_bytes(report).decode()
        (self.pack/'plan.json').write_bytes(json_bytes(plan))

    def prepare(self):
        original = module.publish
        def interrupted(root, name, payload, **kwargs):
            original(root, name, payload, **kwargs)
            if root == self.pack and name == 'plan.json':
                raise InterruptedError('Original interpretation frozen before report')
        with patch.object(module, 'publish', side_effect=interrupted), self.assertRaisesRegex(
                InterruptedError, 'Original interpretation frozen before report'):
            self.call()
        self.assertFalse((self.pack/'report.json').exists())

    def test_original_readable_failed_absent_and_unassessed_remain_distinct(self):
        result = self.call()
        rows = result['report']['products']
        self.assertEqual([row['status'] for row in rows], ['read', 'failed', 'unavailable', 'unassessed'],
            'Native tag reading, failure, absence and unassessed cloud remain distinct')
        self.assertEqual(rows[0]['nativeTags']['nativeCellSpacing'], list(tags.SCALE),
            'Inspection preserves the file declared native spacing')
        self.assertEqual((rows[0]['nativeTags']['width'], rows[0]['nativeTags']['height']),
            (tags.WIDTH, tags.HEIGHT), 'Inspection preserves declared raster dimensions')
        self.assertEqual(rows[0]['nativeTags']['unitInterpretation'], 'declared_native_coordinates',
            'Native units cannot be promoted to measured ground units')
        for key, value in {'processingQualityVerification': 'unassessed',
                'mapPlacementVerification': 'unassessed',
                'callbackPermission': False, 'publicationPermission': False}.items():
            self.assertEqual(result['report'][key], value)
            self.assertEqual(result['receipt'][key], value)
            self.assertIs(type(result['report'][key]), type(value))
        self.assertIs(rows[2]['bytes'], None)
        self.assertIs(rows[2]['nativeTags'], None)

    def test_rotated_spacing_uses_original_raster_vectors(self):
        self.f.members['odm_orthophoto/odm_orthophoto.tif'] = rotated.transformed_tiff(0, -2, 3, 0)
        self.f.archive()
        row = self.call()['report']['products'][0]
        self.assertEqual(row['status'], 'read')
        self.assertEqual(row['nativeTags']['nativeCellSpacing'], [3, 2],
            'Recovered inspection uses both nonzero quarter-turn vectors')

    def test_unsupported_bigtiff_keeps_bytes_without_zero_metadata(self):
        original = tags.build_geotiff(magic=43)
        self.f.members['odm_orthophoto/odm_orthophoto.tif'] = original
        self.f.archive()
        row = self.call()['report']['products'][0]
        self.assertEqual(row['status'], 'unsupported', 'BigTIFF is explicitly unsupported by this reader')
        self.assertIsNone(row['nativeTags'])
        self.assertEqual(row['sha256'], hashlib.sha256(original).hexdigest())

    def test_saved_report_replay_does_not_parse_again(self):
        first = self.call()
        inode = (self.pack/'report.json').stat().st_ino
        with patch.object(module.georef, 'parse_geotiff', side_effect=AssertionError('Frozen inspection cannot parse again')):
            self.assertEqual(self.call(), first)
        self.assertEqual((self.pack/'report.json').stat().st_ino, inode,
            'Frozen inspection replay preserves original report inode')

    def test_changed_raster_during_inspection_refuses(self):
        original = module.georef.parse_geotiff
        path = self.f.pack/'objects/orthophoto.tif'
        def changed(name):
            result = original(name)
            value = path.read_bytes()
            path.write_bytes(value[:-1]+bytes([value[-1]^1]))
            return result
        @contextmanager
        def outer_reader(root, name):
            # Isolate the content-hash guard from the outer metadata-change guard.
            with (root/name).open('rb') as stream:
                yield stream, os.fstat(stream.fileno())
        with patch.object(module, 'reader', side_effect=outer_reader), patch.object(
                module.georef, 'parse_geotiff', side_effect=changed), self.assertRaisesRegex(
                ValueError, 'Inspected original raster bytes differ'):
            self.call()
        self.assertFalse((self.pack/'plan.json').exists(), 'Changed raster cannot freeze an interpretation')

    def test_current_access_after_reading_refuses_plan(self):
        original = module.georef.parse_geotiff
        def revoked(name):
            result = original(name)
            self.f.f.app.f.receipt['authorizedNow'] = False
            return result
        with patch.object(module.georef, 'parse_geotiff', side_effect=revoked), self.assertRaisesRegex(
                PermissionError, 'current application access refused'):
            self.call()
        self.assertFalse((self.pack/'plan.json').exists(), 'Current access must precede interpretation freezing')

    def test_report_publication_interruption_recovers_frozen_interpretation(self):
        original = module.publish
        def interrupted(root, name, payload, **kwargs):
            original(root, name, payload, **kwargs)
            if root == self.pack and name == 'report.json':
                raise InterruptedError('Original report retained before receipt')
        with patch.object(module, 'publish', side_effect=interrupted), self.assertRaisesRegex(
                InterruptedError, 'Original report retained before receipt'):
            self.call()
        saved = (self.pack/'report.json').read_bytes()
        self.assertFalse((self.pack/'receipt.json').exists())
        with patch.object(module.georef, 'parse_geotiff', side_effect=AssertionError('Interrupted interpretation cannot be recomputed')):
            recovered = self.call()
        self.assertEqual(json_bytes(recovered['report']), saved,
            'Interrupted report recovery preserves exact original interpretation')

    def test_changed_saved_report_refuses_without_replacing_it(self):
        self.call()
        path = self.pack/'report.json'
        changed = path.read_bytes()+b'Changed report bytes'
        path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call()
        self.assertEqual(path.read_bytes(), changed, 'Refusal cannot replace another report')

    def test_original_product_plan_change_refuses(self):
        self.prepare()
        plan = json.loads((self.pack/'plan.json').read_bytes())
        plan['sourceReceiptSha256'] = '0'*64
        (self.pack/'plan.json').write_bytes(json_bytes(plan))
        with self.assertRaisesRegex(ValueError, 'Raster inspection original plan differs'):
            self.call()

    def test_lost_original_plan_refuses(self):
        self.call()
        (self.pack/'plan.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Raster inspection has no original plan'):
            self.call()

    def test_claim_promotion_refuses(self):
        self.prepare()
        path = self.pack/'plan.json'
        original = path.read_bytes()
        for key, value in [('publicationPermission', True), ('callbackPermission', True),
                ('processingQualityVerification', 'verified'), ('mapPlacementVerification', 'verified'),
                ('callbackPermission', 0)]:
            try:
                self.plan_report(lambda report: report.update({key: value}))
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError,
                        'identity or claim limits differ'):
                    self.call()
            finally:
                path.write_bytes(original)

    def test_altered_product_census_refuses(self):
        self.prepare()
        self.plan_report(lambda value: value['products'].pop())
        with self.assertRaisesRegex(ValueError, 'product census differs'):
            self.call()

    def test_invalid_reader_or_inspection_profile_refuses(self):
        self.prepare()
        path = self.pack/'plan.json'
        original = path.read_bytes()
        for key in ['readerSha256', 'inspectionSha256']:
            try:
                self.plan_report(lambda value: value.update({key: 'not-a-source-hash'}))
                with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'identity or claim limits differ'):
                    self.call()
            finally:
                path.write_bytes(original)

    def test_altered_original_member_binding_refuses(self):
        self.prepare()
        self.plan_report(lambda value: value['products'][0].update(sha256='0'*64))
        with self.assertRaisesRegex(ValueError, 'original product differs'):
            self.call()

    def test_absence_cannot_be_reported_as_read(self):
        self.prepare()
        self.plan_report(lambda value: value['products'][2].update(status='read'))
        with self.assertRaisesRegex(ValueError, 'absent raster declaration differs'):
            self.call()

    def test_point_cloud_cannot_gain_a_raster_reader_result(self):
        self.prepare()
        self.plan_report(lambda value: value['products'][3].update(status='read'))
        with self.assertRaisesRegex(ValueError, 'point cloud assessment differs'):
            self.call()

    def test_native_coordinates_cannot_be_relabelled_as_metres(self):
        self.prepare()
        self.plan_report(lambda value: value['products'][0]['nativeTags'].update(unitInterpretation='metres'))
        with self.assertRaisesRegex(ValueError, 'native tag declaration differs'):
            self.call()

    def test_failed_read_cannot_keep_native_coordinate_values(self):
        self.prepare()
        self.plan_report(lambda value: value['products'][1].update(nativeTags={'nativeBounds': [0, 0, 1, 1]}))
        with self.assertRaisesRegex(ValueError, 'unsuccessful raster reading differs'):
            self.call()

    def test_nonfinite_and_degenerate_native_values_are_failed_reads(self):
        original = {'width': 1, 'height': 1, 'epsg': tags.EPSG_UTM10N,
            'native_bounds': (0, 0, 1, 1), 'pixel_size': (1, 1)}
        for key, value in [('width', False), ('height', 0), ('native_bounds', (0, 0, float('nan'), 1)),
                ('pixel_size', (0, 1))]:
            with self.subTest(key=key, value=value):
                changed = copy.deepcopy(original)
                changed[key] = value
                with self.assertRaisesRegex(ValueError, 'Native raster'):
                    module.native_tags(changed)

    def test_constructor_requires_real_products_and_finite_timeout(self):
        with self.assertRaisesRegex(ValueError, 'private products and a finite positive timeout'):
            module.Inspection(object())
        for value in [False, 0, -1, float('nan'), float('inf')]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'finite positive timeout'):
                module.Inspection(self.f.products, timeout=value)


if __name__ == '__main__':
    unittest.main()
