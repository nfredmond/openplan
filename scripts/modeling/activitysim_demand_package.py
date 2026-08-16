#!/usr/bin/env python3
"""Turn an ActivitySim trip list into a demand package the same assignment reads.

=========================================================== WHY THIS EXISTS

The comparison Nathaniel asked for holds the network and the assignment constant
and varies only the demand model. That only works if both demand models hand the
assignment the *same kind of thing*: a zone table and a square matrix of daily
vehicle trips, in the format `demand_package.py` already defines.

Lane A's gravity model produces that directly. ActivitySim produces something
richer and differently shaped — one row per person-trip, with a purpose, a mode
and a departure time. This file is the reduction: person-trips to vehicle-trips,
trip rows to an origin-destination matrix, and nothing else.

Reduction, not translation. Everything ActivitySim knows that the assignment
cannot use — purpose, time of day, who made the trip — is dropped here and stays
available in the trip table it came from. What must not happen is this file
quietly inventing anything the trip list did not say.

============================================ THE CONVERSION THAT DECIDES THE ANSWER

**Person-trips are not vehicle trips.** Three people sharing a car make three
person-trips and put one vehicle on the road. Assigning ActivitySim's trip list
without dividing by occupancy would put roughly 1.6 times too many vehicles on
every link, and the comparison would report the demand models disagreeing when
what actually differed was the unit.

So each mode carries an explicit occupancy, and the occupancies are reported with
the result rather than buried here. They are assumptions, and a reader comparing
two models is entitled to see the one number that scales one of them.

**A mode this file does not recognise is reported, never guessed.** ActivitySim
configurations name their modes, and a study area whose configuration spells them
differently would otherwise produce a matrix that is quietly almost empty — every
trip dropped as "not an auto mode", an assignment that converges, and a
comparison that concludes the activity-based model generates almost no traffic.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

# Average vehicle occupancy by mode. The shared-ride-3+ figure is a category
# average rather than a count: the category holds 3-person and larger carpools,
# and 3.25 is the value ActivitySim's own example configurations use for it.
#
# Matched by PREFIX after upper-casing, because the standard mode names carry
# cost suffixes (DRIVEALONEFREE, DRIVEALONEPAY, SHARED2FREE…) that do not change
# how many people are in the car.
AUTO_MODE_OCCUPANCY: tuple[tuple[str, float], ...] = (
    ("DRIVEALONE", 1.0),
    ("SHARED2", 2.0),
    ("SHARED3", 3.25),
    ("TNC_SINGLE", 1.0),
    ("TNC_SHARED", 2.0),
    ("TAXI", 1.0),
)

# Modes that put no vehicle of their own on the road being assigned. Listed
# explicitly rather than treated as "everything else", so that a mode belonging
# to neither list is a reported unknown instead of a silent zero.
NON_AUTO_MODE_PREFIXES: tuple[str, ...] = (
    "WALK",
    "BIKE",
    "DRIVE_LOC",
    "DRIVE_LRF",
    "DRIVE_EXP",
    "DRIVE_HVY",
    "DRIVE_COM",
    "TRANSIT",
    "SCHOOLBUS",
)

TRIP_MODE_COLUMNS = ("trip_mode", "tour_mode", "mode")
ORIGIN_COLUMNS = ("origin", "orig_taz", "otaz", "origin_zone_id")
DESTINATION_COLUMNS = ("destination", "dest_taz", "dtaz", "destination_zone_id")


class ActivitySimDemandError(ValueError):
    """The trip list cannot be reduced to a matrix, with the reason to show."""


def _first_present(row: Mapping[str, Any], candidates: Sequence[str]) -> str | None:
    for candidate in candidates:
        if candidate in row:
            return candidate
    return None


def occupancy_for_mode(mode: str) -> float | None:
    """Vehicles per person-trip for this mode, or None if it is not recognised.

    Returns 0.0 for a mode that puts no vehicle on the assigned network, and
    None — meaning "say so" — for anything in neither list.
    """
    normalized = str(mode or "").strip().upper()
    if not normalized:
        return None
    for prefix, occupancy in AUTO_MODE_OCCUPANCY:
        if normalized.startswith(prefix):
            return occupancy
    for prefix in NON_AUTO_MODE_PREFIXES:
        if normalized.startswith(prefix):
            return 0.0
    return None


def read_trip_rows(trips_csv: Path) -> list[dict[str, str]]:
    if not trips_csv.exists():
        raise ActivitySimDemandError(f"No ActivitySim trip table at {trips_csv}")
    with trips_csv.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ActivitySimDemandError(f"{trips_csv} has no trips in it")
    return rows


def vehicle_trip_matrix(
    trip_rows: Sequence[Mapping[str, Any]], zone_ids: Sequence[int]
) -> tuple[list[list[float]], dict[str, Any]]:
    """Reduce person-trips to a square matrix of daily vehicle trips.

    Returns the matrix and an accounting of every trip that did NOT reach it.
    The accounting is not optional decoration: each of its categories is a way
    the matrix can come out far too small while looking perfectly well-formed.
    """
    first = trip_rows[0]
    mode_column = _first_present(first, TRIP_MODE_COLUMNS)
    origin_column = _first_present(first, ORIGIN_COLUMNS)
    destination_column = _first_present(first, DESTINATION_COLUMNS)
    missing = [
        name
        for name, column in (
            ("trip mode", mode_column),
            ("origin zone", origin_column),
            ("destination zone", destination_column),
        )
        if column is None
    ]
    if missing:
        raise ActivitySimDemandError(
            f"The trip table has no {', '.join(missing)} column. Columns present: "
            f"{', '.join(sorted(first))}."
        )

    index_of = {int(zone_id): position for position, zone_id in enumerate(zone_ids)}
    matrix = [[0.0] * len(zone_ids) for _ in zone_ids]

    person_trips = 0
    vehicle_trips = 0.0
    modes_seen: dict[str, int] = {}
    unrecognised_modes: dict[str, int] = {}
    non_auto_trips = 0
    outside_zone_system = 0
    unreadable_zone = 0

    for row in trip_rows:
        person_trips += 1
        mode = str(row.get(mode_column) or "").strip()
        modes_seen[mode] = modes_seen.get(mode, 0) + 1
        occupancy = occupancy_for_mode(mode)
        if occupancy is None:
            unrecognised_modes[mode] = unrecognised_modes.get(mode, 0) + 1
            continue
        if occupancy == 0.0:
            non_auto_trips += 1
            continue
        try:
            origin = int(float(row.get(origin_column)))
            destination = int(float(row.get(destination_column)))
        except (TypeError, ValueError):
            unreadable_zone += 1
            continue
        if origin not in index_of or destination not in index_of:
            outside_zone_system += 1
            continue
        vehicles = 1.0 / occupancy
        matrix[index_of[origin]][index_of[destination]] += vehicles
        vehicle_trips += vehicles

    accounting = {
        "person_trips": person_trips,
        "vehicle_trips": round(vehicle_trips, 3),
        "non_auto_person_trips": non_auto_trips,
        "person_trips_outside_the_zone_system": outside_zone_system,
        "person_trips_with_an_unreadable_zone": unreadable_zone,
        "unrecognised_modes": dict(sorted(unrecognised_modes.items())),
        "modes_seen": dict(sorted(modes_seen.items())),
        "occupancy_applied": {prefix: occupancy for prefix, occupancy in AUTO_MODE_OCCUPANCY},
        "note": _accounting_note(
            person_trips, vehicle_trips, non_auto_trips, outside_zone_system, unrecognised_modes
        ),
    }
    return matrix, accounting


def _accounting_note(
    person_trips: int,
    vehicle_trips: float,
    non_auto_trips: int,
    outside_zone_system: int,
    unrecognised_modes: Mapping[str, int],
) -> str:
    parts = [
        f"{person_trips:,} person-trips became {vehicle_trips:,.0f} vehicle trips after dividing "
        "shared rides by their occupancy."
    ]
    if non_auto_trips:
        parts.append(
            f"{non_auto_trips:,} were walk, bike or transit trips, which put no vehicle on the "
            "network being assigned."
        )
    if outside_zone_system:
        parts.append(
            f"{outside_zone_system:,} began or ended outside this study area's zones and could not "
            "be assigned."
        )
    if unrecognised_modes:
        total = sum(unrecognised_modes.values())
        parts.append(
            f"{total:,} trips used {len(unrecognised_modes)} mode name(s) this converter does not "
            f"recognise ({', '.join(sorted(unrecognised_modes))}) and were left out of the matrix "
            "entirely. Compare the two models only after resolving this: the activity-based lane is "
            "missing traffic it generated."
        )
    return " ".join(parts)


def internal_zone_rows(zone_rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The zones a demand package may describe: internal ones, in id order.

    Cordons are excluded because the assignment half adds its own — a package
    that declares one is refused by `demand_package.py`, not trimmed.
    """
    kept = [
        row
        for row in zone_rows
        if str(row.get("zone_kind") or "internal").strip().lower() not in ("external", "cordon", "gateway")
    ]
    if not kept:
        raise ActivitySimDemandError(
            "The zone table has no internal zones, so there is nothing to build a package around."
        )
    return sorted(kept, key=lambda row: int(float(row["zone_id"])))


