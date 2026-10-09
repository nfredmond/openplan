"""Parent callback derives discovery extent from the owned assignment package."""
import os
import json
import sys
from pathlib import Path
from model_engine_process import EngineProcess
import model_geometry_inputs
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
        geometry=model_geometry_inputs.consume(result['geometry_record'],self.writer.files.path/'geometry-copy')
        self.assertEqual(geometry['zone_ids'],[20,10])
        self.assertEqual(result['transit_status'],'no_local_feed')
        self.post.assert_called_once()

    def test_deadline_is_forwarded_with_owned_geometry(self):
        self.working()
        with managed.bind(self.writer),patch.object(aeq,'prepare_managed_transit_for_engine',return_value={'status':'unavailable'}) as prepare:
            callback=aeq.managed_assignment_transit_preparer({'centroid_map':{'10':200,'20':100}},deadline=123)
            result=callback(str(self.writer.files.path))
        self.assertEqual(prepare.call_args.kwargs['deadline'],123)
        self.assertEqual(prepare.call_args.kwargs['lons'].tolist(),[170,-121])
        geometry=model_geometry_inputs.consume(result['geometry_record'],self.writer.files.path/'geometry-copy')
        self.assertEqual(geometry['lats'],[-14,39])

    def run_child(self, lost_registration=False):
        self.working()
        with managed.bind(self.writer):
            callback=aeq.managed_assignment_transit_preparer({'centroid_map':{'10':200,'20':100}},deadline=None)
        if lost_registration:
            self.post.side_effect=TimeoutError('Synthetic lost registration reply')
        child="""
import json
from pathlib import Path
from model_engine_channel import inherited_progress_client
import model_geometry_inputs
client=inherited_progress_client()
try:
 client.create_outputs()
 result=client.prepare_transit()
 geometry=model_geometry_inputs.consume(result['geometry_record'],Path.cwd()/'child-geometry')
 Path('geometry-result.json').write_text(json.dumps({'geometry':geometry,'status':result['transit_status']}))
finally:client.stop()
"""
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',child],
            env={'PATH':os.environ.get('PATH','/usr/bin'),'PYTHONPATH':str(Path(__file__).parent),
                 'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},
            progress=True,output_name='run_output',transit_preparer=callback)
        handle.progress.connection.settimeout(5)
        def cleanup():
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)
        self.addCleanup(cleanup)
        no_match=aeq.gtfs_skim.FeedDiscovery(None,'no_match',None)
        with patch.object(self.writer,'read_run',return_value={}),patch.dict(os.environ,{'GTFS_URL':'','GTFS_PATH':''}),patch.object(aeq,'GTFS_DISCOVER',True),patch.object(aeq.gtfs_skim,'discover_feed',return_value=no_match):
            handle.progress.serve_one()
            if lost_registration:
                with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):handle.progress.serve_one()
            else:handle.progress.serve_one()
        return handle

    def test_real_child_consumes_registered_geometry(self):
        handle=self.run_child()
        self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
        result=json.loads((self.writer.files.path/'geometry-result.json').read_text())
        self.assertEqual(result['geometry']['zone_ids'],[20,10])
        self.assertEqual(result['geometry']['lons'],[170,-121])
        self.assertEqual(result['status'],'no_local_feed')
        self.post.assert_called_once()
        self.assertFalse(handle.confirm_exit()['execution_ready'])

    def test_lost_geometry_registration_never_reaches_child(self):
        handle=self.run_child(lost_registration=True)
        self.assertNotEqual(handle.process.wait(timeout=10),0)
        self.assertFalse((self.writer.files.path/'child-geometry').exists())
        self.assertFalse((self.writer.files.path/'geometry-result.json').exists())
        self.assertTrue(self.writer.stopped)

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
