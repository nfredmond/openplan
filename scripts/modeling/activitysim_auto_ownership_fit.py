#!/usr/bin/env python3
"""Fit and geographically validate an ActivitySim auto-ownership EDB.

Run this only in the dedicated ActivitySim estimation environment. Coefficients
are exported only after every holdout fit converges; export is not acceptance.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any, Iterable


FIT_SCHEMA_VERSION = "openplan.activitysim-estimation-fit.v1"


class AutoOwnershipFitError(RuntimeError):
    pass


def configure_case_weights(model):
    model.weight_co_var = "survey_weight"
    return model


def weighted_prediction_metrics(
    observed: list[int], predicted: list[int], weights: list[float]
) -> dict[str, float]:
    if not observed or len(observed) != len(predicted) or len(observed) != len(weights):
        raise AutoOwnershipFitError("Prediction metrics require aligned non-empty observations")
    total_weight = sum(weights)
    if total_weight <= 0:
        raise AutoOwnershipFitError("Prediction metrics require positive survey weight")
    return {
        "weighted_exact_accuracy": sum(
            weight for actual, estimate, weight in zip(observed, predicted, weights)
            if actual == estimate
        ) / total_weight,
        "weighted_mean_absolute_vehicle_error": sum(
            abs(actual - estimate) * weight
            for actual, estimate, weight in zip(observed, predicted, weights)
        ) / total_weight,
    }


def _load_component(directory: Path):
    try:
        from activitysim.estimation.larch import component_model
    except ImportError as exc:
        raise AutoOwnershipFitError(
            "Install workers/activitysim_worker/requirements-estimation.txt before fitting"
        ) from exc
    model, data = component_model(
        "auto_ownership", edb_directory=str(directory / "auto_ownership"), return_data=True
    )
    return configure_case_weights(model), data


def _evaluate(model, data) -> dict[str, float]:
    likelihood = float(model.loglike())
    total_weight = float(model.total_weight())
    probabilities = model.probability(return_format="dataframe")
    # Larch codes the observed 0..4 vehicle alternatives as 1..5 internally.
    predicted = [int(code) - 1 for code in probabilities.idxmax(axis=1).tolist()]
    chooser = data.chooser_data.loc[probabilities.index]
    observed = [int(value) for value in chooser["override_choice"].tolist()]
    weights = [float(value) for value in chooser["survey_weight"].tolist()]
    return {
        "records": len(observed),
        "survey_weight": total_weight,
        "weighted_log_loss": -likelihood / total_weight,
        **weighted_prediction_metrics(observed, predicted, weights),
    }


def _write_coefficients(path: Path, model) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["coefficient_name", "value", "constrain"])
        writer.writeheader()
        names = list(model.pnames)
        values = list(model.pvals)
        if len(names) != len(values):
            raise AutoOwnershipFitError("Larch returned misaligned coefficient names and values")
        for name, value in zip(names, values):
            writer.writerow({"coefficient_name": name, "value": float(value), "constrain": "F"})


def _fit(model, *, max_iterations: int) -> dict[str, Any]:
    initial_loglike = float(model.loglike())
    result = model.estimate(maxiter=max_iterations)
    return {
        "converged": bool(result.success),
        "status": int(result.status),
        "message": str(result.message),
        "iterations": int(result.nit),
        "initial_loglike": initial_loglike,
        "fitted_loglike": float(result.loglike),
    }


def fit_bundles(
    bundle_dir: str | Path, output_dir: str | Path, *, max_iterations: int = 500
) -> dict[str, Any]:
    bundle = Path(bundle_dir)
    source_manifest_path = bundle / "manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text())
    if source_manifest.get("schema_version") != "openplan.activitysim-estimation-bundle.v1":
        raise AutoOwnershipFitError("Unsupported ActivitySim estimation bundle schema")
    output = Path(output_dir)
    holdout_results = []
    for holdout in source_manifest["holdouts"]:
        fold = int(holdout["holdout_fold"])
        train_model, _train_data = _load_component(bundle / f"fold_{fold}" / "train")
        convergence = _fit(train_model, max_iterations=max_iterations)
        if not convergence["converged"]:
            raise AutoOwnershipFitError(
                f"Holdout fold {fold} did not converge: {convergence['message']}"
            )
        validation_model, validation_data = _load_component(
            bundle / f"fold_{fold}" / "validation"
        )
        null_validation = _evaluate(validation_model, validation_data)
        validation_model.pvals = train_model.pvals
        fitted_validation = _evaluate(validation_model, validation_data)
        _write_coefficients(output / f"fold_{fold}_coefficients.csv", train_model)
        holdout_results.append({
            "holdout_fold": fold,
            "convergence": convergence,
            "validation_null": null_validation,
            "validation_fitted": fitted_validation,
        })

    final_model, _final_data = _load_component(bundle / "all")
    final_convergence = _fit(final_model, max_iterations=max_iterations)
    if not final_convergence["converged"]:
        raise AutoOwnershipFitError(
            f"All-data fit did not converge: {final_convergence['message']}"
        )
    _write_coefficients(output / "auto_ownership_coefficients_estimated.csv", final_model)
    log_losses = [row["validation_fitted"]["weighted_log_loss"] for row in holdout_results]
    accuracies = [row["validation_fitted"]["weighted_exact_accuracy"] for row in holdout_results]
    manifest = {
        "schema_version": FIT_SCHEMA_VERSION,
        "component": "auto_ownership",
        "status": "estimated_not_accepted_for_production",
        "survey_weight_applied": True,
        "geographic_holdouts": holdout_results,
        "aggregate_holdout_metrics": {
            "folds": len(holdout_results),
            "weighted_log_loss_mean_across_folds": sum(log_losses) / len(log_losses),
            "weighted_log_loss_range": [min(log_losses), max(log_losses)],
            "weighted_exact_accuracy_mean_across_folds": sum(accuracies) / len(accuracies),
            "weighted_exact_accuracy_range": [min(accuracies), max(accuracies)],
        },
        "all_data_convergence": final_convergence,
        "caveat": (
            "Convergence and held-out performance are measured evidence, not an automatic "
            "production-acceptance threshold or a claim that other ActivitySim components are national."
        ),
    }
    if not all(math.isfinite(value) for value in log_losses + accuracies):
        raise AutoOwnershipFitError("Non-finite holdout metric")
    output.mkdir(parents=True, exist_ok=True)
    (output / "fit_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle_dir")
    parser.add_argument("output_dir")
    parser.add_argument("--max-iterations", type=int, default=500)
    args = parser.parse_args(argv)
    print(json.dumps(
        fit_bundles(args.bundle_dir, args.output_dir, max_iterations=args.max_iterations),
        indent=2,
        sort_keys=True,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
