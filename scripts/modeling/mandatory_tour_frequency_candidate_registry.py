#!/usr/bin/env python3
"""Freeze the mandatory-tour candidate family before fitting it.

This United States survey adapter may read development outcomes, but it refuses
any acceptance-division row.  The registry fixes the reference offsets,
harmonized predictors, regularization grid, geographic cross-validation, and
development gate before coefficients are estimated.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping

import mandatory_tour_frequency_outcomes as outcomes
import mandatory_tour_frequency_registry as preregistration


SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-frequency-candidate-registry.v1"
STATUS = "development_protocol_frozen_acceptance_unopened"
ALTERNATIVES = ("work1", "work2", "school1", "school2", "work_and_school")
REFERENCE_ALTERNATIVE = "work1"
REGULARIZATION_GRID = (
    0.0001,
    0.0003,
    0.001,
    0.003,
    0.01,
    0.03,
    0.1,
    0.3,
    1.0,
    3.0,
    10.0,
    30.0,
    100.0,
)

PREDICTORS = (
    {
        "name": "age_centered_decades",
        "observed": "(R_AGE - 40) / 10",
        "runtime": "(age - 40) / 10",
    },
    {
        "name": "age_centered_decades_squared",
        "observed": "((R_AGE - 40) / 10) ** 2",
        "runtime": "((age - 40) / 10) ** 2",
    },
    {
        "name": "female",
        "observed": "R_SEX == 2",
        "runtime": "female",
    },
    {
        "name": "household_size_minus_one_clip_4",
        "observed": "min(HHSIZE, 5) - 1",
        "runtime": "@df.hhsize.clip(upper=5) - 1",
    },
    {
        "name": "workers_clip_3",
        "observed": "min(WRKCOUNT, 3)",
        "runtime": "@df.num_workers.clip(upper=3)",
    },
    {
        "name": "vehicles_clip_4",
        "observed": "min(HHVEHCNT, 4)",
        "runtime": "@df.auto_ownership.clip(upper=4)",
    },
    {
        "name": "no_vehicle",
        "observed": "HHVEHCNT == 0",
        "runtime": "auto_ownership == 0",
    },
)


class MandatoryTourCandidateRegistryError(RuntimeError):
    """The candidate protocol cannot be frozen without breaking the lock."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise MandatoryTourCandidateRegistryError(f"{label} is unreadable: {path}") from exc
    if not isinstance(value, dict):
        raise MandatoryTourCandidateRegistryError(f"{label} must be a JSON object")
    return value


