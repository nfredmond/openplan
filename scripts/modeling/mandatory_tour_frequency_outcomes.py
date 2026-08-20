#!/usr/bin/env python3
"""Reconstruct mandatory-tour outcomes from a development-only NHTS source.

This adapter is intentionally narrower than the general NHTS diary mapper. It
keeps every person visible, uses the weekday person weight exactly once, and
derives no outcome unless the source has already passed the preregistered
development/acceptance split.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable, Mapping

import mandatory_tour_frequency_registry as preregistration
import prepare_mandatory_tour_development_source as development_source
import us_nhts_diaries as diaries
import us_nhts_survey as nhts


SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-frequency-outcomes.v1"
OUTPUT_NAME = "mandatory_person_days.csv"
MANIFEST_NAME = "manifest.json"
SUPPORTED_ALTERNATIVES = {
    (1, 0): "work1",
    (2, 0): "work2",
    (0, 1): "school1",
    (0, 2): "school2",
    (1, 1): "work_and_school",
}
INCOMPLETE_STATUSES = {
    "invalid_trip_fields",
    "invalid_trip_inside_chain",
    "not_home_anchored",
    "discontinuous_purpose_chain",
    "did_not_return_home",
}
HOUSEHOLD_COLUMNS = {
    "HOUSEID",
    "CENSUS_D",
    "STRATUMID",
    "HHSIZE",
    "HHVEHCNT",
    "WRKCOUNT",
    "DRVRCNT",
    "HHFAMINC_IMP",
    "URBRUR",
}
PERSON_COLUMNS = {
    "HOUSEID",
    "PERSONID",
    "CENSUS_D",
    "STRATUMID",
    "WTPERFIN5D",
    "R_AGE",
    "R_SEX",
    "WORKER",
    "SCHOOL1",
}
TRIP_COLUMNS = {
    "HOUSEID",
    "PERSONID",
    "TRIPID",
    "CENSUS_D",
    "WHYFROM",
    "WHYTO",
    "STRTTIME",
    "ENDTIME",
}
OUTPUT_COLUMNS = [
    "household_id",
    "person_id",
    "census_division_code",
    "stratum_id",
    "weekday_weight",
    "age",
    "sex_code",
    "worker_code",
    "school_code",
    "household_size",
    "workers",
    "drivers",
    "vehicles",
    "income_category_code",
    "urban_rural_code",
    "work_tours",
    "school_tours",
    "alternative",
    "outcome_status",
    "exclusion_reason",
]


class MandatoryTourOutcomeError(RuntimeError):
    """Development outcomes cannot be reconstructed without breaking the lock."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _code(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.lstrip("-").isdigit():
        number = int(text)
        return str(number) if number < 0 else f"{number:02d}"
    return text


def _integer(value: Any) -> int | None:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _finite_float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise MandatoryTourOutcomeError("WTPERFIN5D contains a non-numeric value") from exc
    if not math.isfinite(number):
        raise MandatoryTourOutcomeError("WTPERFIN5D contains a non-finite value")
    return number


def _read_registry(path: Path) -> dict[str, Any]:
    try:
        registry = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise MandatoryTourOutcomeError("The mandatory-tour preregistration is unreadable") from exc
    if registry.get("schema_version") != preregistration.SCHEMA_VERSION:
        raise MandatoryTourOutcomeError("The mandatory-tour preregistration schema is unsupported")
    if registry.get("status") != "pre_registered_before_mandatory_tour_outcome_derivation":
        raise MandatoryTourOutcomeError("The mandatory-tour preregistration is not an unopened lock")
    return registry


def _division_sets(registry: Mapping[str, Any]) -> tuple[set[str], set[str]]:
    selection = registry.get("selection") or {}
    development = {
        _code(row.get("division_code"))
        for row in selection.get("development_divisions") or []
    }
    acceptance = {
        _code(row.get("division_code"))
        for row in selection.get("acceptance_divisions") or []
    }
    if not development or not acceptance or development & acceptance:
        raise MandatoryTourOutcomeError("The preregistered division partition is invalid")
    if development | acceptance != set(preregistration.NHTS_CENSUS_DIVISIONS):
        raise MandatoryTourOutcomeError("The preregistered division partition is incomplete")
    return development, acceptance


