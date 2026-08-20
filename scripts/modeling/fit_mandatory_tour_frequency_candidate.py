#!/usr/bin/env python3
"""Fit the frozen development-only mandatory-tour candidate.

The model is a regularized multinomial correction around a training-only
worker/student frequency reference.  Acceptance divisions are refused.  A
candidate package is written only when the locked development gate passes.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import mandatory_tour_frequency_candidate_registry as protocol
import mandatory_tour_frequency_outcomes as outcomes


SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-frequency-fit.v1"
PACKAGE_SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-frequency-package.v1"
FIT_MANIFEST_NAME = "fit_manifest.json"
MODEL_NAME = "mandatory_tour_frequency_model.json"
PACKAGE_MANIFEST_NAME = "coefficient_package.json"
SPEC_NAME = "mandatory_tour_frequency.csv"
COEFFICIENTS_NAME = "mandatory_tour_frequency_coefficients.csv"
SETTINGS_NAME = "mandatory_tour_frequency.yaml"

STATUS_CELLS = (
    (False, False, "not_worker_not_student"),
    (False, True, "not_worker_student"),
    (True, False, "worker_not_student"),
    (True, True, "worker_student"),
)


class MandatoryTourFitError(RuntimeError):
    """The frozen candidate cannot be fit or packaged honestly."""


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
        raise MandatoryTourFitError(f"{label} is unreadable: {path}") from exc
    if not isinstance(value, dict):
        raise MandatoryTourFitError(f"{label} must be a JSON object")
    return value


def _integer(value: Any) -> int | None:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def status_cell(row: Mapping[str, Any]) -> str:
    worker = str(row.get("worker_code") or "") == "01"
    student = str(row.get("school_code") or "") == "01"
    return next(name for is_worker, is_student, name in STATUS_CELLS if (worker, student) == (is_worker, is_student))


def feature_values(row: Mapping[str, Any]) -> list[float] | None:
    age = _integer(row.get("age"))
    sex = str(row.get("sex_code") or "")
    household_size = _integer(row.get("household_size"))
    workers = _integer(row.get("workers"))
    vehicles = _integer(row.get("vehicles"))
    if (
        age is None
        or sex not in {"01", "02"}
        or household_size is None
        or workers is None
        or vehicles is None
    ):
        return None
    age_decades = (age - 40.0) / 10.0
    return [
        age_decades,
        age_decades * age_decades,
        1.0 if sex == "02" else 0.0,
        float(min(household_size, 5) - 1),
        float(min(workers, 3)),
        float(min(vehicles, 4)),
        1.0 if vehicles == 0 else 0.0,
    ]


def load_inputs(
    outcomes_dir: str | Path,
    registry_path: str | Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, str]]:
    source_dir = Path(outcomes_dir).resolve()
    registry_file = Path(registry_path).resolve()
    registry = _load_json(registry_file, "Candidate registry")
    if registry.get("schema_version") != protocol.SCHEMA_VERSION:
        raise MandatoryTourFitError("Unsupported mandatory-tour candidate registry")
    if registry.get("status") != protocol.STATUS:
        raise MandatoryTourFitError("Candidate registry is not frozen with acceptance unopened")
    if registry.get("acceptance_outcomes_read") is not False:
        raise MandatoryTourFitError("Candidate registry does not keep acceptance unopened")

    manifest_path = source_dir / outcomes.MANIFEST_NAME
    person_days_path = source_dir / outcomes.OUTPUT_NAME
    if _sha256(manifest_path) != registry["source"]["development_outcome_manifest_sha256"]:
        raise MandatoryTourFitError("Development outcome manifest changed after candidate lock")
    if _sha256(person_days_path) != registry["source"]["development_person_days_sha256"]:
        raise MandatoryTourFitError("Development person-days changed after candidate lock")

    with person_days_path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        missing = sorted(set(outcomes.OUTPUT_COLUMNS) - set(reader.fieldnames or []))
        if missing:
            raise MandatoryTourFitError(
                "Development person-days are missing " + ", ".join(missing)
            )
        raw_rows = list(reader)

    development = set(registry["source"]["development_division_codes"])
    acceptance = set(registry["source"]["acceptance_division_codes_committed_but_not_read"])
    discovered = {str(row["census_division_code"]) for row in raw_rows}
    forbidden = sorted(discovered & acceptance)
    if forbidden:
        raise MandatoryTourFitError(
            "Development inputs contain locked acceptance divisions: " + ", ".join(forbidden)
        )
    if discovered != development:
        raise MandatoryTourFitError(
            "Development input divisions changed after the candidate protocol was frozen"
        )

    alternative_index = {name: index for index, name in enumerate(protocol.ALTERNATIVES)}
    rows: list[dict[str, Any]] = []
    for raw in raw_rows:
        if raw["outcome_status"] != "supported_alternative":
            continue
        alternative = str(raw["alternative"])
        weight = _float(raw.get("weekday_weight"))
        if alternative not in alternative_index or weight is None or weight <= 0:
            raise MandatoryTourFitError("A supported development row violates the candidate contract")
        rows.append({
            "division": str(raw["census_division_code"]),
            "cell": status_cell(raw),
            "choice": alternative_index[alternative],
            "weight": weight,
            "features": feature_values(raw),
        })
    if len(rows) != registry["development_inventory"]["supported_records"]:
        raise MandatoryTourFitError("Supported development record count changed after candidate lock")
    invalid = sum(row["features"] is None for row in rows)
    if invalid != registry["development_inventory"]["candidate_predictor_invalid_records"]:
        raise MandatoryTourFitError("Candidate predictor validity changed after candidate lock")
    return registry, rows, {
        "registry_sha256": _sha256(registry_file),
        "development_outcome_manifest_sha256": _sha256(manifest_path),
        "development_person_days_sha256": _sha256(person_days_path),
    }


def normalized_weights(weights: Sequence[float]) -> list[float]:
    total = sum(weights)
    if not weights or not math.isfinite(total) or total <= 0:
        raise MandatoryTourFitError("Weight normalization requires positive finite weights")
    scale = len(weights) / total
    return [weight * scale for weight in weights]


def reference_probabilities(
    rows: Sequence[Mapping[str, Any]],
    *,
    alpha: float,
) -> dict[str, list[float]]:
    if not rows or not math.isfinite(alpha) or alpha <= 0:
        raise MandatoryTourFitError("Reference probabilities need records and positive smoothing")
    alternatives = len(protocol.ALTERNATIVES)

    def distribution(group: Sequence[Mapping[str, Any]]) -> list[float]:
        if not group:
            raise MandatoryTourFitError("Cannot fit an empty reference distribution")
        weights = normalized_weights([float(row["weight"]) for row in group])
        totals = [alpha] * alternatives
        for row, weight in zip(group, weights):
            choice = int(row["choice"])
            if not 0 <= choice < alternatives:
                raise MandatoryTourFitError("Reference row has an invalid alternative")
            totals[choice] += weight
        total = sum(totals)
        return [value / total for value in totals]

    pooled = distribution(rows)
    result = {}
    for _worker, _student, cell in STATUS_CELLS:
        cell_rows = [row for row in rows if row["cell"] == cell]
        result[cell] = distribution(cell_rows) if cell_rows else list(pooled)
    return result


def arrays(rows: Sequence[Mapping[str, Any]]):
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourFitError("Mandatory-tour fitting requires numpy") from exc
    feature_count = len(protocol.PREDICTORS)
    x = np.asarray([
        row["features"] if row["features"] is not None else [0.0] * feature_count
        for row in rows
    ], dtype=float)
    choices = np.asarray([int(row["choice"]) for row in rows], dtype=int)
    weights = np.asarray([float(row["weight"]) for row in rows], dtype=float)
    valid = np.asarray([row["features"] is not None for row in rows], dtype=bool)
    return x, choices, weights, valid


def probabilities(
    rows: Sequence[Mapping[str, Any]],
    reference: Mapping[str, Sequence[float]],
    coefficients,
):
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourFitError("Mandatory-tour fitting requires numpy") from exc
    x, _choices, _weights, valid = arrays(rows)
    expected_shape = (len(protocol.ALTERNATIVES) - 1, len(protocol.PREDICTORS))
    beta = np.asarray(coefficients, dtype=float)
    if beta.shape != expected_shape:
        raise MandatoryTourFitError(
            f"Coefficient shape must be {expected_shape}, received {beta.shape}"
        )
    offsets = np.asarray([reference[str(row["cell"])] for row in rows], dtype=float)
    if offsets.shape != (len(rows), len(protocol.ALTERNATIVES)) or np.any(offsets <= 0):
        raise MandatoryTourFitError("Reference probabilities are incomplete or non-positive")
    logits = np.log(offsets)
    logits[:, 1:] += x @ beta.T
    # Predictor-invalid observations are the exact reference, regardless of beta.
    logits[~valid, :] = np.log(offsets[~valid, :])
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return exp / exp.sum(axis=1, keepdims=True)


def objective_and_gradient(
    flat_coefficients,
    rows: Sequence[Mapping[str, Any]],
    reference: Mapping[str, Sequence[float]],
    regularization: float,
):
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourFitError("Mandatory-tour fitting requires numpy") from exc
    if regularization <= 0 or not math.isfinite(regularization):
        raise MandatoryTourFitError("L2 regularization must be positive and finite")
    beta = np.asarray(flat_coefficients, dtype=float).reshape(
        len(protocol.ALTERNATIVES) - 1, len(protocol.PREDICTORS)
    )
    x, choices, original_weights, valid = arrays(rows)
    weights = np.asarray(normalized_weights(original_weights.tolist()), dtype=float)
    predicted = probabilities(rows, reference, beta)
    tiny = np.finfo(float).tiny
    n = len(rows)
    loss = -float(np.sum(weights * np.log(np.maximum(predicted[np.arange(n), choices], tiny)))) / n
    loss += 0.5 * regularization * float(np.sum(beta * beta))
    residual = predicted[:, 1:].copy()
    for alternative in range(1, len(protocol.ALTERNATIVES)):
        residual[:, alternative - 1] -= choices == alternative
    residual[~valid, :] = 0.0
    gradient = (residual * weights[:, None]).T @ x / n + regularization * beta
    return loss, gradient.reshape(-1)


def fit_model(
    rows: Sequence[Mapping[str, Any]],
    reference: Mapping[str, Sequence[float]],
    *,
    regularization: float,
    optimizer: Mapping[str, Any],
) -> tuple[Any, dict[str, Any]]:
    try:
        import numpy as np
        from scipy.optimize import minimize
    except ImportError as exc:
        raise MandatoryTourFitError("Mandatory-tour fitting requires scipy and numpy") from exc
    initial = np.zeros((len(protocol.ALTERNATIVES) - 1) * len(protocol.PREDICTORS))
    result = minimize(
        objective_and_gradient,
        initial,
        args=(rows, reference, regularization),
        jac=True,
        method=str(optimizer["method"]),
        options={
            "maxiter": int(optimizer["maximum_iterations"]),
            "ftol": float(optimizer["ftol"]),
            "gtol": float(optimizer["gtol"]),
        },
    )
    coefficients = np.asarray(result.x, dtype=float).reshape(
        len(protocol.ALTERNATIVES) - 1, len(protocol.PREDICTORS)
    )
    if not bool(result.success) or not np.all(np.isfinite(coefficients)):
        raise MandatoryTourFitError(
            f"Candidate fit did not converge for lambda={regularization}: {result.message}"
        )
    return coefficients, {
        "converged": True,
        "status": int(result.status),
        "message": str(result.message),
        "iterations": int(result.nit),
        "objective": float(result.fun),
        "gradient_max_absolute": float(np.max(np.abs(result.jac))),
    }


def weighted_log_loss(
    rows: Sequence[Mapping[str, Any]],
    predicted,
) -> float:
    try:
        import numpy as np
    except ImportError as exc:
        raise MandatoryTourFitError("Mandatory-tour fitting requires numpy") from exc
    _x, choices, weights, _valid = arrays(rows)
    total = float(weights.sum())
    if total <= 0:
        raise MandatoryTourFitError("Log loss requires positive validation weight")
    selected = np.asarray(predicted)[np.arange(len(rows)), choices]
    return -float(np.sum(weights * np.log(np.maximum(selected, np.finfo(float).tiny)))) / total


def evaluate_fold(
    train: Sequence[Mapping[str, Any]],
    validation: Sequence[Mapping[str, Any]],
    *,
    alpha: float,
    regularization: float,
    optimizer: Mapping[str, Any],
) -> dict[str, Any]:
    import numpy as np

    reference = reference_probabilities(train, alpha=alpha)
    beta, convergence = fit_model(
        train,
        reference,
        regularization=regularization,
        optimizer=optimizer,
    )
    reference_beta = np.zeros_like(beta)
    return {
        "regularization": regularization,
        "convergence": convergence,
        "validation_records": len(validation),
        "validation_weight": sum(float(row["weight"]) for row in validation),
        "reference_log_loss": weighted_log_loss(
            validation, probabilities(validation, reference, reference_beta)
        ),
        "candidate_log_loss": weighted_log_loss(
            validation, probabilities(validation, reference, beta)
        ),
    }


def select_regularization(
    rows: Sequence[Mapping[str, Any]],
    registry: Mapping[str, Any],
) -> dict[str, Any]:
    divisions = list(registry["development_selection"]["division_codes"])
    alpha = float(registry["reference_model"]["additive_smoothing_alpha"])
    optimizer = registry["estimation"]["optimizer"]
    lambdas = [float(value) for value in registry["estimation"]["lambda_grid"]]
    results_by_lambda = {value: [] for value in lambdas}
    for division in divisions:
        train = [row for row in rows if row["division"] != division]
        validation = [row for row in rows if row["division"] == division]
        if not train or not validation:
            raise MandatoryTourFitError(f"Development fold {division} is empty")
        for regularization in lambdas:
            result = evaluate_fold(
                train,
                validation,
                alpha=alpha,
                regularization=regularization,
                optimizer=optimizer,
            )
            result["holdout_division"] = division
            results_by_lambda[regularization].append(result)

    summaries = []
    for regularization in lambdas:
        folds = results_by_lambda[regularization]
        total_weight = sum(row["validation_weight"] for row in folds)
        reference_loss = sum(
            row["reference_log_loss"] * row["validation_weight"] for row in folds
        ) / total_weight
        candidate_loss = sum(
            row["candidate_log_loss"] * row["validation_weight"] for row in folds
        ) / total_weight
        summaries.append({
            "regularization": regularization,
            "pooled_reference_log_loss": reference_loss,
            "pooled_candidate_log_loss": candidate_loss,
            "division_log_loss_wins": sum(
                row["candidate_log_loss"] < row["reference_log_loss"] for row in folds
            ),
            "folds": folds,
        })
    best_loss = min(row["pooled_candidate_log_loss"] for row in summaries)
    selected = max(
        (row for row in summaries if row["pooled_candidate_log_loss"] <= best_loss + 1e-10),
        key=lambda row: row["regularization"],
    )
    minimum_wins = int(
        registry["development_selection"]["development_gate"][
            "minimum_division_log_loss_wins"
        ]
    )
    boundary = selected["regularization"] in {lambdas[0], lambdas[-1]}
    gate_passed = (
        not boundary
        and selected["pooled_candidate_log_loss"] < selected["pooled_reference_log_loss"]
        and selected["division_log_loss_wins"] >= minimum_wins
    )
    return {
        "selected_regularization": selected["regularization"],
        "selected_is_grid_boundary": boundary,
        "selected_pooled_reference_log_loss": selected["pooled_reference_log_loss"],
        "selected_pooled_candidate_log_loss": selected["pooled_candidate_log_loss"],
        "selected_division_log_loss_wins": selected["division_log_loss_wins"],
        "development_gate_passed": gate_passed,
        "regularization_results": summaries,
    }


def _coefficient_rows(
    reference: Mapping[str, Sequence[float]],
    coefficients,
) -> list[dict[str, Any]]:
    rows = []
    for _worker, _student, cell in STATUS_CELLS:
        for alternative, probability in zip(protocol.ALTERNATIVES, reference[cell]):
            rows.append({
                "coefficient_name": f"offset_{cell}_{alternative}",
                "value": math.log(float(probability)),
                "constrain": "T",
            })
    for alternative_index, alternative in enumerate(protocol.ALTERNATIVES[1:]):
        for predictor_index, predictor in enumerate(protocol.PREDICTORS):
            rows.append({
                "coefficient_name": f"coef_{alternative}_{predictor['name']}",
                "value": float(coefficients[alternative_index, predictor_index]),
                "constrain": "F",
            })
    return rows


def _spec_rows() -> list[dict[str, Any]]:
    expressions = {
        "not_worker_not_student": "(~is_worker) & (~is_student)",
        "not_worker_student": "(~is_worker) & is_student",
        "worker_not_student": "is_worker & (~is_student)",
        "worker_student": "is_worker & is_student",
    }
    rows = []
    for _worker, _student, cell in STATUS_CELLS:
        row = {
            "Label": f"reference_offset_{cell}",
            "Description": f"Fixed development reference offset for {cell}",
            "Expression": expressions[cell],
        }
        for alternative in protocol.ALTERNATIVES:
            row[alternative] = f"offset_{cell}_{alternative}"
        rows.append(row)
    for predictor in protocol.PREDICTORS:
        row = {
            "Label": f"candidate_{predictor['name']}",
            "Description": f"National candidate {predictor['name'].replace('_', ' ')}",
            "Expression": predictor["runtime"],
            protocol.REFERENCE_ALTERNATIVE: "0",
        }
        for alternative in protocol.ALTERNATIVES[1:]:
            row[alternative] = f"coef_{alternative}_{predictor['name']}"
        rows.append(row)
    return rows


def _write_csv(path: Path, rows: Sequence[Mapping[str, Any]], fieldnames: Sequence[str]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _model_record(
    reference: Mapping[str, Sequence[float]],
    coefficients,
    regularization: float,
) -> dict[str, Any]:
    return {
        "alternatives": list(protocol.ALTERNATIVES),
        "reference_alternative": protocol.REFERENCE_ALTERNATIVE,
        "selected_regularization": regularization,
        "reference_probabilities": {
            cell: {alternative: float(value) for alternative, value in zip(protocol.ALTERNATIVES, values)}
            for cell, values in reference.items()
        },
        "learned_coefficients": {
            alternative: {
                predictor["name"]: float(coefficients[alternative_index, predictor_index])
                for predictor_index, predictor in enumerate(protocol.PREDICTORS)
            }
            for alternative_index, alternative in enumerate(protocol.ALTERNATIVES[1:])
        },
        "reference_alternative_learned_coefficients": {},
    }


def fit_candidate(
    outcomes_dir: str | Path,
    registry_path: str | Path,
    output_dir: str | Path,
) -> dict[str, Any]:
    output = Path(output_dir).resolve()
    if output.exists() or output.is_symlink():
        raise MandatoryTourFitError(f"{output} already exists; candidate results are immutable")
    registry, rows, source_hashes = load_inputs(outcomes_dir, registry_path)
    selection = select_regularization(rows, registry)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".mandatory-tour-fit-", dir=output.parent))
    try:
        manifest: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "component": "mandatory_tour_frequency",
            "status": (
                "candidate_not_accepted_for_production"
                if selection["development_gate_passed"]
                else "development_gate_failed_no_candidate_package"
            ),
            "acceptance_outcomes_read": False,
            "source": source_hashes,
            "implementation_sha256": _sha256(Path(__file__).resolve()),
            "development_selection": selection,
        }
        if selection["development_gate_passed"]:
            regularization = float(selection["selected_regularization"])
            alpha = float(registry["reference_model"]["additive_smoothing_alpha"])
            reference = reference_probabilities(rows, alpha=alpha)
            coefficients, convergence = fit_model(
                rows,
                reference,
                regularization=regularization,
                optimizer=registry["estimation"]["optimizer"],
            )
            model_path = staging / MODEL_NAME
            model_path.write_text(json.dumps(
                _model_record(reference, coefficients, regularization),
                indent=2,
                sort_keys=True,
            ) + "\n")
            _write_csv(
                staging / SPEC_NAME,
                _spec_rows(),
                ["Label", "Description", "Expression", *protocol.ALTERNATIVES],
            )
            _write_csv(
                staging / COEFFICIENTS_NAME,
                _coefficient_rows(reference, coefficients),
                ["coefficient_name", "value", "constrain"],
            )
            (staging / SETTINGS_NAME).write_text(
                f"SPEC: {SPEC_NAME}\n"
                f"COEFFICIENTS: {COEFFICIENTS_NAME}\n"
                "LOGIT_TYPE: MNL\n"
            )
            package_files = [SETTINGS_NAME, SPEC_NAME, COEFFICIENTS_NAME, MODEL_NAME]
            package = {
                "schema_version": PACKAGE_SCHEMA_VERSION,
                "status": "candidate_not_accepted_for_production",
                "component": "mandatory_tour_frequency",
                "acceptance_outcomes_read": False,
                "candidate_registry_sha256": source_hashes["registry_sha256"],
                "reference_model_implementation_sha256": manifest["implementation_sha256"],
                "selected_regularization": regularization,
                "all_data_convergence": convergence,
                "files_sha256": {
                    name: _sha256(staging / name) for name in package_files
                },
                "scope": "mandatory_tour_frequency conditional on mandatory DAP only",
                "installation_authorized": False,
            }
            (staging / PACKAGE_MANIFEST_NAME).write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n"
            )
            manifest["all_development_fit"] = convergence
            manifest["candidate_package"] = {
                "manifest": PACKAGE_MANIFEST_NAME,
                "manifest_sha256": _sha256(staging / PACKAGE_MANIFEST_NAME),
                "files_sha256": package["files_sha256"],
            }
        (staging / FIT_MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        )
        if output.exists() or output.is_symlink():
            raise MandatoryTourFitError(
                f"{output} appeared during fitting; refusing to overwrite it"
            )
        staging.rename(output)
        return manifest
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outcomes_dir")
    parser.add_argument("candidate_registry")
    parser.add_argument("output_dir")
    args = parser.parse_args(argv)
    result = fit_candidate(args.outcomes_dir, args.candidate_registry, args.output_dir)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["development_selection"]["development_gate_passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
