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
    directionality_agrees,
    facility_class_agrees,
    counts_on_a_route,
    match_count_to_gateway,
    normalize_road_name,
    attach_passthrough_ceilings,
    passthrough_share_ceiling,
    select_measured_gateway_candidate,
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
        "direction": 0,
        "link_id": label,
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

    def test_candidate_match_requires_facility_class_and_direction(self) -> None:
        observed = count("S1", "Colfax Highway", 5_600)
        observed.update({"candidate_link_types": "trunk", "direction": "two_way"})
        self.assertTrue(facility_class_agrees(gateway("g1", "Colfax Highway"), observed))
        self.assertTrue(directionality_agrees(gateway("g1", "Colfax Highway"), observed))
        self.assertIsNotNone(
            match_count_to_gateway(
                gateway("g1", "Colfax Highway"),
                [observed],
                require_facility_and_direction=True,
            )
        )
        for field, wrong in (("candidate_link_types", "motorway"), ("direction", "one_way")):
            altered = {**observed, field: wrong}
            self.assertIsNone(
                match_count_to_gateway(
                    gateway("g1", "Colfax Highway"),
                    [altered],
                    require_facility_and_direction=True,
                ),
                field,
            )

    def test_excluded_source_section_cannot_seed_a_gateway(self) -> None:
        observed = count("S1", "Colfax Highway", 5_600)
        observed.update({"candidate_link_types": "trunk", "direction": "two_way", "exclusion_status": "excluded"})
        self.assertIsNone(
            match_count_to_gateway(
                gateway("g1", "Colfax Highway"),
                [observed],
                require_facility_and_direction=True,
            )
        )


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


class FrozenMeasuredGatewayCandidate(unittest.TestCase):
    def qualifying_count(self, station: str, road: str, volume: float, *, lat: float = BASE_LAT) -> dict:
        row = count(station, road, volume, lat=lat)
        row.update(
            {
                "candidate_link_types": "trunk",
                "direction": "two_way",
                "source_dataset_id": "42um-tgh5",
                "source_vintage": "2024",
                "source_section_id": f"section-{station}",
            }
        )
        return row

    def test_measured_crossings_exceed_the_cap_but_inferred_crossings_do_not(self) -> None:
        gateways = [
            gateway(f"g{i}", f"Road {i}", lat=BASE_LAT + i * 0.0001)
            for i in range(6)
        ]
        counts = [self.qualifying_count(f"S{i}", f"Road {i}", 5_000 + i) for i in range(4)]
        selected, summary = select_measured_gateway_candidate(
            gateways,
            counts,
            max_inferred_gateways=1,
        )
        self.assertEqual(len(selected), 5)
        self.assertEqual(summary["measured_gateways"], 4)
        self.assertEqual(summary["inferred_gateways"], 1)
        self.assertEqual(summary["dropped_unmeasured_gateways"], 1)
        self.assertEqual(sum(row["gateway_volume_basis"] == "measured" for row in selected), 4)

    def test_baseline_and_candidate_consume_the_same_station_set(self) -> None:
        gateways = [gateway("g1", "Road 1"), gateway("g2", "Road 2")]
        counts = [self.qualifying_count("S1", "Road 1", 5_000)]
        baseline, baseline_summary = select_measured_gateway_candidate(
            gateways,
            counts,
            max_inferred_gateways=8,
            apply_measured_volumes=False,
            retain_all_measured=False,
        )
        candidate, candidate_summary = select_measured_gateway_candidate(
            gateways, counts, max_inferred_gateways=8, apply_measured_volumes=True
        )
        self.assertEqual(baseline_summary["stations_consumed"], candidate_summary["stations_consumed"])
        self.assertEqual(baseline[0]["daily_in"], 9_000)
        self.assertEqual(candidate[0]["daily_in"], 2_500)
        self.assertEqual(baseline[0]["gateway_volume_basis"], "measured")
        self.assertEqual(baseline[0]["gateway_volume_applied"], "road_class_default")

    def test_baseline_preserves_the_old_total_cap(self) -> None:
        gateways = [gateway(f"g{i}", f"Road {i}", lat=BASE_LAT + i * 0.0001) for i in range(6)]
        counts = [self.qualifying_count(f"S{i}", f"Road {i}", 5_000 + i) for i in range(4)]
        baseline, summary = select_measured_gateway_candidate(
            gateways,
            counts,
            max_inferred_gateways=2,
            apply_measured_volumes=False,
            retain_all_measured=False,
        )
        self.assertEqual(len(baseline), 2)
        self.assertEqual(summary["stations_consumed"], ["S0", "S1", "S2", "S3"])

    def test_missing_source_is_unsupported_not_inferred(self) -> None:
        selected, summary = select_measured_gateway_candidate(
            [gateway("g1", "Road 1")],
            [],
            max_inferred_gateways=8,
            source_status="source_unavailable",
        )
        self.assertEqual(selected[0]["gateway_volume_basis"], "unsupported")
        self.assertEqual(summary["unsupported_gateways"], 1)

    def test_candidate_call_site_does_not_accept_a_wrong_facility_class(self) -> None:
        observed = self.qualifying_count("S1", "Road 1", 5_000)
        observed["candidate_link_types"] = "motorway"
        selected, summary = select_measured_gateway_candidate(
            [gateway("g1", "Road 1")], [observed], max_inferred_gateways=8
        )
        self.assertEqual(selected[0]["gateway_volume_basis"], "inferred")
        self.assertEqual(summary["stations_consumed"], [])


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