def _verify_development_source(
    source_dir: Path, registry_path: Path, registry: Mapping[str, Any]
) -> tuple[Path, dict[str, Any], set[str]]:
    manifest_path = source_dir / development_source.OUTPUT_MANIFEST_NAME
    archive_path = source_dir / development_source.OUTPUT_ARCHIVE_NAME
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise MandatoryTourOutcomeError("The development-source manifest is unreadable") from exc
    if manifest.get("schema_version") != development_source.SCHEMA_VERSION:
        raise MandatoryTourOutcomeError("The development-source schema is unsupported")
    if manifest.get("status") != "development_only_before_acceptance_outcome_derivation":
        raise MandatoryTourOutcomeError("The source is not marked development-only")
    development, acceptance = _division_sets(registry)
    partition = manifest.get("partition") or {}
    if set(partition.get("development_division_codes") or []) != development:
        raise MandatoryTourOutcomeError("The source development divisions do not match the lock")
    if set(partition.get("acceptance_division_codes") or []) != acceptance:
        raise MandatoryTourOutcomeError("The source acceptance divisions do not match the lock")
    if partition.get("acceptance_rows_written") is not False:
        raise MandatoryTourOutcomeError("The source does not prove acceptance rows were excluded")
    if partition.get("acceptance_outcome_columns_used") != []:
        raise MandatoryTourOutcomeError("The source records acceptance outcome access")
    source_record = manifest.get("source") or {}
    if source_record.get("preregistration_sha256") != _sha256(registry_path):
        raise MandatoryTourOutcomeError("The source was built under a different preregistration")
    if source_record.get("source_archive_sha256") != (registry.get("source") or {}).get(
        "archive_sha256"
    ):
        raise MandatoryTourOutcomeError("The source archive lock differs from the preregistration")
    if not archive_path.is_file() or _sha256(archive_path) != (manifest.get("output") or {}).get(
        "archive_sha256"
    ):
        raise MandatoryTourOutcomeError("The development archive SHA-256 does not match its manifest")
    if archive_path.stat().st_size != (manifest.get("output") or {}).get("archive_size_bytes"):
        raise MandatoryTourOutcomeError("The development archive size does not match its manifest")
    return archive_path, manifest, development


def _member_map(archive: zipfile.ZipFile) -> dict[str, str]:
    return {Path(name).name.lower(): name for name in archive.namelist()}


def _rows(
    archive: zipfile.ZipFile,
    member: str,
    required: set[str],
    development: set[str],
) -> list[dict[str, str]]:
    with archive.open(member) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        missing = sorted(required - set(reader.fieldnames or []))
        if missing:
            raise MandatoryTourOutcomeError(
                f"{Path(member).name} cannot reconstruct mandatory tours; missing {', '.join(missing)}"
            )
        rows = list(reader)
    outside = sorted({_code(row.get("CENSUS_D")) for row in rows} - development)
    if outside:
        raise MandatoryTourOutcomeError(
            f"{Path(member).name} contains rows outside the development divisions: "
            + ", ".join(outside)
        )
    return rows


def _implementation_record() -> dict[str, Any]:
    repository = Path(__file__).resolve().parents[2]
    paths = [
        Path(__file__).resolve(),
        Path(preregistration.__file__).resolve(),
        Path(development_source.__file__).resolve(),
        Path(diaries.__file__).resolve(),
        Path(nhts.__file__).resolve(),
    ]
    files = [
        {"path": str(path.relative_to(repository)), "sha256": _sha256(path)}
        for path in sorted(paths, key=lambda item: str(item))
    ]
    closure = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {"closure_sha256": closure, "files": files}