def _codes(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    return sorted(str(row["division_code"]) for row in rows)


def _nonnegative_integer(value: Any) -> int | None:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _predictors_valid(row: Mapping[str, str]) -> bool:
    return (
        _nonnegative_integer(row.get("age")) is not None
        and str(row.get("sex_code") or "") in {"01", "02"}
        and _nonnegative_integer(row.get("household_size")) is not None
        and _nonnegative_integer(row.get("workers")) is not None
        and _nonnegative_integer(row.get("vehicles")) is not None
    )


def _read_development_rows(
    person_days_path: Path,
    *,
    development_codes: set[str],
    acceptance_codes: set[str],
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    try:
        handle = person_days_path.open(newline="")
    except OSError as exc:
        raise MandatoryTourCandidateRegistryError(
            f"Development person-days are unreadable: {person_days_path}"
        ) from exc
    with handle:
        reader = csv.DictReader(handle)
        missing = sorted(set(outcomes.OUTPUT_COLUMNS) - set(reader.fieldnames or []))
        if missing:
            raise MandatoryTourCandidateRegistryError(
                "Development person-days are missing " + ", ".join(missing)
            )
        rows = list(reader)

    discovered = {str(row["census_division_code"]) for row in rows}
    forbidden = sorted(discovered & acceptance_codes)
    if forbidden:
        raise MandatoryTourCandidateRegistryError(
            "Development outcomes contain locked acceptance divisions: " + ", ".join(forbidden)
        )
    unexpected = sorted(discovered - development_codes)
    missing_divisions = sorted(development_codes - discovered)
    if unexpected or missing_divisions:
        raise MandatoryTourCandidateRegistryError(
            "Development outcome divisions do not match the preregistration; "
            f"missing={missing_divisions}, unexpected={unexpected}"
        )

    supported = [row for row in rows if row["outcome_status"] == "supported_alternative"]
    if not supported:
        raise MandatoryTourCandidateRegistryError("No supported development outcomes are available")
    alternatives = {alternative: 0 for alternative in ALTERNATIVES}
    invalid_predictors = 0
    invalid_by_division = {code: 0 for code in sorted(development_codes)}
    records_by_division = {code: 0 for code in sorted(development_codes)}
    weighted_by_division = {code: 0.0 for code in sorted(development_codes)}
    for row in supported:
        alternative = str(row["alternative"])
        if alternative not in alternatives:
            raise MandatoryTourCandidateRegistryError(
                f"Development outcomes contain an unsupported alternative: {alternative}"
            )
        try:
            weight = float(row["weekday_weight"])
        except (TypeError, ValueError) as exc:
            raise MandatoryTourCandidateRegistryError(
                "A supported development outcome has an invalid weekday weight"
            ) from exc
        if not math.isfinite(weight) or weight <= 0:
            raise MandatoryTourCandidateRegistryError(
                "A supported development outcome has a non-positive weekday weight"
            )
        code = str(row["census_division_code"])
        alternatives[alternative] += 1
        records_by_division[code] += 1
        weighted_by_division[code] += weight
        if not _predictors_valid(row):
            invalid_predictors += 1
            invalid_by_division[code] += 1
    empty_alternatives = [name for name, count in alternatives.items() if count == 0]
    if empty_alternatives:
        raise MandatoryTourCandidateRegistryError(
            "Development outcomes do not observe every locked alternative: "
            + ", ".join(empty_alternatives)
        )
    return rows, {
        "supported_records": len(supported),
        "supported_alternative_records": alternatives,
        "candidate_predictor_valid_records": len(supported) - invalid_predictors,
        "candidate_predictor_invalid_records": invalid_predictors,
        "supported_records_by_division": records_by_division,
        "supported_weight_by_division": {
            code: round(value, 6) for code, value in weighted_by_division.items()
        },
        "candidate_predictor_invalid_records_by_division": invalid_by_division,
    }


def build_registry(
    outcomes_dir: str | Path,
    preregistration_path: str | Path,
) -> dict[str, Any]:
    source_dir = Path(outcomes_dir).resolve()
    prereg_path = Path(preregistration_path).resolve()
    prereg = _load_json(prereg_path, "Mandatory-tour preregistration")
    if prereg.get("schema_version") != preregistration.SCHEMA_VERSION:
        raise MandatoryTourCandidateRegistryError("Unsupported mandatory-tour preregistration")
    if prereg.get("status") != "pre_registered_before_mandatory_tour_outcome_derivation":
        raise MandatoryTourCandidateRegistryError("The mandatory-tour preregistration is not locked")

    manifest_path = source_dir / outcomes.MANIFEST_NAME
    manifest = _load_json(manifest_path, "Development outcome manifest")
    if manifest.get("schema_version") != outcomes.SCHEMA_VERSION:
        raise MandatoryTourCandidateRegistryError("Unsupported development outcome manifest")
    if manifest.get("status") != "development_outcomes_only_acceptance_unopened":
        raise MandatoryTourCandidateRegistryError(
            "The development outcome manifest does not keep acceptance unopened"
        )
    if manifest.get("study_contract", {}).get("acceptance_outcomes_read") is not False:
        raise MandatoryTourCandidateRegistryError("Acceptance outcomes were not kept unopened")
    if manifest.get("source", {}).get("preregistration_sha256") != _sha256(prereg_path):
        raise MandatoryTourCandidateRegistryError(
            "Development outcomes do not belong to this exact preregistration"
        )

    person_days_path = source_dir / str(manifest.get("outputs", {}).get("person_days") or "")
    if not person_days_path.is_file():
        raise MandatoryTourCandidateRegistryError("Development person-days are missing")
    if manifest["outputs"].get("person_days_sha256") != _sha256(person_days_path):
        raise MandatoryTourCandidateRegistryError("Development person-days changed after reconstruction")
    if manifest["outputs"].get("person_days_size_bytes") != person_days_path.stat().st_size:
        raise MandatoryTourCandidateRegistryError("Development person-day size changed after reconstruction")

    selection = prereg.get("selection", {})
    development_codes = set(_codes(selection.get("development_divisions", [])))
    acceptance_codes = set(_codes(selection.get("acceptance_divisions", [])))
    if not development_codes or not acceptance_codes or development_codes & acceptance_codes:
        raise MandatoryTourCandidateRegistryError("Preregistered geographic split is invalid")
    _rows, inventory = _read_development_rows(
        person_days_path,
        development_codes=development_codes,
        acceptance_codes=acceptance_codes,
    )
    expected_supported = sum(
        int(item["records"])
        for item in manifest.get("summary", {}).get("supported_alternatives", {}).values()
    )
    if expected_supported != inventory["supported_records"]:
        raise MandatoryTourCandidateRegistryError(
            "Development person-days disagree with their supported-outcome summary"
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "status": STATUS,
        "component": "mandatory_tour_frequency",
        "acceptance_outcomes_read": False,
        "source": {
            "preregistration_sha256": _sha256(prereg_path),
            "development_outcome_manifest_sha256": _sha256(manifest_path),
            "development_person_days_sha256": _sha256(person_days_path),
            "outcome_reconstruction_closure_sha256": manifest["implementation"][
                "closure_sha256"
            ],
            "development_division_codes": sorted(development_codes),
            "acceptance_division_codes_committed_but_not_read": sorted(acceptance_codes),
        },
        "development_inventory": inventory,
        "reference_model": {
            "status_cells": [
                "not_worker_not_student",
                "not_worker_student",
                "worker_not_student",
                "worker_student",
            ],
            "observed_status_mapping": {
                "worker": "WORKER == 01",
                "student": "SCHOOL1 == 01",
            },
            "runtime_status_mapping": {
                "worker": "is_worker",
                "student": "is_student",
            },
            "fit_scope": "training divisions only for each fold; all development divisions for final fit",
            "probabilities": (
                "Within each status cell, normalize positive survey weights to sum to the "
                "cell record count, add alpha to every alternative, then renormalize. "
                "Use the similarly normalized pooled training distribution only if a cell is empty."
            ),
            "additive_smoothing_alpha": prereg["reference_model"][
                "additive_smoothing_alpha"
            ],
            "candidate_offset": "natural logarithm of the training-only reference probability",
            "holdout_information_allowed": False,
        },
        "candidate_model": {
            "family": "weighted multinomial logit with fixed reference-probability offsets",
            "alternatives": list(ALTERNATIVES),
            "reference_alternative": REFERENCE_ALTERNATIVE,
            "identification": (
                "The reference alternative has zero learned coefficients. Each other alternative "
                "has one coefficient per predictor and no learned intercept."
            ),
            "nesting_proof": (
                "Setting every learned coefficient to zero reproduces the reference probabilities exactly."
            ),
            "predictors": list(PREDICTORS),
            "invalid_predictor_row_rule": (
                "Retain the outcome in every score but use the reference probabilities; do not fit "
                "a coefficient contribution from that row. Runtime inputs are required to be valid."
            ),
            "excluded_predictors": {
                "DRVRCNT": (
                    "NHTS counts licensed drivers; prototype_mtc counts every household member age 16+."
                ),
                "URBRUR": (
                    "NHTS reports an official urban/rural classification; prototype_mtc derives a "
                    "local density area type from OpenPlan zones."
                ),
                "linked_roster_R_AGE_young_children": (
                    "NHTS person records begin at age five, while prototype_mtc counts every person age 0-5."
                ),
                "HHFAMINC_IMP": (
                    "NHTS brackets are 2022 dollars, while prototype_mtc receives OpenPlan household "
                    "income deflated to year-2000 dollars. No threshold is treated as equivalent."
                ),
                "regional_or_LOS_fields": (
                    "Forbidden by the preregistration or unavailable with the same observed meaning."
                ),
            },
        },
        "estimation": {
            "case_weight": "WTPERFIN5D once per supported person-day",
            "weight_normalization": (
                "Within each training fit, multiply positive weights so their sum equals the "
                "number of training records. Report validation metrics with original weights."
            ),
            "objective": "mean normalized weighted negative log likelihood + 0.5 * lambda * sum(beta^2)",
            "regularization": "L2 on every learned coefficient; reference offsets are never penalized",
            "lambda_grid": list(REGULARIZATION_GRID),
            "optimizer": {
                "implementation": "scipy.optimize.minimize",
                "method": "L-BFGS-B",
                "analytic_gradient": True,
                "maximum_iterations": 5000,
                "ftol": 1e-12,
                "gtol": 1e-8,
                "all_folds_and_final_fit_must_converge": True,
            },
        },
        "development_selection": {
            "folds": "leave one whole development Census division out",
            "division_codes": sorted(development_codes),
            "selection_metric": "pooled original-weight multiclass log loss across held-out divisions",
            "selection_rule": (
                "Choose the lowest pooled log loss; among lambdas within 1e-10, choose the largest lambda."
            ),
            "grid_boundary_rule": (
                "Refuse to freeze coefficients if the selected lambda is the smallest or largest grid value."
            ),
            "development_gate": {
                "candidate_pooled_log_loss_must_be_below_reference": True,
                "minimum_division_log_loss_wins": 4,
                "required_division_wins_denominator": len(development_codes),
                "all_fits_must_converge": True,
            },
            "acceptance_information_allowed": False,
        },
        "next_lock": {
            "before_acceptance_outcomes_may_be_derived": [
                "immutable candidate ActivitySim package and every coefficient-file SHA-256",
                "immutable reference-model implementation SHA-256",
                "immutable acceptance-evaluator implementation SHA-256",
                "this candidate registry SHA-256",
                "the hashes already required by the original preregistration",
            ],
            "candidate_package_status_until_acceptance": "candidate_not_accepted_for_production",
        },
        "limits": [
            "This registry authorizes development fitting, not production installation.",
            "It estimates only mandatory tour frequency conditional on an observed mandatory DAP.",
            "It does not validate any other borrowed ActivitySim component.",
        ],
    }


def write_registry(registry: Mapping[str, Any], path: str | Path) -> Path:
    output = Path(path).resolve()
    if output.exists() or output.is_symlink():
        try:
            existing = json.loads(output.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise MandatoryTourCandidateRegistryError(
                f"Existing candidate registry is unreadable: {output}"
            ) from exc
        if existing != registry:
            raise MandatoryTourCandidateRegistryError(
                f"{output} already freezes a different candidate protocol; rewriting is forbidden"
            )
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
    return output


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outcomes_dir", help="Development-only reconstructed outcome directory")
    parser.add_argument("preregistration", help="Immutable mandatory-tour preregistration")
    parser.add_argument("output", help="Immutable candidate protocol registry")
    args = parser.parse_args(argv)
    registry = build_registry(args.outcomes_dir, args.preregistration)
    output = write_registry(registry, args.output)
    print(json.dumps({"registry": str(output), "registry_sha256": _sha256(output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
