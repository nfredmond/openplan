#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MANIFEST_NAME = "manifest.json"
DEFAULT_SKIM_RELATIVE_PATH = Path("run_output") / "travel_time_skims.omx"
DEFAULT_ZONE_ATTRIBUTES_RELATIVE_PATH = Path("package") / "zone_attributes.csv"
SOURCE_MANIFEST_RELATIVE_PATH = Path("bundle_manifest.json")

POPULATION_CAVEATS = [
    "Prototype synthetic population only; this bundle does not contain a calibrated IPF or PopulationSim population.",
    "Households and persons are deterministically scaffolded from screening zone attributes and should not be represented as production-ready ActivitySim agents.",
    "Household/person columns are an OpenPlan handoff scaffold and will need final ActivitySim config and schema alignment in a later worker slice.",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Package a screening run into a prototype ActivitySim input bundle scaffold."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--screening-run-dir", help="Completed screening run directory")
    source_group.add_argument("--screening-manifest", help="Path to screening bundle_manifest.json")
    parser.add_argument("--output-dir", required=True, help="Output directory for the ActivitySim bundle")
    parser.add_argument(
        "--skim-mode",
        choices=["copy", "symlink"],
        default="copy",
        help="Whether to copy or symlink the screening skim OMX into the bundle (default: copy)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing output bundle directory")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n")


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_for_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_screening_run_dir(screening_run_dir: str | None, screening_manifest: str | None) -> Path:
    if screening_run_dir:
        return Path(screening_run_dir).expanduser().resolve()
    manifest_path = Path(screening_manifest).expanduser().resolve()
    if manifest_path.name != SOURCE_MANIFEST_RELATIVE_PATH.name:
        raise RuntimeError(
            f"Expected a screening manifest named {SOURCE_MANIFEST_RELATIVE_PATH.name}, got {manifest_path.name}"
        )
    return manifest_path.parent


def require_source_file(path: Path, label: str) -> Path:
    if not path.exists():
        raise RuntimeError(f"Missing {label}: {path}")
    return path


