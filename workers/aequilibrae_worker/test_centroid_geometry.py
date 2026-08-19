#!/usr/bin/env python3
import sqlite3
import unittest

from centroid_geometry import insert_distinct_centroid


class FakeConnection:
    def __init__(self, collisions=0):
        self.collisions = collisions
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))
        if self.collisions:
            self.collisions -= 1
            raise sqlite3.IntegrityError("Cannot create on-top of other node")


class CentroidGeometryTests(unittest.TestCase):
    def test_unchanged_coordinate_is_used_when_it_is_free(self):
        conn = FakeConnection()
        lon, lat, offset = insert_distinct_centroid(conn, 17, -82.1, 39.3)
        self.assertEqual((lon, lat, offset), (-82.1, 39.3, 0.0))
        self.assertEqual(conn.calls[0][1], (17, -82.1, 39.3))

    def test_collision_moves_only_the_virtual_node_by_a_bounded_distance(self):
        conn = FakeConnection(collisions=1)
        lon, lat, offset = insert_distinct_centroid(conn, 17, -77.0, 42.0)
        self.assertEqual(len(conn.calls), 2)
        self.assertEqual(offset, 0.1)
        self.assertNotEqual((lon, lat), (-77.0, 42.0))
        self.assertLess(abs(lon + 77.0), 0.00001)
        self.assertLess(abs(lat - 42.0), 0.00001)

    def test_unrelated_integrity_error_is_not_hidden(self):
        class OtherFailure(FakeConnection):
            def execute(self, sql, params):
                raise sqlite3.IntegrityError("node id is not unique")

        with self.assertRaisesRegex(sqlite3.IntegrityError, "not unique"):
            insert_distinct_centroid(OtherFailure(), 17, 0.0, 0.0)


if __name__ == "__main__":
    unittest.main()
