#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# The population modules are siblings, and this script is run both directly and
# imported by the prototype orchestrator. Without this the direct invocation
# finds them and the imported one does not — a difference that would only show
# up on the path a planner actually uses.
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

MANIFEST_NAME = "manifest.json"
DEFAULT_SKIM_RELATIVE_PATH = Path("run_output") / "travel_time_skims.omx"
DEFAULT_ZONE_ATTRIBUTES_RELATIVE_PATH = Path("package") / "zone_attributes.csv"
SOURCE_MANIFEST_RELATIVE_PATH = Path("bundle_manifest.json")
CONFIG_STARTER_VERSION = "v0"
CONFIG_PACKAGE_DESCRIPTOR_NAME = "openplan_config_package.json"

SCAFFOLD_POPULATION_CAVEATS = [
    "Prototype synthetic population only; this bundle does not contain a calibrated IPF or PopulationSim population.",
    "Households and persons are deterministically scaffolded from screening zone attributes and should not be represented as production-ready ActivitySim agents.",
    "Household/person columns are an OpenPlan handoff scaffold and will need final ActivitySim config and schema alignment in a later worker slice.",
    "The scaffold is derived from the SAME zone attributes the trip-based demand model uses, so a comparison between the two models is not a comparison of independent methods.",
]

# Kept as a distinct name from SCAFFOLD_POPULATION_CAVEATS on purpose. The two
# populations carry completely different authority, and a bundle that ships one
# under the other's caveats is the exact failure this whole lane exists to fix.
POPULATION_CAVEATS = SCAFFOLD_POPULATION_CAVEATS


def census_population_caveats(result: dict[str, Any]) -> list[str]:
    """What a reader must be told about a population fitted from real records.

    Built from the fit that actually ran, not written down in advance: a caveat
    list that says the same thing whatever happened is decoration, and the two
    things worth knowing here — how well each zone reproduced its published
    totals, and which controls could not be fitted at all — are different on
    every run.
    """
    provenance = result.get("provenance", {})
    quality = result.get("fit_quality", {})
    caveats = [provenance.get("note", "")]
    caveats.append(result.get("fit_grading_note", ""))
    if quality.get("note"):
        caveats.append(quality["note"])
    for control, reason in (result.get("dropped_controls") or {}).items():
        caveats.append(reason)
    caveats.append(
        "ActivitySim behavioural coefficients carry separate provenance for each component. "
        "A population drawn from local survey records does not make the travel behaviour local."
    )
    return [caveat for caveat in caveats if caveat]


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
    parser.add_argument(
        "--population",
        choices=["auto", "census", "scaffold"],
        default="auto",
        help=(
            "Where households come from. 'census' fits real Census microdata records to each zone's "
            "published totals and fails if they cannot be reached; 'scaffold' expands the screening "
            "zone attributes, which are the same inputs the trip-based model uses; 'auto' (default) "
            "uses census when a CENSUS_API_KEY is configured and records why when it falls back."
        ),
    )
    parser.add_argument(
        "--config-package",
        choices=["starter", "mtc"],
        default="starter",
        help=(
            "Which config package the bundle ships. 'starter' (default) is the non-runnable "
            "contract kit; 'mtc' builds inputs the stock prototype_mtc example can RUN, layered "
            "over the unmodified installed configuration — requires --population census and "
            "carries Bay-Area-coefficient caveats on every artifact."
        ),
    )
    parser.add_argument(
        "--stock-configs-dir",
        help=(
            "Explicit path to the installed prototype_mtc example (or its configs/ directory). "
            "Default: resolve from the importable activitysim package, then the ActivitySim "
            "worker venv."
        ),
    )
    parser.add_argument(
        "--accepted-components-registry",
        help=(
            "Optional accepted-component registry override. The repository registry is used by "
            "default and every referenced decision and coefficient file is hash-verified."
        ),
    )
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


