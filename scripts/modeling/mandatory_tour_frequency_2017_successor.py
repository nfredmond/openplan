#!/usr/bin/env python3
"""Freeze and execute the one-opening 2017 NHTS mandatory-tour successor.

The freeze command may read consumed 2022 outcomes and 2017 ZIP metadata plus
CSV headers.  The evaluate command writes and fsyncs its receipt before opening
the first 2017 data row.  It never writes person-level acceptance data.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
from scipy.optimize import minimize
from scipy.stats import t as student_t

import mandatory_tour_frequency_outcomes as consumed_outcomes
import prepare_mandatory_tour_development_source as consumed_source
import us_nhts_diaries as diaries


REPOSITORY = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY / "data/modeling"
PREREGISTRATION_PATH = (
    DATA_ROOT / "mandatory-tour-frequency-2017-successor-preregistration-2026-08-24.json"
)
PACKAGE_DIR = DATA_ROOT / "activitysim-mandatory-tour-frequency-2017-successor"
LOCK_PATH = DATA_ROOT / "mandatory-tour-frequency-2017-successor-opening-lock-2026-08-24.json"
RECEIPT_PATH = (
    DATA_ROOT / "mandatory-tour-frequency-2017-successor-opening-receipt-2026-08-24.json"
)
RESULT_PATH = DATA_ROOT / "mandatory-tour-frequency-2017-successor-result-2026-08-24.json"

CONSUMED_2022_PREREGISTRATION = (
    DATA_ROOT / "mandatory-tour-frequency-preregistration-2026-08-19.json"
)
CONSUMED_2022_LOCK = (
    DATA_ROOT / "mandatory-tour-frequency-acceptance-opening-lock-v2-2026-08-19.json"
)
CONSUMED_2022_RECEIPT = (
    DATA_ROOT / "mandatory-tour-frequency-acceptance-opening-receipt-v2-2026-08-19.json"
)

SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-frequency-2017-successor.v1"
LOCK_SCHEMA_VERSION = f"{SCHEMA_VERSION}.opening-lock"
RECEIPT_SCHEMA_VERSION = f"{SCHEMA_VERSION}.opening-receipt"
RESULT_SCHEMA_VERSION = f"{SCHEMA_VERSION}.result"
PACKAGE_SCHEMA_VERSION = f"{SCHEMA_VERSION}.candidate-package"

CORE_URL = "https://nhts.ornl.gov/media/2016/download/csv.zip"
REPLICATE_URL = "https://nhts.ornl.gov/media/2016/download/ReplicatesCSV.zip"
CORE_MEMBER = "hhpub.csv"
PERSON_MEMBER = "perpub.csv"
TRIP_MEMBER = "trippub.csv"
REPLICATE_MEMBER = "perwgt.csv"
CORE_EXPECTED_SIZE = 83_726_358
REPLICATE_EXPECTED_SIZE = 80_811_775
CORE_EXPECTED_SHA256 = "4f1917d9470fbf351c325ee9fe7d4cdbf71715775d0e0c974ca57861b4d8704d"
REPLICATE_EXPECTED_SHA256 = "730c3634c0adc6945ab60436b19924e221df516970560e46585fc5613148cc46"
CONSUMED_2022_SHA256 = "64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c"

ALTERNATIVES = ("work1", "work2", "school1", "school2", "work_and_school")
REFERENCE_ALTERNATIVE = "work1"
TOUR_COUNTS = np.asarray(((1, 0), (2, 0), (0, 1), (0, 2), (1, 1)), dtype=float)
FEATURES = (
    {
        "name": "age_centered_decades",
        "observed_2022": "(R_AGE - 40) / 10",
        "observed_2017": "(R_AGE_IMP - 40) / 10",
        "runtime": "(age - 40) / 10",
    },
    {
        "name": "age_centered_decades_squared",
        "observed_2022": "((R_AGE - 40) / 10) ** 2",
        "observed_2017": "((R_AGE_IMP - 40) / 10) ** 2",
        "runtime": "((age - 40) / 10) ** 2",
    },
    {"name": "female", "observed_2022": "R_SEX == 2", "observed_2017": "R_SEX_IMP == 2", "runtime": "female"},
    {
        "name": "household_size_minus_one_clip_4",
        "observed_2022": "min(HHSIZE, 5) - 1",
        "observed_2017": "min(HHSIZE, 5) - 1",
        "runtime": "@df.hhsize.clip(upper=5) - 1",
    },
    {
        "name": "workers_clip_3",
        "observed_2022": "min(WRKCOUNT, 3)",
        "observed_2017": "min(WRKCOUNT, 3)",
        "runtime": "@df.num_workers.clip(upper=3)",
    },
)
FORBIDDEN_PREDICTOR_TOKENS = (
    "student",
    "is_student",
    "school_code",
    "vehicle",
    "auto_ownership",
    "hhvehcnt",
    "driver",
    "income",
    "census_d",
    "division",
    "state",
    "fips",
    "smplsrce",
)
AGE_BANDS = (
    (5, 17, "age_05_17"),
    (18, 24, "age_18_24"),
    (25, 44, "age_25_44"),
    (45, 64, "age_45_64"),
    (65, 120, "age_65_plus"),
)
REFERENCE_ALPHA = 0.5
LAMBDA_GRID = (0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0)

REPLICATE_COUNT = 98
JACKKNIFE_FACTOR = 6.0 / 7.0
DESIGN_DEGREES_OF_FREEDOM = 84
FAMILY_ALPHA = 0.05
ONE_SIDED_CRITICAL = float(student_t.ppf(0.95, DESIGN_DEGREES_OF_FREEDOM))
TWO_SIDED_CRITICAL = float(student_t.ppf(0.975, DESIGN_DEGREES_OF_FREEDOM))

THRESHOLDS = {
    "national": {
        "candidate_minus_reference_log_loss_one_sided_upper": 0.0,
        "candidate_total_variation_maximum": 0.05,
        "candidate_choice_share_absolute_error_maximum": 0.05,
        "tour_mean_absolute_error_two_sided_upper_maximum": 0.10,
        "weighted_reconstruction_coverage_minimum": 0.95,
        "weighted_reconstruction_coverage_lower_bound_minimum": 0.90,
        "rare_alternative_unweighted_minimum": 10,
        "rare_alternative_kish_effective_minimum": 5.0,
    },
    "transfer_cells": {
        "unweighted_minimum": 30,
        "kish_effective_minimum": 20.0,
        "holm_family_alpha": FAMILY_ALPHA,
    },
    "division_safety": {
        "unweighted_supported_minimum": 30,
        "kish_effective_minimum": 20.0,
        "holm_family_alpha": FAMILY_ALPHA,
        "candidate_minus_reference_total_variation_maximum": 0.05,
        "weighted_reconstruction_coverage_lower_bound_minimum": 0.80,
        "tour_mean_absolute_error_two_sided_upper_maximum": 0.15,
    },
}

HOUSEHOLD_REQUIRED = {"HOUSEID", "HHSIZE", "WRKCOUNT", "CENSUS_D", "SMPLSRCE", "SAMPSTRAT"}
PERSON_REQUIRED = {
    "HOUSEID", "PERSONID", "R_AGE_IMP", "R_SEX_IMP", "WORKER", "TRAVDAY",
    "TDAYDATE", "FRSTHM17", "OUTOFTWN", "OUTCNTRY", "WTPERFIN", "CENSUS_D",
}
TRIP_REQUIRED = {
    "HOUSEID", "PERSONID", "TDCASEID", "TDTRPNUM", "STRTTIME", "ENDTIME",
    "WHYFROM", "WHYTO", "CENSUS_D",
}
REPLICATE_REQUIRED = {"HOUSEID", "PERSONID", "WTPERFIN"} | {
    f"WTPERFIN{index}" for index in range(1, REPLICATE_COUNT + 1)
}
CENSUS_DIVISIONS = tuple(f"{index:02d}" for index in range(1, 10))
SUPPORTED_ALTERNATIVES = {
    (1, 0): "work1", (2, 0): "work2", (0, 1): "school1",
    (0, 2): "school2", (1, 1): "work_and_school",
}


class SuccessorError(RuntimeError):
    """The sealed study cannot continue without violating its contract."""


class SuccessorInconclusive(SuccessorError):
    """A frozen source or inference prerequisite cannot support a decision."""


@dataclass(frozen=True)
class SourceRows:
    rows: list[dict[str, Any]]
    replicate_weights: np.ndarray
    coverage_rows: list[dict[str, Any]]
    coverage_replicate_weights: np.ndarray
    source_summary: dict[str, Any]


def sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def portable(path: str | Path) -> str:
    resolved = Path(path).resolve()
    try:
        return str(resolved.relative_to(REPOSITORY))
    except ValueError:
        return str(resolved)


def load_json(path: str | Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SuccessorError(f"{label} is unreadable") from exc
    if not isinstance(value, dict):
        raise SuccessorError(f"{label} is not a JSON object")
    return value


def exclusive_json(path: str | Path, value: Mapping[str, Any], *, fsync: bool = False) -> None:
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(target, flags, 0o644)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            if fsync:
                os.fsync(handle.fileno())
    finally:
        os.close(descriptor)
    if fsync:
        parent_descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)


def integer(value: Any) -> int | None:
    try:
        result = int(float(value))
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def code(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.lstrip("-").isdigit():
        number = int(text)
        return str(number) if number < 0 else f"{number:02d}"
    return text


def finite_positive(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise SuccessorInconclusive(f"{label} contains a nonnumeric value") from exc
    if not math.isfinite(result) or result <= 0:
        raise SuccessorInconclusive(f"{label} contains a nonpositive or nonfinite value")
    return result


def age_band(age: Any) -> str | None:
    parsed = integer(age)
    if parsed is None:
        return None
    for lower, upper, name in AGE_BANDS:
        if lower <= parsed <= upper:
            return name
    return None


def reference_cell(row: Mapping[str, Any]) -> str | None:
    band = age_band(row.get("age"))
    worker = code(row.get("worker_code"))
    if band is None or worker not in {"01", "02"}:
        return None
    return f"{'worker' if worker == '01' else 'not_worker'}__{band}"


def feature_values(row: Mapping[str, Any]) -> np.ndarray | None:
    age = integer(row.get("age"))
    sex = code(row.get("sex_code"))
    household_size = integer(row.get("household_size"))
    workers = integer(row.get("workers"))
    if age is None or not 5 <= age <= 120 or sex not in {"01", "02"}:
        return None
    if household_size is None or household_size < 1 or workers is None:
        return None
    centered = (age - 40.0) / 10.0
    return np.asarray(
        [centered, centered * centered, float(sex == "02"), min(household_size, 5) - 1, min(workers, 3)],
        dtype=float,
    )


def normalized_weights(weights: np.ndarray) -> np.ndarray:
    if len(weights) == 0 or np.any(~np.isfinite(weights)) or np.any(weights <= 0):
        raise SuccessorError("Candidate fit weights must all be finite and positive")
    return weights * (len(weights) / float(np.sum(weights)))


def fit_reference(rows: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, float]]:
    cells = [f"{worker}__{band}" for worker in ("not_worker", "worker") for _lo, _hi, band in AGE_BANDS]
    pooled = np.full(len(ALTERNATIVES), REFERENCE_ALPHA, dtype=float)
    by_cell = {cell: np.full(len(ALTERNATIVES), REFERENCE_ALPHA, dtype=float) for cell in cells}
    for row in rows:
        cell = reference_cell(row)
        alternative = str(row.get("alternative") or "")
        if cell is None or alternative not in ALTERNATIVES:
            continue
        weight = finite_positive(row.get("weekday_weight"), "2022 WTPERFIN5D")
        index = ALTERNATIVES.index(alternative)
        pooled[index] += weight
        by_cell[cell][index] += weight
    pooled /= np.sum(pooled)
    result: dict[str, dict[str, float]] = {}
    for cell, counts in by_cell.items():
        probabilities = counts / np.sum(counts) if np.sum(counts) > len(ALTERNATIVES) * REFERENCE_ALPHA else pooled
        result[cell] = {alternative: float(probabilities[index]) for index, alternative in enumerate(ALTERNATIVES)}
    return result


def probability_arrays(
    rows: Sequence[Mapping[str, Any]],
    reference: Mapping[str, Mapping[str, float]],
    coefficients: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    reference_rows: list[list[float]] = []
    features: list[np.ndarray | None] = []
    outcomes: list[int] = []
    pooled = np.mean(np.asarray([list(cell.values()) for cell in reference.values()], dtype=float), axis=0)
    for row in rows:
        cell = reference_cell(row)
        cell_probabilities = reference.get(cell)
        probabilities = (
            [float(cell_probabilities[alternative]) for alternative in ALTERNATIVES]
            if cell_probabilities
            else list(pooled)
        )
        reference_rows.append([float(value) for value in probabilities])
        features.append(feature_values(row))
        outcomes.append(ALTERNATIVES.index(str(row["alternative"])))
    reference_array = np.asarray(reference_rows, dtype=float)
    feature_array = np.asarray(
        [value if value is not None else np.zeros(len(FEATURES), dtype=float) for value in features],
        dtype=float,
    )
    candidate = reference_array.copy()
    if coefficients is not None:
        utilities = np.log(reference_array)
        utilities[:, 1:] += feature_array @ coefficients.T
        utilities -= np.max(utilities, axis=1, keepdims=True)
        candidate = np.exp(utilities)
        candidate /= np.sum(candidate, axis=1, keepdims=True)
        invalid = np.asarray([value is None for value in features])
        candidate[invalid] = reference_array[invalid]
    if np.any(~np.isfinite(candidate)) or not np.allclose(np.sum(candidate, axis=1), 1.0, atol=1e-12):
        raise SuccessorError("Candidate probabilities are invalid")
    return candidate, reference_array, np.asarray(outcomes, dtype=int)


def fit_coefficients(
    rows: Sequence[Mapping[str, Any]], reference: Mapping[str, Mapping[str, float]], regularization: float
) -> tuple[np.ndarray, dict[str, Any]]:
    valid_rows = [row for row in rows if feature_values(row) is not None and reference_cell(row) is not None]
    if not valid_rows:
        raise SuccessorError("No valid consumed-2022 rows remain for candidate fitting")
    features = np.asarray([feature_values(row) for row in valid_rows], dtype=float)
    _candidate, offsets, outcomes = probability_arrays(valid_rows, reference)
    weights = normalized_weights(np.asarray([float(row["weekday_weight"]) for row in valid_rows], dtype=float))
    shape = (len(ALTERNATIVES) - 1, len(FEATURES))

    def objective(flat: np.ndarray) -> tuple[float, np.ndarray]:
        beta = flat.reshape(shape)
        utilities = np.log(offsets)
        utilities[:, 1:] += features @ beta.T
        utilities -= np.max(utilities, axis=1, keepdims=True)
        probabilities = np.exp(utilities)
        probabilities /= np.sum(probabilities, axis=1, keepdims=True)
        loss = -float(np.sum(weights * np.log(np.clip(probabilities[np.arange(len(outcomes)), outcomes], 1e-300, 1.0))) / np.sum(weights))
        loss += 0.5 * regularization * float(np.sum(beta * beta))
        observed = np.eye(len(ALTERNATIVES), dtype=float)[outcomes]
        residual = (probabilities - observed) * (weights[:, None] / np.sum(weights))
        gradient = residual[:, 1:].T @ features + regularization * beta
        return loss, gradient.ravel()

    result = minimize(
        lambda flat: objective(flat), np.zeros(np.prod(shape), dtype=float), jac=True,
        method="L-BFGS-B", options={"maxiter": 5000, "ftol": 1e-12, "gtol": 1e-8},
    )
    if not result.success or np.any(~np.isfinite(result.x)):
        raise SuccessorError(f"Candidate fit did not converge: {result.message}")
    return result.x.reshape(shape), {
        "converged": True, "iterations": int(result.nit), "objective": float(result.fun),
        "gradient_max_absolute": float(np.max(np.abs(result.jac))), "message": str(result.message),
    }


def weighted_log_loss(probabilities: np.ndarray, outcomes: np.ndarray, weights: np.ndarray) -> float:
    chosen = np.clip(probabilities[np.arange(len(outcomes)), outcomes], 1e-300, 1.0)
    return -float(np.sum(weights * np.log(chosen)) / np.sum(weights))


def select_candidate(rows: Sequence[Mapping[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    divisions = sorted({str(row["census_division_code"]) for row in rows})
    if divisions != list(CENSUS_DIVISIONS):
        raise SuccessorError("Consumed 2022 development data do not cover all nine Census divisions")
    evaluations: list[dict[str, Any]] = []
    for regularization in LAMBDA_GRID:
        total_weight = 0.0
        candidate_loss = 0.0
        reference_loss = 0.0
        folds: list[dict[str, Any]] = []
        for division in divisions:
            training = [row for row in rows if row["census_division_code"] != division]
            validation = [row for row in rows if row["census_division_code"] == division]
            reference = fit_reference(training)
            coefficients, convergence = fit_coefficients(training, reference, regularization)
            candidate, baseline, outcomes = probability_arrays(validation, reference, coefficients)
            weights = np.asarray([float(row["weekday_weight"]) for row in validation], dtype=float)
            candidate_fold = weighted_log_loss(candidate, outcomes, weights)
            reference_fold = weighted_log_loss(baseline, outcomes, weights)
            fold_weight = float(np.sum(weights))
            total_weight += fold_weight
            candidate_loss += candidate_fold * fold_weight
            reference_loss += reference_fold * fold_weight
            folds.append({
                "division": division, "candidate_log_loss": candidate_fold,
                "reference_log_loss": reference_fold, "candidate_better": candidate_fold < reference_fold,
                "convergence": convergence,
            })
        evaluations.append({
            "regularization": regularization,
            "pooled_candidate_log_loss": candidate_loss / total_weight,
            "pooled_reference_log_loss": reference_loss / total_weight,
            "division_wins": sum(bool(row["candidate_better"]) for row in folds),
            "folds": folds,
        })
    selected = min(evaluations, key=lambda row: (row["pooled_candidate_log_loss"], -row["regularization"]))
    if selected["regularization"] in {LAMBDA_GRID[0], LAMBDA_GRID[-1]}:
        raise SuccessorError("Selected regularization is on the frozen grid boundary")
    reference = fit_reference(rows)
    coefficients, convergence = fit_coefficients(rows, reference, float(selected["regularization"]))
    model = {
        "alternatives": list(ALTERNATIVES),
        "reference_alternative": REFERENCE_ALTERNATIVE,
        "reference_cells": "worker status crossed with fixed age band; student status absent",
        "reference_probabilities": reference,
        "features": list(FEATURES),
        "learned_coefficients": {
            alternative: {FEATURES[column]["name"]: float(coefficients[row, column]) for column in range(len(FEATURES))}
            for row, alternative in enumerate(ALTERNATIVES[1:])
        },
        "selected_regularization": selected["regularization"],
    }
    verify_candidate_contract(model)
    return model, {"grid": evaluations, "selected": selected, "all_data_convergence": convergence}


def verify_candidate_contract(model: Mapping[str, Any]) -> None:
    executable = {
        "reference_probability_cell_names": sorted((model.get("reference_probabilities") or {}).keys()),
        "features": model.get("features"),
        "learned_coefficients": model.get("learned_coefficients"),
    }
    rendered = json.dumps(executable, sort_keys=True).lower()
    for token in FORBIDDEN_PREDICTOR_TOKENS:
        if token in rendered:
            raise SuccessorError(f"Frozen candidate contains prohibited predictor token: {token}")
    if tuple(model.get("alternatives") or ()) != ALTERNATIVES:
        raise SuccessorError("Frozen candidate alternatives changed")
    if model.get("reference_alternative") != REFERENCE_ALTERNATIVE:
        raise SuccessorError("Frozen candidate reference alternative changed")
    learned = model.get("learned_coefficients") or {}
    if set(learned) != set(ALTERNATIVES[1:]):
        raise SuccessorError("Frozen candidate coefficient alternatives changed")
    expected = {feature["name"] for feature in FEATURES}
    if any(set(values) != expected for values in learned.values()):
        raise SuccessorError("Frozen candidate feature set changed")


def load_consumed_2022_rows(archive_path: str | Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    archive = Path(archive_path).resolve()
    if sha256(archive) != CONSUMED_2022_SHA256:
        raise SuccessorError("Consumed 2022 archive does not match the historical lock")
    temporary = Path(tempfile.mkdtemp(prefix="openplan-mandatory-successor-development-"))
    try:
        development_dir = temporary / "development"
        acceptance_dir = temporary / "acceptance"
        consumed_source._build_partition_source(
            archive, CONSUMED_2022_PREREGISTRATION, development_dir, role="development"
        )
        consumed_source._build_partition_source(
            archive, CONSUMED_2022_PREREGISTRATION, acceptance_dir, role="acceptance",
            opening_lock_path=CONSUMED_2022_LOCK, opening_receipt_path=CONSUMED_2022_RECEIPT,
        )
        development_rows, development_context = consumed_outcomes._reconstruct_partition_outcomes(
            development_dir, CONSUMED_2022_PREREGISTRATION, role="development"
        )
        acceptance_rows, acceptance_context = consumed_outcomes._reconstruct_partition_outcomes(
            acceptance_dir, CONSUMED_2022_PREREGISTRATION, role="acceptance",
            opening_lock_path=CONSUMED_2022_LOCK, opening_receipt_path=CONSUMED_2022_RECEIPT,
        )
        rows = [
            row for row in development_rows + acceptance_rows
            if row["outcome_status"] == "supported_alternative"
        ]
        return rows, {
            "archive_sha256": sha256(archive), "supported_records": len(rows),
            "development_summary": development_context["summary"],
            "formerly_acceptance_summary": acceptance_context["summary"],
            "historical_acceptance_result_sha256": sha256(
                DATA_ROOT / "mandatory-tour-frequency-acceptance-result-v2-2026-08-19.json"
            ),
            "all_nine_divisions_are_consumed_development": True,
        }
    finally:
        shutil.rmtree(temporary)


def zip_header_inventory(path: str | Path, requirements: Mapping[str, set[str]]) -> dict[str, Any]:
    archive_path = Path(path).resolve()
    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise SuccessorError(f"Unreadable ZIP archive: {archive_path}") from exc
    with archive:
        members = {Path(name).name.lower(): name for name in archive.namelist()}
        header_records: dict[str, Any] = {}
        for expected_member, required in requirements.items():
            member = members.get(expected_member.lower())
            if member is None:
                raise SuccessorError(f"Source archive is missing {expected_member}")
            with archive.open(member) as raw:
                header = next(csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")), [])
            missing = sorted(required - set(header))
            if missing:
                raise SuccessorError(f"{expected_member} header is missing {', '.join(missing)}")
            info = archive.getinfo(member)
            header_records[expected_member] = {
                "archive_member": member, "uncompressed_size_bytes": info.file_size,
                "compressed_size_bytes": info.compress_size, "crc32": f"{info.CRC:08x}",
                "columns": header,
            }
        return {
            "archive_size_bytes": archive_path.stat().st_size,
            "archive_sha256": sha256(archive_path),
            "members": [
                {"name": info.filename, "uncompressed_size_bytes": info.file_size,
                 "compressed_size_bytes": info.compress_size, "crc32": f"{info.CRC:08x}"}
                for info in archive.infolist()
            ],
            "header_only_contract": header_records,
            "non_header_rows_read": 0,
        }


def write_candidate_package(model: Mapping[str, Any], fit_record: Mapping[str, Any], development: Mapping[str, Any]) -> dict[str, Any]:
    if PACKAGE_DIR.exists() or PACKAGE_DIR.is_symlink():
        raise SuccessorError(f"Candidate package already exists: {PACKAGE_DIR}")
    staging = Path(tempfile.mkdtemp(prefix=".mandatory-successor-package-", dir=DATA_ROOT))
    try:
        model_path = staging / "mandatory_tour_frequency_model.json"
        model_path.write_text(json.dumps(model, indent=2, sort_keys=True) + "\n")
        spec_path = staging / "mandatory_tour_frequency.csv"
        coefficient_path = staging / "mandatory_tour_frequency_coefficients.csv"
        settings_path = staging / "mandatory_tour_frequency.yaml"
        with spec_path.open("w", newline="") as handle:
            fields = ["Label", "Description", "Expression", *ALTERNATIVES]
            writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            for cell in sorted(model["reference_probabilities"]):
                worker, band = cell.split("__", 1)
                lower, upper, _name = next(row for row in AGE_BANDS if row[2] == band)
                worker_expression = "is_worker" if worker == "worker" else "(~is_worker)"
                age_expression = f"(age >= {lower}) & (age <= {upper})"
                writer.writerow({
                    "Label": f"reference_offset_{cell}",
                    "Description": f"Fixed consumed-2022 reference offset for {cell}",
                    "Expression": f"{worker_expression} & {age_expression}",
                    **{alternative: f"offset_{cell}_{alternative}" for alternative in ALTERNATIVES},
                })
            expressions = {feature["name"]: feature["runtime"] for feature in FEATURES}
            for feature in FEATURES:
                name = feature["name"]
                writer.writerow({
                    "Label": f"candidate_{name}", "Description": f"National successor {name}",
                    "Expression": expressions[name], REFERENCE_ALTERNATIVE: "0",
                    **{alternative: f"coef_{alternative}_{name}" for alternative in ALTERNATIVES[1:]},
                })
        with coefficient_path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["coefficient_name", "value", "constrain"], lineterminator="\n")
            writer.writeheader()
            for cell, probabilities in sorted(model["reference_probabilities"].items()):
                for alternative, probability in probabilities.items():
                    writer.writerow({"coefficient_name": f"offset_{cell}_{alternative}", "value": math.log(probability), "constrain": "T"})
            for alternative, values in model["learned_coefficients"].items():
                for name, value in values.items():
                    writer.writerow({"coefficient_name": f"coef_{alternative}_{name}", "value": value, "constrain": "F"})
        settings_path.write_text("SPEC: mandatory_tour_frequency.csv\nCOEFFICIENTS: mandatory_tour_frequency_coefficients.csv\nLOGIT_TYPE: MNL\n")
        package = {
            "schema_version": PACKAGE_SCHEMA_VERSION,
            "status": "candidate_frozen_before_2017_outcome_access",
            "component": "mandatory_tour_frequency",
            "scope": "conditional on an observed mandatory daily activity pattern only",
            "installation_authorized": False,
            "acceptance_outcomes_read": False,
            "development": development,
            "fit": fit_record,
            "forbidden_predictor_tokens": list(FORBIDDEN_PREDICTOR_TOKENS),
            "files_sha256": {
                path.name: sha256(path) for path in (model_path, spec_path, coefficient_path, settings_path)
            },
        }
        (staging / "coefficient_package.json").write_text(json.dumps(package, indent=2, sort_keys=True) + "\n")
        staging.rename(PACKAGE_DIR)
        return package
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def evaluator_closure() -> dict[str, Any]:
    paths = [Path(__file__).resolve(), Path(diaries.__file__).resolve()]
    files = [{"path": portable(path), "sha256": sha256(path)} for path in sorted(paths)]
    return {"files": files, "closure_sha256": canonical_sha256(files)}


def build_preregistration(
    core_archive: str | Path, replicate_archive: str | Path, consumed_2022_archive: str | Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    core = Path(core_archive).resolve()
    replicates = Path(replicate_archive).resolve()
    if core.stat().st_size != CORE_EXPECTED_SIZE or sha256(core) != CORE_EXPECTED_SHA256:
        raise SuccessorError("The 2017 core archive differs from the official locked bytes")
    if replicates.stat().st_size != REPLICATE_EXPECTED_SIZE or sha256(replicates) != REPLICATE_EXPECTED_SHA256:
        raise SuccessorError("The 2017 replicate archive differs from the official locked bytes")
    core_inventory = zip_header_inventory(
        core, {CORE_MEMBER: HOUSEHOLD_REQUIRED, PERSON_MEMBER: PERSON_REQUIRED, TRIP_MEMBER: TRIP_REQUIRED}
    )
    replicate_inventory = zip_header_inventory(replicates, {REPLICATE_MEMBER: REPLICATE_REQUIRED})
    development_rows, development = load_consumed_2022_rows(consumed_2022_archive)
    model, fit_record = select_candidate(development_rows)
    package = write_candidate_package(model, fit_record, development)
    package_manifest_path = PACKAGE_DIR / "coefficient_package.json"
    package_hashes = {
        path.name: sha256(path) for path in sorted(PACKAGE_DIR.iterdir()) if path.is_file()
    }
    preregistration = {
        "schema_version": SCHEMA_VERSION,
        "status": "frozen_before_2017_outcome_access",
        "component": "mandatory_tour_frequency",
        "question": "Does one unchanged national mandatory-tour-frequency component transfer from consumed 2022 development outcomes to the complete 2017 NHTS source?",
        "freshness_attestation": {
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "repository_search_found_2017_mandatory_outcome_artifact": False,
            "known_current_agent_work_inspected_2017_outcome_rows": False,
            "known_prior_work": "Only published aggregate trip-rate references and header-only source inspection were found.",
            "bounded_limit": "Repository and known-agent history cannot prove that no unrelated person or checkout ever inspected the outcome.",
        },
        "sources": {
            "development": {"source_id": "us-fhwa-nhts-2022-consumed", **development},
            "acceptance_core": {"source_id": "us-fhwa-nhts-2017-core", "official_url": CORE_URL, **core_inventory},
            "acceptance_replicates": {"source_id": "us-fhwa-nhts-2017-person-replicates", "official_url": REPLICATE_URL, **replicate_inventory},
            "license_posture": "public-use; FHWA citation requested; raw redistribution not authorized by this study",
        },
        "weekday_estimand": {
            "population": "combined national and add-on public-use sample",
            "domain": "TRAVDAY 02 through 06, including holidays",
            "weight": "WTPERFIN and WTPERFIN1 through WTPERFIN98",
            "absolute_population_totals_used": False,
            "ratio_rule": "recompute every normalized estimate separately under each replicate",
            "limitation": "This is a weekday domain under seven-day weights, not the 2022 nonholiday WTPERFIN5D estimand.",
        },
        "candidate_contract": {
            "package_path": portable(PACKAGE_DIR), "package_manifest_sha256": sha256(package_manifest_path),
            "files_sha256": package_hashes, "predictors": list(FEATURES),
            "reference_cells": "worker status crossed with age band",
            "student_status_absent": True, "vehicle_terms_absent": True,
            "geographic_terms_absent": True, "fit_source": "all nine consumed 2022 Census divisions",
        },
        "outcome_adapter": {
            "person_first_universe": True, "home_codes": ["01", "02"], "work_code": "03",
            "school_code": "08", "work_related_code_not_work": "04", "order_field": "TDTRPNUM",
            "start_home_field": "FRSTHM17", "end_home_required": True,
            "away_fields": ["OUTOFTWN", "OUTCNTRY"], "paper_diary_field_used": False,
            "supported_alternatives": list(ALTERNATIVES), "unsupported_patterns_coerced": False,
        },
        "inference": {
            "replicate_count": REPLICATE_COUNT, "jackknife_factor": JACKKNIFE_FACTOR,
            "design_degrees_of_freedom": DESIGN_DEGREES_OF_FREEDOM,
            "one_sided_95_t_critical": ONE_SIDED_CRITICAL,
            "two_sided_95_t_critical": TWO_SIDED_CRITICAL,
            "kish_effective_sample": "sum(w)^2 / sum(w^2)",
            "failed_replicate_rule": "any missing, nonfinite, or nonpositive denominator makes the study inconclusive",
        },
        "evaluation": {
            "national_gates": THRESHOLDS["national"],
            "transfer_cell_gates": THRESHOLDS["transfer_cells"],
            "division_safety_gates": THRESHOLDS["division_safety"],
            "division_labels": list(CENSUS_DIVISIONS), "holm_family_alpha": FAMILY_ALPHA,
            "decision": {
                "accepted": "every source, replicate, rare-cell, national, transfer-cell, and nine-division gate passes",
                "rejected": "all prerequisites are valid and at least one substantive gate fails",
                "inconclusive": "any source, replicate, rare-cell, reconstruction, or domain-adequacy prerequisite fails",
            },
        },
        "scope_limits": [
            "A pass covers this one mandatory_tour_frequency component conditional on observed mandatory DAP only.",
            "It does not validate another ActivitySim component, destination or mode choice, scheduling, or local corridor accuracy.",
            "No result changes an OpenPlan default automatically.",
        ],
    }
    return preregistration, package, model


def freeze_study(core_archive: str | Path, replicate_archive: str | Path, consumed_2022_archive: str | Path) -> dict[str, Any]:
    for path in (PREREGISTRATION_PATH, LOCK_PATH, RECEIPT_PATH, RESULT_PATH, PACKAGE_DIR):
        if path.exists() or path.is_symlink():
            raise SuccessorError(f"Study artifact already exists; refusing to overwrite {path}")
    preregistration, _package, _model = build_preregistration(core_archive, replicate_archive, consumed_2022_archive)
    exclusive_json(PREREGISTRATION_PATH, preregistration)
    lock = {
        "schema_version": LOCK_SCHEMA_VERSION,
        "status": "one_opening_frozen_unopened",
        "component": "mandatory_tour_frequency",
        "preregistration_path": portable(PREREGISTRATION_PATH),
        "preregistration_sha256": sha256(PREREGISTRATION_PATH),
        "candidate_package_path": portable(PACKAGE_DIR),
        "candidate_package_files_sha256": {
            path.name: sha256(path) for path in sorted(PACKAGE_DIR.iterdir()) if path.is_file()
        },
        "evaluator": evaluator_closure(),
        "source_paths": {"core": str(Path(core_archive).resolve()), "replicates": str(Path(replicate_archive).resolve())},
        "source_sha256": {"core": sha256(core_archive), "replicates": sha256(replicate_archive)},
        "one_shot_outputs": {"receipt": portable(RECEIPT_PATH), "result": portable(RESULT_PATH), "person_level_output_allowed": False},
    }
    exclusive_json(LOCK_PATH, lock)
    return lock


def verify_lock(core_archive: str | Path, replicate_archive: str | Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    lock = load_json(LOCK_PATH, "Successor opening lock")
    preregistration = load_json(PREREGISTRATION_PATH, "Successor preregistration")
    package = load_json(PACKAGE_DIR / "coefficient_package.json", "Successor candidate package")
    model = load_json(PACKAGE_DIR / "mandatory_tour_frequency_model.json", "Successor candidate model")
    if lock.get("schema_version") != LOCK_SCHEMA_VERSION or lock.get("status") != "one_opening_frozen_unopened":
        raise SuccessorError("Successor opening lock is not the frozen unopened contract")
    if lock.get("preregistration_sha256") != sha256(PREREGISTRATION_PATH):
        raise SuccessorError("Successor preregistration changed after locking")
    if lock.get("evaluator") != evaluator_closure():
        raise SuccessorError("Successor evaluator closure changed after locking")
    expected_sources = lock.get("source_sha256") or {}
    if sha256(core_archive) != expected_sources.get("core") or sha256(replicate_archive) != expected_sources.get("replicates"):
        raise SuccessorError("A 2017 source archive changed after locking")
    expected_files = lock.get("candidate_package_files_sha256") or {}
    measured_files = {path.name: sha256(path) for path in sorted(PACKAGE_DIR.iterdir()) if path.is_file()}
    if measured_files != expected_files:
        raise SuccessorError("Candidate package changed after locking")
    if package.get("status") != "candidate_frozen_before_2017_outcome_access" or package.get("acceptance_outcomes_read") is not False:
        raise SuccessorError("Candidate package claims premature acceptance access")
    verify_candidate_contract(model)
    if preregistration.get("status") != "frozen_before_2017_outcome_access":
        raise SuccessorError("Successor preregistration is not unopened")
    return lock, preregistration, model


def purpose(value: Any) -> str:
    value = code(value)
    if value in {"01", "02"}:
        return "home"
    if value == "03":
        return "work"
    if value == "08":
        return "school"
    if value.startswith("-") or not value:
        return "unknown"
    return "other"


def reconstruct_person(person_id: str, person: Mapping[str, str], trips: Sequence[Mapping[str, str]]) -> dict[str, Any]:
    full_weight = finite_positive(person.get("WTPERFIN"), "2017 WTPERFIN")
    if code(person.get("TRAVDAY")) not in {"02", "03", "04", "05", "06"}:
        return {"weekday_weight": full_weight, "outcome_status": "not_weekday", "alternative": "", "work_tours": None, "school_tours": None}
    if code(person.get("OUTOFTWN")) == "01" or code(person.get("OUTCNTRY")) == "01":
        return {"weekday_weight": full_weight, "outcome_status": "away", "alternative": "", "work_tours": None, "school_tours": None}
    if code(person.get("FRSTHM17")) != "01":
        return {"weekday_weight": full_weight, "outcome_status": "incomplete_start_away", "alternative": "", "work_tours": None, "school_tours": None}
    mapped: list[dict[str, Any]] = []
    seen_numbers: set[int] = set()
    for trip in trips:
        trip_number = integer(trip.get("TDTRPNUM"))
        if trip_number is not None and trip_number in seen_numbers:
            trip_number = None
        if trip_number is not None:
            seen_numbers.add(trip_number)
        mapped.append({
            "trip_id": str(trip.get("TDCASEID") or f"{person_id}:{trip.get('TDTRPNUM')}"),
            "person_id": person_id, "household_id": str(person.get("HOUSEID") or ""),
            "trip_number": trip_number, "survey_weight": 1.0, "holdout_fold": "acceptance",
            "origin_purpose": purpose(trip.get("WHYFROM")), "destination_purpose": purpose(trip.get("WHYTO")),
            "depart_minutes": diaries.hhmm_to_minutes(trip.get("STRTTIME")),
            "arrive_minutes": diaries.hhmm_to_minutes(trip.get("ENDTIME")),
            "usable_for_tour_reconstruction": trip_number is not None and purpose(trip.get("WHYFROM")) != "unknown" and purpose(trip.get("WHYTO")) != "unknown" and diaries.hhmm_to_minutes(trip.get("STRTTIME")) is not None and diaries.hhmm_to_minutes(trip.get("ENDTIME")) is not None,
        })
    if not mapped:
        return {"weekday_weight": full_weight, "outcome_status": "no_observed_mandatory_pattern", "alternative": "", "work_tours": 0, "school_tours": 0}
    tours, assignments, _excluded = diaries.reconstruct_home_based_tours(mapped, person_weights={person_id: full_weight})
    statuses = {str(value.get("tour_reconstruction_status")) for value in assignments.values()}
    incomplete = sorted(statuses & consumed_outcomes.INCOMPLETE_STATUSES)
    if incomplete:
        return {"weekday_weight": full_weight, "outcome_status": "incomplete_diary", "exclusion_reason": "|".join(incomplete), "alternative": "", "work_tours": None, "school_tours": None}
    work_tours = sum(tour["tour_type"] == "work" for tour in tours)
    school_tours = sum(tour["tour_type"] == "school" for tour in tours)
    if work_tours + school_tours == 0:
        return {"weekday_weight": full_weight, "outcome_status": "no_observed_mandatory_pattern", "alternative": "", "work_tours": 0, "school_tours": 0}
    alternative = SUPPORTED_ALTERNATIVES.get((work_tours, school_tours), "")
    return {
        "weekday_weight": full_weight,
        "outcome_status": "supported_alternative" if alternative else "out_of_support_mandatory_pattern",
        "alternative": alternative, "work_tours": work_tours, "school_tours": school_tours,
    }


def csv_rows(archive: zipfile.ZipFile, member: str, required: set[str]) -> list[dict[str, str]]:
    with archive.open(member) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        missing = sorted(required - set(reader.fieldnames or []))
        if missing:
            raise SuccessorInconclusive(f"{member} is missing {', '.join(missing)}")
        return list(reader)


def read_2017_source(core_archive: str | Path, replicate_archive: str | Path) -> SourceRows:
    with zipfile.ZipFile(core_archive) as core:
        households_raw = csv_rows(core, CORE_MEMBER, HOUSEHOLD_REQUIRED)
        persons_raw = csv_rows(core, PERSON_MEMBER, PERSON_REQUIRED)
        trips_raw = csv_rows(core, TRIP_MEMBER, TRIP_REQUIRED)
    households: dict[str, dict[str, str]] = {}
    for row in households_raw:
        household_id = str(row.get("HOUSEID") or "").strip()
        if not household_id or household_id in households:
            raise SuccessorInconclusive("2017 household keys are missing or duplicated")
        households[household_id] = row
    persons: dict[str, dict[str, str]] = {}
    for row in persons_raw:
        household_id = str(row.get("HOUSEID") or "").strip()
        person_number = str(row.get("PERSONID") or "").strip()
        key = f"{household_id}:{person_number}"
        if not household_id or not person_number or key in persons or household_id not in households:
            raise SuccessorInconclusive("2017 person keys are invalid, duplicated, or orphaned")
        if code(row.get("CENSUS_D")) != code(households[household_id].get("CENSUS_D")):
            raise SuccessorInconclusive("A 2017 person and household disagree on Census division")
        persons[key] = row
    trips_by_person: dict[str, list[dict[str, str]]] = {}
    trip_keys: set[str] = set()
    for row in trips_raw:
        key = f"{str(row.get('HOUSEID') or '').strip()}:{str(row.get('PERSONID') or '').strip()}"
        trip_key = str(row.get("TDCASEID") or "").strip()
        if key not in persons or not trip_key or trip_key in trip_keys:
            raise SuccessorInconclusive("2017 trip keys are invalid, duplicated, or orphaned")
        if code(row.get("CENSUS_D")) != code(persons[key].get("CENSUS_D")):
            raise SuccessorInconclusive("A 2017 trip and person disagree on Census division")
        trip_keys.add(trip_key)
        trips_by_person.setdefault(key, []).append(row)
    with zipfile.ZipFile(replicate_archive) as replicate_zip:
        replicate_rows = csv_rows(replicate_zip, REPLICATE_MEMBER, REPLICATE_REQUIRED)
    replicate_by_person: dict[str, np.ndarray] = {}
    for row in replicate_rows:
        key = f"{str(row.get('HOUSEID') or '').strip()}:{str(row.get('PERSONID') or '').strip()}"
        if key in replicate_by_person or key not in persons:
            raise SuccessorInconclusive("2017 replicate keys are duplicated or orphaned")
        values = np.asarray([finite_positive(row.get(f"WTPERFIN{index}"), f"WTPERFIN{index}") for index in range(1, REPLICATE_COUNT + 1)], dtype=float)
        if not math.isclose(finite_positive(row.get("WTPERFIN"), "replicate WTPERFIN"), finite_positive(persons[key].get("WTPERFIN"), "person WTPERFIN"), rel_tol=1e-10, abs_tol=1e-8):
            raise SuccessorInconclusive("2017 person and replicate full weights disagree")
        replicate_by_person[key] = values
    if set(replicate_by_person) != set(persons):
        raise SuccessorInconclusive("2017 replicate coverage is not one-to-one with persons")
    output_rows: list[dict[str, Any]] = []
    output_replicates: list[np.ndarray] = []
    coverage_rows: list[dict[str, Any]] = []
    coverage_replicates: list[np.ndarray] = []
    status_counts: dict[str, int] = {}
    division_counts = {division: 0 for division in CENSUS_DIVISIONS}
    for key in sorted(persons):
        person = persons[key]
        household = households[str(person["HOUSEID"]).strip()]
        if code(household.get("CENSUS_D")) not in CENSUS_DIVISIONS:
            raise SuccessorInconclusive("A 2017 household has an invalid Census division")
        outcome = reconstruct_person(key, person, trips_by_person.get(key, []))
        status = str(outcome["outcome_status"])
        status_counts[status] = status_counts.get(status, 0) + 1
        if status in {"supported_alternative", "out_of_support_mandatory_pattern"}:
            coverage_rows.append({**outcome, "census_division_code": code(household["CENSUS_D"])})
            coverage_replicates.append(replicate_by_person[key])
        if status != "supported_alternative":
            continue
        row = {
            **outcome,
            "age": integer(person.get("R_AGE_IMP")), "sex_code": code(person.get("R_SEX_IMP")),
            "worker_code": code(person.get("WORKER")), "household_size": integer(household.get("HHSIZE")),
            "workers": integer(household.get("WRKCOUNT")), "census_division_code": code(household.get("CENSUS_D")),
        }
        output_rows.append(row)
        output_replicates.append(replicate_by_person[key])
        division_counts[row["census_division_code"]] += 1
    if not output_rows or any(count == 0 for count in division_counts.values()):
        raise SuccessorInconclusive("Supported 2017 outcomes do not cover all nine divisions")
    return SourceRows(
        rows=output_rows, replicate_weights=np.asarray(output_replicates, dtype=float),
        coverage_rows=coverage_rows, coverage_replicate_weights=np.asarray(coverage_replicates, dtype=float),
        source_summary={
            "households": len(households), "persons": len(persons), "trips": len(trip_keys),
            "replicate_persons": len(replicate_by_person), "supported_records": len(output_rows),
            "coverage_denominator_records": len(coverage_rows), "status_counts": dict(sorted(status_counts.items())),
            "supported_records_by_division": division_counts,
        },
    )


def model_from_record(model: Mapping[str, Any]) -> tuple[dict[str, dict[str, float]], np.ndarray]:
    verify_candidate_contract(model)
    reference = model["reference_probabilities"]
    coefficients = np.asarray(
        [[model["learned_coefficients"][alternative][feature["name"]] for feature in FEATURES] for alternative in ALTERNATIVES[1:]],
        dtype=float,
    )
    return reference, coefficients


def kish(weights: np.ndarray) -> float:
    denominator = float(np.sum(weights * weights))
    return float(np.sum(weights) ** 2 / denominator) if denominator > 0 else 0.0


def jackknife(full: float, replicates: np.ndarray) -> tuple[float, float, float]:
    if replicates.shape != (REPLICATE_COUNT,) or np.any(~np.isfinite(replicates)) or not math.isfinite(full):
        raise SuccessorInconclusive("A jackknife estimate is missing or nonfinite")
    standard_error = math.sqrt(float(np.sum(JACKKNIFE_FACTOR * (replicates - full) ** 2)))
    return standard_error, full - TWO_SIDED_CRITICAL * standard_error, full + TWO_SIDED_CRITICAL * standard_error


def ratio(full_weights: np.ndarray, replicate_weights: np.ndarray, values: np.ndarray) -> tuple[float, np.ndarray]:
    denominator = float(np.sum(full_weights))
    replicate_denominators = np.sum(replicate_weights, axis=0)
    if denominator <= 0 or np.any(replicate_denominators <= 0):
        raise SuccessorInconclusive("A full or replicate denominator is nonpositive")
    full = float(np.sum(full_weights * values) / denominator)
    replicates = np.sum(replicate_weights * values[:, None], axis=0) / replicate_denominators
    if np.any(~np.isfinite(replicates)):
        raise SuccessorInconclusive("A replicate ratio is nonfinite")
    return full, replicates


def holm(entries: list[dict[str, Any]], alpha: float) -> None:
    ordered = sorted(entries, key=lambda row: (float(row["p_value"]), str(row["name"])))
    rejected = True
    total = len(ordered)
    for index, row in enumerate(ordered):
        threshold = alpha / (total - index)
        row["holm_threshold"] = threshold
        row["significant_deterioration"] = bool(rejected and row["point"] > 0 and row["p_value"] <= threshold)
        if row["p_value"] > threshold:
            rejected = False


def logloss_test(
    name: str, mask: np.ndarray, weights: np.ndarray, replicate_weights: np.ndarray,
    candidate_loss: np.ndarray, reference_loss: np.ndarray,
) -> dict[str, Any]:
    selected = np.asarray(mask, dtype=bool)
    selected_weights = weights[selected]
    if int(np.sum(selected)) < THRESHOLDS["transfer_cells"]["unweighted_minimum"] or kish(selected_weights) < THRESHOLDS["transfer_cells"]["kish_effective_minimum"]:
        raise SuccessorInconclusive(f"Transfer or safety cell {name} lacks its frozen effective sample")
    point, replicates = ratio(selected_weights, replicate_weights[selected], (candidate_loss - reference_loss)[selected])
    standard_error, lower, upper = jackknife(point, replicates)
    statistic = point / standard_error if standard_error > 0 else (-math.inf if point < 0 else math.inf)
    p_value = float(student_t.sf(statistic, DESIGN_DEGREES_OF_FREEDOM))
    return {
        "name": name, "records": int(np.sum(selected)), "kish_effective_sample": kish(selected_weights),
        "point": point, "standard_error": standard_error, "two_sided_interval": [lower, upper],
        "one_sided_p_value": p_value, "p_value": p_value,
    }


def coverage_metric(rows: SourceRows, mask: np.ndarray | None = None) -> dict[str, Any]:
    selected = np.ones(len(rows.coverage_rows), dtype=bool) if mask is None else np.asarray(mask, dtype=bool)
    weights = np.asarray([float(row["weekday_weight"]) for row in rows.coverage_rows], dtype=float)[selected]
    reps = rows.coverage_replicate_weights[selected]
    supported = np.asarray([row["outcome_status"] == "supported_alternative" for row in rows.coverage_rows], dtype=float)[selected]
    point, replicate_points = ratio(weights, reps, supported)
    standard_error, lower, upper = jackknife(point, replicate_points)
    return {"point": point, "standard_error": standard_error, "two_sided_interval": [lower, upper]}


def evaluate_rows(source: SourceRows, model: Mapping[str, Any]) -> dict[str, Any]:
    reference_model, coefficients = model_from_record(model)
    candidate, reference, outcomes = probability_arrays(source.rows, reference_model, coefficients)
    weights = np.asarray([float(row["weekday_weight"]) for row in source.rows], dtype=float)
    replicates = source.replicate_weights
    if replicates.shape != (len(source.rows), REPLICATE_COUNT):
        raise SuccessorInconclusive("Replicate matrix shape does not match the supported person universe")
    chosen_candidate = -np.log(np.clip(candidate[np.arange(len(outcomes)), outcomes], 1e-300, 1.0))
    chosen_reference = -np.log(np.clip(reference[np.arange(len(outcomes)), outcomes], 1e-300, 1.0))
    difference = chosen_candidate - chosen_reference
    logloss_point, logloss_reps = ratio(weights, replicates, difference)
    logloss_se, logloss_lower, logloss_upper = jackknife(logloss_point, logloss_reps)
    observed = np.eye(len(ALTERNATIVES), dtype=float)[outcomes]
    share_errors: dict[str, Any] = {}
    candidate_shares: list[float] = []
    reference_shares: list[float] = []
    observed_shares: list[float] = []
    for index, alternative in enumerate(ALTERNATIVES):
        observed_point, _observed_reps = ratio(weights, replicates, observed[:, index])
        candidate_point, candidate_reps = ratio(weights, replicates, candidate[:, index])
        reference_point, _reference_reps = ratio(weights, replicates, reference[:, index])
        error = candidate_point - observed_point
        error_reps = candidate_reps - _observed_reps
        error_se, error_lower, error_upper = jackknife(error, error_reps)
        share_errors[alternative] = {"observed": observed_point, "candidate": candidate_point, "reference": reference_point, "error": error, "standard_error": error_se, "two_sided_interval": [error_lower, error_upper]}
        observed_shares.append(observed_point)
        candidate_shares.append(candidate_point)
        reference_shares.append(reference_point)
    candidate_tv = 0.5 * float(np.sum(np.abs(np.asarray(candidate_shares) - np.asarray(observed_shares))))
    reference_tv = 0.5 * float(np.sum(np.abs(np.asarray(reference_shares) - np.asarray(observed_shares))))
    tour_metrics: dict[str, Any] = {}
    for column, name in enumerate(("work_tours", "school_tours")):
        observed_values = TOUR_COUNTS[outcomes, column]
        expected_values = candidate @ TOUR_COUNTS[:, column]
        difference_values = expected_values - observed_values
        point, replicate_points = ratio(weights, replicates, difference_values)
        standard_error, lower, upper = jackknife(point, replicate_points)
        tour_metrics[name] = {"error": point, "standard_error": standard_error, "two_sided_interval": [lower, upper], "absolute_error_upper": abs(point) + TWO_SIDED_CRITICAL * standard_error}
    coverage = coverage_metric(source)
    rare = {}
    for alternative in ("work2", "school2", "work_and_school"):
        selected = outcomes == ALTERNATIVES.index(alternative)
        rare[alternative] = {"records": int(np.sum(selected)), "kish_effective_sample": kish(weights[selected])}
    prerequisite_failures = [
        f"{alternative} rare alternative inadequate"
        for alternative, value in rare.items()
        if value["records"] < THRESHOLDS["national"]["rare_alternative_unweighted_minimum"]
        or value["kish_effective_sample"] < THRESHOLDS["national"]["rare_alternative_kish_effective_minimum"]
    ]
    national_gates = {
        "log_loss_improvement": {"passed": logloss_point + ONE_SIDED_CRITICAL * logloss_se < 0, "point": logloss_point, "standard_error": logloss_se, "one_sided_upper": logloss_point + ONE_SIDED_CRITICAL * logloss_se, "two_sided_interval": [logloss_lower, logloss_upper]},
        "total_variation": {"passed": candidate_tv <= THRESHOLDS["national"]["candidate_total_variation_maximum"], "candidate": candidate_tv, "reference": reference_tv},
        "choice_shares": {"passed": all(abs(value["error"]) <= THRESHOLDS["national"]["candidate_choice_share_absolute_error_maximum"] for value in share_errors.values()), "alternatives": share_errors},
        "tour_means": {"passed": all(value["absolute_error_upper"] <= THRESHOLDS["national"]["tour_mean_absolute_error_two_sided_upper_maximum"] for value in tour_metrics.values()), "measures": tour_metrics},
        "reconstruction_coverage": {"passed": coverage["point"] >= THRESHOLDS["national"]["weighted_reconstruction_coverage_minimum"] and coverage["two_sided_interval"][0] >= THRESHOLDS["national"]["weighted_reconstruction_coverage_lower_bound_minimum"], **coverage},
    }
    transfer_entries: list[dict[str, Any]] = []
    worker_codes = np.asarray([code(row["worker_code"]) for row in source.rows])
    sex_codes = np.asarray([code(row["sex_code"]) for row in source.rows])
    age_bands = np.asarray([age_band(row["age"]) for row in source.rows])
    for name, values in (("worker", worker_codes), ("sex", sex_codes), ("age_band", age_bands)):
        for value in sorted({str(item) for item in values}):
            transfer_entries.append(logloss_test(f"{name}:{value}", values == value, weights, replicates, chosen_candidate, chosen_reference))
    holm(transfer_entries, THRESHOLDS["transfer_cells"]["holm_family_alpha"])
    transfer_gates = {"passed": not any(row["significant_deterioration"] for row in transfer_entries), "cells": transfer_entries}
    division_entries: list[dict[str, Any]] = []
    division_codes = np.asarray([row["census_division_code"] for row in source.rows])
    for division in CENSUS_DIVISIONS:
        selected = division_codes == division
        if int(np.sum(selected)) < THRESHOLDS["division_safety"]["unweighted_supported_minimum"] or kish(weights[selected]) < THRESHOLDS["division_safety"]["kish_effective_minimum"]:
            prerequisite_failures.append(f"division {division} lacks its frozen effective sample")
            continue
        log_test = logloss_test(f"division:{division}", selected, weights, replicates, chosen_candidate, chosen_reference)
        observed_division = observed[selected]
        candidate_division = candidate[selected]
        reference_division = reference[selected]
        division_weights = weights[selected]
        observed_share = np.average(observed_division, axis=0, weights=division_weights)
        candidate_share = np.average(candidate_division, axis=0, weights=division_weights)
        reference_share = np.average(reference_division, axis=0, weights=division_weights)
        candidate_division_tv = 0.5 * float(np.sum(np.abs(candidate_share - observed_share)))
        reference_division_tv = 0.5 * float(np.sum(np.abs(reference_share - observed_share)))
        coverage_mask = np.asarray([row["census_division_code"] == division for row in source.coverage_rows])
        division_coverage = coverage_metric(source, coverage_mask)
        division_tours: dict[str, Any] = {}
        for column, name in enumerate(("work_tours", "school_tours")):
            values = (candidate @ TOUR_COUNTS[:, column] - TOUR_COUNTS[outcomes, column])[selected]
            point, replicate_points = ratio(division_weights, replicates[selected], values)
            standard_error, lower, upper = jackknife(point, replicate_points)
            division_tours[name] = {"error": point, "standard_error": standard_error, "two_sided_interval": [lower, upper], "absolute_error_upper": abs(point) + TWO_SIDED_CRITICAL * standard_error}
        division_entries.append({
            "division": division, "records": int(np.sum(selected)), "kish_effective_sample": kish(division_weights),
            "log_loss": log_test,
            "distribution_disadvantage": candidate_division_tv - reference_division_tv,
            "distribution_gate_passed": candidate_division_tv - reference_division_tv <= THRESHOLDS["division_safety"]["candidate_minus_reference_total_variation_maximum"],
            "coverage": division_coverage,
            "coverage_gate_passed": division_coverage["two_sided_interval"][0] >= THRESHOLDS["division_safety"]["weighted_reconstruction_coverage_lower_bound_minimum"],
            "tour_means": division_tours,
            "tour_gate_passed": all(value["absolute_error_upper"] <= THRESHOLDS["division_safety"]["tour_mean_absolute_error_two_sided_upper_maximum"] for value in division_tours.values()),
        })
    if len(division_entries) == len(CENSUS_DIVISIONS):
        holm([entry["log_loss"] for entry in division_entries], THRESHOLDS["division_safety"]["holm_family_alpha"])
    division_gates = {
        "passed": len(division_entries) == len(CENSUS_DIVISIONS) and all(
            division_entry_passes(entry)
            for entry in division_entries
        ),
        "divisions": division_entries,
    }
    decision = classify_decision(prerequisite_failures, national_gates, transfer_gates, division_gates)
    result = {
        "decision": decision,
        "prerequisite_failures": prerequisite_failures,
        "national_gates": national_gates,
        "transfer_cell_gates": transfer_gates,
        "division_safety_gates": division_gates,
        "rare_alternative_adequacy": rare,
        "source_summary": source.source_summary,
    }
    assert_aggregate_only(result)
    return result


def division_entry_passes(entry: Mapping[str, Any]) -> bool:
    return bool(
        not (entry.get("log_loss") or {}).get("significant_deterioration", False)
        and entry.get("distribution_gate_passed")
        and entry.get("coverage_gate_passed")
        and entry.get("tour_gate_passed")
    )


def classify_decision(
    prerequisite_failures: Sequence[str], national_gates: Mapping[str, Mapping[str, Any]],
    transfer_gates: Mapping[str, Any], division_gates: Mapping[str, Any],
) -> str:
    if prerequisite_failures:
        return "inconclusive"
    substantive = [bool(value.get("passed")) for value in national_gates.values()]
    substantive.extend([bool(transfer_gates.get("passed")), bool(division_gates.get("passed"))])
    return "accepted" if all(substantive) else "rejected"


def assert_aggregate_only(value: Any, path: tuple[str, ...] = ()) -> None:
    prohibited = {"household_id", "person_id", "tdcaseid", "source_rows", "replicate_weights"}
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if str(key).lower() in prohibited:
                raise SuccessorError(f"Aggregate result contains prohibited field {'.'.join((*path, str(key)))}")
            assert_aggregate_only(nested, (*path, str(key)))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            assert_aggregate_only(nested, (*path, str(index)))


def consume_and_evaluate(
    core_archive: str | Path, replicate_archive: str | Path,
    *, source_loader: Callable[[str | Path, str | Path], SourceRows] = read_2017_source,
) -> dict[str, Any]:
    if RECEIPT_PATH.exists() or RESULT_PATH.exists():
        raise SuccessorError("The 2017 successor opening has already been consumed")
    lock, preregistration, model = verify_lock(core_archive, replicate_archive)
    receipt = {
        "schema_version": RECEIPT_SCHEMA_VERSION,
        "status": "source_consumed_before_first_non_header_row_read",
        "component": "mandatory_tour_frequency",
        "written_at": datetime.now(timezone.utc).isoformat(),
        "opening_lock_sha256": sha256(LOCK_PATH),
        "source_sha256": lock["source_sha256"],
        "aggregate_result_path": portable(RESULT_PATH),
        "failure_consumes_receipt": True,
    }
    exclusive_json(RECEIPT_PATH, receipt, fsync=True)
    try:
        source = source_loader(core_archive, replicate_archive)
        evaluation = evaluate_rows(source, model)
        decision = evaluation["decision"]
        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "status": f"evaluated_once_{decision}",
            "decision": decision,
            "component": "mandatory_tour_frequency",
            "scope": "conditional on observed mandatory DAP only",
            "production_registration_authorized": decision == "accepted",
            "default_changed": False,
            "evidence_hashes": {
                "opening_lock_sha256": sha256(LOCK_PATH), "opening_receipt_sha256": sha256(RECEIPT_PATH),
                "preregistration_sha256": sha256(PREREGISTRATION_PATH),
                "candidate_package_manifest_sha256": sha256(PACKAGE_DIR / "coefficient_package.json"),
                "core_archive_sha256": sha256(core_archive), "replicate_archive_sha256": sha256(replicate_archive),
                "evaluator_closure_sha256": lock["evaluator"]["closure_sha256"],
            },
            "estimand": preregistration["weekday_estimand"],
            "evaluation": evaluation,
            "limits": preregistration["scope_limits"],
        }
    except Exception as exc:
        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "status": "evaluated_once_inconclusive", "decision": "inconclusive",
            "component": "mandatory_tour_frequency", "production_registration_authorized": False,
            "default_changed": False, "inconclusive_reason": str(exc),
            "inconclusive_error_kind": type(exc).__name__,
            "evidence_hashes": {
                "opening_lock_sha256": sha256(LOCK_PATH), "opening_receipt_sha256": sha256(RECEIPT_PATH),
                "core_archive_sha256": sha256(core_archive), "replicate_archive_sha256": sha256(replicate_archive),
            },
            "limits": preregistration["scope_limits"],
        }
    assert_aggregate_only(result)
    exclusive_json(RESULT_PATH, result, fsync=True)
    return result


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    freeze_parser = subparsers.add_parser("freeze")
    freeze_parser.add_argument("core_archive")
    freeze_parser.add_argument("replicate_archive")
    freeze_parser.add_argument("consumed_2022_archive")
    evaluate_parser = subparsers.add_parser("evaluate")
    evaluate_parser.add_argument("core_archive")
    evaluate_parser.add_argument("replicate_archive")
    args = parser.parse_args(argv)
    if args.command == "freeze":
        value = freeze_study(args.core_archive, args.replicate_archive, args.consumed_2022_archive)
        print(json.dumps(value, indent=2, sort_keys=True))
        return 0
    value = consume_and_evaluate(args.core_archive, args.replicate_archive)
    print(json.dumps(value, indent=2, sort_keys=True))
    return 0 if value["decision"] == "accepted" else 2


if __name__ == "__main__":
    raise SystemExit(main())
