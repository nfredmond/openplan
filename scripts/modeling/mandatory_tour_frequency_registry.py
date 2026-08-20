#!/usr/bin/env python3
"""Lock the NHTS mandatory-tour study before deriving tour outcomes.

This United States source adapter reads only the NHTS person table. Holdout
selection may use Census division, weekday person counts, and weekday person
weights. It never opens the trip table, because those records contain the
work and school travel from which the acceptance outcome will later be built.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import math
import zipfile
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import us_nhts_survey as source


SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-frequency-preregistration.v1"
ACCEPTANCE_DIVISION_COUNT = 3
REFERENCE_SMOOTHING_ALPHA = 0.5
ACTIVITYSIM_SEEDS = list(range(2026081901, 2026081921))

# NHTS is a United States adapter. These codes never enter a shared geography
# type, and a future country's travel survey would provide its own registry.
NHTS_CENSUS_DIVISIONS = {
    "01": "new_england",
    "02": "middle_atlantic",
    "03": "east_north_central",
    "04": "west_north_central",
    "05": "south_atlantic",
    "06": "east_south_central",
    "07": "west_south_central",
    "08": "mountain",
    "09": "pacific",
}

PERSON_MEMBER = source.TABLE_FILES["persons"]
PRE_OUTCOME_PERSON_COLUMNS = {
    "HOUSEID",
    "PERSONID",
    "WTPERFIN5D",
    "CENSUS_D",
    "STRATUMID",
}

ALTERNATIVES = {
    "work1": {"work_tours": 1, "school_tours": 0},
    "work2": {"work_tours": 2, "school_tours": 0},
    "school1": {"work_tours": 0, "school_tours": 1},
    "school2": {"work_tours": 0, "school_tours": 2},
    "work_and_school": {"work_tours": 1, "school_tours": 1},
}


class MandatoryTourRegistryError(RuntimeError):
    """The pre-outcome study lock cannot be built honestly."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _member_map(archive: zipfile.ZipFile) -> dict[str, str]:
    return {Path(name).name.lower(): name for name in archive.namelist()}


def _division_code(value: Any) -> str:
    text = str(value or "").strip()
    if text.isdigit():
        return text.zfill(2)
    return text


def _weekday_weight(value: Any) -> float:
    try:
        weight = float(value)
    except (TypeError, ValueError) as exc:
        raise MandatoryTourRegistryError(
            "NHTS WTPERFIN5D contains a missing or non-numeric value"
        ) from exc
    if not math.isfinite(weight) or weight < 0:
        raise MandatoryTourRegistryError(
            "NHTS WTPERFIN5D contains a negative or non-finite value"
        )
    return weight


