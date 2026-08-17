#!/usr/bin/env python3
"""How far a zone's demand is willing to travel to enter on a bigger road.

`rank_connector_candidate` scores a candidate node as
``priority * CONNECTOR_CLASS_WEIGHT_M - distance_m``. That single constant
decides whether a zone's whole demand is injected onto the nearest arterial or
onto the nearest road of any kind, and the consequence is measurable: across 24
counties with published counts the assignment over-loads arterials and starves
small roads (trunk 3.39x observed, tertiary 0.01x).

These tests pin the arithmetic and the default. They do NOT assert that the
default is correct — that is what the counties measure.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import screening_runtime as sr


def network(links: list[tuple[int, int, str]]) -> sqlite3.Connection:
    """An in-memory stand-in for the project's link table."""
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE links (a_node INTEGER, b_node INTEGER, link_type TEXT)")
    conn.executemany("INSERT INTO links (a_node, b_node, link_type) VALUES (?, ?, ?)", links)
    return conn


def degrees_for_metres(metres: float) -> float:
    """The squared-degree distance the ranker expects, for a given distance."""
    return (metres / 111000.0) ** 2


class TheClassWeightDecidesHowFarDemandWillTravel(unittest.TestCase):
    def setUp(self) -> None:
        # node 1 sits on a motorway, node 2 on a residential street
        self.conn = network([(1, 10, "motorway"), (2, 20, "residential")])

    def score(self, node_id: int, metres: float) -> float:
        return sr.rank_connector_candidate(self.conn, node_id, degrees_for_metres(metres))[0]

    def test_at_the_shipped_weight_a_motorway_wins_from_much_farther_away(self) -> None:
        # priority 8 vs 2 = six steps x 250 m = 1,500 m of advantage.
        self.assertGreater(self.score(1, 1400), self.score(2, 10))
        self.assertLess(self.score(1, 1600), self.score(2, 10))

    def test_the_advantage_is_exactly_the_weight_times_the_class_gap(self) -> None:
        gap_metres = (8 - 2) * sr.CONNECTOR_CLASS_WEIGHT_M
        near = self.score(2, 10)
        # A motorway exactly `gap` farther than the residential node ties with it.
        self.assertAlmostEqual(self.score(1, 10 + gap_metres), near, places=6)

    def test_an_unknown_link_type_is_ranked_below_every_known_one(self) -> None:
        conn = network([(1, 10, "motorway"), (3, 30, "some_new_osm_tag")])
        unknown = sr.rank_connector_candidate(conn, 3, degrees_for_metres(10))
        known = sr.rank_connector_candidate(conn, 1, degrees_for_metres(10))
        self.assertLess(unknown[0], known[0])

    def test_distance_still_breaks_a_tie_between_equal_classes(self) -> None:
        conn = network([(1, 10, "primary"), (2, 20, "primary")])
        near = sr.rank_connector_candidate(conn, 1, degrees_for_metres(50))
        far = sr.rank_connector_candidate(conn, 2, degrees_for_metres(500))
        self.assertGreater(near[0], far[0])


class TheWeightIsMeasurableWithoutEditingCode(unittest.TestCase):
    """An experiment that needs a source edit is one nobody re-runs."""

    def reload_with(self, value: str | None):
        previous = os.environ.get("OPENPLAN_CONNECTOR_CLASS_WEIGHT_M")
        if value is None:
            os.environ.pop("OPENPLAN_CONNECTOR_CLASS_WEIGHT_M", None)
        else:
            os.environ["OPENPLAN_CONNECTOR_CLASS_WEIGHT_M"] = value
        try:
            return importlib.reload(sr)
        finally:
            if previous is None:
                os.environ.pop("OPENPLAN_CONNECTOR_CLASS_WEIGHT_M", None)
            else:
                os.environ["OPENPLAN_CONNECTOR_CLASS_WEIGHT_M"] = previous

    def tearDown(self) -> None:
        self.reload_with(None)

    def test_the_default_is_the_shipped_behaviour(self) -> None:
        module = self.reload_with(None)
        self.assertEqual(module.CONNECTOR_CLASS_WEIGHT_M, 250.0)

    def test_zero_makes_connector_choice_purely_nearest_node(self) -> None:
        module = self.reload_with("0")
        conn = network([(1, 10, "motorway"), (2, 20, "residential")])
        motorway_far = module.rank_connector_candidate(conn, 1, degrees_for_metres(400))[0]
        residential_near = module.rank_connector_candidate(conn, 2, degrees_for_metres(10))[0]
        self.assertGreater(residential_near, motorway_far)

    def test_an_unreadable_value_falls_back_to_the_shipped_default(self) -> None:
        # A typo in an environment variable must not silently rewrite how every
        # zone attaches to the network.
        with self.assertRaises(ValueError):
            self.reload_with("not-a-number")


class TheRecordedAssumptionsSayWhatWasUsed(unittest.TestCase):
    def test_the_weight_travels_in_the_run_s_own_assumptions(self) -> None:
        """A run whose connectors attached differently must be able to say so
        years later, in the same block as the other screening defaults."""
        assumptions = sr.model_assumptions()
        self.assertEqual(
            assumptions["other"]["connector_class_weight_m"], sr.CONNECTOR_CLASS_WEIGHT_M
        )


if __name__ == "__main__":
    unittest.main()
