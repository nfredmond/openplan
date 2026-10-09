"""Zone order follows graph centroids and package data, across coordinate signs."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_zone_geometry as geometry
import model_attempt_writer as managed
import test_package_working_copy as packages
from test_model_skip_dispatch import aeq

CSV='zone_id,centroid_lon,centroid_lat,area_sq_mi\n20,170,-14,2\n10,-121,39,1\n'


class ZoneGeometryTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        (self.root/'zone_attributes.csv').write_text(CSV)

    def test_graph_order_and_original_coordinates_survive(self):
        order=geometry.assignment_zone_order({'10':200,'20':100})
        result=geometry.read_assignment_geometry(self.root,order)
        self.assertEqual(result['zone_ids'],[20,10]);self.assertEqual(result['lons'],[170,-121])
        self.assertEqual(result['lats'],[-14,39]);self.assertEqual(result['areas_sq_mi'],[2,1])
        self.assertEqual(result['source_sha256'],hashlib.sha256(CSV.encode()).hexdigest())

    def test_ambiguous_mapping_and_rows_refused(self):
        for mapping in ({},{'1':2,'2':2},{'01':2,'1':3}):
            with self.assertRaises(ValueError):geometry.assignment_zone_order(mapping)
        (self.root/'zone_attributes.csv').write_text(CSV+'20,0,0,1\n')
        with self.assertRaises(ValueError):geometry.read_assignment_geometry(self.root,[20,10])

    def test_missing_and_nonfinite_coordinates_do_not_become_zero(self):
        with self.assertRaises(KeyError):geometry.read_assignment_geometry(self.root,[999])
        for token in ('NaN','inf','181'):
            (self.root/'zone_attributes.csv').write_text(CSV.replace('170',token))
            with self.assertRaises(ValueError):geometry.read_assignment_geometry(self.root,[20,10])

    def test_fractional_and_boolean_identifiers_refused(self):
        for mapping in ({'10': 1.5}, {10.5: 1}, {True: 1}, {'10.5': 1}):
            with self.assertRaises(ValueError):
                geometry.assignment_zone_order(mapping)
        for value in ('20.5', 'NaN', '2e1'):
            (self.root/'zone_attributes.csv').write_text(CSV.replace('20,', value+','))
            with self.assertRaises(ValueError):
                geometry.read_assignment_geometry(self.root, [20,10])

    def test_linked_zone_file_refused(self):
        source=self.root/'zone_attributes.csv';source.rename(self.root/'original')
        source.symlink_to(self.root/'original')
        with self.assertRaises(OSError):geometry.read_assignment_geometry(self.root,[20,10])


class OwnedGeometryTests(unittest.TestCase):
    setUp=packages.PackageWorkingCopyTests.setUp
    response=packages.PackageWorkingCopyTests.response
    prepare=packages.PackageWorkingCopyTests.prepare
    consumed=packages.PackageWorkingCopyTests.consumed

    def working(self):
        record=self.consumed();working=self.writer.prepare_package_working_copy(record)
        path=Path(working['package_directory']);(path/'zone_attributes.csv').write_text(CSV)
        self.post.reset_mock();return path

    def test_actual_parent_reads_owned_working_package(self):
        self.working()
        with managed.bind(self.writer):result=aeq.managed_assignment_zone_geometry({'centroid_map':{'10':200,'20':100}})
        self.assertEqual(result['zone_ids'],[20,10]);self.assertEqual(result['lons'],[170,-121])
        self.post.assert_not_called()

    def test_replaced_package_stops_before_geometry_read(self):
        path=self.working();path.rename(path.with_name('original-package'));path.mkdir()
        with managed.bind(self.writer),patch.object(aeq,'read_assignment_geometry') as read:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):aeq.managed_assignment_zone_geometry({'centroid_map':{'10':200,'20':100}})
        read.assert_not_called();self.assertTrue(self.writer.stopped)


if __name__=='__main__':unittest.main()