def inspect_pre_outcome_person_design(archive_path: str | Path) -> dict[str, Any]:
    """Inventory only inputs allowed to choose the geographic holdout."""
    path = Path(archive_path).resolve()
    if not path.is_file():
        raise MandatoryTourRegistryError(f"NHTS archive does not exist: {path}")
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise MandatoryTourRegistryError("NHTS source is not a readable ZIP archive") from exc

    with archive:
        members = _member_map(archive)
        member = members.get(PERSON_MEMBER)
        if not member:
            raise MandatoryTourRegistryError(
                f"NHTS archive has no {PERSON_MEMBER}; no holdout can be selected"
            )
        with archive.open(member) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
            missing = sorted(PRE_OUTCOME_PERSON_COLUMNS - set(reader.fieldnames or []))
            if missing:
                raise MandatoryTourRegistryError(
                    f"{PERSON_MEMBER} cannot lock the study; missing {', '.join(missing)}"
                )
            totals = {
                code: {
                    "division_code": code,
                    "division": name,
                    "weekday_person_records": 0,
                    "weighted_weekday_persons": 0.0,
                    "strata": set(),
                    "households": set(),
                }
                for code, name in NHTS_CENSUS_DIVISIONS.items()
            }
            total_records = 0
            zero_weekday_weight_records = 0
            for row in reader:
                total_records += 1
                weight = _weekday_weight(row.get("WTPERFIN5D"))
                if weight == 0:
                    zero_weekday_weight_records += 1
                    continue
                division_code = _division_code(row.get("CENSUS_D"))
                if division_code not in totals:
                    raise MandatoryTourRegistryError(
                        "A positive-weekday-weight person has an unsupported Census division "
                        f"code: {division_code or '<missing>'}"
                    )
                stratum_id = str(row.get("STRATUMID") or "").strip()
                household_id = str(row.get("HOUSEID") or "").strip()
                if not stratum_id or not household_id:
                    raise MandatoryTourRegistryError(
                        "A positive-weekday-weight person is missing STRATUMID or HOUSEID"
                    )
                division = totals[division_code]
                division["weekday_person_records"] += 1
                division["weighted_weekday_persons"] += weight
                division["strata"].add(stratum_id)
                division["households"].add(household_id)

    empty = [code for code, row in totals.items() if not row["weekday_person_records"]]
    if empty:
        raise MandatoryTourRegistryError(
            "The national NHTS weekday sample is missing Census divisions: " + ", ".join(empty)
        )
    divisions = []
    for row in totals.values():
        divisions.append({
            "division_code": row["division_code"],
            "division": row["division"],
            "weekday_person_records": row["weekday_person_records"],
            "weighted_weekday_persons": round(row["weighted_weekday_persons"], 6),
            "survey_strata": len(row["strata"] - {""}),
            "household_clusters": len(row["households"] - {""}),
        })
    return {
        "person_table": PERSON_MEMBER,
        "person_columns_used": sorted(PRE_OUTCOME_PERSON_COLUMNS),
        "outcome_tables_read": [],
        "total_person_records": total_records,
        "zero_weekday_weight_records": zero_weekday_weight_records,
        "weekday_person_records": sum(row["weekday_person_records"] for row in divisions),
        "weighted_weekday_persons": round(
            sum(row["weighted_weekday_persons"] for row in divisions), 6
        ),
        "divisions": divisions,
    }


def select_acceptance_divisions(
    divisions: Sequence[Mapping[str, Any]],
    *,
    acceptance_count: int = ACCEPTANCE_DIVISION_COUNT,
) -> dict[str, Any]:
    """Choose the closest pre-outcome count-and-weight balance."""
    rows = sorted((dict(row) for row in divisions), key=lambda row: row["division_code"])
    if len(rows) <= acceptance_count or acceptance_count < 1:
        raise MandatoryTourRegistryError(
            "The holdout needs at least one development and one acceptance division"
        )
    total_records = sum(int(row["weekday_person_records"]) for row in rows)
    total_weight = sum(float(row["weighted_weekday_persons"]) for row in rows)
    if total_records <= 0 or total_weight <= 0:
        raise MandatoryTourRegistryError("The holdout cannot balance empty person totals")
    target_share = acceptance_count / len(rows)

    scored = []
    for indexes in itertools.combinations(range(len(rows)), acceptance_count):
        chosen = [rows[index] for index in indexes]
        record_share = sum(int(row["weekday_person_records"]) for row in chosen) / total_records
        weight_share = sum(float(row["weighted_weekday_persons"]) for row in chosen) / total_weight
        record_error = abs(record_share - target_share)
        weight_error = abs(weight_share - target_share)
        codes = tuple(row["division_code"] for row in chosen)
        scored.append((max(record_error, weight_error), record_error + weight_error, codes))
    _, _, acceptance_codes = min(scored)
    acceptance_set = set(acceptance_codes)
    acceptance = [row for row in rows if row["division_code"] in acceptance_set]
    development = [row for row in rows if row["division_code"] not in acceptance_set]
    acceptance_record_share = (
        sum(int(row["weekday_person_records"]) for row in acceptance) / total_records
    )
    acceptance_weight_share = (
        sum(float(row["weighted_weekday_persons"]) for row in acceptance) / total_weight
    )
    return {
        "target_acceptance_share": round(target_share, 12),
        "acceptance_record_share": round(acceptance_record_share, 12),
        "acceptance_weight_share": round(acceptance_weight_share, 12),
        "maximum_absolute_balance_error": round(
            max(
                abs(acceptance_record_share - target_share),
                abs(acceptance_weight_share - target_share),
            ),
            12,
        ),
        "acceptance": acceptance,
        "development": development,
    }


