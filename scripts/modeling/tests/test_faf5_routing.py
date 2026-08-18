#!/usr/bin/env python3
"""The national router respects direction, weights, and disclosed failures."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import LineString, Polygon

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import faf5_routing as routing


def link(start, end, *, direction=0, ab=1.0, ba=1.0):
    return {
        "geometry": LineString([start, end]),
        "DIR": direction,
        "AB_FreeFlowTime": ab,
        "BA_FreeFlowTime": ba,
    }


class FafDirectionAndCostAreReal(unittest.TestCase):
    def test_one_way_link_cannot_be_used_backwards(self) -> None:
        graph, coordinates, _ = routing.build_directed_graph([
            link((0, 0), (1, 0), direction=1),
        ])
        router = routing.Faf5Router(graph, coordinates)
        result = router.route("east", "west", {"west": (0, 0), "east": (1, 0)})
        self.assertEqual(result.status, "unreachable")

    def test_reverse_only_link_uses_ba_and_cannot_be_used_forwards(self) -> None:
        graph, coordinates, _ = routing.build_directed_graph([
            link((0, 0), (1, 0), direction=-1, ab=2.0, ba=5.0),
        ])
        router = routing.Faf5Router(graph, coordinates)
        points = {"west": (0, 0), "east": (1, 0)}
        self.assertEqual(router.route("west", "east", points).status, "unreachable")
        self.assertEqual(router.route("east", "west", points).free_flow_minutes, 5.0)

    def test_reverse_direction_uses_ba_time(self) -> None:
        graph, coordinates, _ = routing.build_directed_graph([
            link((0, 0), (1, 0), ab=1.0, ba=7.0),
        ])
        router = routing.Faf5Router(graph, coordinates)
        points = {"west": (0, 0), "east": (1, 0)}
        self.assertEqual(router.route("west", "east", points).free_flow_minutes, 1.0)
        self.assertEqual(router.route("east", "west", points).free_flow_minutes, 7.0)

    def test_fastest_route_wins_instead_of_fewest_links(self) -> None:
        graph, coordinates, _ = routing.build_directed_graph([
            link((0, 0), (2, 0), ab=9.0, ba=9.0),
            link((0, 0), (1, 1), ab=2.0, ba=2.0),
            link((1, 1), (2, 0), ab=2.0, ba=2.0),
        ])
        result = routing.Faf5Router(graph, coordinates).route(
            "a", "b", {"a": (0, 0), "b": (2, 0)}
        )
        self.assertEqual(result.free_flow_minutes, 4.0)
        self.assertEqual(result.coordinates, ((0.0, 0.0), (1.0, 1.0), (2.0, 0.0)))


class RouteClassificationNeverSilentlyFallsBack(unittest.TestCase):
    AREA = Polygon([(0.9, 0.5), (1.1, 0.5), (1.1, 1.5), (0.9, 1.5)])

    def test_routed_geometry_drives_intersection(self) -> None:
        path = routing.RoutedPath("a", "b", "routed", 0, 0, 1, ((0, 0), (1, 1), (2, 0)))
        self.assertTrue(routing.route_intersects(path, self.AREA))

    def test_unreachable_path_is_not_replaced_by_a_straight_line(self) -> None:
        path = routing.RoutedPath("a", "b", "unreachable", 0, 0, None, ())
        self.assertFalse(routing.route_intersects(path, self.AREA))

    def test_missing_endpoint_is_named(self) -> None:
        graph, coordinates, _ = routing.build_directed_graph([link((0, 0), (1, 0))])
        result = routing.Faf5Router(graph, coordinates).route("known", "missing", {"known": (0, 0)})
        self.assertEqual(result.status, "missing_endpoint")

    def test_network_fingerprint_reads_content_not_only_file_sizes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            table = Path(tmp) / "network.gdbtable"
            table.write_bytes(b"first")
            first = routing.graph_source_fingerprint(Path(tmp))
            table.write_bytes(b"other")  # same length, different network bytes
            self.assertNotEqual(first, routing.graph_source_fingerprint(Path(tmp)))


class WholeTreeAreaClassification(unittest.TestCase):
    def test_masks_propagate_through_ancestors_to_every_destination(self) -> None:
        links = [
            link((0, 0), (1, 0)),
            link((1, 0), (2, 0)),
            link((2, 0), (3, 0)),
        ]
        graph, coordinates, node_ids = routing.build_directed_graph(links)
        masks = routing.csr_matrix(
            ([1], ([node_ids[(1.0, 0.0)]], [node_ids[(2.0, 0.0)]])),
            shape=graph.shape,
            dtype="uint64",
        )
        router = routing.Faf5Router(graph, coordinates)
        reachable, path_masks = router.routed_area_masks((0, 0), masks)
        self.assertTrue(reachable[node_ids[(3.0, 0.0)]])
        self.assertEqual(path_masks[node_ids[(1.0, 0.0)]], 0)
        self.assertEqual(path_masks[node_ids[(2.0, 0.0)]], 1)
        self.assertEqual(path_masks[node_ids[(3.0, 0.0)]], 1)

    def test_unreachable_nodes_never_inherit_an_area_mask(self) -> None:
        links = [link((0, 0), (1, 0), direction=1), link((2, 0), (3, 0), direction=1)]
        graph, coordinates, node_ids = routing.build_directed_graph(links)
        masks = routing.csr_matrix(
            ([1], ([node_ids[(2.0, 0.0)]], [node_ids[(3.0, 0.0)]])),
            shape=graph.shape,
            dtype="uint64",
        )
        reachable, path_masks = routing.Faf5Router(graph, coordinates).routed_area_masks((0, 0), masks)
        self.assertFalse(reachable[node_ids[(3.0, 0.0)]])
        self.assertEqual(path_masks[node_ids[(3.0, 0.0)]], 0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
