#!/usr/bin/env python3
"""Run one candidate auto-ownership component across retained study bundles."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any, Iterable

from compare_activitysim_auto_ownership import (
    SCHEMA_VERSION as COMPARISON_SCHEMA_VERSION,
    compare,
)


SCHEMA_VERSION = "openplan.activitysim-auto-ownership-transfer-study.v2"

EVALUATION_SETTINGS = """# Component-isolation run: identical upstream models through auto ownership.
inherit_settings: True
models:
  - initialize_landuse
  - initialize_households
  - compute_accessibility
  - school_location
  - workplace_location
  - auto_ownership_simulate
  - write_tables
output_tables:
  h5_store: False
  action: include
  prefix: final_
  tables:
    - tablename: households
      decode_columns:
        home_zone_id: land_use.zone_id
"""


class TransferStudyError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_fresh_holdout(
    registry_path: str | Path,
    study_runs_dir: str | Path,
    coefficient_overlay: str | Path,
) -> dict[str, Any]:
    registry_file = Path(registry_path).resolve()
    registry = json.loads(registry_file.read_text())
    if registry.get("schema_version") != "openplan.activitysim-auto-ownership-fresh-holdout.v1":
        raise TransferStudyError(f"Unsupported fresh-holdout registry: {registry_file}")
    if registry.get("status") != "pre_registered_before_candidate_execution":
        raise TransferStudyError("Fresh-holdout registry is not in its pre-registered state")

    overlay = Path(coefficient_overlay).resolve()
    manifest_path = overlay / "coefficient_package.json"
    expected_manifest = registry["candidate"]["package_manifest_sha256"]
    if _sha256(manifest_path) != expected_manifest:
        raise TransferStudyError("Candidate package manifest changed after holdout registration")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("status") != registry["candidate"]["package_status"]:
        raise TransferStudyError("Candidate package status changed after holdout registration")
    for filename, expected in registry["candidate"]["coefficient_files_sha256"].items():
        if _sha256(overlay / filename) != expected:
            raise TransferStudyError(
                f"Candidate coefficient {filename} changed after holdout registration"
            )

    expected_geographies = {row["geography_id"] for row in registry["geographies"]}
    discovered = {path.name for path in Path(study_runs_dir).iterdir() if path.is_dir()}
    if discovered != expected_geographies:
        missing = sorted(expected_geographies - discovered)
        extra = sorted(discovered - expected_geographies)
        raise TransferStudyError(
            f"Fresh holdout directories do not match the registry; missing={missing}, extra={extra}"
        )
    return {
        "registry_path": str(registry_file),
        "registry_sha256": _sha256(registry_file),
        "candidate_package_manifest_sha256": expected_manifest,
        "geography_ids": sorted(expected_geographies),
    }


def aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        raise TransferStudyError("Transfer study has no geography results")
    households = sum(row["households"] for row in results)

    def combined(model: str, metric: str) -> float:
        metric_path = metric.split(".")

        def value(row: dict[str, Any]) -> float:
            current: Any = row[model]["metrics"]
            for part in metric_path:
                current = current[part]
            return float(current)
        return sum(
            row["households"] * value(row) for row in results
        ) / households

    candidate_wins = sum(
        row["candidate_national"]["metrics"]["mean_absolute_vehicle_error"]
        < row["borrowed_mtc"]["metrics"]["mean_absolute_vehicle_error"]
        for row in results
    )
    borrowed_mae = combined("borrowed_mtc", "mean_absolute_vehicle_error")
    candidate_mae = combined("candidate_national", "mean_absolute_vehicle_error")
    borrowed_distribution_error = combined(
        "borrowed_mtc", "distribution_calibration.total_variation_distance"
    )
    candidate_distribution_error = combined(
        "candidate_national", "distribution_calibration.total_variation_distance"
    )
    candidate_distribution_wins = sum(
        row["candidate_national"]["metrics"]["distribution_calibration"][
            "total_variation_distance"
        ]
        < row["borrowed_mtc"]["metrics"]["distribution_calibration"][
            "total_variation_distance"
        ]
        for row in results
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "measured_not_accepted_for_production",
        "geographies": len(results),
        "households": households,
        "borrowed_mtc": {
            "exact_accuracy": combined("borrowed_mtc", "exact_accuracy"),
            "mean_absolute_vehicle_error": borrowed_mae,
            "mean_vehicle_bias": combined("borrowed_mtc", "mean_vehicle_bias"),
            "choice_distribution_total_variation": borrowed_distribution_error,
        },
        "candidate_national": {
            "exact_accuracy": combined("candidate_national", "exact_accuracy"),
            "mean_absolute_vehicle_error": candidate_mae,
            "mean_vehicle_bias": combined("candidate_national", "mean_vehicle_bias"),
            "choice_distribution_total_variation": candidate_distribution_error,
        },
        "candidate_lower_mae_geographies": candidate_wins,
        "borrowed_lower_or_equal_mae_geographies": len(results) - candidate_wins,
        "candidate_lower_distribution_error_geographies": candidate_distribution_wins,
        "borrowed_lower_or_equal_distribution_error_geographies": (
            len(results) - candidate_distribution_wins
        ),
        "comparison_outcome": (
            "candidate_lower_aggregate_mae"
            if candidate_mae < borrowed_mae
            else "candidate_did_not_outperform_borrowed"
        ),
        "distribution_comparison_outcome": (
            "candidate_lower_aggregate_distribution_error"
            if candidate_distribution_error < borrowed_distribution_error
            else "candidate_did_not_improve_aggregate_distribution_error"
        ),
        "results": results,
        "interpretation": (
            "This is transfer evidence on retained Census-fitted populations. Vehicle-share "
            "distribution error is the transfer measure; household exact match compares separate "
            "stochastic realizations and remains diagnostic. Production acceptance requires an "
            "untouched holdout and remains a separate decision."
        ),
    }


def run_study(
    study_runs_dir: str | Path,
    coefficient_overlay: str | Path,
    stock_configs: str | Path,
    activitysim_cli: str | Path,
    output_dir: str | Path,
    registry_path: str | Path | None = None,
) -> dict[str, Any]:
    studies = Path(study_runs_dir)
    overlay = Path(coefficient_overlay).resolve()
    stock = Path(stock_configs).resolve()
    cli = Path(activitysim_cli).resolve()
    output = Path(output_dir)
    holdout_lock = (
        validate_fresh_holdout(registry_path, studies, overlay)
        if registry_path is not None else None
    )
    if holdout_lock is not None:
        incomplete = {}
        for geography_id in holdout_lock["geography_ids"]:
            study = studies / geography_id
            required = [
                study / "activitysim_bundle/households.csv",
                study / "activitysim_bundle/persons.csv",
                study / "activitysim_bundle/configs/settings.yaml",
                study / "activitysim_output/output/final_households.csv",
            ]
            missing = [str(path.relative_to(study)) for path in required if not path.is_file()]
            if missing:
                incomplete[geography_id] = missing
        if incomplete:
            raise TransferStudyError(
                f"Fresh holdout has incomplete retained inputs: {incomplete}"
            )
    eval_config = output / "evaluation_config"
    eval_config.mkdir(parents=True, exist_ok=True)
    (eval_config / "settings.yaml").write_text(EVALUATION_SETTINGS)
    results = []
    exclusions: dict[str, list[str]] = {}
    for study in sorted(path for path in studies.iterdir() if path.is_dir()):
        bundle = study / "activitysim_bundle"
        borrowed = study / "activitysim_output/output/final_households.csv"
        required = [
            bundle / "households.csv", bundle / "persons.csv", bundle / "configs/settings.yaml",
            borrowed,
        ]
        missing = [str(path.relative_to(study)) for path in required if not path.is_file()]
        if missing:
            exclusions[study.name] = missing
            continue
        candidate_output = output / study.name / "output"
        comparison_path = output / study.name / "comparison.json"
        candidate_households = candidate_output / "final_households.csv"
        saved = json.loads(comparison_path.read_text()) if comparison_path.is_file() else None
        if saved and saved.get("schema_version") == COMPARISON_SCHEMA_VERSION:
            result = saved
        elif candidate_households.is_file():
            result = compare(
                bundle / "households.csv",
                borrowed,
                candidate_households,
                coefficient_package_path=overlay / "coefficient_package.json",
            )
            result["geography_key"] = study.name
            result["candidate_runtime_stdout_tail"] = (
                (saved or {}).get("candidate_runtime_stdout_tail")
            )
            comparison_path.parent.mkdir(parents=True, exist_ok=True)
            comparison_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        else:
            command = [
                str(cli), "run",
                "-c", str(eval_config.resolve()),
                "-c", str(overlay),
                "-c", str((bundle / "configs").resolve()),
                "-c", str(stock),
                "-d", str(bundle.resolve()),
                "-o", str(candidate_output.resolve()),
            ]
            completed = subprocess.run(command, text=True, capture_output=True)
            if completed.returncode:
                raise TransferStudyError(
                    f"Candidate ActivitySim run failed for {study.name}:\n{completed.stderr[-4000:]}"
                )
            result = compare(
                bundle / "households.csv",
                borrowed,
                candidate_households,
                coefficient_package_path=overlay / "coefficient_package.json",
            )
            result["geography_key"] = study.name
            result["candidate_runtime_stdout_tail"] = completed.stdout[-1000:]
            comparison_path.parent.mkdir(parents=True, exist_ok=True)
            comparison_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        results.append(result)
    summary = aggregate(results)
    summary["directories_discovered"] = len(results) + len(exclusions)
    summary["excluded_incomplete_runs"] = exclusions
    if holdout_lock is not None:
        summary["fresh_holdout_lock"] = holdout_lock
    (output / "transfer_study.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n"
    )
    return summary


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("study_runs_dir")
    parser.add_argument("coefficient_overlay")
    parser.add_argument("stock_configs")
    parser.add_argument("activitysim_cli")
    parser.add_argument("output_dir")
    parser.add_argument("--registry", help="Pre-registered fresh-holdout registry to enforce")
    args = parser.parse_args(argv)
    print(json.dumps(run_study(
        args.study_runs_dir,
        args.coefficient_overlay,
        args.stock_configs,
        args.activitysim_cli,
        args.output_dir,
        registry_path=args.registry,
    ), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