def build_bundle_readme(
    source_manifest: dict[str, Any],
    skim_mode: str,
    caveats: list[str] | None = None,
    config_package: str = "starter",
) -> str:
    """The bundle's own README, carrying the caveats of the bundle it is IN.

    It used to print the scaffold caveats unconditionally, which made a
    fitted-census bundle's README describe a population it did not contain.
    """
    run_name = source_manifest.get("run_name", "unknown-screening-run")
    caveat_lines = "\n".join(f"- {item}" for item in (caveats if caveats is not None else POPULATION_CAVEATS))
    if config_package == "mtc":
        return (
            "# OpenPlan ActivitySim Input Bundle — prototype_mtc config package\n\n"
            f"Source screening run: `{run_name}`\n\n"
            "This bundle is runnable by the stock ActivitySim `prototype_mtc` example, layered\n"
            "over the unmodified installed configuration (see `configs/README.md`). The\n"
            "population is fitted from real Census microdata; the travel behaviour is the\n"
            "Bay Area's, and every artifact says so.\n\n"
            "## Contents\n\n"
            "- `manifest.json`: bundle provenance, file registry, and caveats\n"
            "- `land_use.csv`: zone table in the MTC vocabulary (TOTHH/TOTEMP/area_type…)\n"
            "- `households.csv`: fitted households with MTC codes (HHT, year-2000 income)\n"
            "- `persons.csv`: fitted persons with MTC person types (ptype/pemploy/pstudent)\n"
            "- `skims/mtc_skims.omx`: the full stock skim inventory — real auto times and\n"
            "  distances, zero transit and tolls\n"
            "- `skims/travel_time_skims.omx`: the raw screening skim this was expanded from,\n"
            f"  materialized via `{skim_mode}`\n"
            "- `configs/`: the settings overlay layered over the stock configuration\n"
            "- `metadata/source_screening_bundle_manifest.json`: copied source screening manifest\n\n"
            "## Caveats\n\n"
            f"{caveat_lines}\n"
        )
    return (
        "# OpenPlan ActivitySim Input Bundle Prototype\n\n"
        f"Source screening run: `{run_name}`\n\n"
        "This bundle is an OpenPlan handoff layer from the screening-grade AequilibraE lane to a future "
        "ActivitySim worker. It packages the current screening skim artifact, a derived land-use table, and a "
        "synthetic population.\n\n"
        "## Contents\n\n"
        "- `manifest.json`: bundle provenance, file registry, and caveats\n"
        "- `land_use.csv`: zone-level land use derived from screening `zone_attributes.csv`\n"
        "- `households.csv`: synthetic households (see manifest for which kind)\n"
        "- `persons.csv`: synthetic persons (see manifest for which kind)\n"
        "- `skims/travel_time_skims.omx`: screening skim OMX materialized via "
        f"`{skim_mode}`\n"
        f"- `configs/settings.yaml`: starter ActivitySim settings kit `{CONFIG_STARTER_VERSION}`\n"
        f"- `configs/constants.yaml`: starter constants kit `{CONFIG_STARTER_VERSION}`\n"
        f"- `configs/{CONFIG_PACKAGE_DESCRIPTOR_NAME}`: config package posture metadata\n"
        "- `configs/network_los.yaml`: placeholder LOS settings inherited from ActivitySim defaults\n"
        "- `configs/README.md`: starter kit notes and handoff caveats\n"
        "- `metadata/source_screening_bundle_manifest.json`: copied source screening manifest\n\n"
        "## Caveats\n\n"
        f"{caveat_lines}\n"
    )


def build_configs_readme() -> str:
    return (
        "# OpenPlan ActivitySim Starter Config Kit\n\n"
        f"Starter kit version: `{CONFIG_STARTER_VERSION}`\n\n"
        "This is a versioned starter config posture for worker integration and contract testing. "
        "It is not a production-calibrated ActivitySim config package and should not be represented as pilot-ready.\n\n"
        "Included starter files:\n"
        "- `settings.yaml`: minimal model/input wiring scaffold\n"
        "- `constants.yaml`: placeholder constants referenced by the settings scaffold\n"
        "- `network_los.yaml`: minimal LOS placeholder inheriting ActivitySim defaults\n"
        f"- `{CONFIG_PACKAGE_DESCRIPTOR_NAME}`: machine-readable posture metadata\n\n"
        "What is still missing before true pilot execution:\n"
        "- calibrated model settings, coefficients, and estimation outputs\n"
        "- final schema alignment for OpenPlan prototype household/person tables\n"
        "- validated skim period/mode naming and OMX lookup conventions\n"
        "- a confirmed end-to-end ActivitySim run against county-specific inputs\n"
    )


