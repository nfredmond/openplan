#!/usr/bin/env python3
"""The full trip-to-VMT accounting chain, including failure probes."""
from __future__ import annotations

import csv
import inspect
import sqlite3
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from demand_conservation import (  # noqa: E402
    DemandConservationError,
    build_conservation_record,
    recompute_network_vmt,
)
from screening_metrics import METERS_PER_MILE, compute_network_daily_vmt  # noqa: E402
import demand_conservation as conservation_module  # noqa: E402


def accounting() -> dict:
    return {
        "input_unit": "person_trips",
        "person_trips": 180.0,
        "non_auto_person_trips": 30.0,
        "unassigned_person_trips": 0.0,
        "auto_person_trips": 150.0,
        "vehicle_conversion": {
            "method": "purpose_average_occupancy",
            "occupancy": {"hbw": 1.2, "hbo": 1.5, "nhb": 1.25},
            "person_trips_by_purpose": {"hbw": 60.0, "hbo": 45.0, "nhb": 45.0},
            "vehicle_trips_by_purpose": {"hbw": 50.0, "hbo": 30.0, "nhb": 36.0},
        },
        "internal_vehicle_trips_before_reachability": 116.0,
        "internal_vehicle_trips_dropped_unreachable": 1.0,
        "internal_vehicle_trips": 115.0,
        "external_vehicle_trips_before_reachability": 40.0,
        "external_vehicle_trips_dropped_unreachable": 5.0,
        "external_vehicle_trips": 35.0,
        "daily_assignment_vehicle_trips": 150.0,
        "overall_demand_scalar": 1.0,
    }


def assignment() -> dict:
    return {
        "demand": {
            "total_trips": 150.0,
            "peak_hour_factor": 0.1,
            "period_total_trips": 15.0,
        },
        "network_daily_vehicle_miles": 987.6,
    }


class FullChainConservation(unittest.TestCase):
    def test_balanced_chain_passes_and_names_every_stage(self) -> None:
        record = build_conservation_record(accounting(), assignment(), recomputed_network_vmt=987.6)
        self.assertEqual(record["status"], "passed")
        self.assertEqual(
            record["chain"],
            [
                "person_trips",
                "vehicle_conversion",
                "internal_demand",
                "external_demand",
                "period_totals",
                "assignment_totals",
                "reported_vmt",
            ],
        )
        self.assertTrue(all(check["passed"] for check in record["checks"]))

    def assert_stage_fails(self, section: str, field: str, code: str) -> None:
        account = accounting()
        assig = assignment()
        target = account if section == "accounting" else assig["demand"]
        target[field] = float(target[field]) + 1.0
        with self.assertRaisesRegex(DemandConservationError, code):
            build_conservation_record(account, assig, recomputed_network_vmt=987.6)

    def test_person_trip_loss_fails(self) -> None:
        self.assert_stage_fails(
            "accounting", "person_trips", "person_trips_split_into_auto_non_auto_and_unassigned"
        )

    def test_internal_demand_loss_fails(self) -> None:
        self.assert_stage_fails(
            "accounting", "internal_vehicle_trips", "internal_reachability_losses_accounted"
        )

    def test_external_demand_loss_fails(self) -> None:
        self.assert_stage_fails(
            "accounting", "external_vehicle_trips_before_reachability", "external_reachability_losses_accounted"
        )

    def test_daily_total_loss_fails(self) -> None:
        self.assert_stage_fails(
            "accounting", "daily_assignment_vehicle_trips", "daily_matrix_is_internal_plus_external"
        )

    def test_period_total_loss_fails(self) -> None:
        self.assert_stage_fails("assignment", "period_total_trips", "period_matrix_uses_registered_factor")

    def test_assignment_total_loss_fails(self) -> None:
        self.assert_stage_fails("assignment", "total_trips", "assignment_reads_the_daily_matrix")

    def test_reported_vmt_loss_fails(self) -> None:
        with self.assertRaisesRegex(DemandConservationError, "reported_vmt_matches_serialized_links"):
            build_conservation_record(accounting(), assignment(), recomputed_network_vmt=980.0)

    def test_vehicle_conversion_loss_fails(self) -> None:
        account = accounting()
        account["vehicle_conversion"]["vehicle_trips_by_purpose"]["hbw"] += 1
        with self.assertRaisesRegex(DemandConservationError, "vehicle_conversion_preserves_auto_person_trips"):
            build_conservation_record(account, assignment(), recomputed_network_vmt=987.6)

    def test_the_real_driver_calls_the_fail_closed_audit_before_publishing(self) -> None:
        import screening_runtime

        source = inspect.getsource(screening_runtime.run_screening_model)
        code_only = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        audit_at = code_only.find("conservation_record = build_conservation_record(")
        manifest_at = code_only.find("manifest = write_bundle_outputs(")
        self.assertGreaterEqual(audit_at, 0, "the run no longer drives the conservation audit")
        self.assertGreater(manifest_at, audit_at, "the run publishes before conservation is proven")
        self.assertIn("recompute_network_vmt(", code_only[audit_at:manifest_at])


class SerializedVmtRecalculation(unittest.TestCase):
    def test_both_vmt_paths_use_the_exact_international_mile(self) -> None:
        self.assertEqual(METERS_PER_MILE, 1609.344)
        self.assertEqual(conservation_module.METERS_PER_MILE, METERS_PER_MILE)

    def test_reads_link_lengths_and_written_daily_volumes(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            database = root / "project.sqlite"
            volumes = root / "link_volumes.csv"
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE links (link_id INTEGER, distance REAL)")
                connection.executemany(
                    "INSERT INTO links VALUES (?, ?)",
                    [(1, METERS_PER_MILE), (2, METERS_PER_MILE / 2)],
                )
            with volumes.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["link_id", "PCE_tot"])
                writer.writeheader()
                writer.writerows([{"link_id": 1, "PCE_tot": 100}, {"link_id": 2, "PCE_tot": 40}])
            self.assertAlmostEqual(recompute_network_vmt(database, volumes), 120.0)

    def test_reported_and_serialized_vmt_share_one_exact_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            database = root / "project.sqlite"
            volumes = root / "link_volumes.csv"
            distance = 9972082431.773428 / 100000.0
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE links (link_id INTEGER, distance REAL)")
                connection.execute("INSERT INTO links VALUES (?, ?)", (1, distance))
            with volumes.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["link_id", "PCE_tot"])
                writer.writeheader()
                writer.writerow({"link_id": 1, "PCE_tot": 100000})
            reported = round(compute_network_daily_vmt([100000], [distance]), 1)
            recomputed = recompute_network_vmt(database, volumes)
            self.assertLessEqual(abs(reported - recomputed), 0.05)


if __name__ == "__main__":
    unittest.main()