def _trip_for_reconstruction(row: Mapping[str, str]) -> dict[str, Any]:
    household_id = str(row.get("HOUSEID") or "").strip()
    person_number = str(row.get("PERSONID") or "").strip()
    trip_number = _integer(row.get("TRIPID"))
    from_code = _code(row.get("WHYFROM"))
    to_code = _code(row.get("WHYTO"))
    origin = diaries.PURPOSE.get(from_code, "unknown")
    destination = diaries.PURPOSE.get(to_code, "unknown")
    depart = diaries.hhmm_to_minutes(row.get("STRTTIME"))
    arrive = diaries.hhmm_to_minutes(row.get("ENDTIME"))
    person_id = f"{household_id}:{person_number}"
    return {
        "trip_id": f"{person_id}:{row.get('TRIPID')}",
        "person_id": person_id,
        "household_id": household_id,
        "trip_number": trip_number,
        "survey_weight": 1.0,
        "holdout_fold": _code(row.get("CENSUS_D")),
        "origin_purpose": origin,
        "destination_purpose": destination,
        "depart_minutes": depart,
        "arrive_minutes": arrive,
        "usable_for_tour_reconstruction": (
            trip_number is not None
            and origin != "unknown"
            and destination != "unknown"
            and depart is not None
            and arrive is not None
        ),
    }


def _outcome_for_person(
    person_id: str, trips: list[dict[str, Any]], weekday_weight: float
) -> dict[str, Any]:
    if weekday_weight <= 0:
        return {
            "weekday_weight": "",
            "work_tours": "",
            "school_tours": "",
            "alternative": "",
            "outcome_status": "not_weekday_study_population",
            "exclusion_reason": "nonpositive_WTPERFIN5D",
        }
    if not trips:
        return {
            "weekday_weight": weekday_weight,
            "work_tours": 0,
            "school_tours": 0,
            "alternative": "",
            "outcome_status": "no_observed_mandatory_pattern",
            "exclusion_reason": "observed_mandatory_DAP_absent",
        }
    tours, assignments, _exclusions = diaries.reconstruct_home_based_tours(
        trips, person_weights={person_id: weekday_weight}
    )
    trip_statuses = {
        str(assignment.get("tour_reconstruction_status"))
        for assignment in assignments.values()
    }
    incomplete = sorted(trip_statuses & INCOMPLETE_STATUSES)
    if incomplete:
        return {
            "weekday_weight": weekday_weight,
            "work_tours": "",
            "school_tours": "",
            "alternative": "",
            "outcome_status": "incomplete_diary",
            "exclusion_reason": "|".join(incomplete),
        }
    work_tours = sum(tour["tour_type"] == "work" for tour in tours)
    school_tours = sum(tour["tour_type"] == "school" for tour in tours)
    if work_tours + school_tours == 0:
        return {
            "weekday_weight": weekday_weight,
            "work_tours": 0,
            "school_tours": 0,
            "alternative": "",
            "outcome_status": "no_observed_mandatory_pattern",
            "exclusion_reason": "observed_mandatory_DAP_absent",
        }
    alternative = SUPPORTED_ALTERNATIVES.get((work_tours, school_tours))
    if not alternative:
        return {
            "weekday_weight": weekday_weight,
            "work_tours": work_tours,
            "school_tours": school_tours,
            "alternative": "",
            "outcome_status": "out_of_support_mandatory_pattern",
            "exclusion_reason": f"work={work_tours};school={school_tours}",
        }
    return {
        "weekday_weight": weekday_weight,
        "work_tours": work_tours,
        "school_tours": school_tours,
        "alternative": alternative,
        "outcome_status": "supported_alternative",
        "exclusion_reason": "",
    }