def build_config_settings() -> str:
    return (
        "# OpenPlan ActivitySim starter config kit\n"
        "# This file exists so the worker can stage a config-shaped package, but it is not a calibrated county run config.\n"
        "models: []\n"
        "multiprocess: false\n"
        "households_sample_size: 0\n"
        "want_dest_choice_sample_tables: false\n"
        "input_table_list:\n"
        "  - tablename: land_use\n"
        "    filename: land_use.csv\n"
        "  - tablename: households\n"
        "    filename: households.csv\n"
        "  - tablename: persons\n"
        "    filename: persons.csv\n"
        "constants:\n"
        "  source_file_paths:\n"
        "    - constants.yaml\n"
    )


def build_config_constants(population_status: str = "prototype_scaffold") -> str:
    """The starter constants, stamped with the population the bundle ACTUALLY has.

    This used to say `prototype_scaffold` unconditionally. Once a bundle can
    contain households fitted from real survey records, a constant that always
    says otherwise is a false statement inside a generated artifact — and it is
    the kind that survives, because a config file is read long after the run log
    is gone.
    """
    return (
        "# OpenPlan ActivitySim starter constants\n"
        "openplan_bundle_profile: screening_to_activitysim_handoff\n"
        "openplan_config_starter_version: v0\n"
        f"openplan_population_status: {population_status}\n"
    )


def build_network_los_settings() -> str:
    return (
        "inherit_settings: False\n"
        "zone_system: 1\n"
        "read_skim_cache: False\n"
        "write_skim_cache: False\n"
        "taz_skims: skims/travel_time_skims.omx\n"
        "skim_time_periods:\n"
        "  time_window: 1440\n"
        "  period_minutes: 60\n"
        "  periods: [0, 6, 11, 16, 20, 24]\n"
        "  labels: ['EA', 'AM', 'MD', 'PM', 'EV']\n"
    )


def build_config_package_descriptor() -> dict[str, Any]:
    return {
        "schema_version": "openplan.activitysim_config_package.v0",
        "package_type": "activitysim_config_package",
        "package_status": "starter_executable_kit",
        "starter_version": CONFIG_STARTER_VERSION,
        "runnable": False,
        "notes": [
            "This starter kit is intended for worker/runtime contract enablement only.",
            "It is not a calibrated or pilot-ready ActivitySim configuration package.",
        ],
        "expected_files": [
            "README.md",
            "settings.yaml",
            "constants.yaml",
            "network_los.yaml",
            CONFIG_PACKAGE_DESCRIPTOR_NAME,
        ],
    }


def build_mtc_config_package_descriptor(
    stock: dict[str, Any], specs_sha256: str, accepted_components: list[dict[str, Any]]
) -> dict[str, Any]:
    """The runnable-package descriptor: what it layers over, pinned by digest.

    The digest is what turns "the stock configuration is unmodified" from an
    assertion into a check — the worker recomputes it before every run and
    refuses to execute over a directory that no longer matches.
    """
    return {
        "schema_version": "openplan.activitysim_config_package.v0",
        "package_type": "activitysim_config_package",
        "package_status": "runnable_config_package",
        "config_package": "mtc",
        "runnable": True,
        "accepted_components": accepted_components,
        "layered_stock_configs": {
            "path": str(stock["configs_dir"]),
            "specs_sha256": specs_sha256,
            "activitysim_version": stock["activitysim_version"],
            "source_example": "prototype_mtc",
            "region_of_estimation": "San Francisco Bay Area (MTC Travel Model One)",
            "resolved_via": stock["resolved_via"],
        },
        "notes": [
            (
                "This bundle's configs are an overlay passed as the FIRST -c over the UNMODIFIED "
                "stock prototype_mtc configuration (the second -c); the digest above makes "
                "'unmodified' checkable at run time."
            ),
            (
                "Auto ownership uses a nationally estimated component accepted on a locked fresh "
                "holdout. Every other behavioural component remains estimated for the San "
                "Francisco Bay Area; nothing above screening grade can rest on this output."
            ),
        ],
        "expected_files": [
            "README.md",
            "settings.yaml",
            "network_los.yaml",
            CONFIG_PACKAGE_DESCRIPTOR_NAME,
        ] + sorted(
            filename
            for component in accepted_components
            for filename in component["installed_files_sha256"]
        ),
    }


