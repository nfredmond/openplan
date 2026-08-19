#!/usr/bin/env python3
"""Run one candidate auto-ownership component across retained study bundles."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any, Iterable

from compare_activitysim_auto_ownership import compare


SCHEMA_VERSION = "openplan.activitysim-auto-ownership-transfer-study.v1"

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


def aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        raise TransferStudyError("Transfer study has no geography results")
    households = sum(row["households"] for row in results)

    def combined(model: str, metric: str) -> float:
        return sum(
            row["households"] * row[model]["metrics"][metric] for row in results
        ) / households

    candidate_wins = sum(
        row["candidate_national"]["metrics"]["mean_absolute_vehicle_error"]
        < row["borrowed_mtc"]["metrics"]["mean_absolute_vehicle_error"]
        for row in results
    )
    borrowed_mae = combined("borrowed_mtc", "mean_absolute_vehicle_error")
    candidate_mae = combined("candidate_national", "mean_absolute_vehicle_error")
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "measured_not_accepted_for_production",
        "geographies": len(results),
        "households": households,
        "borrowed_mtc": {
            "exact_accuracy": combined("borrowed_mtc", "exact_accuracy"),
            "mean_absolute_vehicle_error": borrowed_mae,
            "mean_vehicle_bias": combined("borrowed_mtc", "mean_vehicle_bias"),
        },
        "candidate_national": {
            "exact_accuracy": combined("candidate_national", "exact_accuracy"),
            "mean_absolute_vehicle_error": candidate_mae,
            "mean_vehicle_bias": combined("candidate_national", "mean_vehicle_bias"),
        },
        "candidate_lower_mae_geographies": candidate_wins,
        "borrowed_lower_or_equal_mae_geographies": len(results) - candidate_wins,
        "comparison_outcome": (
            "candidate_lower_aggregate_mae"
            if candidate_mae < borrowed_mae
            else "candidate_did_not_outperform_borrowed"
        ),
        "results": results,
        "interpretation": (
            "This is transfer evidence on retained Census-fitted populations. Model agreement "
            "measures methodological sensitivity, not confidence. Production acceptance remains "
            "a separate decision."
        ),
    }


def run_study(
    study_runs_dir: str | Path,
    coefficient_overlay: str | Path,
    stock_configs: str | Path,
    activitysim_cli: str | Path,
    output_dir: str | Path,
) -> dict[str, Any]:
    studies = Path(study_runs_dir)
    overlay = Path(coefficient_overlay).resolve()
    stock = Path(stock_configs).resolve()
    cli = Path(activitysim_cli).resolve()
    output = Path(output_dir)
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
        if comparison_path.is_file():
            result = json.loads(comparison_path.read_text())
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
                candidate_output / "final_households.csv",
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
    args = parser.parse_args(argv)
    print(json.dumps(run_study(
        args.study_runs_dir,
        args.coefficient_overlay,
        args.stock_configs,
        args.activitysim_cli,
        args.output_dir,
    ), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
