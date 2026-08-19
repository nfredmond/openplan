#!/usr/bin/env python3
"""Compare borrowed and candidate auto ownership on one retained population."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "openplan.activitysim-auto-ownership-comparison.v2"


class AutoOwnershipComparisonError(RuntimeError):
    pass


def _read_choices(path: Path) -> dict[str, int]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"household_id", "auto_ownership"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise AutoOwnershipComparisonError(
                f"{path} is missing {', '.join(sorted(missing))}"
            )
        return {row["household_id"]: min(int(float(row["auto_ownership"])), 4) for row in reader}


def choice_metrics(reference: list[int], modeled: list[int]) -> dict[str, Any]:
    if not reference or len(reference) != len(modeled):
        raise AutoOwnershipComparisonError("Choice metrics require aligned non-empty arrays")
    count = len(reference)
    reference_distribution = {
        str(choice): sum(value == choice for value in reference) / count for choice in range(5)
    }
    modeled_distribution = {
        str(choice): sum(value == choice for value in modeled) / count for choice in range(5)
    }
    share_errors = [
        modeled_distribution[str(choice)] - reference_distribution[str(choice)]
        for choice in range(5)
    ]
    return {
        "records": count,
        "exact_accuracy": sum(a == b for a, b in zip(reference, modeled)) / count,
        "mean_absolute_vehicle_error": sum(abs(a - b) for a, b in zip(reference, modeled)) / count,
        "mean_vehicles": sum(modeled) / count,
        "mean_vehicle_bias": sum(b - a for a, b in zip(reference, modeled)) / count,
        "choice_shares": modeled_distribution,
        "distribution_calibration": {
            "reference_choice_shares": reference_distribution,
            "total_variation_distance": 0.5 * sum(abs(error) for error in share_errors),
            "share_rmse": (sum(error * error for error in share_errors) / 5) ** 0.5,
            "maximum_absolute_share_error": max(abs(error) for error in share_errors),
        },
    }


def _trip_summary(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    counts: dict[str, int] = {}
    total = 0
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if "trip_mode" not in (reader.fieldnames or []):
            raise AutoOwnershipComparisonError(f"{path} is missing trip_mode")
        for row in reader:
            total += 1
            mode = row["trip_mode"]
            counts[mode] = counts.get(mode, 0) + 1
    return {"trips": total, "trip_modes": dict(sorted(counts.items()))}


def compare(
    reference_path: str | Path,
    borrowed_path: str | Path,
    candidate_path: str | Path,
    *,
    borrowed_trips_path: str | Path | None = None,
    candidate_trips_path: str | Path | None = None,
    coefficient_package_path: str | Path | None = None,
) -> dict[str, Any]:
    paths = [Path(reference_path), Path(borrowed_path), Path(candidate_path)]
    reference, borrowed, candidate = [_read_choices(path) for path in paths]
    if reference.keys() != borrowed.keys() or reference.keys() != candidate.keys():
        raise AutoOwnershipComparisonError(
            "Reference, borrowed, and candidate household identifiers are not identical"
        )
    ids = list(reference)
    observed = [reference[key] for key in ids]
    borrowed_values = [borrowed[key] for key in ids]
    candidate_values = [candidate[key] for key in ids]
    borrowed_error = [abs(a - b) for a, b in zip(observed, borrowed_values)]
    candidate_error = [abs(a - b) for a, b in zip(observed, candidate_values)]
    pair = {
        "same_choice_share": sum(a == b for a, b in zip(borrowed_values, candidate_values)) / len(ids),
        "mean_absolute_choice_difference": sum(
            abs(a - b) for a, b in zip(borrowed_values, candidate_values)
        ) / len(ids),
        "candidate_closer_households": sum(a < b for a, b in zip(candidate_error, borrowed_error)),
        "borrowed_closer_households": sum(a > b for a, b in zip(candidate_error, borrowed_error)),
        "equal_error_households": sum(a == b for a, b in zip(candidate_error, borrowed_error)),
    }
    package = Path(coefficient_package_path) if coefficient_package_path else None
    result = {
        "schema_version": SCHEMA_VERSION,
        "status": "measured_not_accepted_for_production",
        "households": len(ids),
        "reference": {
            "meaning": "Census-PUMS-derived vehicle ownership retained in the fitted population",
            "metrics": choice_metrics(observed, observed),
        },
        "borrowed_mtc": {
            "meaning": "ActivitySim prototype_mtc Bay Area auto-ownership component",
            "metrics": choice_metrics(observed, borrowed_values),
            "downstream": _trip_summary(Path(borrowed_trips_path) if borrowed_trips_path else None),
        },
        "candidate_national": {
            "meaning": "NHTS-weighted national candidate auto-ownership component",
            "metrics": choice_metrics(observed, candidate_values),
            "downstream": _trip_summary(Path(candidate_trips_path) if candidate_trips_path else None),
        },
        "method_sensitivity": pair,
        "coefficient_package_sha256": (
            hashlib.sha256(package.read_bytes()).hexdigest() if package else None
        ),
        "interpretation": (
            "Agreement identifies insensitivity to the auto-ownership method on this population; "
            "it does not establish confidence or correctness. Distribution calibration is the "
            "transfer measure because the retained PUMS vehicle count and each simulated choice "
            "are separate realizations; household-level exact match remains diagnostic only."
        ),
    }
    return result


def markdown(result: dict[str, Any]) -> str:
    borrowed = result["borrowed_mtc"]["metrics"]
    candidate = result["candidate_national"]["metrics"]
    sensitivity = result["method_sensitivity"]
    return "\n".join([
        "# ActivitySim auto-ownership same-population comparison",
        "",
        f"Status: `{result['status']}`",
        "",
        "| Measure | Borrowed MTC | National candidate |",
        "|---|---:|---:|",
        f"| Exact accuracy | {borrowed['exact_accuracy']:.3%} | {candidate['exact_accuracy']:.3%} |",
        f"| Mean absolute vehicle error | {borrowed['mean_absolute_vehicle_error']:.4f} | {candidate['mean_absolute_vehicle_error']:.4f} |",
        f"| Mean vehicles | {borrowed['mean_vehicles']:.4f} | {candidate['mean_vehicles']:.4f} |",
        f"| Mean vehicle bias | {borrowed['mean_vehicle_bias']:+.4f} | {candidate['mean_vehicle_bias']:+.4f} |",
        f"| Vehicle-share total variation | {borrowed['distribution_calibration']['total_variation_distance']:.4f} | {candidate['distribution_calibration']['total_variation_distance']:.4f} |",
        "",
        f"The components chose the same vehicle count for {sensitivity['same_choice_share']:.3%} of households.",
        "This is a methodological-sensitivity measure, not confidence or correctness.",
        "",
        result["interpretation"],
        "",
    ])


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference_households")
    parser.add_argument("borrowed_households")
    parser.add_argument("candidate_households")
    parser.add_argument("output_dir")
    parser.add_argument("--borrowed-trips")
    parser.add_argument("--candidate-trips")
    parser.add_argument("--coefficient-package")
    args = parser.parse_args(argv)
    result = compare(
        args.reference_households,
        args.borrowed_households,
        args.candidate_households,
        borrowed_trips_path=args.borrowed_trips,
        candidate_trips_path=args.candidate_trips,
        coefficient_package_path=args.coefficient_package,
    )
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / "auto_ownership_comparison.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n"
    )
    (output / "auto_ownership_comparison.md").write_text(markdown(result))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
