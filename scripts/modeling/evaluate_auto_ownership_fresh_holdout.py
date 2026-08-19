#!/usr/bin/env python3
"""Apply only the acceptance rules locked before the fresh holdout ran."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "openplan.activitysim-auto-ownership-fresh-holdout-result.v1"


class FreshHoldoutEvaluationError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate(registry_path: str | Path, transfer_path: str | Path) -> dict[str, Any]:
    registry_file = Path(registry_path).resolve()
    transfer_file = Path(transfer_path).resolve()
    registry = json.loads(registry_file.read_text())
    transfer = json.loads(transfer_file.read_text())
    lock = transfer.get("fresh_holdout_lock") or {}
    if lock.get("registry_sha256") != _sha256(registry_file):
        raise FreshHoldoutEvaluationError("Transfer result is not bound to this registry")
    expected_ids = {row["geography_id"] for row in registry["geographies"]}
    result_ids = {row["geography_key"] for row in transfer["results"]}
    if result_ids != expected_ids:
        raise FreshHoldoutEvaluationError("Transfer result geography set differs from the registry")

    borrowed_tv = transfer["borrowed_mtc"]["choice_distribution_total_variation"]
    candidate_tv = transfer["candidate_national"]["choice_distribution_total_variation"]
    if borrowed_tv <= 0:
        raise FreshHoldoutEvaluationError(
            "Borrowed-MTC aggregate distribution error must be positive"
        )
    relative_improvement = (borrowed_tv - candidate_tv) / borrowed_tv
    win_share = transfer["candidate_lower_distribution_error_geographies"] / len(result_ids)
    bias_disadvantage = (
        abs(transfer["candidate_national"]["mean_vehicle_bias"])
        - abs(transfer["borrowed_mtc"]["mean_vehicle_bias"])
    )
    geography_disadvantages = {
        row["geography_key"]: (
            row["candidate_national"]["metrics"]["distribution_calibration"]["total_variation_distance"]
            - row["borrowed_mtc"]["metrics"]["distribution_calibration"]["total_variation_distance"]
        )
        for row in transfer["results"]
    }
    worst_disadvantage = max(geography_disadvantages.values())
    rules = registry["acceptance_rules"]
    checks = {
        "relative_aggregate_improvement": {
            "value": relative_improvement,
            "threshold": rules["minimum_relative_aggregate_improvement"],
            "passed": relative_improvement >= rules["minimum_relative_aggregate_improvement"],
        },
        "geography_win_share": {
            "value": win_share,
            "threshold": rules["minimum_geography_win_share"],
            "passed": win_share >= rules["minimum_geography_win_share"],
        },
        "absolute_bias_disadvantage": {
            "value": bias_disadvantage,
            "maximum": rules["maximum_absolute_bias_disadvantage"],
            "passed": bias_disadvantage <= rules["maximum_absolute_bias_disadvantage"],
        },
        "worst_single_geography_tv_disadvantage": {
            "value": worst_disadvantage,
            "maximum": rules["maximum_single_geography_tv_disadvantage"],
            "passed": worst_disadvantage <= rules["maximum_single_geography_tv_disadvantage"],
        },
    }
    accepted = all(check["passed"] for check in checks.values())
    return {
        "schema_version": SCHEMA_VERSION,
        "decision": "accept_auto_ownership_component" if accepted else "reject_auto_ownership_component",
        "accepted": accepted,
        "scope": "ActivitySim auto-ownership component only",
        "registry_sha256": _sha256(registry_file),
        "transfer_result_sha256": _sha256(transfer_file),
        "checks": checks,
        "per_geography_tv_disadvantage": geography_disadvantages,
        "diagnostic_only": {
            "household_exact_accuracy": True,
            "individual_household_mean_absolute_error": True,
        },
    }


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry")
    parser.add_argument("transfer_result")
    parser.add_argument("output")
    args = parser.parse_args(argv)
    result = evaluate(args.registry, args.transfer_result)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["accepted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