PACKAGE_ZONE_COLUMNS = (
    "zone_id",
    "GEOID",
    "NAMELSAD",
    "centroid_lon",
    "centroid_lat",
    "area_sq_mi",
    "est_population",
    "households",
    "total_jobs",
    "zone_kind",
)


def write_demand_package(
    output_dir: Path,
    zone_rows: Sequence[Mapping[str, Any]],
    matrix: Sequence[Sequence[float]],
    manifest: Mapping[str, Any],
) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    zone_path = output_dir / "zone_attributes.csv"
    matrix_path = output_dir / "od_trip_matrix.csv"
    manifest_path = output_dir / "manifest.json"

    with zone_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(PACKAGE_ZONE_COLUMNS))
        writer.writeheader()
        for row in zone_rows:
            writer.writerow({column: row.get(column, "") for column in PACKAGE_ZONE_COLUMNS})

    zone_ids = [int(float(row["zone_id"])) for row in zone_rows]
    with matrix_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([""] + zone_ids)
        for zone_id, matrix_row in zip(zone_ids, matrix):
            writer.writerow([zone_id] + [f"{value:.2f}" for value in matrix_row])

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return {
        "zone_attributes": str(zone_path),
        "od_trip_matrix": str(matrix_path),
        "manifest": str(manifest_path),
    }


