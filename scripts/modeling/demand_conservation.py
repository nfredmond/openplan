#!/usr/bin/env python3
"""Fail-closed accounting from generated person trips through reported VMT."""
from __future__ import annotations

import csv
import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Mapping

from screening_metrics import METERS_PER_MILE
SCHEMA_VERSION = "openplan.demand-conservation.v1"


class DemandConservationError(RuntimeError):
    """A run lost, duplicated, or mislabeled demand between model stages."""


def _number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise DemandConservationError(f"Conservation value {label} is missing or non-numeric.") from exc
    if not math.isfinite(number):
        raise DemandConservationError(f"Conservation value {label} is not finite.")
    return number


def _check(
    checks: list[dict[str, Any]],
    code: str,
    left: float,
    right: float,
    *,
    tolerance: float,
) -> None:
    difference = left - right
    passed = math.isclose(left, right, rel_tol=0.0, abs_tol=tolerance)
    checks.append(
        {
            "code": code,
            "passed": passed,
            "left": round(left, 6),
            "right": round(right, 6),
            "difference": round(difference, 6),
            "tolerance": tolerance,
        }
    )


def recompute_network_vmt(project_db: Path, link_volumes_csv: Path) -> float:
    """Read the serialized assignment artifacts and independently total VMT."""
    with sqlite3.connect(project_db) as connection:
        distances = {
            int(link_id): float(distance or 0.0)
            for link_id, distance in connection.execute("SELECT link_id, distance FROM links")
        }
    total = 0.0
    with Path(link_volumes_csv).open(newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                link_id = int(float(row["link_id"]))
                volume = float(row["PCE_tot"])
                distance = distances[link_id]
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(volume) and math.isfinite(distance) and volume > 0 and distance > 0:
                total += volume * distance / METERS_PER_MILE
    return total


def build_conservation_record(
    accounting: Mapping[str, Any],
    assignment: Mapping[str, Any],
    *,
    recomputed_network_vmt: float,
    trip_tolerance: float = 0.05,
    vmt_tolerance: float = 0.11,
) -> dict[str, Any]:
    """Build every registered equality and refuse an incomplete chain."""
    person_trips = _number(accounting.get("person_trips"), "person_trips")
    non_auto = _number(accounting.get("non_auto_person_trips"), "non_auto_person_trips")
    unassigned = _number(accounting.get("unassigned_person_trips"), "unassigned_person_trips")
    auto_person = _number(accounting.get("auto_person_trips"), "auto_person_trips")
    internal_before = _number(
        accounting.get("internal_vehicle_trips_before_reachability"),
        "internal_vehicle_trips_before_reachability",
    )
    internal_dropped = _number(
        accounting.get("internal_vehicle_trips_dropped_unreachable"),
        "internal_vehicle_trips_dropped_unreachable",
    )
    internal = _number(accounting.get("internal_vehicle_trips"), "internal_vehicle_trips")
    external_before = _number(
        accounting.get("external_vehicle_trips_before_reachability"),
        "external_vehicle_trips_before_reachability",
    )
    external_dropped = _number(
        accounting.get("external_vehicle_trips_dropped_unreachable"),
        "external_vehicle_trips_dropped_unreachable",
    )
    external = _number(accounting.get("external_vehicle_trips"), "external_vehicle_trips")
    daily = _number(accounting.get("daily_assignment_vehicle_trips"), "daily_assignment_vehicle_trips")
    period_factor = _number((assignment.get("demand") or {}).get("peak_hour_factor"), "peak_hour_factor")
    period = _number((assignment.get("demand") or {}).get("period_total_trips"), "period_total_trips")
    assignment_daily = _number((assignment.get("demand") or {}).get("total_trips"), "assignment_total_trips")
    reported_vmt = _number(assignment.get("network_daily_vehicle_miles"), "network_daily_vehicle_miles")
    recomputed_vmt = _number(recomputed_network_vmt, "recomputed_network_vmt")

    checks: list[dict[str, Any]] = []
    _check(
        checks,
        "person_trips_split_into_auto_non_auto_and_unassigned",
        person_trips,
        auto_person + non_auto + unassigned,
        tolerance=trip_tolerance,
    )
    _check(checks, "internal_reachability_losses_accounted", internal_before, internal + internal_dropped, tolerance=trip_tolerance)
    _check(checks, "external_reachability_losses_accounted", external_before, external + external_dropped, tolerance=trip_tolerance)
    _check(checks, "daily_matrix_is_internal_plus_external", daily, internal + external, tolerance=trip_tolerance)
    _check(checks, "period_matrix_uses_registered_factor", period, daily * period_factor, tolerance=trip_tolerance)
    _check(checks, "assignment_reads_the_daily_matrix", assignment_daily, daily, tolerance=trip_tolerance)
    _check(checks, "reported_vmt_matches_serialized_links", reported_vmt, recomputed_vmt, tolerance=vmt_tolerance)

    conversion = dict(accounting.get("vehicle_conversion") or {})
    if conversion.get("method") == "purpose_average_occupancy":
        people_by_purpose = conversion.get("person_trips_by_purpose") or {}
        vehicles_by_purpose = conversion.get("vehicle_trips_by_purpose") or {}
        occupancies = conversion.get("occupancy") or {}
        converted_people = sum(
            _number(vehicles_by_purpose.get(purpose), f"vehicle_trips_by_purpose.{purpose}")
            * _number(occupancies.get(purpose), f"occupancy.{purpose}")
            for purpose in ("hbw", "hbo", "nhb")
        )
        _check(checks, "vehicle_conversion_preserves_auto_person_trips", auto_person, converted_people, tolerance=trip_tolerance)
        _check(
            checks,
            "purpose_person_total_matches_auto_person_trips",
            auto_person,
            sum(_number(people_by_purpose.get(purpose), f"person_trips_by_purpose.{purpose}") for purpose in ("hbw", "hbo", "nhb")),
            tolerance=trip_tolerance,
        )
    elif conversion.get("method") == "producer_preconverted_vehicle_matrix":
        producer = conversion.get("producer_record") or {}
        producer_vehicles = _number(producer.get("vehicle_trips"), "producer_record.vehicle_trips")
        scalar = _number(accounting.get("overall_demand_scalar"), "overall_demand_scalar")
        _check(
            checks,
            "producer_vehicle_total_reaches_internal_matrix",
            producer_vehicles * scalar,
            internal_before,
            tolerance=max(trip_tolerance, 0.02 * max(1.0, producer_vehicles)),
        )
    elif conversion.get("method") == "none_all_auto_person_trips_assigned_as_vehicles":
        _check(checks, "all_auto_person_trips_become_vehicles", auto_person, internal_before, tolerance=trip_tolerance)
    else:
        raise DemandConservationError("Vehicle-conversion method is missing or unsupported.")

    failed = [check["code"] for check in checks if not check["passed"]]
    record = {
        "schema_version": SCHEMA_VERSION,
        "status": "passed" if not failed else "failed",
        "chain": [
            "person_trips",
            "vehicle_conversion",
            "internal_demand",
            "external_demand",
            "period_totals",
            "assignment_totals",
            "reported_vmt",
        ],
        "accounting": dict(accounting),
        "assignment": {
            "daily_vehicle_trips": assignment_daily,
            "period_factor": period_factor,
            "period_vehicle_trips": period,
            "reported_network_vmt": reported_vmt,
            "recomputed_network_vmt": recomputed_vmt,
        },
        "checks": checks,
        "failed_checks": failed,
    }
    if failed:
        raise DemandConservationError(
            "Demand conservation failed: " + ", ".join(failed)
        )
    return record


def write_conservation_record(record: Mapping[str, Any], output_path: Path) -> None:
    if record.get("status") != "passed" or record.get("failed_checks"):
        raise DemandConservationError("Refusing to write a non-passing conservation record.")
    Path(output_path).write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
