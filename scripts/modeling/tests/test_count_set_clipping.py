#!/usr/bin/env python3
"""A count set must describe the study area, not the box drawn around it.

MEASURED 2026-08-16
===================
The first real validation of a county run against Caltrans counts reported a
median absolute percent error of 100%. It was not that bad. The count set had
been fetched by BOUNDING BOX, and a bounding box around any real study area
overlaps its neighbours: 32 of 113 matched stations were in the next county —
Tahoe City, Squaw Valley, Truckee-area highways — on roads this run's network
carries no traffic for. Every one of them scored 100% error and dragged the
median to exactly that.

Clipped to the county, the same run scored 82.65%. Still a clear failure of the
30% gate, and now an honest one.

The lesson is about the instrument rather than the model: a measure that counts
things it was never pointed at reports the wrong number in the wrong direction,
and hides real improvement behind noise it created itself.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import Polygon, mapping

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_expanded_aadt_counts import _load_boundary, clip_points_to_boundary  # noqa: E402

# A unit square from (0,0) to (1,1) — the "study area".
STUDY_AREA = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])


def station(lon: float, lat: float) -> dict:
    return {"lon": lon, "lat": lat, "rte": "20", "pm": 1.0}


class ClipToStudyAreaTests(unittest.TestCase):
    def test_stations_outside_the_study_area_are_dropped_and_counted(self) -> None:
        points = [station(0.5, 0.5), station(5.0, 5.0), station(0.2, 0.9), station(-3.0, 0.5)]
        inside, dropped = clip_points_to_boundary(points, STUDY_AREA)

        self.assertEqual(len(inside), 2)
        self.assertEqual(dropped, 2)
        # Reported, not silent: the number that was thrown away is the number a
        # reader needs to trust the ones that stayed.
        self.assertEqual(dropped + len(inside), len(points))

    def test_a_station_on_the_boundary_is_kept(self) -> None:
        """Every DOT publishes "COUNTY LINE" stations, and they sit exactly on
        the line. `contains` would drop them on a floating-point tie; `covers`
        keeps them, and they are among the most useful stations there are —
        they measure precisely the through traffic the cordons model."""
        inside, dropped = clip_points_to_boundary([station(1.0, 0.5), station(0.0, 0.0)], STUDY_AREA)
        self.assertEqual(len(inside), 2)
        self.assertEqual(dropped, 0)

    def test_nothing_inside_is_reported_rather_than_returned_empty_and_quiet(self) -> None:
        inside, dropped = clip_points_to_boundary([station(9, 9), station(8, 8)], STUDY_AREA)
        self.assertEqual(inside, [])
        self.assertEqual(dropped, 2)

    def test_an_empty_count_set_does_not_crash(self) -> None:
        self.assertEqual(clip_points_to_boundary([], STUDY_AREA), ([], 0))


class BoundaryLoadingTests(unittest.TestCase):
    """The boundary arrives in whichever GeoJSON shape its producer used."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write(self, payload: dict) -> str:
        path = self.dir / "boundary.geojson"
        path.write_text(json.dumps(payload))
        return str(path)

    def test_a_bare_geometry_loads(self) -> None:
        geometry = _load_boundary(self._write(mapping(STUDY_AREA)))
        self.assertTrue(geometry.covers(Polygon([(0.1, 0.1), (0.2, 0.1), (0.2, 0.2)])))

    def test_a_feature_loads(self) -> None:
        geometry = _load_boundary(
            self._write({"type": "Feature", "properties": {}, "geometry": mapping(STUDY_AREA)})
        )
        self.assertAlmostEqual(geometry.area, 1.0)

    def test_a_feature_collection_is_unioned_rather_than_truncated_to_its_first(self) -> None:
        """A study area can arrive as several features — a county split by a
        water body, a multi-county region. Taking only the first would clip the
        count set to part of the area and drop real stations."""
        second = Polygon([(2, 0), (3, 0), (3, 1), (2, 1)])
        geometry = _load_boundary(
            self._write(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {"type": "Feature", "properties": {}, "geometry": mapping(STUDY_AREA)},
                        {"type": "Feature", "properties": {}, "geometry": mapping(second)},
                    ],
                }
            )
        )
        self.assertAlmostEqual(geometry.area, 2.0)
        inside, dropped = clip_points_to_boundary([station(0.5, 0.5), station(2.5, 0.5)], geometry)
        self.assertEqual(len(inside), 2)
        self.assertEqual(dropped, 0)


if __name__ == "__main__":
    unittest.main()
