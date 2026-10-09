"""Parent callback derives discovery extent from the owned assignment package."""
import os
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import test_model_zone_geometry as fixtures
from test_model_skip_dispatch import aeq


class TransitGeometryTests(unittest.TestCase):
    setUp=fixtures.OwnedGeometryTests.setUp
    response=fixtures.OwnedGeometryTests.response
    prepare=fixtures.OwnedGeometryTests.prepare
    consumed=fixtures.OwnedGeometryTests.consumed
    working=fixtures.OwnedGeometryTests.working

    def test_callback_uses_owned_coordinates_and_frozen_zone_order(self):
        self.working()
        setup={'centroid_map':{'10':200,'20':100}}
        with managed.bind(self.writer):
            prepare=aeq.managed_assignment_transit_preparer(setup,deadline=123)
        setup['centroid_map']={'10':100,'20':200}
        no_match=aeq.gtfs_skim.FeedDiscovery(None,'no_match',None)
        with managed.bind(self.writer),patch.object(self.writer,'read_run',return_value={}),patch.dict(os.environ,{'GTFS_URL':'','GTFS_PATH':''}),patch.object(aeq,'GTFS_DISCOVER',True),patch.object(aeq.gtfs_skim,'discover_feed',return_value=no_match) as discover:
            result=prepare(str(self.writer.files.path))
        discover.assert_called_once_with((-121.0,-14.0,170.0,39.0))
        self.assertEqual(result['geometry']['zone_ids'],[20,10])
        self.assertEqual(result['transit_status'],'no_local_feed')
        self.post.assert_not_called()

    def test_deadline_is_forwarded_with_owned_geometry(self):
        self.working()
        with managed.bind(self.writer),patch.object(aeq,'prepare_managed_transit_for_engine',return_value={'status':'unavailable'}) as prepare:
            callback=aeq.managed_assignment_transit_preparer({'centroid_map':{'10':200,'20':100}},deadline=123)
            result=callback(str(self.writer.files.path))
        self.assertEqual(prepare.call_args.kwargs['deadline'],123)
        self.assertEqual(prepare.call_args.kwargs['lons'].tolist(),[170,-121])
        self.assertEqual(result['geometry']['lats'],[-14,39])

    def test_unbound_callback_refuses_before_feed_preparation(self):
        self.working()
        with managed.bind(self.writer):
            callback=aeq.managed_assignment_transit_preparer({'centroid_map':{'10':200,'20':100}},deadline=None)
        with patch.object(aeq,'prepare_managed_transit_for_engine') as prepare:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):callback(str(self.writer.files.path))
        prepare.assert_not_called()

    def test_replaced_package_prevents_feed_preparation(self):
        path=self.working()
        with managed.bind(self.writer):
            callback=aeq.managed_assignment_transit_preparer({'centroid_map':{'10':200,'20':100}},deadline=None)
            path.rename(path.with_name('old-package'));path.mkdir()
            with patch.object(aeq,'prepare_managed_transit_for_engine') as prepare:
                with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):callback(str(self.writer.files.path))
        prepare.assert_not_called();self.assertTrue(self.writer.stopped)


if __name__=='__main__':unittest.main()
