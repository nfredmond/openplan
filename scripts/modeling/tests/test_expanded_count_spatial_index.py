#!/usr/bin/env python3
"""The count crosswalk uses a conservative index without changing its exact match."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import build_expanded_aadt_counts as counts  # noqa: E402


class FakeConnection:
    def __init__(self, rows):
        self.rows = rows
        self.query = ""
        self.arguments = ()

    def execute(self, query, arguments):
        self.query = query
        self.arguments = arguments
        return self

    def fetchall(self):
        return self.rows


class IndexedRouteLookup(unittest.TestCase):
    def test_spatial_index_is_only_a_prefilter_and_exact_distance_remains(self) -> None:
        connection = FakeConnection(
            [("Local Road", "tertiary", 5.0), ("State Route", "primary", 150.0)]
        )
        selected = counts.route_link(connection, "OH", "7", -80.6, 40.8)
        self.assertEqual(selected, ("State Route", "primary", 150.0))
        self.assertIn("SpatialIndex", connection.query)
        self.assertIn("Distance(geometry, MakePoint(?, ?, 4326), 1) < ?", connection.query)
        self.assertEqual(connection.arguments[-1], counts.NEAR_M)

    def test_antimeridian_search_is_split_without_querying_across_the_world(self) -> None:
        east = counts.spatial_search_bounds(179.9995, 52.0, counts.NEAR_M)
        west = counts.spatial_search_bounds(-179.9995, 52.0, counts.NEAR_M)
        self.assertEqual(len(east), 2)
        self.assertEqual(len(west), 2)
        self.assertTrue(all(-180.0 <= value <= 180.0 for box in east + west for value in (box[0], box[2])))

    def test_polar_search_degrades_to_a_worldwide_longitude_band(self) -> None:
        bounds = counts.spatial_search_bounds(30.0, 90.0, counts.NEAR_M)
        self.assertEqual(bounds[0][0::2], (-180.0, 180.0))


if __name__ == "__main__":
    unittest.main()