def build_mtc_configs_readme(
    stock: dict[str, Any], specs_sha256: str, accepted_components: list[dict[str, Any]]
) -> str:
    accepted_lines = "\n".join(
        f"- `{component['component']}`: `{component['acceptance_result_sha256']}`"
        for component in accepted_components
    )
    return (
        "# OpenPlan ActivitySim Config Overlay — prototype_mtc package\n\n"
        "These files are an OVERLAY, layered as the first `-c` over the unmodified stock\n"
        "`prototype_mtc` configuration that ships inside the installed ActivitySim package:\n\n"
        f"- stock configuration: `{stock['configs_dir']}`\n"
        f"- ActivitySim version: `{stock['activitysim_version']}`\n"
        f"- stock specs SHA-256: `{specs_sha256}`\n\n"
        "Run shape: `activitysim run -c <this directory> -c <stock configs> -d <bundle> -o <out>`.\n\n"
        "There is deliberately NO `constants.yaml` here: config files resolve first-match across\n"
        "the layered directories, and a constants file in this overlay would silently shadow the\n"
        "stock one (person-type codes, income segments) rather than merge with it.\n\n"
        "Accepted component decisions layered into this directory:\n\n"
        f"{accepted_lines}\n\n"
        "Auto ownership uses the accepted national component. All other behavioural coefficients\n"
        "remain from the San Francisco Bay Area MTC example. Every artifact carries that caveat.\n"
    )


def build_mtc_land_use_summary(land_use_rows: list[dict[str, Any]], source_run_dir: Path) -> dict[str, Any]:
    return {
        "rows": len(land_use_rows),
        "total_households": sum(int(row["TOTHH"]) for row in land_use_rows),
        "total_population": sum(int(row["TOTPOP"]) for row in land_use_rows),
        "total_employment": sum(int(row["TOTEMP"]) for row in land_use_rows),
        "source_csv": str(source_run_dir / DEFAULT_ZONE_ATTRIBUTES_RELATIVE_PATH),
        "vocabulary": "MTC Travel Model One (prototype_mtc keep_columns)",
    }


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
    population_block: dict[str, Any],
    caveats: list[str],
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
            "config_settings": "configs/settings.yaml",
            "config_constants": "configs/constants.yaml",
            "config_network_los": "configs/network_los.yaml",
            "config_readme": "configs/README.md",
            "config_package_descriptor": f"configs/{CONFIG_PACKAGE_DESCRIPTOR_NAME}",
            "source_screening_manifest": "metadata/source_screening_bundle_manifest.json",
        },
        "config_package": build_config_package_descriptor(),
        "land_use": {
            "rows": len(land_use_rows),
            # Column vocabulary differs by config package (starter vs MTC);
            # the MTC caller replaces this whole block with its own summary.
            "total_households": sum(int(row.get("households", row.get("TOTHH", 0))) for row in land_use_rows),
            "total_population": sum(int(row.get("population", row.get("TOTPOP", 0))) for row in land_use_rows),
            "total_workers": sum(int(row.get("workers", 0)) for row in land_use_rows),
            "total_employment": sum(int(row.get("employment", row.get("TOTEMP", 0))) for row in land_use_rows),
            "source_csv": str(source_run_dir / DEFAULT_ZONE_ATTRIBUTES_RELATIVE_PATH),
        },
        "synthetic_population": {**population_block, "adjustments": adjustments},
        "skims": {
            "artifact": skim_manifest,
            "source_contract": {
                "source_file": str(source_run_dir / DEFAULT_SKIM_RELATIVE_PATH),
                "origin": "AequilibraE screening run",
            },
        },
        "caveats": caveats,
        "source_bundle_excerpt": {
            "artifacts": source_manifest.get("artifacts", {}),
            "skims": source_manifest.get("skims", {}),
            "zones": source_manifest.get("zones", {}),
            "demand": source_manifest.get("demand", {}),
        },
        "output_dir": str(output_dir),
    }


