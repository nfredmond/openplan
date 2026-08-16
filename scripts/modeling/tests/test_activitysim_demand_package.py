#!/usr/bin/env python3
"""Reducing a trip list to a matrix: every way it comes out quietly too small.

WHY THE ACCOUNTING IS THE POINT
===============================
This converter's failures do not raise. A mode name it does not recognise, a
zone id outside the package, an occupancy applied in the wrong direction — each
produces a well-formed square matrix, an assignment that converges, and a
comparison that reports the two demand models disagreeing. The disagreement
would be real and would be about nothing but this file.

The one that would be hardest to notice is occupancy. Three people sharing a car
are three person-trips and one vehicle. Skip the division and every link carries
roughly 1.6 times too much traffic — a difference well inside the range where
"the activity-based model produces more traffic" sounds like a finding.
"""
from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from activitysim_demand_package import (  # noqa: E402
    ActivitySimDemandError,
    build_activitysim_demand_package,
    internal_zone_rows,
    occupancy_for_mode,
    vehicle_trip_matrix,
)


def zone(zone_id: int, kind: str = "internal") -> dict:
    return {
        "zone_id": zone_id,
        "GEOID": f"0605700010{zone_id}",
        "NAMELSAD": f"Tract {zone_id}",
        "centroid_lon": -121.0,
        "centroid_lat": 39.3,
        "area_sq_mi": 4.0,
        "est_population": 1000,
        "households": 400,
        "total_jobs": 200,
        "zone_kind": kind,
    }


def trip(origin: int, destination: int, mode: str) -> dict:
    return {"trip_mode": mode, "origin": str(origin), "destination": str(destination)}


class HowManyVehiclesAPersonTripIs(unittest.TestCase):
    def test_drive_alone_is_one_vehicle(self) -> None:
        self.assertEqual(occupancy_for_mode("DRIVEALONEFREE"), 1.0)
        self.assertEqual(occupancy_for_mode("DRIVEALONEPAY"), 1.0)

    def test_shared_rides_carry_their_occupancy(self) -> None:
        self.assertEqual(occupancy_for_mode("SHARED2FREE"), 2.0)
        self.assertEqual(occupancy_for_mode("SHARED3PAY"), 3.25)

    def test_walk_bike_and_transit_put_no_vehicle_on_the_road(self) -> None:
        for mode in ("WALK", "BIKE", "WALK_LOC", "DRIVE_LOC", "SCHOOLBUS"):
            self.assertEqual(occupancy_for_mode(mode), 0.0, mode)

    def test_a_mode_in_neither_list_is_reported_not_assumed(self) -> None:
        # The distinction that matters: 0.0 means "no vehicle", None means
        # "this converter does not know", and only one of those is safe to
        # treat as zero traffic.
        self.assertIsNone(occupancy_for_mode("HOVERBOARD"))
        self.assertIsNone(occupancy_for_mode(""))


class ReducingPersonTripsToVehicleTrips(unittest.TestCase):
    def test_a_shared_ride_of_two_is_half_a_vehicle_each(self) -> None:
        # THE CONVERSION THAT DECIDES THE ANSWER. Four people carpooling in
        # pairs are four person-trips and two vehicles.
        rows = [trip(1, 2, "SHARED2FREE") for _ in range(4)]
        matrix, accounting = vehicle_trip_matrix(rows, [1, 2])

        self.assertAlmostEqual(matrix[0][1], 2.0)
        self.assertEqual(accounting["person_trips"], 4)
        self.assertAlmostEqual(accounting["vehicle_trips"], 2.0)

    def test_drive_alone_trips_are_not_divided(self) -> None:
        rows = [trip(1, 2, "DRIVEALONEFREE") for _ in range(4)]
        matrix, accounting = vehicle_trip_matrix(rows, [1, 2])
        self.assertAlmostEqual(matrix[0][1], 4.0)
        self.assertAlmostEqual(accounting["vehicle_trips"], 4.0)

    def test_direction_is_preserved(self) -> None:
        # A transposed matrix assigns every trip backwards. On a symmetric
        # network the totals barely move and the corridor answer is wrong.
        matrix, _ = vehicle_trip_matrix([trip(1, 2, "DRIVEALONEFREE")], [1, 2])
        self.assertAlmostEqual(matrix[0][1], 1.0)
        self.assertAlmostEqual(matrix[1][0], 0.0)

    def test_intrazonal_trips_land_on_the_diagonal(self) -> None:
        matrix, _ = vehicle_trip_matrix([trip(2, 2, "DRIVEALONEFREE")], [1, 2])
        self.assertAlmostEqual(matrix[1][1], 1.0)

    def test_the_matrix_is_indexed_by_position_not_by_zone_id(self) -> None:
        # Zone ids are not row numbers. Treating id 7 as index 7 either crashes
        # or, with enough zones, silently writes the trip into another zone's row.
        matrix, accounting = vehicle_trip_matrix([trip(7, 3, "DRIVEALONEFREE")], [3, 7])
        self.assertAlmostEqual(matrix[1][0], 1.0)
        self.assertAlmostEqual(accounting["vehicle_trips"], 1.0)

    def test_non_auto_trips_are_counted_out_loud(self) -> None:
        rows = [trip(1, 2, "WALK"), trip(1, 2, "DRIVEALONEFREE")]
        matrix, accounting = vehicle_trip_matrix(rows, [1, 2])
        self.assertAlmostEqual(matrix[0][1], 1.0)
        self.assertEqual(accounting["non_auto_person_trips"], 1)
        self.assertIn("walk, bike or transit", accounting["note"])

    def test_an_unrecognised_mode_is_named_in_the_accounting(self) -> None:
        # Without this, a configuration that spells its modes differently
        # produces a nearly empty matrix, an assignment that converges, and the
        # conclusion that the activity-based model generates almost no traffic.
        rows = [trip(1, 2, "CAR_POOL_2"), trip(1, 2, "DRIVEALONEFREE")]
        _, accounting = vehicle_trip_matrix(rows, [1, 2])

        self.assertEqual(accounting["unrecognised_modes"], {"CAR_POOL_2": 1})
        self.assertIn("CAR_POOL_2", accounting["note"])
        self.assertIn("missing traffic it generated", accounting["note"])

    def test_a_trip_outside_the_zone_system_is_counted_not_dropped(self) -> None:
        rows = [trip(1, 99, "DRIVEALONEFREE"), trip(1, 2, "DRIVEALONEFREE")]
        _, accounting = vehicle_trip_matrix(rows, [1, 2])
        self.assertEqual(accounting["person_trips_outside_the_zone_system"], 1)
        self.assertIn("outside this study area", accounting["note"])

    def test_an_unreadable_zone_is_counted_separately(self) -> None:
        rows = [{"trip_mode": "DRIVEALONEFREE", "origin": "", "destination": "2"}]
        _, accounting = vehicle_trip_matrix(rows, [1, 2])
        self.assertEqual(accounting["person_trips_with_an_unreadable_zone"], 1)

    def test_the_occupancies_used_travel_with_the_result(self) -> None:
        # They are assumptions, and they scale one of the two models being
        # compared. A reader is entitled to see them next to the numbers.
        _, accounting = vehicle_trip_matrix([trip(1, 2, "SHARED2FREE")], [1, 2])
        self.assertEqual(accounting["occupancy_applied"]["SHARED2"], 2.0)
        self.assertEqual(accounting["occupancy_applied"]["DRIVEALONE"], 1.0)

    def test_alternative_column_spellings_are_accepted(self) -> None:
        rows = [{"tour_mode": "DRIVEALONEFREE", "otaz": "1", "dtaz": "2"}]
        matrix, _ = vehicle_trip_matrix(rows, [1, 2])
        self.assertAlmostEqual(matrix[0][1], 1.0)

    def test_a_trip_table_with_no_mode_column_is_refused_by_name(self) -> None:
        with self.assertRaises(ActivitySimDemandError) as caught:
            vehicle_trip_matrix([{"origin": "1", "destination": "2"}], [1, 2])
        self.assertIn("trip mode", str(caught.exception))