class TheThroughShareIsBoundedNotMeasured(unittest.TestCase):
    """What counts can and cannot say about traffic crossing a study area.

    Every vehicle that traverses the area passes the lowest-volume point on its
    route inside it, so through travel is bounded by that minimum. Counts can
    never say WHICH vehicles are the same vehicles, so this is a ceiling and
    nothing tighter is available from this data.

    The model currently applies a flat 0.35 to every paired route. Measured
    across five counties the ceiling runs 0.45 to 1.00 and varies with what the
    road does — an interstate bypassing towns bounds high, a highway running
    through a city bounds low.
    """

    def count(self, station_id, facility, volume, lon, lat, names="Golden State Highway"):
        return {
            "station_id": station_id, "facility_name": facility, "observed_volume": str(volume),
            "candidate_model_names": names,
            "bbox_min_lon": lon - 0.001, "bbox_min_lat": lat - 0.001,
            "bbox_max_lon": lon + 0.001, "bbox_max_lat": lat + 0.001,
        }

    def crossing(self, lon, lat, name="Golden State Highway"):
        return {"name": name, "boundary_lon": lon, "boundary_lat": lat}

    def test_the_route_is_chosen_by_facility_not_by_candidate_name(self) -> None:
        # THE BUG THIS EXISTS FOR. A station's candidate names come from its
        # location description, so "JCT. RTE. 5" put a 1,400-vehicle state route
        # into Interstate 5's profile and bounded a rural interstate at 0.03.
        crossings = [self.crossing(-121.0, 37.0), self.crossing(-121.0, 37.5)]
        counts = [
            self.count("A", "SR 5", 45500, -121.0, 37.0),
            self.count("B", "SR 5", 38000, -121.0, 37.5),
            self.count("C", "SR 5", 40000, -121.0, 37.25),
            self.count("D", "SR 165", 1400, -121.0, 37.1),   # junction with Route 5
        ]
        on_route = counts_on_a_route(crossings, counts)
        self.assertEqual({row["facility"] for row in on_route}, {"SR 5"})
        self.assertEqual(len(on_route), 3)

    def test_the_ceiling_is_the_route_minimum_over_what_enters(self) -> None:
        crossings = [self.crossing(-121.0, 37.0), self.crossing(-121.0, 37.5)]
        counts = [
            self.count("A", "SR 99", 100000, -121.0, 37.0),
            self.count("B", "SR 99", 60000, -121.0, 37.5),
            self.count("C", "SR 99", 45000, -121.0, 37.25),
        ]
        on_route = counts_on_a_route(crossings, counts)
        bound = passthrough_share_ceiling(crossings[0], on_route)
        self.assertAlmostEqual(bound["ceiling"], 0.45, places=4)
        self.assertTrue(bound["is_informative"])

    def test_a_route_whose_minimum_is_its_own_crossing_bounds_nothing(self) -> None:
        # True and useless: 1.0 says every vehicle COULD be passing through.
        # Reporting it as a measured share would be the whole error.
        crossings = [self.crossing(-121.0, 37.0), self.crossing(-121.0, 37.5)]
        counts = [
            self.count("A", "SR 99", 40000, -121.0, 37.0),
            self.count("B", "SR 99", 60000, -121.0, 37.5),
            self.count("C", "SR 99", 55000, -121.0, 37.25),
        ]
        bound = passthrough_share_ceiling(crossings[0], counts_on_a_route(crossings, counts))
        self.assertEqual(bound["ceiling"], 1.0)
        self.assertFalse(bound["is_informative"])

    def test_two_counts_are_two_endpoints_and_not_a_profile(self) -> None:
        crossings = [self.crossing(-121.0, 37.0), self.crossing(-121.0, 37.5)]
        counts = [
            self.count("A", "SR 99", 40000, -121.0, 37.0),
            self.count("B", "SR 99", 60000, -121.0, 37.5),
        ]
        self.assertIsNone(passthrough_share_ceiling(crossings[0], counts_on_a_route(crossings, counts)))

    def test_a_crossing_with_no_count_near_it_bounds_nothing(self) -> None:
        # The nearest station is the denominator, so a far one would scale the
        # whole estimate by a volume from somewhere else.
        crossings = [self.crossing(-121.0, 37.0), self.crossing(-121.0, 37.5)]
        far = [self.count(str(i), "SR 99", 40000, -118.0, 34.0 + i * 0.01) for i in range(3)]
        self.assertIsNone(passthrough_share_ceiling(crossings[0], counts_on_a_route(crossings, far)))

    def test_the_bound_says_out_loud_that_it_is_a_bound(self) -> None:
        crossings = [self.crossing(-121.0, 37.0), self.crossing(-121.0, 37.5)]
        counts = [
            self.count("A", "SR 99", 100000, -121.0, 37.0),
            self.count("B", "SR 99", 60000, -121.0, 37.5),
            self.count("C", "SR 99", 45000, -121.0, 37.25),
        ]
        bound = passthrough_share_ceiling(crossings[0], counts_on_a_route(crossings, counts))
        self.assertIn("upper bound, not a measurement", bound["note"])
        self.assertIn("cannot say which vehicles are the same", bound["note"])




