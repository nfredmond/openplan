#!/usr/bin/env python3
"""Seeding boundary traffic from measurements, and the ways that goes wrong.

WHAT THIS IS CORRECTING
=======================
A third of everything a screening run assigns is traffic entering and leaving
the study area, and its magnitude came from five hardcoded numbers by road
class. Measured against the state DOT's published counts on one county: freeway
and major-primary crossings landed at 0.8-1.2 times the real volume, trunk-road
crossings at 2.7-5.7 times. The same run validates trunk roads at 3.3 times
observed. Over-injected traffic has to go somewhere, and it goes onto the roads
it entered on.

WHY THE TESTS ARE MOSTLY REFUSALS
=================================
Replacing a guess with "real data" is exactly the change that feels safe and
introduces a worse error. Matching on proximity alone paired a motorway crossing
with a count on a different highway 1.2 miles away reading 3,150 where the
freeway carries 33,000 — a twelvefold error committed in the name of using
measurements. So the match must prove road identity AND closeness, and the
module must refuse to grade the model on the counts that built it.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from gateway_counts import (  # noqa: E402
    GatewayCountsError,
    assert_counts_not_reused_for_grading,
    count_road_names,
    match_count_to_gateway,
    normalize_road_name,
    seed_gateways_from_counts,
)

# Roughly a mile apart in latitude at this longitude.
BASE_LAT, BASE_LON = 39.20, -121.05
MILE_LAT = 0.0145


def gateway(label: str, name: str, *, daily: float = 9000.0, lat: float = BASE_LAT) -> dict:
    return {
        "label": label,
        "name": name,
        "link_type": "trunk",
        "daily_in": daily,
        "daily_out": daily,
        "boundary_lat": lat,
        "boundary_lon": BASE_LON,
    }


def count(station: str, road: str, volume: float, *, lat: float = BASE_LAT, facility: str = "SR 20") -> dict:
    return {
        "station_id": station,
        "facility_name": facility,
        "candidate_model_names": road,
        "observed_volume": str(volume),
        "bbox_min_lat": str(lat - 0.0005),
        "bbox_max_lat": str(lat + 0.0005),
        "bbox_min_lon": str(BASE_LON - 0.0005),
        "bbox_max_lon": str(BASE_LON + 0.0005),
    }


class MatchingACountToACrossing(unittest.TestCase):
    def test_a_count_on_the_same_road_nearby_is_the_match(self) -> None:
        match = match_count_to_gateway(
            gateway("g1", "Colfax Highway"), [count("S1", "Colfax Highway", 5_600)]
        )
        self.assertIsNotNone(match)
        self.assertEqual(match["station_id"], "S1")
        self.assertEqual(match["observed_volume"], 5_600)

    def test_a_count_on_a_different_road_is_not_matched_however_close(self) -> None:
        # THE ONE THAT MATTERS MOST. Proximity alone paired a motorway crossing
        # with a count on another highway reading 3,150 where the freeway
        # carries 33,000 — a twelvefold error introduced by "using real data".
        match = match_count_to_gateway(
            gateway("g1", "Alan S. Hart Freeway"), [count("S1", "Colfax Highway", 3_150)]
        )
        self.assertIsNone(match)

    def test_a_count_on_the_same_road_too_far_away_is_not_matched(self) -> None:
        # A station miles inside the county measures local traffic that never
        # crosses the boundary at all.
        far = count("S1", "Colfax Highway", 5_600, lat=BASE_LAT + MILE_LAT * 6)
        self.assertIsNone(match_count_to_gateway(gateway("g1", "Colfax Highway"), [far]))

    def test_the_nearest_qualifying_count_wins(self) -> None:
        near = count("NEAR", "Colfax Highway", 5_600, lat=BASE_LAT + MILE_LAT * 0.2)
        further = count("FAR", "Colfax Highway", 9_900, lat=BASE_LAT + MILE_LAT * 1.5)
        match = match_count_to_gateway(gateway("g1", "Colfax Highway"), [near, further])
        self.assertEqual(match["station_id"], "NEAR")

    def test_road_names_compare_without_punctuation_or_case(self) -> None:
        self.assertEqual(normalize_road_name("Alan S. Hart Freeway"), "alan s hart freeway")
        match = match_count_to_gateway(
            gateway("g1", "Alan S. Hart Freeway"), [count("S1", "alan s hart freeway", 33_000)]
        )
        self.assertEqual(match["station_id"], "S1")

    def test_a_gateway_on_an_unnamed_road_matches_nothing(self) -> None:
        # An unnamed crossing cannot prove which road a nearby count belongs to,
        # and guessing is the failure above.
        self.assertIsNone(match_count_to_gateway(gateway("g1", ""), [count("S1", "Colfax Highway", 5_600)]))

    def test_a_count_with_no_usable_volume_is_skipped(self) -> None:
        for bad in ("TBD", "", "0", "-1"):
            self.assertIsNone(
                match_count_to_gateway(gateway("g1", "Colfax Highway"), [count("S1", "Colfax Highway", bad)]),
                bad,
            )

    def test_a_count_with_no_position_is_skipped(self) -> None:
        positionless = {"station_id": "S1", "candidate_model_names": "Colfax Highway", "observed_volume": "5600"}
        self.assertIsNone(match_count_to_gateway(gateway("g1", "Colfax Highway"), [positionless]))

    def test_several_road_names_on_one_count_all_count(self) -> None:
        multi = count("S1", "Colfax Highway|Nevada City Highway", 5_600)
        self.assertIsNotNone(match_count_to_gateway(gateway("g1", "Nevada City Highway"), [multi]))
        self.assertIn("colfax highway", count_road_names(multi))


class SeedingTheCrossings(unittest.TestCase):
    def test_a_two_way_count_becomes_half_in_and_half_out(self) -> None:
        # THE CORRECTION THAT WAS ALREADY WRONG BEFORE ANY COUNT WAS INVOLVED.
        # The class value was applied in BOTH directions, so a crossing pushed
        # twice its number across the boundary. A published AADT is the total
        # of both directions, so it is split, and total crossings equal the
        # measurement instead of double it.
        seeded, summary = seed_gateways_from_counts(
            [gateway("g1", "Colfax Highway", daily=9_000)], [count("S1", "Colfax Highway", 5_600)]
        )
        self.assertEqual(seeded[0]["daily_in"], 2_800)
        self.assertEqual(seeded[0]["daily_out"], 2_800)
        self.assertEqual(summary["boundary_crossings_after"], 5_600)
        self.assertEqual(summary["boundary_crossings_before"], 18_000)

    def test_an_unmatched_gateway_keeps_its_default_and_says_so(self) -> None:
        seeded, summary = seed_gateways_from_counts([gateway("g1", "Nowhere Road")], [])
        self.assertEqual(seeded[0]["daily_in"], 9_000)
        self.assertEqual(seeded[0]["daily_basis"], "road_class_default")
        self.assertIn("not a measurement", seeded[0]["daily_basis_note"])
        self.assertEqual(summary["gateways_from_road_class_default"], 1)

    def test_a_seeded_gateway_records_what_measured_it(self) -> None:
        seeded, _ = seed_gateways_from_counts(
            [gateway("g1", "Colfax Highway")], [count("S1", "Colfax Highway", 5_600)]
        )
        self.assertEqual(seeded[0]["daily_basis"], "published_count")
        self.assertEqual(seeded[0]["daily_basis_station_id"], "S1")
        self.assertIn("5,600", seeded[0]["daily_basis_note"])
        self.assertIn("assumes the day balances", seeded[0]["daily_basis_note"])

    def test_the_summary_reports_how_far_the_total_moved(self) -> None:
        seeded, summary = seed_gateways_from_counts(
            [gateway("g1", "Colfax Highway", daily=9_000), gateway("g2", "Nowhere Road", daily=6_000)],
            [count("S1", "Colfax Highway", 5_600)],
        )
        self.assertEqual(summary["gateways_from_published_counts"], 1)
        self.assertEqual(summary["gateways_from_road_class_default"], 1)
        self.assertEqual(summary["boundary_crossings_before"], 30_000)
        self.assertEqual(summary["boundary_crossings_after"], 17_600)
        self.assertIn("-41%", summary["note"])

    def test_a_study_area_with_no_usable_counts_is_told_plainly(self) -> None:
        # Traffic entering the study area is usually a large share of everything
        # assigned, so a run where none of it is measured needs to say that
        # rather than let the defaults pass as data.
        _, summary = seed_gateways_from_counts([gateway("g1", "Nowhere Road")], [])
        self.assertIn("None of this study area's 1 boundary crossings", summary["note"])
        self.assertIn("not measurements", summary["note"])

    def test_every_consumed_station_is_reported(self) -> None:
        _, summary = seed_gateways_from_counts(
            [gateway("g1", "Colfax Highway"), gateway("g2", "Colfax Highway", lat=BASE_LAT + MILE_LAT * 0.3)],
            [count("S1", "Colfax Highway", 5_600), count("S2", "Colfax Highway", 6_100, lat=BASE_LAT + MILE_LAT * 0.3)],
        )
        self.assertEqual(summary["stations_consumed"], ["S1", "S2"])


class NotGradingTheModelOnWhatBuiltIt(unittest.TestCase):
    def test_a_station_used_for_both_is_refused_by_name(self) -> None:
        # `run_screening_model` already refuses calibrating and validating on
        # one file. This is the same rule for demand: a gateway seeded from a
        # count, then reported as matching that count, is marking its own exam.
        with self.assertRaises(GatewayCountsError) as caught:
            assert_counts_not_reused_for_grading(["S1", "S2"], ["S2", "S9"])
        self.assertIn("S2", str(caught.exception))
        self.assertIn("cannot be graded on the numbers it was built from", str(caught.exception))

    def test_disjoint_sets_pass(self) -> None:
        assert_counts_not_reused_for_grading(["S1"], ["S2", "S3"])

    def test_nothing_consumed_passes(self) -> None:
        assert_counts_not_reused_for_grading([], ["S1", "S2"])


if __name__ == "__main__":
    unittest.main()
