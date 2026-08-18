#!/usr/bin/env python3
"""Routed TAF arithmetic stays separate from pathfinding and narration."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import routed_taf_through_trips as routed


class PerOriginArithmetic(unittest.TestCase):
    STUDIES = ["06047", "08014"]
    NODES = {"06001": 0, "06002": 1, "06047": 2, "08014": 3, "99998": 4}

    def test_one_route_can_pass_through_one_study_but_not_another(self) -> None:
        reachable = np.ones(5, dtype=bool)
        masks = np.array([0, 1, 0, 0, 0], dtype=np.uint64)
        result = routed.summarize_origin(
            "06001", {"06002": 3650.0}, self.STUDIES, self.NODES,
            {"06001": "accepted", "06002": "accepted"}, reachable, masks
        )
        self.assertEqual(result["counties"]["06047"]["annual_person_trips_through"], 3650.0)
        self.assertEqual(result["counties"]["08014"]["annual_person_trips_through"], 0.0)

    def test_a_trip_ending_in_study_is_not_also_through(self) -> None:
        result = routed.summarize_origin(
            "06001",
            {"06047": 100.0},
            self.STUDIES,
            self.NODES,
            {"06001": "accepted", "06047": "accepted"},
            np.ones(5, dtype=bool),
            np.array([0, 0, 1, 0, 0], dtype=np.uint64),
        )
        county = result["counties"]["06047"]
        self.assertEqual(county["annual_person_trips_ending_here"], 100.0)
        self.assertEqual(county["annual_person_trips_through"], 0.0)

    def test_unreachable_flow_is_excluded_and_disclosed_for_every_external_study(self) -> None:
        reachable = np.array([True, False, True, True, True])
        result = routed.summarize_origin(
            "06001", {"06002": 75.0}, self.STUDIES, self.NODES,
            {"06001": "accepted", "06002": "accepted"}, reachable, np.zeros(5, dtype=np.uint64)
        )
        for county in result["counties"].values():
            self.assertEqual(county["positive_external_flows_without_a_route"], 1)
            self.assertEqual(county["annual_person_trips_without_a_route"], 75.0)

    def test_missing_origin_is_not_silently_snapped_or_dropped(self) -> None:
        result = routed.summarize_origin("99999", {"06002": 25.0}, self.STUDIES, self.NODES,
            {"99999": "missing_endpoint", "06002": "accepted"}, None, None)
        self.assertEqual(result["counties"]["06047"]["annual_person_trips_without_a_route"], 25.0)
        self.assertEqual(result["counties"]["06047"]["annual_person_trips_missing_endpoint"], 25.0)

    def test_too_distant_endpoint_is_distinct_from_disconnected_network(self) -> None:
        result = routed.summarize_origin("06001", {"99998": 12.0}, self.STUDIES, self.NODES,
            {"06001": "accepted", "99998": "snap_too_far"}, None, None)
        county = result["counties"]["06047"]
        self.assertEqual(county["annual_person_trips_snap_too_far"], 12.0)
        self.assertEqual(county["annual_person_trips_network_unreachable"], 0.0)


class EndpointEvidence(unittest.TestCase):
    def test_later_point_adapter_overrides_an_older_gazetteer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gazetteer = root / "gaz.txt"
            gazetteer.write_text("GEOID\tINTPTLONG\tINTPTLAT\n06047\t-120.0\t37.0\n")
            adapter = root / "points.csv"
            adapter.write_text("id,lon,lat,source\n06047,-121.0,38.0,test\n")
            points = routed.read_endpoint_points([gazetteer], [adapter])
        self.assertEqual(points["06047"], (-121.0, 38.0))

    def test_snap_threshold_uses_miles_and_refuses_distant_point(self) -> None:
        class Router:
            coordinates = np.array([[0.0, 0.0], [1.0, 0.0]])
            def nearest_node(self, point):
                return (0, 0.0) if point[0] < 0.5 else (1, 0.0)
        nodes, statuses, distances = routed.snap_endpoints(
            Router(), {"near": (0.01, 0.0), "far": (2.0, 0.0)}, ["near", "far", "missing"], 10.0
        )
        self.assertEqual(statuses, {"far": "snap_too_far", "missing": "missing_endpoint", "near": "accepted"})
        self.assertEqual(nodes, {"near": 0})
        self.assertGreater(distances["far"], 60.0)


class FinalReduction(unittest.TestCase):
    def test_share_uses_through_plus_ending_travel(self) -> None:
        records = [
            {
                "origin": "a",
                "positive_od_pairs": 2,
                "counties": {
                    "06047": {
                        "annual_person_trips_through": 800.0,
                        "annual_person_trips_ending_here": 200.0,
                        "positive_external_flows_without_a_route": 0,
                        "annual_person_trips_without_a_route": 0.0,
                    }
                },
            }
        ]
        result = routed.combine_origin_summaries(records, ["06047"])
        self.assertEqual(result["counties"]["06047"]["through_share_of_long_distance_travel"], 0.8)
        self.assertEqual(result["positive_od_pairs"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