def _summary(rows: list[dict[str, Any]], development: set[str]) -> dict[str, Any]:
    def empty_distribution() -> dict[str, dict[str, float | int]]:
        return {}

    by_division: dict[str, Any] = {
        division: {"records": 0, "weekday_weight": 0.0, "statuses": empty_distribution()}
        for division in sorted(development)
    }
    alternatives = {
        alternative: {"records": 0, "weekday_weight": 0.0}
        for alternative in sorted(SUPPORTED_ALTERNATIVES.values())
    }
    supported_weight = 0.0
    observed_mandatory_weight = 0.0
    for row in rows:
        division = str(row["census_division_code"])
        weight = float(row["weekday_weight"] or 0)
        division_summary = by_division[division]
        division_summary["records"] += 1
        division_summary["weekday_weight"] += weight
        status = str(row["outcome_status"])
        status_summary = division_summary["statuses"].setdefault(
            status, {"records": 0, "weekday_weight": 0.0}
        )
        status_summary["records"] += 1
        status_summary["weekday_weight"] += weight
        if status in {"supported_alternative", "out_of_support_mandatory_pattern"}:
            observed_mandatory_weight += weight
        if status == "supported_alternative":
            supported_weight += weight
            alternative = alternatives[str(row["alternative"])]
            alternative["records"] += 1
            alternative["weekday_weight"] += weight
    for division_summary in by_division.values():
        division_summary["weekday_weight"] = round(division_summary["weekday_weight"], 6)
        for status_summary in division_summary["statuses"].values():
            status_summary["weekday_weight"] = round(status_summary["weekday_weight"], 6)
    for alternative in alternatives.values():
        alternative["weekday_weight"] = round(alternative["weekday_weight"], 6)
    return {
        "records": len(rows),
        "weekday_records": sum(bool(row["weekday_weight"] != "") for row in rows),
        "by_division": by_division,
        "supported_alternatives": alternatives,
        "design_weighted_supported_share": (
            round(supported_weight / observed_mandatory_weight, 12)
            if observed_mandatory_weight > 0
            else None
        ),
        "coverage_denominator": "complete weekday person-days with an observed mandatory pattern",
    }