def build_population(
    zone_rows: list[dict[str, Any]], population_source: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any], list[str]]:
    """Produce the households and persons, and say plainly which kind they are.

    The manifest block and the caveats are returned WITH the rows rather than
    assembled later, because the failure that matters is a real population
    shipping under the scaffold's caveats or — far worse — a scaffold shipping
    under the real one's. Building all four together makes that mismatch
    impossible to introduce by editing one call site.
    """
    if population_source not in ("auto", "census", "scaffold"):
        raise RuntimeError(f"Unknown population source '{population_source}'.")

    census_api_key = (os.getenv("CENSUS_API_KEY") or "").strip()
    fallback_reason: str | None = None

    if population_source == "auto" and not census_api_key:
        fallback_reason = (
            "No CENSUS_API_KEY was configured, so households could not be fitted from Census "
            "microdata and were expanded from the screening zone attributes instead."
        )
    elif population_source == "census" and not census_api_key:
        raise RuntimeError(
            "A population fitted from Census microdata was requested but no CENSUS_API_KEY is "
            "configured. Get a free key at https://api.census.gov/data/key_signup.html."
        )

    if population_source != "scaffold" and not fallback_reason:
        from synthetic_population import SyntheticPopulationError, synthesize_study_area

        try:
            result = synthesize_study_area(zone_rows, census_api_key=census_api_key)
        except SyntheticPopulationError as exc:
            if population_source == "census":
                raise
            # 'auto' degrades, but never silently: the reason travels into the
            # manifest and the caveats, so a bundle built from zone averages is
            # never mistaken for one built from survey records.
            fallback_reason = f"Census microdata could not be used for this study area: {exc}"
        else:
            block = {
                "status": "fitted_to_published_totals",
                "method": result["method"],
                "calibration_status": "fitted_to_acs_marginals",
                "households": result["summary"]["households"],
                "persons": result["summary"]["persons"],
                "workers": result["summary"]["workers"],
                "zone_geography": result["summary"]["zone_geography"],
                "seed_provenance": result["provenance"],
                "fit_quality": result["fit_quality"],
                "fit_grading": result["fit_grading_note"],
                "controls_not_fitted": result["dropped_controls"],
            }
            return (
                result["households"],
                result["persons"],
                result["summary"],
                block,
                census_population_caveats(result),
            )

    household_rows, person_rows, summary = build_population_rows(zone_rows_for_scaffold(zone_rows))
    block = {
        "status": "prototype_scaffold",
        "method": "deterministic_zone_attribute_expansion",
        "calibration_status": "not_calibrated",
        "households": len(household_rows),
        "persons": len(person_rows),
    }
    caveats = list(SCAFFOLD_POPULATION_CAVEATS)
    if fallback_reason:
        block["fallback_reason"] = fallback_reason
        caveats.insert(0, fallback_reason)
    return household_rows, person_rows, summary, block, caveats


