#!/usr/bin/env python3
"""Three people sharing a car are three trips and one vehicle.

This lane generated PERSON trips — its own provenance says "trips per person per
day" — and assigned them to the network as though each were a car. Every link
therefore carried roughly 1.6 times too many vehicles, which is most of the
2.2x over-assignment measured against published VMT and against traffic counts.

The ActivitySim lane has always divided by occupancy, and says exactly why:
"the comparison would report the demand models disagreeing when what actually
differed was the unit." So the two demand models in OpenPlan's own
side-by-side comparison were being assigned in different units.
"""
from __future__ import annotations

import sys
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
    rows = []
    for i in range(n):
        rows.append({
            "zone_id": i + 1, "zone_kind": "internal",
            "est_population": 1000.0, "households": 400.0, "worker_residents": 500.0,
            "total_jobs": 300.0, "retail_jobs": 50.0, "accommodation_jobs": 20.0,
            "health_jobs": 30.0, "education_jobs": 20.0, "govt_jobs": 10.0,
            "area_sq_mi": 10.0, "centroid_lon": -121.0 - i * 0.1, "centroid_lat": 39.0,
            "GEOID": f"0600000010{i}", "NAMELSAD": f"Tract {i}", "area_share": 1.0 / n,
        })
    return pd.DataFrame(rows)


def skim(n: int = 3) -> np.ndarray:
    m = np.full((n, n), 10.0)
    np.fill_diagonal(m, 2.0)
    return m


def demand(**kwargs):
    df = zones()
    return sr.synthesize_demand(df, skim(), [], Path("/tmp"), **kwargs)


class PersonTripsAreDividedByOccupancy(unittest.TestCase):
    def setUp(self) -> None:
        # synthesize_demand writes package files; give it somewhere harmless.
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_demand(self, convert: bool):
        return sr.synthesize_demand(
            zones(), skim(), [], self.out, convert_person_trips_to_vehicles=convert
        )

    def test_converting_puts_fewer_vehicles_on_the_network(self) -> None:
        persons = self.run_demand(convert=False)
        vehicles = self.run_demand(convert=True)
        self.assertLess(vehicles["matrix"].sum(), persons["matrix"].sum())

    def test_the_reduction_matches_the_published_occupancies(self) -> None:
        # Not "smaller" — smaller by the right amount. A conversion applied to
        # one purpose, or applied twice, is still smaller.
        persons = self.run_demand(convert=False)
        vehicles = self.run_demand(convert=True)
        p, v = persons["summary"], vehicles["summary"]
        expected = (
            p["hbw_trips"] / sr.VEHICLE_OCCUPANCY["hbw"]
            + p["hbo_trips"] / sr.VEHICLE_OCCUPANCY["hbo"]
            + p["nhb_trips"] / sr.VEHICLE_OCCUPANCY["nhb"]
        )
        got = v["hbw_trips"] + v["hbo_trips"] + v["nhb_trips"]
        self.assertAlmostEqual(got, expected, delta=max(expected * 1e-4, 1e-4))

    def test_work_trips_are_divided_least(self) -> None:
        # Commuting is the least shared purpose in the NHTS table (1.08 against
        # 1.72 and 1.52). A single average occupancy would erase that.
        self.assertLess(sr.VEHICLE_OCCUPANCY["hbw"], sr.VEHICLE_OCCUPANCY["nhb"])
        self.assertLess(sr.VEHICLE_OCCUPANCY["nhb"], sr.VEHICLE_OCCUPANCY["hbo"])

    def test_every_occupancy_is_at_least_one_person_per_car(self) -> None:
        # Below 1.0 would ADD vehicles, which no carpooling can do.
        for purpose, occupancy in sr.VEHICLE_OCCUPANCY.items():
            self.assertGreaterEqual(occupancy, 1.0, purpose)

    def test_the_run_records_the_conversion_it_applied(self) -> None:
        # It is the single number scaling the whole internal demand; a reader
        # comparing two runs is entitled to see it rather than infer it.
        applied = self.run_demand(convert=True)["summary"]["trip_rates"]["vehicle_occupancy_applied"]
        self.assertEqual(applied, sr.VEHICLE_OCCUPANCY)
        self.assertIsNone(
            self.run_demand(convert=False)["summary"]["trip_rates"]["vehicle_occupancy_applied"]
        )

    def test_it_is_on_by_default_because_it_is_a_unit_error(self) -> None:
        self.assertTrue(sr.CONVERT_PERSON_TRIPS_TO_VEHICLES)


if __name__ == "__main__":
    unittest.main(verbosity=1)