def build_registry(archive_path: str | Path) -> dict[str, Any]:
    path = Path(archive_path).resolve()
    design = inspect_pre_outcome_person_design(path)
    split = select_acceptance_divisions(design["divisions"])
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "pre_registered_before_mandatory_tour_outcome_derivation",
        "question": (
            "Does one unchanged nationally estimated mandatory-tour-frequency component "
            "transfer to unseen United States Census divisions?"
        ),
        "component": "mandatory_tour_frequency",
        "source": {
            "source_id": source.SOURCE_ID,
            "source_url": source.SOURCE_URL,
            "archive_sha256": _sha256(path),
            "archive_size_bytes": path.stat().st_size,
            "person_table": design["person_table"],
            "weekday_weight": "WTPERFIN5D",
            "variance_stratum": "STRATUMID",
            "variance_primary_sampling_unit": "HOUSEID",
        },
        "outcome_access_lock": {
            "person_columns_used": design["person_columns_used"],
            "outcome_tables_read": design["outcome_tables_read"],
            "selection_may_use": ["weekday person records", "WTPERFIN5D totals"],
            "selection_may_not_use": [
                "trip purposes",
                "tour reconstruction",
                "mandatory-tour alternatives",
                "candidate or reference losses",
            ],
        },
        "selection": {
            "strategy": (
                "Choose three whole Census divisions whose combined weekday record and "
                "WTPERFIN5D shares are closest to one third; break ties by division code."
            ),
            "total_person_records": design["total_person_records"],
            "zero_weekday_weight_records": design["zero_weekday_weight_records"],
            "weekday_person_records": design["weekday_person_records"],
            "weighted_weekday_persons": design["weighted_weekday_persons"],
            "target_acceptance_share": split["target_acceptance_share"],
            "acceptance_record_share": split["acceptance_record_share"],
            "acceptance_weight_share": split["acceptance_weight_share"],
            "maximum_absolute_balance_error": split["maximum_absolute_balance_error"],
            "acceptance_divisions": split["acceptance"],
            "development_divisions": split["development"],
        },
        "study_population": {
            "unit": "weekday person-day",
            "base": (
                "Start from the person table so people with no reported trips remain visible."
            ),
            "eligibility": (
                "Condition on an observed mandatory daily pattern: at least one complete "
                "home-based work or school tour. This does not estimate CDAP."
            ),
            "complete_diary_rule": (
                "Exclude the person-day if any trip needed for a home-based chain has invalid "
                "time or purpose, a discontinuity, a non-home start, or no return home."
            ),
            "weight": "Use WTPERFIN5D once per eligible person-day; never use a trip weight.",
            "alternatives": ALTERNATIVES,
            "out_of_support": (
                "Publish and exclude every mandatory tour-count pattern outside the five "
                "alternatives; never coerce it to the nearest alternative."
            ),
        },
        "candidate": {
            "coefficient_scope": "one national coefficient vector",
            "allowed_predictors": [
                {"observed": "R_AGE", "runtime": "age"},
                {"observed": "R_SEX", "runtime": "sex"},
                {"observed": "WORKER", "runtime": "is_worker"},
                {"observed": "SCHOOL1", "runtime": "is_student"},
                {"observed": "HHSIZE", "runtime": "household_size"},
                {"observed": "WRKCOUNT", "runtime": "workers"},
                {"observed": "DRVRCNT", "runtime": "drivers"},
                {"observed": "HHVEHCNT", "runtime": "vehicles"},
                {"observed": "HHFAMINC_IMP", "runtime": "income category"},
                {"observed": "URBRUR", "runtime": "home urban or rural classification"},
                {"observed": "linked roster R_AGE", "runtime": "young-child count"},
            ],
            "forbidden_predictors": [
                "CENSUS_D or any regional indicator or intercept",
                "county or state",
                "GCDWORK",
                "invented school distance",
                "invented auto time",
                "telework until the runtime population carries the same observed field",
            ],
            "forbidden_adjustments": [
                "regional scalar",
                "division constant",
                "post-hoc calibration factor",
                "rescaling expected work or school tours before acceptance grading",
            ],
        },
        "reference_model": {
            "fit_geography": "development divisions only",
            "definition": (
                "Weighted alternative frequency within the four observed WORKER by SCHOOL1 "
                "status cells. Fall back to the pooled development frequency only when a "
                "development cell has no eligible person-days."
            ),
            "additive_smoothing_alpha": REFERENCE_SMOOTHING_ALPHA,
            "holdout_information_allowed": False,
        },
        "acceptance_rules": {
            "single_opening": True,
            "all_rules_must_pass": True,
            "outcome_coverage": {
                "minimum_design_weighted_supported_share": 0.95,
                "publish_exclusions_by_division": True,
            },
            "primary_predictive_score": {
                "metric": "paired design-weighted multiclass log loss",
                "variance_method": (
                    "Taylor series with STRATUMID strata and HOUSEID primary sampling units"
                ),
                "candidate_minus_reference_one_sided_confidence": 0.95,
                "upper_confidence_bound_must_be_below": 0.0,
                "candidate_point_estimate_must_win_all_acceptance_divisions": True,
            },
            "choice_distribution": {
                "maximum_pooled_total_variation_distance": 0.05,
                "must_beat_reference_pooled": True,
                "minimum_division_wins": 2,
                "maximum_disadvantage_in_remaining_division": 0.02,
            },
            "tour_totals": {
                "measures": ["work tours per eligible person-day", "school tours per eligible person-day"],
                "variance_method": (
                    "Taylor series with STRATUMID strata and HOUSEID primary sampling units"
                ),
                "inside_design_based_95_percent_interval_pooled": True,
                "minimum_divisions_inside_interval": 2,
                "rescaling_allowed": False,
            },
            "transfer_cells": {
                "dimensions": ["WORKER status", "SCHOOL1 status", "URBRUR"],
                "minimum_unweighted_observations": 100,
                "multiple_comparison_correction": "Holm",
                "reject_any_significant_log_loss_deterioration": True,
            },
            "stochastic_stability": {
                "activitysim_seeds": ACTIVITYSIM_SEEDS,
                "interval": (
                    "For each alternative, expected weighted share is sum(w_i*p_i)/sum(w_i). "
                    "The two-sided 95% Monte Carlo interval is expected share plus or minus "
                    "1.96*sqrt(sum(w_i^2*p_i*(1-p_i)))/sum(w_i)."
                ),
                "every_seed_and_alternative_must_be_inside_interval": True,
            },
        },
        "acceptance_opening_lock": {
            "required_before_any_acceptance_outcome_is_derived_or_read": [
                "this preregistration's SHA-256",
                "outcome-reconstruction implementation SHA-256",
                "frozen candidate package and every coefficient-file SHA-256",
                "frozen reference-model implementation SHA-256",
                "frozen acceptance evaluator implementation SHA-256",
            ],
            "development_results_may_not_change_these_rules": True,
        },
        "limits": [
            "Acceptance applies only to mandatory_tour_frequency conditional on observed mandatory DAP.",
            "It does not validate CDAP, location choice, scheduling, parking, or mode choice.",
            "It does not prove county-level accuracy in an individual place.",
        ],
    }


def write_registry(registry: Mapping[str, Any], path: str | Path) -> Path:
    output = Path(path).resolve()
    if output.exists():
        existing = json.loads(output.read_text())
        if existing != registry:
            raise MandatoryTourRegistryError(
                f"{output} already locks a different study; rewriting it is forbidden"
            )
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
    return output


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="Exact FHWA NHTS CSV ZIP")
    parser.add_argument("output", help="Immutable preregistration JSON")
    args = parser.parse_args(argv)
    registry = build_registry(args.archive)
    output = write_registry(registry, args.output)
    print(json.dumps({"registry": str(output), "registry_sha256": _sha256(output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