def build_outcomes(
    development_dir: str | Path,
    registry_path: str | Path,
    output_dir: str | Path,
) -> dict[str, Any]:
    source_dir = Path(development_dir).resolve()
    registry_file = Path(registry_path).resolve()
    output = Path(output_dir).resolve()
    if output.exists() or output.is_symlink():
        raise MandatoryTourOutcomeError(f"{output} already exists; refusing to overwrite it")
    registry = _read_registry(registry_file)
    archive_path, source_manifest, development = _verify_development_source(
        source_dir, registry_file, registry
    )

    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise MandatoryTourOutcomeError("The development source is not a readable ZIP") from exc
    with archive:
        members = _member_map(archive)
        required_members = {
            table: members.get(filename)
            for table, filename in nhts.TABLE_FILES.items()
        }
        missing_members = [
            nhts.TABLE_FILES[table]
            for table, member in required_members.items()
            if member is None
        ]
        if missing_members:
            raise MandatoryTourOutcomeError(
                "The development source is missing " + ", ".join(missing_members)
            )
        households_raw = _rows(
            archive, str(required_members["households"]), HOUSEHOLD_COLUMNS, development
        )
        persons_raw = _rows(
            archive, str(required_members["persons"]), PERSON_COLUMNS, development
        )
        trips_raw = _rows(
            archive, str(required_members["trips"]), TRIP_COLUMNS, development
        )

    expected_counts = (source_manifest.get("partition") or {}).get(
        "development_row_counts"
    ) or {}
    measured_counts = {
        "households": len(households_raw),
        "persons": len(persons_raw),
        "trips": len(trips_raw),
    }
    for table, measured in measured_counts.items():
        if expected_counts.get(table) != measured:
            raise MandatoryTourOutcomeError(
                f"The development {table} row count differs from its manifest"
            )

    households: dict[str, dict[str, str]] = {}
    for row in households_raw:
        household_id = str(row.get("HOUSEID") or "").strip()
        if not household_id or household_id in households:
            raise MandatoryTourOutcomeError("Development households have a missing or duplicate HOUSEID")
        households[household_id] = row

    persons: dict[str, dict[str, Any]] = {}
    for row in persons_raw:
        household_id = str(row.get("HOUSEID") or "").strip()
        person_number = str(row.get("PERSONID") or "").strip()
        person_id = f"{household_id}:{person_number}"
        household = households.get(household_id)
        if not household:
            raise MandatoryTourOutcomeError("A development person has no household record")
        if person_id in persons:
            raise MandatoryTourOutcomeError("Development persons have a duplicate person identifier")
        if _code(row.get("CENSUS_D")) != _code(household.get("CENSUS_D")):
            raise MandatoryTourOutcomeError("A development person and household disagree on CENSUS_D")
        if str(row.get("STRATUMID") or "").strip() != str(
            household.get("STRATUMID") or ""
        ).strip():
            raise MandatoryTourOutcomeError("A development person and household disagree on STRATUMID")
        persons[person_id] = {
            "raw": row,
            "household": household,
            "weekday_weight": _finite_float(row.get("WTPERFIN5D")),
        }

    trips_by_person: dict[str, list[dict[str, Any]]] = {}
    trip_ids: set[str] = set()
    for row in trips_raw:
        household_id = str(row.get("HOUSEID") or "").strip()
        person_number = str(row.get("PERSONID") or "").strip()
        person_id = f"{household_id}:{person_number}"
        person = persons.get(person_id)
        if not person:
            raise MandatoryTourOutcomeError("A development trip has no person record")
        if _code(row.get("CENSUS_D")) != _code(person["raw"].get("CENSUS_D")):
            raise MandatoryTourOutcomeError("A development trip and person disagree on CENSUS_D")
        if person["weekday_weight"] <= 0:
            continue
        trip = _trip_for_reconstruction(row)
        if trip["trip_id"] in trip_ids:
            raise MandatoryTourOutcomeError("Development trips have a duplicate trip identifier")
        trip_ids.add(trip["trip_id"])
        trips_by_person.setdefault(person_id, []).append(trip)

    output_rows: list[dict[str, Any]] = []
    for person_id in sorted(persons):
        person = persons[person_id]
        row = person["raw"]
        household = person["household"]
        outcome = _outcome_for_person(
            person_id, trips_by_person.get(person_id, []), person["weekday_weight"]
        )
        output_rows.append({
            "household_id": str(row["HOUSEID"]).strip(),
            "person_id": person_id,
            "census_division_code": _code(row["CENSUS_D"]),
            "stratum_id": str(row["STRATUMID"]).strip(),
            "age": _integer(row.get("R_AGE")) if _integer(row.get("R_AGE")) is not None else "",
            "sex_code": _code(row.get("R_SEX")),
            "worker_code": _code(row.get("WORKER")),
            "school_code": _code(row.get("SCHOOL1")),
            "household_size": _integer(household.get("HHSIZE")) if _integer(household.get("HHSIZE")) is not None else "",
            "workers": _integer(household.get("WRKCOUNT")) if _integer(household.get("WRKCOUNT")) is not None else "",
            "drivers": _integer(household.get("DRVRCNT")) if _integer(household.get("DRVRCNT")) is not None else "",
            "vehicles": _integer(household.get("HHVEHCNT")) if _integer(household.get("HHVEHCNT")) is not None else "",
            "income_category_code": _code(household.get("HHFAMINC_IMP")),
            "urban_rural_code": _code(household.get("URBRUR")),
            **outcome,
        })

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".mandatory-tour-outcomes-", dir=output.parent))
    try:
        csv_path = staging / OUTPUT_NAME
        with csv_path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(output_rows)
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "status": "development_outcomes_only_acceptance_unopened",
            "component": "mandatory_tour_frequency",
            "source": {
                "preregistration_sha256": _sha256(registry_file),
                "development_manifest_sha256": _sha256(
                    source_dir / development_source.OUTPUT_MANIFEST_NAME
                ),
                "development_archive_sha256": _sha256(archive_path),
            },
            "implementation": _implementation_record(),
            "outputs": {
                "person_days": OUTPUT_NAME,
                "person_days_sha256": _sha256(csv_path),
                "person_days_size_bytes": csv_path.stat().st_size,
            },
            "summary": _summary(output_rows, development),
            "study_contract": {
                "unit": "weekday person-day",
                "weight": "WTPERFIN5D exactly once per person-day",
                "eligibility": "observed mandatory daily pattern conditional on complete diary",
                "unsupported_patterns_coerced": False,
                "acceptance_outcomes_read": False,
            },
        }
        (staging / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        )
        if output.exists() or output.is_symlink():
            raise MandatoryTourOutcomeError(
                f"{output} appeared while reconstructing outcomes; refusing to overwrite it"
            )
        staging.rename(output)
        return manifest
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("development_dir")
    parser.add_argument("registry")
    parser.add_argument("output_dir")
    args = parser.parse_args(argv)
    manifest = build_outcomes(args.development_dir, args.registry, args.output_dir)
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