class OnlyAnInformativeBoundReplacesTheFlatShare(unittest.TestCase):
    """Attaching a ceiling of 1.0 would send every vehicle straight across.

    1.0 is what a route reports when its lowest count sits at its own crossing:
    true, and it means "these counts cannot tell". Writing it as the share would
    turn "we do not know" into "all of it passes through" — the same mistake as
    reading an unnamed road as a road with no counts nearby.
    """

    def count(self, station_id, facility, volume, lon, lat, names="Golden State Highway"):
        return {
            "station_id": station_id, "facility_name": facility, "observed_volume": str(volume),
            "candidate_model_names": names,
            "bbox_min_lon": lon - 0.001, "bbox_min_lat": lat - 0.001,
            "bbox_max_lon": lon + 0.001, "bbox_max_lat": lat + 0.001,
        }

    def crossings(self, name="Golden State Highway"):
        return [
            {"name": name, "boundary_lon": -121.0, "boundary_lat": 37.0, "zone_id": 100},
            {"name": name, "boundary_lon": -121.0, "boundary_lat": 37.5, "zone_id": 101},
        ]

    def test_an_informative_bound_is_written_onto_the_crossing(self) -> None:
        gateways = self.crossings()
        counts = [
            self.count("A", "SR 99", 100000, -121.0, 37.0),
            self.count("B", "SR 99", 60000, -121.0, 37.5),
            self.count("C", "SR 99", 45000, -121.0, 37.25),
        ]
        record = attach_passthrough_ceilings(gateways, counts)
        self.assertAlmostEqual(gateways[0]["passthrough_share"], 0.45, places=4)
        self.assertEqual(gateways[0]["passthrough_basis"], "count_profile_ceiling")
        # Both ends bound, and to DIFFERENT figures — the same route's two
        # crossings carry different volumes, so one flat share cannot describe
        # even a single road.
        self.assertEqual(record["crossings_bounded_by_counts"], 2)
        self.assertAlmostEqual(gateways[1]["passthrough_share"], 0.75, places=4)

    def test_a_ceiling_of_one_leaves_the_flat_share_in_place(self) -> None:
        gateways = self.crossings()
        counts = [
            self.count("A", "SR 99", 40000, -121.0, 37.0),
            self.count("B", "SR 99", 60000, -121.0, 37.5),
            self.count("C", "SR 99", 55000, -121.0, 37.25),
        ]
        attach_passthrough_ceilings(gateways, counts)
        self.assertNotIn("passthrough_share", gateways[0])
        self.assertEqual(gateways[0]["passthrough_basis"], "flat_default")

    def test_a_route_crossing_once_is_left_entirely_alone(self) -> None:
        gateways = [{"name": "Lonely Road", "boundary_lon": -121.0, "boundary_lat": 37.0, "zone_id": 100}]
        record = attach_passthrough_ceilings(gateways, [])
        self.assertNotIn("passthrough_share", gateways[0])
        self.assertNotIn("passthrough_basis", gateways[0])
        self.assertEqual(record["paired_crossings"], 0)

    def test_every_crossing_says_which_basis_it_used(self) -> None:
        gateways = self.crossings()
        attach_passthrough_ceilings(gateways, [])
        for gateway in gateways:
            self.assertEqual(gateway["passthrough_basis"], "flat_default")
            self.assertIn("any road anywhere", gateway["passthrough_basis_note"])

    def test_the_record_calls_them_ceilings(self) -> None:
        gateways = self.crossings()
        record = attach_passthrough_ceilings(gateways, [])
        self.assertIn("CEILING on through travel, not a measurement", record["note"])


if __name__ == "__main__":
    unittest.main()