def load_zone_attributes(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
    if not rows:
        raise RuntimeError(f"Zone attributes CSV is empty: {path}")

    numeric_fields = {
        "zone_id",
        "centroid_lon",
        "centroid_lat",
        "area_sq_mi",
        "total_jobs",
        "retail_jobs",
        "health_jobs",
        "education_jobs",
        "accommodation_jobs",
        "govt_jobs",
        "est_population",
        "households",
        "worker_residents",
        "area_share",
    }
    parsed: list[dict[str, Any]] = []
    for row in rows:
        parsed_row: dict[str, Any] = {}
        for key, value in row.items():
            if key in numeric_fields:
                parsed_row[key] = float(value or 0)
            else:
                parsed_row[key] = value
        parsed.append(parsed_row)
    return parsed


def integerize(values: list[float]) -> list[int]:
    if not values:
        return []
    floors = [max(0, math.floor(value)) for value in values]
    rounded_total = max(0, int(round(sum(values))))
    current_total = sum(floors)
    delta = rounded_total - current_total
    order = sorted(
        range(len(values)),
        key=lambda idx: (values[idx] - floors[idx], values[idx], -idx),
        reverse=True,
    )
    result = floors[:]
    if delta > 0:
        for idx in order[:delta]:
            result[idx] += 1
    elif delta < 0:
        for idx in reversed(order[: abs(delta)]):
            result[idx] = max(0, result[idx] - 1)
    return result


def coerce_zone_totals(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    households = integerize([row["households"] for row in rows])
    population = integerize([row["est_population"] for row in rows])
    workers = integerize([row["worker_residents"] for row in rows])
    employment = integerize([row["total_jobs"] for row in rows])

    adjustments = {
        "host_households_added_for_population": 0,
        "population_floor_lifts_for_nonempty_households": 0,
        "workers_trimmed_to_population": 0,
    }

    enriched: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        zone_households = households[idx]
        zone_population = population[idx]
        zone_workers = workers[idx]
        zone_employment = employment[idx]

        if zone_population > 0 and zone_households == 0:
            zone_households = 1
            adjustments["host_households_added_for_population"] += 1
        if zone_households > 0 and zone_population < zone_households:
            adjustments["population_floor_lifts_for_nonempty_households"] += zone_households - zone_population
            zone_population = zone_households
        if zone_workers > zone_population:
            adjustments["workers_trimmed_to_population"] += zone_workers - zone_population
            zone_workers = zone_population

        enriched.append(
            {
                **row,
                "proto_households": zone_households,
                "proto_population": zone_population,
                "proto_workers": zone_workers,
                "proto_employment": zone_employment,
            }
        )

    return enriched, adjustments


def distribute_people_across_households(household_count: int, people_count: int) -> list[int]:
    if household_count <= 0:
        return []
    sizes = [1] * household_count
    extra_people = max(0, people_count - household_count)
    for offset in range(extra_people):
        sizes[offset % household_count] += 1
    return sizes


def distribute_workers_across_households(household_sizes: list[int], worker_count: int) -> list[int]:
    workers = [0] * len(household_sizes)
    remaining = max(0, worker_count)
    household_index = 0
    while remaining > 0 and household_sizes:
        if workers[household_index] < household_sizes[household_index]:
            workers[household_index] += 1
            remaining -= 1
        household_index = (household_index + 1) % len(household_sizes)
    return workers


def household_income(zone_id: int, household_index: int, workers: int, persons: int) -> int:
    return 20000 + (18000 * workers) + (6000 * max(0, persons - 1)) + (((zone_id + household_index) % 5) * 2500)


def build_land_use_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    land_use_rows: list[dict[str, Any]] = []
    for row in rows:
        zone_id = int(row["zone_id"])
        land_use_rows.append(
            {
                "zone_id": zone_id,
                "TAZ": zone_id,
                "source_geoid": row["GEOID"],
                "zone_name": row["NAMELSAD"],
                "households": int(row["proto_households"]),
                "population": int(row["proto_population"]),
                "employment": int(row["proto_employment"]),
                "emp_retail": int(round(row["retail_jobs"])),
                "emp_health": int(round(row["health_jobs"])),
                "emp_education": int(round(row["education_jobs"])),
                "emp_accommodation": int(round(row["accommodation_jobs"])),
                "emp_govt": int(round(row["govt_jobs"])),
                "workers": int(row["proto_workers"]),
                "area_sq_mi": f"{float(row['area_sq_mi']):.6f}",
                "area_share": f"{float(row['area_share']):.6f}",
                "centroid_lon": f"{float(row['centroid_lon']):.6f}",
                "centroid_lat": f"{float(row['centroid_lat']):.6f}",
                "land_use_source": "openplan_screening_zone_attributes",
            }
        )
    return land_use_rows


def build_population_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    households_rows: list[dict[str, Any]] = []
    persons_rows: list[dict[str, Any]] = []
    household_id = 1
    person_id = 1

    for row in rows:
        zone_id = int(row["zone_id"])
        sizes = distribute_people_across_households(int(row["proto_households"]), int(row["proto_population"]))
        workers = distribute_workers_across_households(sizes, int(row["proto_workers"]))
        for household_index, size in enumerate(sizes, start=1):
            household_workers = workers[household_index - 1]
            autos = min(4, household_workers + (1 if size >= 3 else 0))
            households_rows.append(
                {
                    "household_id": household_id,
                    "home_zone_id": zone_id,
                    "persons": size,
                    "workers": household_workers,
                    "autos": autos,
                    "income": household_income(zone_id, household_index, household_workers, size),
                    "prototype_household_type": f"zone_{zone_id}_scaffold",
                    "source_geoid": row["GEOID"],
                    "scaffold_method": "deterministic_zone_attribute_expansion",
                }
            )

            adult_count = size if size <= 2 else min(size, max(household_workers, 1) + 1)
            for person_num in range(1, size + 1):
                is_worker = person_num <= household_workers
                is_child = person_num > adult_count
                if is_worker:
                    age = 25 + ((household_id + person_num + zone_id) % 35)
                    role = "worker"
                elif is_child:
                    age = 6 + ((household_id + person_num + zone_id) % 12)
                    role = "student"
                else:
                    age = 22 + ((household_id + person_num + zone_id) % 45)
                    role = "adult_nonworker"
                persons_rows.append(
                    {
                        "person_id": person_id,
                        "household_id": household_id,
                        "person_num": person_num,
                        "home_zone_id": zone_id,
                        "age": age,
                        "sex": 1 + ((person_id + zone_id) % 2),
                        "is_worker": 1 if is_worker else 0,
                        "is_student": 1 if role == "student" else 0,
                        "prototype_role": role,
                        "source_geoid": row["GEOID"],
                        "scaffold_method": "deterministic_zone_attribute_expansion",
                    }
                )
                person_id += 1
            household_id += 1

    summary = {
        "households": len(households_rows),
        "persons": len(persons_rows),
        "workers": sum(int(row["is_worker"]) for row in persons_rows),
        "zones_with_households": len({int(row["home_zone_id"]) for row in households_rows}),
    }
    return households_rows, persons_rows, summary


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        raise RuntimeError(f"Refusing to write empty CSV: {path}")
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def materialize_skim(source_path: Path, destination_path: Path, skim_mode: str) -> dict[str, Any]:
    ensure_dir(destination_path.parent)
    if destination_path.exists() or destination_path.is_symlink():
        destination_path.unlink()
    if skim_mode == "symlink":
        os.symlink(source_path, destination_path)
    else:
        shutil.copy2(source_path, destination_path)
    return {
        "bundle_path": str(destination_path),
        "mode": skim_mode,
        "source_path": str(source_path),
        "byte_size": source_path.stat().st_size,
        "sha256": sha256_for_file(source_path),
    }


def build_bundle_readme(source_manifest: dict[str, Any], skim_mode: str) -> str:
    run_name = source_manifest.get("run_name", "unknown-screening-run")
    caveats = "\n".join(f"- {item}" for item in POPULATION_CAVEATS)
    return (
        "# OpenPlan ActivitySim Input Bundle Prototype\n\n"
        f"Source screening run: `{run_name}`\n\n"
        "This bundle is an OpenPlan handoff layer from the screening-grade AequilibraE lane to a future "
        "ActivitySim worker. It packages the current screening skim artifact, a derived land-use table, and a "
        "deterministic synthetic-population scaffold.\n\n"
        "## Contents\n\n"
        "- `manifest.json`: bundle provenance, file registry, and caveats\n"
        "- `land_use.csv`: zone-level land use derived from screening `zone_attributes.csv`\n"
        "- `households.csv`: prototype household scaffold generated from zone attributes\n"
        "- `persons.csv`: prototype person scaffold generated from zone attributes\n"
        "- `skims/travel_time_skims.omx`: screening skim OMX materialized via "
        f"`{skim_mode}`\n"
        "- `configs/README.md`: placeholder config notes for a future ActivitySim worker\n"
        "- `metadata/source_screening_bundle_manifest.json`: copied source screening manifest\n\n"
        "## Caveats\n\n"
        f"{caveats}\n"
    )


def build_configs_readme() -> str:
    return (
        "# Future ActivitySim Worker Config Scaffold\n\n"
        "This directory is intentionally minimal. The current bundle builder does not ship an executable "
        "ActivitySim config set.\n\n"
        "Expected follow-on work:\n"
        "- map OpenPlan prototype household/person columns to the final ActivitySim schema\n"
        "- define model settings, coefficients, and estimation/calibration inputs\n"
        "- formalize skim period/mode naming and OMX lookup conventions\n"
    )


def build_manifest_payload(
    *,
    output_dir: Path,
    source_run_dir: Path,
    source_manifest: dict[str, Any],
    skim_manifest: dict[str, Any],
    land_use_rows: list[dict[str, Any]],
    household_rows: list[dict[str, Any]],
    person_rows: list[dict[str, Any]],
    adjustments: dict[str, int],
) -> dict[str, Any]:
    return {
        "schema_version": "openplan.activitysim_input_bundle.v0",
        "bundle_type": "activitysim_input_bundle",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "builder": {
            "script": "scripts/modeling/build_activitysim_input_bundle.py",
            "prototype": True,
        },
        "source_screening_run": {
            "run_dir": str(source_run_dir),
            "run_name": source_manifest.get("run_name"),
            "manifest_path": str(source_run_dir / SOURCE_MANIFEST_RELATIVE_PATH),
            "screening_grade": bool(source_manifest.get("screening_grade", False)),
        },
        "files": {
            "manifest": MANIFEST_NAME,
            "land_use": "land_use.csv",
            "households": "households.csv",
            "persons": "persons.csv",
            "skim_omx": "skims/travel_time_skims.omx",
            "readme": "README.md",
            "config_readme": "configs/README.md",
            "source_screening_manifest": "metadata/source_screening_bundle_manifest.json",
        },
        "land_use": {
            "rows": len(land_use_rows),
            "total_households": sum(int(row["households"]) for row in land_use_rows),
            "total_population": sum(int(row["population"]) for row in land_use_rows),
            "total_workers": sum(int(row["workers"]) for row in land_use_rows),
            "total_employment": sum(int(row["employment"]) for row in land_use_rows),
            "source_csv": str(source_run_dir / DEFAULT_ZONE_ATTRIBUTES_RELATIVE_PATH),
        },
        "synthetic_population": {
            "status": "prototype_scaffold",
            "method": "deterministic_zone_attribute_expansion",
            "calibration_status": "not_calibrated",
            "households": len(household_rows),
            "persons": len(person_rows),
            "adjustments": adjustments,
        },
        "skims": {
            "artifact": skim_manifest,
            "source_contract": {
                "source_file": str(source_run_dir / DEFAULT_SKIM_RELATIVE_PATH),
                "origin": "AequilibraE screening run",
            },
        },
        "caveats": POPULATION_CAVEATS,
        "source_bundle_excerpt": {
            "artifacts": source_manifest.get("artifacts", {}),
            "skims": source_manifest.get("skims", {}),
            "zones": source_manifest.get("zones", {}),
            "demand": source_manifest.get("demand", {}),
        },
        "output_dir": str(output_dir),
    }


def build_activitysim_input_bundle(
    *,
    screening_run_dir: str | None = None,
    screening_manifest: str | None = None,
    output_dir: str,
    skim_mode: str = "copy",
    force: bool = False,
) -> dict[str, Any]:
    source_run_dir = resolve_screening_run_dir(screening_run_dir, screening_manifest)
    source_manifest_path = require_source_file(source_run_dir / SOURCE_MANIFEST_RELATIVE_PATH, "screening manifest")
    source_zone_attributes = require_source_file(
        source_run_dir / DEFAULT_ZONE_ATTRIBUTES_RELATIVE_PATH,
        "screening zone attributes CSV",
    )
    source_skim = require_source_file(source_run_dir / DEFAULT_SKIM_RELATIVE_PATH, "screening skim OMX")
    source_manifest = read_json(source_manifest_path)

    output_path = Path(output_dir).expanduser().resolve()
    if output_path.exists():
        if not force:
            raise RuntimeError(f"Output bundle directory already exists: {output_path}. Re-run with --force to replace it.")
        shutil.rmtree(output_path)
    ensure_dir(output_path)
    ensure_dir(output_path / "configs")
    ensure_dir(output_path / "metadata")
    ensure_dir(output_path / "skims")

    zones = load_zone_attributes(source_zone_attributes)
    zones, adjustments = coerce_zone_totals(zones)
    land_use_rows = build_land_use_rows(zones)
    household_rows, person_rows, population_summary = build_population_rows(zones)

    land_use_path = output_path / "land_use.csv"
    households_path = output_path / "households.csv"
    persons_path = output_path / "persons.csv"
    write_csv(land_use_path, land_use_rows)
    write_csv(households_path, household_rows)
    write_csv(persons_path, person_rows)

    skim_manifest = materialize_skim(source_skim, output_path / "skims" / "travel_time_skims.omx", skim_mode)
    shutil.copy2(source_manifest_path, output_path / "metadata" / "source_screening_bundle_manifest.json")
    (output_path / "README.md").write_text(build_bundle_readme(source_manifest, skim_mode))
    (output_path / "configs" / "README.md").write_text(build_configs_readme())

    manifest = build_manifest_payload(
        output_dir=output_path,
        source_run_dir=source_run_dir,
        source_manifest=source_manifest,
        skim_manifest=skim_manifest,
        land_use_rows=land_use_rows,
        household_rows=household_rows,
        person_rows=person_rows,
        adjustments=adjustments,
    )
    write_json(output_path / MANIFEST_NAME, manifest)

    return {
        "output_dir": str(output_path),
        "manifest_path": str(output_path / MANIFEST_NAME),
        "bundle_files": manifest["files"],
        "land_use_rows": len(land_use_rows),
        "households": population_summary["households"],
        "persons": population_summary["persons"],
        "skim_mode": skim_mode,
        "caveats": manifest["caveats"],
    }


def main() -> int:
    args = parse_args()
    summary = build_activitysim_input_bundle(
        screening_run_dir=args.screening_run_dir,
        screening_manifest=args.screening_manifest,
        output_dir=args.output_dir,
        skim_mode=args.skim_mode,
        force=args.force,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
