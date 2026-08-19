#!/usr/bin/env python3
import sqlite3
import unittest

from centroid_geometry import candidates_on_routable_component, insert_distinct_centroid


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
    def test_searches_routable_component_when_fixed_nearby_pool_contains_only_islands(self):
        nearby = [(node_id, float(node_id)) for node_id in range(1, 201)]
        direct_search_calls = []

        selected, searched_directly = candidates_on_routable_component(
            nearby,
            {9001, 9002},
            lambda: direct_search_calls.append(True) or [(9001, 201.0), (9002, 202.0)],
        )

        self.assertEqual(selected, [(9001, 201.0), (9002, 202.0)])
        self.assertTrue(searched_directly)
        self.assertEqual(direct_search_calls, [True])

    def test_keeps_nearby_routable_candidates_without_an_extra_database_search(self):
        selected, searched_directly = candidates_on_routable_component(
            [(10, 1.0), (20, 2.0), (30, 3.0)],
            {20, 30},
            lambda: self.fail("direct component search should not run"),
        )

        self.assertEqual(selected, [(20, 2.0), (30, 3.0)])
        self.assertFalse(searched_directly)

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
