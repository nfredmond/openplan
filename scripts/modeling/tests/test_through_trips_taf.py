#!/usr/bin/env python3
"""Through travel from FHWA's county-to-county trip tables.

Every check here is about a way the estimate silently becomes wrong while still
producing a plausible percentage — which is how the first run of this analysis
reported that nobody travels to Merced County.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import Polygon

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import through_trips_taf as taf

# A square study area, with counties placed west, east, north and inside it.
STUDY = Polygon([(-121.0, 37.0), (-120.0, 37.0), (-120.0, 38.0), (-121.0, 38.0)])
CENTROIDS = {
    "06047": (-120.5, 37.5),   # inside the study area
    "06001": (-122.0, 37.5),   # west
    "06002": (-119.0, 37.5),   # east — a line west-to-east crosses the study area
    "06003": (-122.0, 40.0),   # far north-west
    "06004": (-119.0, 40.5),   # far north-east — the line between these misses
}


class ThroughIsBothEndpointsOutsideAndAPathAcross(unittest.TestCase):
    def split(self, rows):
        return taf.through_and_local_trips(rows, "06047", STUDY, CENTROIDS)

    def test_a_flow_crossing_the_area_counts_as_through(self) -> None:
        result = self.split([("06001", "06002", 3650.0)])
        self.assertEqual(result["annual_person_trips_through"], 3650.0)
        self.assertEqual(result["daily_person_trips_through"], 10.0)

    def test_a_flow_ending_in_the_study_area_is_not_through(self) -> None:
        result = self.split([("06001", "06047", 3650.0)])
        self.assertEqual(result["annual_person_trips_through"], 0.0)
        self.assertEqual(result["annual_person_trips_ending_here"], 3650.0)

    def test_a_flow_that_misses_the_area_counts_as_neither(self) -> None:
        result = self.split([("06003", "06004", 3650.0)])
        self.assertEqual(result["annual_person_trips_through"], 0.0)
        self.assertEqual(result["annual_person_trips_ending_here"], 0.0)

    def test_the_share_is_through_over_everything_that_touches_the_county(self) -> None:
        result = self.split([("06001", "06002", 800.0), ("06001", "06047", 200.0)])
        self.assertAlmostEqual(result["through_share_of_long_distance_travel"], 0.8, places=4)

    def test_no_flows_gives_no_share_rather_than_zero(self) -> None:
        # A county nobody travels to and a county with no data are different.
        self.assertIsNone(self.split([])["through_share_of_long_distance_travel"])


class TheFipsCodesMustLineUp(unittest.TestCase):
    """THE BUG THAT MADE EVERY CALIFORNIA COUNTY LOOK UNVISITED.

    TAF writes county FIPS without leading zeros — 1001, not 01001 — while the
    Census Gazetteer pads them. Unpadded, every county in a state numbered below
    10 fails to match, and the first run reported 0 trips ending in each of five
    study counties. Zero is a plausible-looking number.
    """

    def test_an_unpadded_code_still_matches(self) -> None:
        result = taf.through_and_local_trips([("6001", "6047", 3650.0)], "06047", STUDY, CENTROIDS)
        self.assertEqual(result["annual_person_trips_ending_here"], 3650.0)

    def test_normalize_pads_to_five_digits(self) -> None:
        self.assertEqual(taf.normalize_fips("1001"), "01001")
        self.assertEqual(taf.normalize_fips("48001"), "48001")

    def test_a_flow_naming_a_county_with_no_centroid_is_counted_as_unknown(self) -> None:
        # Silently dropping it would shrink the denominator and inflate the share.
        result = taf.through_and_local_trips([("99999", "06002", 3650.0)], "06047", STUDY, CENTROIDS)
        self.assertEqual(result["flows_with_an_unknown_county"], 1)
        self.assertEqual(result["annual_person_trips_through"], 0.0)


class TheGazetteerHeaderHasTrailingSpaces(unittest.TestCase):
    """`INTPTLONG` is written with trailing spaces in the Census file.

    Unstripped, every row raises KeyError and the centroid table comes back
    empty — after which nothing crosses anything and every share is zero.
    """

    def test_centroids_are_read_despite_the_padded_header(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gaz.txt"
            path.write_text(
                "USPS\tGEOID\tNAME\tINTPTLAT\tINTPTLONG" + " " * 20 + "\n"
                "CA\t06047\tMerced County\t37.19\t-120.71\n"
            )
            centroids = taf.read_county_centroids(path)
        self.assertEqual(centroids["06047"], (-120.71, 37.19))


class TheEstimateCarriesItsOwnLimits(unittest.TestCase):
    def test_it_says_what_it_is_not(self) -> None:
        note = taf.through_and_local_trips([("06001", "06002", 10.0)], "06047", STUDY, CENTROIDS)["what_this_is_not"]
        self.assertIn("LONG-DISTANCE", note)
        self.assertIn("straight line", note)
        self.assertIn("not the share of traffic at a boundary crossing", note)


if __name__ == "__main__":
    unittest.main(verbosity=1)