def zone_rows_for_scaffold(zone_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    coerced, _ = coerce_zone_totals(list(zone_rows))
    return coerced


def build_mtc_package(
    *,
    output_path: Path,
    source_run_dir: Path,
    source_skim: Path,
    raw_zones: list[dict[str, Any]],
    household_rows: list[dict[str, Any]],
    person_rows: list[dict[str, Any]],
    caveats: list[str],
    stock_configs_dir: str | None,
    accepted_components_registry: str | None,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], list[str]]:
    """Everything the MTC config package adds to a bundle, in one place.

    Fails fast on the local prerequisites (income vintage, stock configs, the
    run's centroid map) before spending a network call on enrolment.
    """
    # Lazy imports: numpy/openmatrix and the population stack ride in only
    # when an MTC bundle is actually requested.
    import activitysim_mtc_inputs as mtc
    from activitysim_accepted_components import DEFAULT_REGISTRY, install_accepted_components
    import census_pums as cp

    mtc.check_income_vintage(cp.ACS_5_URL)
    stock = mtc.resolve_stock_prototype_mtc(stock_configs_dir)
    specs_sha256 = mtc.stock_configs_digest(stock["configs_dir"])
    centroid_map = mtc.read_centroid_map(source_run_dir / "work" / "network_setup_summary.json")

    skim_accounting = mtc.expand_skims(
        source_omx=source_skim,
        output_omx=output_path / "skims" / "mtc_skims.omx",
        internal_zone_rows=raw_zones,
        centroid_map=centroid_map,
        stock_configs_dir=stock["configs_dir"],
        stock_skims_omx=stock["stock_skims_omx"],
    )

    mtc_household_rows, household_accounting = mtc.mtc_households(household_rows)
    mtc_person_rows, person_accounting = mtc.mtc_persons(person_rows)

    internal = mtc.internal_zones_in_order(raw_zones)
    census_api_key = (os.getenv("CENSUS_API_KEY") or "").strip()
    enrollment = cp.fetch_acs_school_enrollment(
        [str(zone.get("GEOID") or "").strip() for zone in internal], census_api_key
    )
    # Land use totals come from the FITTED rows (they carry home_zone_id and
    # age); the converted MTC rows have already traded those for the MTC
    # vocabulary.
    land_use_rows, land_use_accounting = mtc.mtc_land_use(
        raw_zones, household_rows, person_rows, enrollment
    )

    write_csv(output_path / "land_use.csv", land_use_rows)
    write_csv(output_path / "households.csv", mtc_household_rows)
    write_csv(output_path / "persons.csv", mtc_person_rows)
    (output_path / "configs" / "settings.yaml").write_text(mtc.mtc_settings_yaml())
    (output_path / "configs" / "network_los.yaml").write_text(mtc.mtc_network_los_yaml())
    accepted_components = install_accepted_components(
        output_path / "configs", accepted_components_registry or DEFAULT_REGISTRY
    )
    (output_path / "configs" / "README.md").write_text(
        build_mtc_configs_readme(stock, specs_sha256, accepted_components)
    )

    config_descriptor = build_mtc_config_package_descriptor(
        stock, specs_sha256, accepted_components
    )
    mtc_blocks = {
        "files": {
            # The skim the run actually reads; the raw screening skim is kept
            # alongside for provenance.
            "skim_omx": "skims/mtc_skims.omx",
            "source_skim_omx": "skims/travel_time_skims.omx",
        },
        "land_use_summary": build_mtc_land_use_summary(land_use_rows, source_run_dir),
        "mtc_inputs": {
            "skim_expansion": skim_accounting,
            "households": household_accounting,
            "persons": person_accounting,
            "land_use": land_use_accounting,
            "stock_configuration": {
                "path": str(stock["configs_dir"]),
                "specs_sha256": specs_sha256,
                "activitysim_version": stock["activitysim_version"],
                "resolved_via": stock["resolved_via"],
            },
            "accepted_components": accepted_components,
        },
    }
    stock_caveats = mtc.mtc_config_caveats()
    behavior_caveat = (
        "Auto ownership uses the nationally estimated component accepted by the recorded fresh "
        "holdout study. Every other behavioral component still uses ActivitySim's stock "
        "prototype_mtc coefficients estimated for the San Francisco Bay Area. Component "
        "acceptance does not establish destination, mode, timing, assignment, or corridor accuracy."
    )
    return (
        land_use_rows,
        mtc_blocks,
        config_descriptor,
        list(caveats) + [behavior_caveat] + stock_caveats[1:],
    )