def build_activitysim_demand_package(
    *,
    trips_csv: Path,
    zone_rows: Sequence[Mapping[str, Any]],
    output_dir: Path,
    source: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """The whole reduction, in the order it has to happen."""
    zones = internal_zone_rows(zone_rows)
    zone_ids = [int(float(row["zone_id"])) for row in zones]
    trip_rows = read_trip_rows(trips_csv)
    matrix, accounting = vehicle_trip_matrix(trip_rows, zone_ids)

    if accounting["vehicle_trips"] <= 0:
        raise ActivitySimDemandError(
            "No vehicle trips could be read from this trip table, so assigning it would produce an "
            f"empty network. {accounting['note']}"
        )

    manifest = {
        "schema_version": "openplan.demand_package.v0",
        "demand_source": "activitysim_trip_table",
        "producer": "scripts/modeling/activitysim_demand_package.py",
        "zones": len(zones),
        "conversion": accounting,
        "source": dict(source or {}),
        "method_note": (
            "Daily vehicle trips reduced from an ActivitySim person-trip list. Assigning this with "
            "the same network and the same assignment settings the trip-based lane used makes any "
            "difference in link volumes attributable to the demand model and nothing else."
        ),
    }
    files = write_demand_package(output_dir, zones, matrix, manifest)
    return {
        "output_dir": str(output_dir),
        "files": files,
        "zones": len(zones),
        "conversion": accounting,
    }


def read_zone_rows_from_csv(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise ActivitySimDemandError(f"No zone table at {path}")
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ActivitySimDemandError(f"{path} has no zones in it")
    return rows


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description=(
            "Reduce an ActivitySim trip list to a demand package the screening assignment can run, "
            "so both demand models can be assigned on the same network."
        )
    )
    parser.add_argument("--trips-csv", required=True, help="ActivitySim final_trips.csv")
    parser.add_argument(
        "--zone-attributes-csv",
        required=True,
        help="The zone table the ActivitySim run used (the screening run's package/zone_attributes.csv)",
    )
    parser.add_argument("--output-dir", required=True, help="Directory to write the demand package into")
    args = parser.parse_args()

    result = build_activitysim_demand_package(
        trips_csv=Path(args.trips_csv).expanduser().resolve(),
        zone_rows=read_zone_rows_from_csv(Path(args.zone_attributes_csv).expanduser().resolve()),
        output_dir=Path(args.output_dir).expanduser().resolve(),
        source={"trips_csv": args.trips_csv, "zone_attributes_csv": args.zone_attributes_csv},
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
