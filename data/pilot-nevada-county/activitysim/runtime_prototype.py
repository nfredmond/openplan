#!/usr/bin/env python3
"""
OpenPlan ActivitySim runtime prototype.

This script prepares minimal ActivitySim-style runtime inputs from the Nevada
County pilot package, then runs either:
  - mock prototype execution (default), or
  - a best-effort real ActivitySim CLI invocation when requested.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_csv_rows(path: Path, fieldnames: list[str], rows: Iterable[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def to_int(value: object, fallback: int = 0) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


def detect_activitysim_cli(explicit_cli: str | None = None) -> str | None:
    candidates = [
        explicit_cli,
        os.getenv("OPENPLAN_ACTIVITYSIM_CLI"),
        os.getenv("ACTIVITYSIM_CLI"),
        shutil.which("activitysim"),
    ]
    for candidate in candidates:
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    return None


def write_settings_yaml(settings_path: Path, output_dir: Path) -> None:
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        "\n".join(
            [
                "# OpenPlan runtime prototype settings",
                "models: []",
                "input_table_list:",
                "  - land_use",
                "  - households",
                "  - persons",
                "households_sample_size: 0",
                "chunk_size: 0",
                "trace_hh_id: null",
                "output_tables:",
                "  h5_store: false",
                "  action: include",
                "  tables:",
                "    - households",
                "    - persons",
                "    - trips",
                f"output_dir: {output_dir.as_posix()}",
                "",
            ]
        ),
        encoding="utf-8",
    )


def select_zone_id(tract_geoid: str, tract_to_zone: dict[str, int], fallback_zones: list[int], index: int) -> int:
    if tract_geoid in tract_to_zone:
        return tract_to_zone[tract_geoid]
    if fallback_zones:
        return fallback_zones[index % len(fallback_zones)]
    return 1


def prepare_runtime_bundle(package_dir: Path, synthetic_dir: Path, activitysim_dir: Path) -> dict[str, object]:
    zone_attributes_path = package_dir / "zone_attributes.csv"
    tract_marginals_path = synthetic_dir / "tract_marginals.csv"
    seed_households_path = synthetic_dir / "seed_households.csv"
    seed_persons_path = synthetic_dir / "seed_persons.csv"

    zone_rows = read_csv_rows(zone_attributes_path)
    tract_rows = read_csv_rows(tract_marginals_path)

    tract_to_zone = {row.get("GEOID", "").strip(): to_int(row.get("zone_id"), 0) for row in zone_rows if row.get("GEOID")}
    known_zone_ids = [to_int(row.get("zone_id"), 0) for row in zone_rows if to_int(row.get("zone_id"), 0) > 0]

    households_rows: list[dict[str, object]] = []
    persons_rows: list[dict[str, object]] = []
    household_id = 1
    person_id = 1

    for tract_index, tract in enumerate(tract_rows):
        geoid = (tract.get("geoid") or tract.get("GEOID") or "").strip()
        total_hh = max(to_int(tract.get("total_hh"), 0), 0)
        if total_hh == 0:
            continue

        size_weights = [
            (1, to_int(tract.get("sz_1"), 0)),
            (2, to_int(tract.get("sz_2"), 0)),
            (3, to_int(tract.get("sz_3"), 0)),
            (4, to_int(tract.get("sz_4p"), 0)),
        ]
        income_weights = [
            (1, to_int(tract.get("inc_1"), 0)),
            (2, to_int(tract.get("inc_2"), 0)),
            (3, to_int(tract.get("inc_3"), 0)),
            (4, to_int(tract.get("inc_4"), 0)),
        ]

        size_pool = [size for size, count in size_weights for _ in range(max(count, 0))]
        income_pool = [bucket for bucket, count in income_weights for _ in range(max(count, 0))]
        if not size_pool:
            size_pool = [2]
        if not income_pool:
            income_pool = [2]

        zone_id = select_zone_id(geoid, tract_to_zone, known_zone_ids, tract_index)

        for i in range(total_hh):
            persons = int(size_pool[i % len(size_pool)])
            income_bucket = int(income_pool[(i * 3) % len(income_pool)])
            income_midpoint = {1: 30000, 2: 65000, 3: 105000, 4: 165000}.get(income_bucket, 65000)
            workers = 0 if persons <= 1 else min(persons - 1, 2)
            household = {
                "household_id": household_id,
                "home_zone_id": zone_id,
                "persons": persons,
                "workers": workers,
                "income": income_midpoint,
                "income_bucket": income_bucket,
                "tract_geoid": geoid,
            }
            households_rows.append(household)

            for person_number in range(1, persons + 1):
                age = 15 + ((household_id + person_number * 7) % 65)
                pemploy = 1 if person_number <= workers else 3
                pstudent = 1 if 6 <= age <= 22 else 3
                persons_rows.append(
                    {
                        "person_id": person_id,
                        "household_id": household_id,
                        "home_zone_id": zone_id,
                        "age": age,
                        "pemploy": pemploy,
                        "pstudent": pstudent,
                    }
                )
                person_id += 1

            household_id += 1

    land_use_rows = []
    households_by_zone: dict[int, int] = {}
    for household in households_rows:
        zone_id = int(household["home_zone_id"])
        households_by_zone[zone_id] = households_by_zone.get(zone_id, 0) + 1

    for row in zone_rows:
        zone_id = to_int(row.get("zone_id"), 0)
        if zone_id <= 0:
            continue
        land_use_rows.append(
            {
                "TAZ": zone_id,
                "GEOID": row.get("GEOID", ""),
                "TOTEMP": to_int(row.get("total_jobs"), 0),
                "POP": to_int(row.get("est_population"), 0),
                "HH": households_by_zone.get(zone_id, 0),
                "ACRES": round(float(row.get("area_sq_mi") or 0) * 640, 3),
            }
        )

    write_settings_yaml(activitysim_dir / "settings.yaml", activitysim_dir)
    write_csv_rows(activitysim_dir / "land_use.csv", ["TAZ", "GEOID", "TOTEMP", "POP", "HH", "ACRES"], land_use_rows)
    write_csv_rows(
        activitysim_dir / "households.csv",
        ["household_id", "home_zone_id", "persons", "workers", "income", "income_bucket", "tract_geoid"],
        households_rows,
    )
    write_csv_rows(
        activitysim_dir / "persons.csv",
        ["person_id", "household_id", "home_zone_id", "age", "pemploy", "pstudent"],
        persons_rows,
    )

    write_csv_rows(seed_households_path, ["household_id", "home_zone_id", "persons", "workers", "income", "income_bucket", "tract_geoid"], households_rows)
    write_csv_rows(seed_persons_path, ["person_id", "household_id", "home_zone_id", "age", "pemploy", "pstudent"], persons_rows)

    return {
        "zoneCount": len(land_use_rows),
        "householdCount": len(households_rows),
        "personCount": len(persons_rows),
        "files": {
            "settings": str(activitysim_dir / "settings.yaml"),
            "landUse": str(activitysim_dir / "land_use.csv"),
            "households": str(activitysim_dir / "households.csv"),
            "persons": str(activitysim_dir / "persons.csv"),
        },
    }


def run_mock_execution(activitysim_dir: Path, output_dir: Path) -> dict[str, object]:
    households = read_csv_rows(activitysim_dir / "households.csv")
    persons = read_csv_rows(activitysim_dir / "persons.csv")

    households_out = []
    for household in households:
        workers = to_int(household.get("workers"), 0)
        income = to_int(household.get("income"), 0)
        auto_ownership = 0
        if income >= 50000:
            auto_ownership += 1
        if income >= 100000:
            auto_ownership += 1
        if workers >= 2:
            auto_ownership += 1
        household_out = dict(household)
        household_out["auto_ownership"] = auto_ownership
        households_out.append(household_out)

    persons_out = []
    for person in persons:
        pemploy = to_int(person.get("pemploy"), 3)
        pstudent = to_int(person.get("pstudent"), 3)
        pattern = "home"
        if pemploy == 1:
            pattern = "work"
        elif pstudent == 1:
            pattern = "school"
        person_out = dict(person)
        person_out["activity_pattern"] = pattern
        persons_out.append(person_out)

    trips = []
    trip_id = 1
    for person in persons_out:
        household_id = to_int(person.get("household_id"), 0)
        person_id = to_int(person.get("person_id"), 0)
        origin_zone = to_int(person.get("home_zone_id"), 1)
        pattern = person.get("activity_pattern", "home")
        if pattern == "home":
            continue
        purpose = "work" if pattern == "work" else "school"
        destination_zone = origin_zone + 1 if origin_zone < 26 else max(1, origin_zone - 1)
        trips.append(
            {
                "trip_id": trip_id,
                "household_id": household_id,
                "person_id": person_id,
                "origin_zone": origin_zone,
                "destination_zone": destination_zone,
                "purpose": purpose,
                "mode": "drive",
                "depart_period": "AM",
            }
        )
        trip_id += 1
        trips.append(
            {
                "trip_id": trip_id,
                "household_id": household_id,
                "person_id": person_id,
                "origin_zone": destination_zone,
                "destination_zone": origin_zone,
                "purpose": "home",
                "mode": "drive",
                "depart_period": "PM",
            }
        )
        trip_id += 1

    write_csv_rows(output_dir / "households_out.csv", list(households_out[0].keys()) if households_out else ["household_id"], households_out)
    write_csv_rows(output_dir / "persons_out.csv", list(persons_out[0].keys()) if persons_out else ["person_id"], persons_out)
    write_csv_rows(
        output_dir / "trips.csv",
        ["trip_id", "household_id", "person_id", "origin_zone", "destination_zone", "purpose", "mode", "depart_period"],
        trips,
    )

    return {
        "householdCount": len(households_out),
        "personCount": len(persons_out),
        "tripCount": len(trips),
    }


def run_real_activitysim(cli: str, activitysim_dir: Path, output_dir: Path, timeout_seconds: int) -> tuple[bool, str]:
    cmd = [cli, "run", "-c", str(activitysim_dir), "-d", str(activitysim_dir), "-o", str(output_dir)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    if proc.returncode == 0:
        return True, f"real CLI succeeded: {' '.join(cmd)}"
    stderr = (proc.stderr or proc.stdout or "").strip()
    return False, f"real CLI failed ({proc.returncode}): {stderr[:500]}"


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenPlan ActivitySim runtime prototype")
    parser.add_argument("--package-dir", required=True)
    parser.add_argument("--synthetic-dir", required=True)
    parser.add_argument("--activitysim-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", default="local-prototype")
    parser.add_argument("--mode", choices=["mock", "auto", "real"], default="mock")
    parser.add_argument("--cli-path", default=None)
    parser.add_argument("--timeout-seconds", type=int, default=120)
    args = parser.parse_args()

    package_dir = Path(args.package_dir).resolve()
    synthetic_dir = Path(args.synthetic_dir).resolve()
    activitysim_dir = Path(args.activitysim_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    bundle = prepare_runtime_bundle(package_dir=package_dir, synthetic_dir=synthetic_dir, activitysim_dir=activitysim_dir)
    cli_path = detect_activitysim_cli(args.cli_path)

    execution_mode = "mock"
    execution_note = "mock mode selected"
    real_cli_attempted = False
    if args.mode in {"auto", "real"}:
        if cli_path:
            real_cli_attempted = True
            ok, note = run_real_activitysim(cli_path, activitysim_dir, output_dir, timeout_seconds=args.timeout_seconds)
            if ok:
                execution_mode = "real"
                execution_note = note
            elif args.mode == "real":
                summary = {
                    "schemaVersion": "openplan-activitysim-runtime.v1",
                    "generatedAt": now_iso(),
                    "runId": args.run_id,
                    "mode": "real",
                    "status": "failed",
                    "cliPath": cli_path,
                    "note": note,
                    "bundle": bundle,
                }
                (output_dir / "runtime_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
                return 2
            else:
                execution_mode = "mock_fallback"
                execution_note = f"{note}; falling back to mock execution"
        elif args.mode == "real":
            summary = {
                "schemaVersion": "openplan-activitysim-runtime.v1",
                "generatedAt": now_iso(),
                "runId": args.run_id,
                "mode": "real",
                "status": "failed",
                "cliPath": None,
                "note": "real mode requested but no ActivitySim CLI was detected",
                "bundle": bundle,
            }
            (output_dir / "runtime_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
            return 2

    mock_outputs = run_mock_execution(activitysim_dir=activitysim_dir, output_dir=output_dir)

    summary = {
        "schemaVersion": "openplan-activitysim-runtime.v1",
        "generatedAt": now_iso(),
        "runId": args.run_id,
        "status": "succeeded",
        "mode": execution_mode,
        "cliPath": cli_path,
        "realCliAttempted": real_cli_attempted,
        "note": execution_note,
        "bundle": bundle,
        "outputs": mock_outputs,
    }
    (output_dir / "runtime_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
