#!/usr/bin/env python3
"""Map FHWA NHTS V2.1 into weighted, auditable behavioral diaries.

The output is intentionally one step before ActivitySim survey tables. Public
NHTS has no local zone identifiers, so claiming destination-choice or
LOS-sensitive mode-choice estimation from it would invent geography. Every
normalized value retains its raw source code, and the manifest names which
ActivitySim components this source can and cannot support.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import zipfile
from pathlib import Path
from typing import Any, Iterable

import us_nhts_survey as source


DIARY_SCHEMA_VERSION = "openplan.behavioral-survey-diaries.v1"

HOUSEHOLD_COLUMNS = {
    "HOUSEID", "WTHHFIN", "CENSUS_D", "HHSIZE", "HHVEHCNT", "WRKCOUNT",
    "HHFAMINC_IMP", "URBRUR",
}
PERSON_COLUMNS = {
    "HOUSEID", "PERSONID", "WTPERFIN", "R_AGE", "R_SEX", "WORKER", "SCHOOL1",
}
TRIP_COLUMNS = {
    "HOUSEID", "PERSONID", "TRIPID", "WTTRDFIN", "TRIPMODE", "WHYFROM", "WHYTO",
    "STRTTIME", "ENDTIME", "TRPMILES", "CENSUS_D",
}

MODE = {
    "01": "private_vehicle_driver",
    "02": "private_vehicle_passenger",
    "03": "public_transit",
    "04": "school_bus",
    "05": "walk",
    "06": "bike",
    "07": "other",
}

PURPOSE = {
    "01": "home",
    "02": "home",
    "03": "work",
    "04": "work",
    "05": "work",
    "06": "school",
    "07": "escort",
    "08": "other_discretionary",
    "09": "change_mode",
    "10": "escort",
    "11": "other_maintenance",
    "12": "eat_out",
    "13": "shopping",
    "14": "other_maintenance",
    "15": "other_discretionary",
    "16": "other_discretionary",
    "17": "social",
    "18": "other_discretionary",
    "19": "social",
    "97": "other",
}


class NhtsDiaryError(RuntimeError):
    pass


def _code(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.lstrip("-").isdigit():
        number = int(text)
        return str(number) if number < 0 else f"{number:02d}"
    return text


def _positive_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def hhmm_to_minutes(value: Any) -> int | None:
    """NHTS HHMM to minutes after midnight; invalid/refused codes stay absent."""
    try:
        hhmm = int(float(value))
    except (TypeError, ValueError):
        return None
    if hhmm == 2400:
        return 1440
    hours, minutes = divmod(hhmm, 100)
    if hhmm < 0 or hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def _integer(value: Any) -> int | None:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _member_map(archive: zipfile.ZipFile) -> dict[str, str]:
    return {Path(name).name.lower(): name for name in archive.namelist()}


def _rows(archive: zipfile.ZipFile, member: str, required: set[str]) -> list[dict[str, str]]:
    with archive.open(member) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        missing = sorted(required - set(reader.fieldnames or []))
        if missing:
            raise NhtsDiaryError(
                f"{Path(member).name} cannot map behavioral diaries; missing {', '.join(missing)}"
            )
        return list(reader)


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        raise NhtsDiaryError(f"Refusing to write an empty behavioral diary: {path.name}")
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def activitysim_component_support() -> dict[str, dict[str, str]]:
    """Measured support, never a blanket 'nationally calibrated' claim."""
    support = {
        name: {
            "status": "blocked_missing_local_zone_geography",
            "reason": "Public-use NHTS has no local origin/destination zone identifiers or matching LOS.",
        }
        for name in (
            "school_location", "workplace_location", "joint_tour_destination",
            "non_mandatory_tour_destination", "atwork_subtour_destination", "trip_destination",
            "tour_mode_choice", "trip_mode_choice",
        )
    }
    support.update({
        "auto_ownership": {
            "status": "candidate_requires_estimation_specification",
            "reason": "Weighted household vehicle ownership and household/person predictors are observed.",
        },
        "free_parking": {
            "status": "not_mapped",
            "reason": "This diary slice does not yet map the NHTS workplace parking variables.",
        },
    })
    for name in (
        "cdap", "mandatory_tour_frequency", "work_tour_scheduling", "school_tour_scheduling",
        "joint_tour_frequency", "joint_tour_composition", "joint_tour_participation",
        "joint_tour_scheduling", "non_mandatory_tour_frequency",
        "non_mandatory_tour_scheduling", "atwork_subtour_frequency",
        "atwork_subtour_scheduling", "stop_frequency",
    ):
        support[name] = {
            "status": "blocked_until_tours_are_reconstructed",
            "reason": "Observed trips are mapped, but tour chains have not yet been inferred and validated.",
        }
    return dict(sorted(support.items()))


def build_diaries(archive_path: str | Path, output_dir: str | Path) -> dict[str, Any]:
    inventory = source.inspect_archive(archive_path)
    source.require_estimation_contract(inventory)
    if inventory["geographic_holdouts"]["records_missing_geography"]:
        raise NhtsDiaryError(
            "NHTS diaries cannot assign geographic holdouts because household geography is missing"
        )
    assignments = {
        division: fold["fold"]
        for fold in inventory["geographic_holdouts"]["folds"]
        for division in fold["division_codes"]
    }
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive_path) as archive:
        members = _member_map(archive)
        households_raw = _rows(
            archive, members[source.TABLE_FILES["households"]], HOUSEHOLD_COLUMNS
        )
        persons_raw = _rows(archive, members[source.TABLE_FILES["persons"]], PERSON_COLUMNS)
        trips_raw = _rows(archive, members[source.TABLE_FILES["trips"]], TRIP_COLUMNS)

    households = []
    for row in households_raw:
        division = _code(row["CENSUS_D"])
        households.append({
            "household_id": row["HOUSEID"],
            "survey_weight": _positive_float(row["WTHHFIN"]),
            "holdout_fold": assignments[division],
            "census_division_code": division,
            "household_size": _integer(row["HHSIZE"]),
            "vehicles": _integer(row["HHVEHCNT"]),
            "workers": _integer(row["WRKCOUNT"]),
            "income_category_code": _code(row["HHFAMINC_IMP"]),
            "urban_rural_code": _code(row["URBRUR"]),
        })

    persons = []
    for row in persons_raw:
        persons.append({
            "person_id": f"{row['HOUSEID']}:{row['PERSONID']}",
            "household_id": row["HOUSEID"],
            "person_number": _integer(row["PERSONID"]),
            "survey_weight": _positive_float(row["WTPERFIN"]),
            "age": _integer(row["R_AGE"]),
            "sex_code": _code(row["R_SEX"]),
            "is_worker": _code(row["WORKER"]) == "01",
            "is_student": _code(row["SCHOOL1"]) == "01",
        })

    trips = []
    unmapped_modes = 0
    unmapped_purposes = 0
    for row in trips_raw:
        division = _code(row["CENSUS_D"])
        mode_code = _code(row["TRIPMODE"])
        from_code = _code(row["WHYFROM"])
        to_code = _code(row["WHYTO"])
        mode = MODE.get(mode_code, "unknown")
        origin_purpose = PURPOSE.get(from_code, "unknown")
        destination_purpose = PURPOSE.get(to_code, "unknown")
        unmapped_modes += mode == "unknown"
        unmapped_purposes += origin_purpose == "unknown" or destination_purpose == "unknown"
        person_id = f"{row['HOUSEID']}:{row['PERSONID']}"
        depart = hhmm_to_minutes(row["STRTTIME"])
        arrive = hhmm_to_minutes(row["ENDTIME"])
        trips.append({
            "trip_id": f"{person_id}:{row['TRIPID']}",
            "person_id": person_id,
            "household_id": row["HOUSEID"],
            "trip_number": _integer(row["TRIPID"]),
            "survey_weight": _positive_float(row["WTTRDFIN"]),
            "holdout_fold": assignments[division],
            "mode": mode,
            "mode_source_code": mode_code,
            "origin_purpose": origin_purpose,
            "origin_purpose_source_code": from_code,
            "destination_purpose": destination_purpose,
            "destination_purpose_source_code": to_code,
            "depart_minutes": depart,
            "arrive_minutes": arrive,
            "distance_miles": _positive_float(row["TRPMILES"]),
            "has_local_zone_geography": False,
            "usable_for_tour_reconstruction": (
                mode != "unknown" and origin_purpose != "unknown"
                and destination_purpose != "unknown" and depart is not None and arrive is not None
            ),
        })

    _write(output / "observed_households.csv", households)
    _write(output / "observed_persons.csv", persons)
    _write(output / "observed_trips.csv", trips)
    manifest = {
        "schema_version": DIARY_SCHEMA_VERSION,
        "source": inventory,
        "outputs": {
            "households": len(households), "persons": len(persons), "trips": len(trips),
        },
        "mapping_quality": {
            "unmapped_trip_modes": unmapped_modes,
            "trips_with_any_unmapped_purpose": unmapped_purposes,
            "tour_reconstruction_eligible_trips": sum(
                bool(row["usable_for_tour_reconstruction"]) for row in trips
            ),
        },
        "activitysim_component_support": activitysim_component_support(),
        "caveats": [
            "These are weighted observed diaries, not estimated ActivitySim coefficients.",
            "Public-use NHTS has no local zone geography; location and LOS-sensitive components are blocked.",
            "Tour-dependent components remain blocked until tour chains are reconstructed and validated.",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("output_dir")
    args = parser.parse_args(argv)
    print(json.dumps(build_diaries(args.archive, args.output_dir), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