class WhichZonesThePackageDescribes(unittest.TestCase):
    def test_cordon_zones_are_excluded(self) -> None:
        # The assignment half adds its own cordons; a package that declares one
        # is refused outright by the contract, not trimmed.
        zones = internal_zone_rows(
            [zone(1), zone(2, "external"), zone(3), zone(4, "cordon"), zone(5, "gateway")]
        )
        self.assertEqual([z["zone_id"] for z in zones], [1, 3])

    def test_zones_come_out_in_id_order(self) -> None:
        # The matrix rows are written in this order and the contract compares it
        # against the zone table position by position.
        zones = internal_zone_rows([zone(9), zone(2), zone(5)])
        self.assertEqual([z["zone_id"] for z in zones], [2, 5, 9])

    def test_a_zone_table_of_nothing_but_cordons_is_refused(self) -> None:
        with self.assertRaises(ActivitySimDemandError):
            internal_zone_rows([zone(1, "external")])


class TheWholePackage(unittest.TestCase):
    def _build(self, trips: list[dict], zones: list[dict]) -> tuple[Path, dict]:
        workspace = Path(tempfile.mkdtemp())
        trips_csv = workspace / "final_trips.csv"
        with trips_csv.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(trips[0]))
            writer.writeheader()
            writer.writerows(trips)
        result = build_activitysim_demand_package(
            trips_csv=trips_csv, zone_rows=zones, output_dir=workspace / "package"
        )
        return workspace / "package", result

    def test_the_package_it_writes_is_one_the_contract_accepts(self) -> None:
        # THE TEST THAT MATTERS MOST. This converter's only job is to produce
        # something `demand_package.py` will read — and that module refuses a
        # matrix whose labels do not line up with its zone table, which is
        # exactly the mistake a hand-rolled writer makes.
        from demand_package import read_demand_package

        package_dir, _ = self._build(
            [trip(1, 2, "DRIVEALONEFREE"), trip(2, 1, "SHARED2FREE")],
            [zone(1), zone(2), zone(3, "external")],
        )
        package = read_demand_package(package_dir)

        self.assertEqual(len(package["zones"]), 2)
        self.assertAlmostEqual(float(package["matrix"].sum()), 1.5)

    def test_the_producer_manifest_records_the_conversion(self) -> None:
        package_dir, result = self._build(
            [trip(1, 2, "SHARED2FREE"), trip(1, 2, "WALK")], [zone(1), zone(2)]
        )
        manifest = json.loads((package_dir / "manifest.json").read_text())

        self.assertEqual(manifest["demand_source"], "activitysim_trip_table")
        self.assertEqual(manifest["conversion"]["non_auto_person_trips"], 1)
        self.assertAlmostEqual(manifest["conversion"]["vehicle_trips"], 0.5)
        self.assertIn("attributable to the demand model", manifest["method_note"])

    def test_a_trip_list_with_no_vehicle_trips_is_refused(self) -> None:
        # Assigning it would produce an empty network and a comparison
        # concluding the activity-based model generates no traffic at all.
        with self.assertRaises(ActivitySimDemandError) as caught:
            self._build([trip(1, 2, "WALK")], [zone(1), zone(2)])
        self.assertIn("empty network", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
