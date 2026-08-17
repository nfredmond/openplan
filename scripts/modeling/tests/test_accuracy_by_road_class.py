#!/usr/bin/env python3
"""One accuracy figure for a whole model hides which roads it gets right.

WHAT THIS GUARDS
================
Measured on a real Nevada County run against 17 published Caltrans stations:

    motorway   9 stations   median error  22.8%   model/observed 1.10
    secondary  4 stations   median error 132.4%   model/observed 1.63
    primary    2 stations   median error 146.6%   model/observed 2.47
    trunk      1 station    median error 227.1%   model/observed 3.27

The run reported "39.7% median error" and nothing else. A planner asking how
much traffic is on a freeway and a planner asking about an arterial were handed
numbers roughly five times apart in quality, described identically.

That is the failure this breakdown exists to end, so the tests are about the
ways a per-class figure could mislead in turn: a class represented by one
station reading as an accuracy, a class ordering that buries the worst result,
and a ratio that loses the direction of the error.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from screening_metrics import accuracy_by_road_class, road_class_accuracy_note  # noqa: E402


def station(road_class: str, observed: float, modeled: float) -> dict:
    error = abs(modeled - observed) / observed * 100.0
    return {
        "model_link_type": road_class,
        "observed_volume": str(observed),
        "modeled_daily_pce": str(modeled),
        "absolute_percent_error": f"{error:.2f}",
    }


class SplittingAccuracyByTheKindOfRoad(unittest.TestCase):
    def test_each_class_gets_its_own_error(self) -> None:
        rows = [
            station("motorway", 40_000, 44_000),   # 10%
            station("motorway", 30_000, 33_000),   # 10%
            station("secondary", 5_000, 11_000),   # 120%
            station("secondary", 4_000, 8_800),    # 120%
        ]
        breakdown = {entry["road_class"]: entry for entry in accuracy_by_road_class(rows)}

        self.assertAlmostEqual(breakdown["motorway"]["median_absolute_percent_error"], 10.0, places=1)
        self.assertAlmostEqual(breakdown["secondary"]["median_absolute_percent_error"], 120.0, places=1)
        self.assertEqual(breakdown["motorway"]["stations"], 2)

    def test_the_ratio_keeps_the_direction_of_the_error(self) -> None:
        # Over- and under-assignment are different problems. A model putting
        # traffic where it does not belong overstates a corridor in a funding
        # application; an absolute error cannot tell the two apart.
        over = accuracy_by_road_class([station("primary", 4_000, 10_000), station("primary", 5_000, 12_000)])
        under = accuracy_by_road_class([station("primary", 10_000, 4_000), station("primary", 12_000, 5_000)])

        self.assertGreater(over[0]["median_model_over_observed"], 2.0)
        self.assertLess(under[0]["median_model_over_observed"], 0.5)

    def test_a_class_with_one_station_is_marked_as_such(self) -> None:
        # THE ONE THAT MATTERS MOST for not replacing one misleading number with
        # five. A single comparison is a data point; printed as "227% median
        # error" next to a class with nine stations it reads as a measurement.
        breakdown = accuracy_by_road_class([station("trunk", 3_000, 9_800)])
        self.assertTrue(breakdown[0]["single_station"])

        many = accuracy_by_road_class([station("trunk", 3_000, 9_800)] * 3)
        self.assertFalse(many[0]["single_station"])

    def test_classes_come_out_biggest_road_first(self) -> None:
        rows = [station("secondary", 5_000, 6_000), station("motorway", 40_000, 41_000),
                station("tertiary", 1_000, 1_100), station("primary", 8_000, 9_000)]
        order = [entry["road_class"] for entry in accuracy_by_road_class(rows)]
        self.assertEqual(order, ["motorway", "primary", "secondary", "tertiary"])

    def test_an_unrecognised_class_still_appears_rather_than_vanishing(self) -> None:
        # A road type this list has not seen is data, not noise. Dropping it
        # would silently shrink the evidence a reader thinks they have.
        order = [entry["road_class"] for entry in accuracy_by_road_class(
            [station("motorway", 40_000, 41_000), station("busway", 2_000, 2_400)]
        )]
        self.assertEqual(order, ["motorway", "busway"])

    def test_a_station_with_no_road_type_is_skipped_not_grouped_as_blank(self) -> None:
        rows = [station("", 5_000, 6_000), station("motorway", 40_000, 41_000)]
        self.assertEqual([e["road_class"] for e in accuracy_by_road_class(rows)], ["motorway"])

    def test_a_zero_observed_count_cannot_produce_an_infinite_ratio(self) -> None:
        rows = [{"model_link_type": "primary", "observed_volume": "0",
                 "modeled_daily_pce": "5000", "absolute_percent_error": "100"}]
        self.assertEqual(accuracy_by_road_class(rows), [])

    def test_unmatched_or_unreadable_stations_do_not_enter(self) -> None:
        rows = [
            {"model_link_type": "primary", "observed_volume": None,
             "modeled_daily_pce": "5000", "absolute_percent_error": "100"},
            {"model_link_type": "primary", "observed_volume": "5000",
             "modeled_daily_pce": "", "absolute_percent_error": "100"},
        ]
        self.assertEqual(accuracy_by_road_class(rows), [])


class SayingItInASentence(unittest.TestCase):
    def test_it_names_the_best_and_the_worst_road_type(self) -> None:
        rows = [station("motorway", 40_000, 44_000)] * 2 + [station("secondary", 5_000, 11_000)] * 2
        note = road_class_accuracy_note(accuracy_by_road_class(rows))

        self.assertIn("motorway", note)
        self.assertIn("secondary", note)
        self.assertIn("the study-area median hides that", note)

    def test_single_station_classes_do_not_become_the_headline(self) -> None:
        # A lone catastrophic station must not be announced as the worst class
        # when it is one comparison. It stays in the table, marked.
        rows = [station("motorway", 40_000, 44_000)] * 2 + [station("trunk", 3_000, 30_000)]
        note = road_class_accuracy_note(accuracy_by_road_class(rows))

        self.assertNotIn("trunk", note)
        self.assertIn("measured on motorway roads only", note)

    def test_nothing_to_break_down_says_so(self) -> None:
        note = road_class_accuracy_note([])
        self.assertIn("cannot be broken down by road type", note)

    def test_every_class_having_one_station_is_disclosed(self) -> None:
        rows = [station("motorway", 40_000, 44_000), station("secondary", 5_000, 11_000)]
        note = road_class_accuracy_note(accuracy_by_road_class(rows))
        self.assertIn("individual comparisons rather than measures of accuracy", note)


if __name__ == "__main__":
    unittest.main()
