"""Geometry travels by verified file reference, not unbounded channel arrays."""
import json
from pathlib import Path
import tempfile
import unittest
import model_geometry_inputs as inputs
from model_engine_channel import MAX_FRAME


class GeometryInputsTests(unittest.TestCase):
    def test_large_geometry_has_small_reference_and_exact_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            geometry={'zone_ids':list(range(20000)),'lons':[170.25]*20000,'lats':[-14.25]*20000}
            self.assertGreater(len(json.dumps(geometry)),MAX_FRAME)
            record=inputs.retain(geometry,root/'retained')
            self.assertLess(len(json.dumps(record)),MAX_FRAME)
            self.assertEqual(inputs.consume(record,root/'consumed'),geometry)
            self.assertNotEqual((root/'retained/files/geometry.json').stat().st_ino,(root/'consumed/files/geometry.json').stat().st_ino)

    def test_changed_geometry_is_not_consumed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);record=inputs.retain({'lons':[170]},root/'retained')
            (root/'retained/files/geometry.json').write_text('{"lons":[0]}')
            with self.assertRaises(ValueError):inputs.consume(record,root/'consumed')


if __name__=='__main__':unittest.main()
