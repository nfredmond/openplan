#!/usr/bin/env python3
"""Walking and cycling are not cars.

This lane assigned every generated person trip to the road network, including
the ones nobody drove. It is the same unit error as assigning person trips as
vehicles, one step earlier: the worker has had a mode-choice model since it was
written, and the county-script lane never called it.

With no transit skim the split is auto-versus-active only. That is the honest
consequence of having no transit data — a blanket transit share would be a
fabricated number, and `mode_choice` refuses to produce one.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parents[1]
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for path in (str(SCRIPT_DIR), str(WORKER_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import screening_runtime as sr


def zones(n: int = 3) -> pd.DataFrame:
    return pd.DataFrame([{
        "zone_id": i + 1, "zone_kind": "internal",
        "est_population": 1000.0, "households": 400.0, "worker_residents": 500.0,
        "total_jobs": 300.0, "retail_jobs": 50.0, "accommodation_jobs": 20.0,
        "health_jobs": 30.0, "education_jobs": 20.0, "govt_jobs": 10.0,
        "area_sq_mi": 10.0, "centroid_lon": -121.0 - i * 0.1, "centroid_lat": 39.0,
        "GEOID": f"0600000010{i}", "NAMELSAD": f"Tract {i}", "area_share": 1.0 / n,
    } for i in range(n)])


def times(n: int = 3, minutes: float = 10.0) -> np.ndarray:
    m = np.full((n, n), minutes)
    np.fill_diagonal(m, 2.0)
    return m


def miles(n: int = 3, value: float = 6.0) -> np.ndarray:
    m = np.full((n, n), value)
    np.fill_diagonal(m, 0.5)
    return m


class OnlyTheDrivenTripsReachTheNetwork(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def demand(self, *, split: bool, distance=None, dist_value: float = 6.0):
        return sr.synthesize_demand(
            zones(), times(), [], self.out,
            convert_person_trips_to_vehicles=False,
            split_non_auto_modes=split,
            distance_matrix=miles(value=dist_value) if distance is None else distance,
        )

    def test_splitting_removes_trips_nobody_drove(self) -> None:
        everything = self.demand(split=False)["summary"]
        driven = self.demand(split=True)["summary"]
        total = lambda s: s["hbw_trips"] + s["hbo_trips"] + s["nhb_trips"]
        self.assertLess(total(driven), total(everything))

    def test_short_trips_lose_more_to_walking_than_long_ones(self) -> None:
        # The whole reason distance is needed. If the split ignored distance,
        # a half-mile errand and a twenty-mile commute would shed the same share.
        short = self.demand(split=True, dist_value=0.5)["summary"]["trip_rates"]["mode_split_applied"]
        long = self.demand(split=True, dist_value=25.0)["summary"]["trip_rates"]["mode_split_applied"]
        self.assertLess(short["auto_share_of_person_trips"], long["auto_share_of_person_trips"])

    def test_no_distance_skim_means_no_split_rather_than_a_guess(self) -> None:
        # Guessing distance from time would invent the very quantity the split
        # turns on.
        result = sr.synthesize_demand(
            zones(), times(), [], self.out,
            convert_person_trips_to_vehicles=False, split_non_auto_modes=True,
            distance_matrix=None,
        )
        self.assertIsNone(result["summary"]["trip_rates"]["mode_split_applied"])

    def test_the_run_records_the_share_it_applied(self) -> None:
        applied = self.demand(split=True)["summary"]["trip_rates"]["mode_split_applied"]
        self.assertIsNotNone(applied["auto_share_of_person_trips"])
        self.assertLessEqual(applied["auto_share_of_person_trips"], 1.0)

    def test_no_transit_share_is_claimed_without_a_transit_skim(self) -> None:
        applied = self.demand(split=True)["summary"]["trip_rates"]["mode_split_applied"]
        self.assertIn("no transit share is claimed", applied["transit"])

    def test_it_is_on_by_default_because_it_is_a_unit_error(self) -> None:
        self.assertTrue(sr.SPLIT_NON_AUTO_MODES)


class TheDistanceSkimIsMetres(unittest.TestCase):
    """The unit error I made writing this, caught by measuring not by a test.

    AequilibraE's `distance` field — in the links table and in the skim — is
    METRES. Passed to a mode model expecting miles, it asks whether anyone would
    walk thirty-five thousand miles, answers no, and returns a 98.5% auto share.
    That reads as a rural county with little walking, which Merced plausibly is,
    so the number survived review and only a comparison against the published
    non-auto share exposed it.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def split_for(self, metres: float) -> float:
        n = 3
        d = np.full((n, n), metres)
        np.fill_diagonal(d, metres / 10.0)
        result = sr.synthesize_demand(
            zones(), times(), [], self.out,
            convert_person_trips_to_vehicles=False, split_non_auto_modes=True,
            distance_matrix=d,
        )
        return result["summary"]["trip_rates"]["mode_split_applied"]

    def test_a_walkable_distance_in_metres_is_treated_as_walkable(self) -> None:
        # 800 m is half a mile. Read as 800 MILES nobody walks it, and the auto
        # share comes back at essentially 1.0.
        applied = self.split_for(800.0)
        self.assertLess(applied["auto_share_of_person_trips"], 0.98)
        self.assertLess(applied["median_trip_miles"], 1.0)

    def test_the_recorded_median_is_in_miles_not_metres(self) -> None:
        # A run reporting a median trip of 35,694 has not converted anything.
        applied = self.split_for(35694.0)
        self.assertAlmostEqual(applied["median_trip_miles"], 22.18, delta=0.1)

    def test_the_conversion_constant_is_the_one_the_rest_of_the_lane_uses(self) -> None:
        self.assertAlmostEqual(sr.METERS_PER_MILE, 1609.344, places=3)


if __name__ == "__main__":
    unittest.main(verbosity=1)