def build_activitysim_input_bundle(
    *,
    screening_run_dir: str | None = None,
    screening_manifest: str | None = None,
    output_dir: str,
    skim_mode: str = "copy",
    force: bool = False,
    population_source: str = "auto",
    config_package: str = "starter",
    stock_configs_dir: str | None = None,
    accepted_components_registry: str | None = None,
) -> dict[str, Any]:
    if config_package not in ("starter", "mtc"):
        raise RuntimeError(f"Unknown config package '{config_package}'.")
    if config_package == "mtc" and population_source != "census":
        # The MTC person types are derived from raw survey codes a scaffold
        # does not have; and a scaffold under Bay Area behaviour would stack
        # an invented population on borrowed coefficients.
        raise RuntimeError(
            "The MTC config package derives its person types from raw Census microdata codes; "
            "build it with --population census."
        )

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
    raw_zones = list(zones)
    zones, adjustments = coerce_zone_totals(zones)
    household_rows, person_rows, population_summary, population_block, caveats = build_population(
        raw_zones, population_source
    )

    mtc_blocks: dict[str, Any] | None = None
    if config_package == "mtc":
        land_use_rows, mtc_blocks, config_descriptor, caveats = build_mtc_package(
            output_path=output_path,
            source_run_dir=source_run_dir,
            source_skim=source_skim,
            raw_zones=raw_zones,
            household_rows=household_rows,
            person_rows=person_rows,
            caveats=caveats,
            stock_configs_dir=stock_configs_dir,
            accepted_components_registry=accepted_components_registry,
        )
    else:
        land_use_rows = build_land_use_rows(zones)
        write_csv(output_path / "land_use.csv", land_use_rows)
        write_csv(output_path / "households.csv", household_rows)
        write_csv(output_path / "persons.csv", person_rows)
        (output_path / "configs" / "README.md").write_text(build_configs_readme())
        (output_path / "configs" / "settings.yaml").write_text(build_config_settings())
        (output_path / "configs" / "constants.yaml").write_text(
            build_config_constants(population_block["status"])
        )
        (output_path / "configs" / "network_los.yaml").write_text(build_network_los_settings())
        config_descriptor = build_config_package_descriptor()

    skim_manifest = materialize_skim(source_skim, output_path / "skims" / "travel_time_skims.omx", skim_mode)
    shutil.copy2(source_manifest_path, output_path / "metadata" / "source_screening_bundle_manifest.json")
    (output_path / "README.md").write_text(
        build_bundle_readme(source_manifest, skim_mode, caveats=caveats, config_package=config_package)
    )
    write_json(output_path / "configs" / CONFIG_PACKAGE_DESCRIPTOR_NAME, config_descriptor)

    manifest = build_manifest_payload(
        output_dir=output_path,
        source_run_dir=source_run_dir,
        source_manifest=source_manifest,
        skim_manifest=skim_manifest,
        land_use_rows=land_use_rows,
        household_rows=household_rows,
        person_rows=person_rows,
        adjustments=adjustments,
        population_block=population_block,
        caveats=caveats,
    )
    manifest["config_package"] = config_descriptor
    if mtc_blocks:
        manifest["files"].update(mtc_blocks["files"])
        # No constants.yaml in the MTC overlay — it would shadow the stock one.
        manifest["files"].pop("config_constants", None)
        manifest["land_use"] = mtc_blocks["land_use_summary"]
        manifest["mtc_inputs"] = mtc_blocks["mtc_inputs"]
    write_json(output_path / MANIFEST_NAME, manifest)

    return {
        "output_dir": str(output_path),
        "manifest_path": str(output_path / MANIFEST_NAME),
        "bundle_files": manifest["files"],
        "land_use_rows": len(land_use_rows),
        "households": population_summary["households"],
        "persons": population_summary["persons"],
        "skim_mode": skim_mode,
        # Carried in the SUMMARY, not only in the bundle manifest on disk. Every
        # caller downstream reads this dict to build its own record, and a
        # household count that does not travel with what kind of household it is
        # becomes a number nobody can qualify two steps later.
        "population": {
            "status": population_block["status"],
            "method": population_block["method"],
            "fallback_reason": population_block.get("fallback_reason"),
        },
        "config_package": {
            "name": config_package,
            "status": config_descriptor["package_status"],
            "runnable": bool(config_descriptor.get("runnable", False)),
        },
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
        population_source=args.population,
        config_package=args.config_package,
        stock_configs_dir=args.stock_configs_dir,
        accepted_components_registry=args.accepted_components_registry,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
