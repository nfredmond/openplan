#!/usr/bin/env python3
"""Arithmetic evaluation of the pre-registered gateway-volume study."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import statistics
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STUDY_DIR = REPO_ROOT / "data/modeling/gateway-volume-study-2026-08-22"
DEMAND_METHODS = ("aequilibrae", "activitysim")


class GatewayVolumeEvaluationError(RuntimeError):
    """A frozen input or paired evaluation invariant is missing."""


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validation_rows(record: Mapping[str, Any], repo_root: Path) -> dict[str, dict[str, Any]]:
    artifacts = record["full_validation_artifacts"]
    validation_dir = repo_root / artifacts["location"]
    path = validation_dir / "validation_results.csv"
    expected_hash = artifacts["sha256"]["validation_results.csv"]
    if not path.exists() or sha256_file(path) != expected_hash:
        raise GatewayVolumeEvaluationError(
            f"Full validation artifact is missing or changed: {path}"
        )
    with path.open(newline="") as handle:
        rows = {
            row["station_id"]: row
            for row in csv.DictReader(handle)
            if row.get("match_status") == "matched"
        }
    if len(rows) != record["matched_station_count"]:
        raise GatewayVolumeEvaluationError(
            f"Matched-station count disagrees with compact evidence: {path}"
        )
    set_hash = hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()
    if set_hash != record["matched_station_set_sha256"]:
        raise GatewayVolumeEvaluationError(
            f"Matched-station set disagrees with compact evidence: {path}"
        )
    return rows


def numeric_ape(row: Mapping[str, Any]) -> float:
    try:
        return float(row["absolute_percent_error"])
    except (KeyError, TypeError, ValueError) as error:
        raise GatewayVolumeEvaluationError(
            f"Matched station {row.get('station_id')} has no numeric APE"
        ) from error


def paired_method_metrics(
    counties: Sequence[Mapping[str, Any]], thresholds: Mapping[str, Any]
) -> dict[str, Any]:
    county_improvements = [
        float(county["baseline_median_ape"]) - float(county["candidate_median_ape"])
        for county in counties
    ]
    baseline_apes = [ape for county in counties for ape in county["baseline_apes"]]
    candidate_apes = [ape for county in counties for ape in county["candidate_apes"]]
    if not baseline_apes or len(baseline_apes) != len(candidate_apes):
        raise GatewayVolumeEvaluationError("Pooled paired station exam is empty or unequal")

    road_classes = sorted(
        {
            road_class
            for county in counties
            for road_class in county["baseline_by_road_class"]
        }
        | {
            road_class
            for county in counties
            for road_class in county["candidate_by_road_class"]
        }
    )
    road_class_results: dict[str, Any] = {}
    road_class_pass = True
    for road_class in road_classes:
        baseline = [
            ape
            for county in counties
            for ape in county["baseline_by_road_class"].get(road_class, [])
        ]
        candidate = [
            ape
            for county in counties
            for ape in county["candidate_by_road_class"].get(road_class, [])
        ]
        if len(baseline) != len(candidate):
            raise GatewayVolumeEvaluationError(
                f"Road class {road_class} changed its paired station set"
            )
        result = {
            "comparisons": len(baseline),
            "baseline_median_ape": round(statistics.median(baseline), 6) if baseline else None,
            "candidate_median_ape": round(statistics.median(candidate), 6) if candidate else None,
            "worsening_percentage_points": (
                round(statistics.median(candidate) - statistics.median(baseline), 6)
                if baseline
                else None
            ),
            "threshold_applies": len(baseline)
            >= int(thresholds["minimum_road_class_comparisons"]),
        }
        result["passed"] = (
            not result["threshold_applies"]
            or result["worsening_percentage_points"]
            <= float(thresholds["maximum_road_class_worsening_percentage_points"])
        )
        road_class_pass = road_class_pass and result["passed"]
        road_class_results[road_class] = result

    improved_counties = sum(improvement > 0 for improvement in county_improvements)
    median_county_improvement = statistics.median(county_improvements)
    pooled_baseline = statistics.median(baseline_apes)
    pooled_candidate = statistics.median(candidate_apes)
    criteria = {
        "counties_improved": {
            "actual": improved_counties,
            "required": int(thresholds["counties_improved_minimum"]),
            "passed": improved_counties >= int(thresholds["counties_improved_minimum"]),
        },
        "median_county_improvement_percentage_points": {
            "actual": round(median_county_improvement, 6),
            "required": float(thresholds["median_county_improvement_percentage_points"]),
            "passed": median_county_improvement
            >= float(thresholds["median_county_improvement_percentage_points"]),
        },
        "pooled_station_median_ape": {
            "baseline": round(pooled_baseline, 6),
            "candidate": round(pooled_candidate, 6),
            "improvement_percentage_points": round(pooled_baseline - pooled_candidate, 6),
            "passed": pooled_candidate < pooled_baseline,
        },
        "road_classes": {
            "passed": road_class_pass,
            "maximum_worsening_percentage_points": float(
                thresholds["maximum_road_class_worsening_percentage_points"]
            ),
        },
    }
    return {
        "counties": [
            {
                "county_fips": county["county_fips"],
                "baseline_median_ape": county["baseline_median_ape"],
                "candidate_median_ape": county["candidate_median_ape"],
                "improvement_percentage_points": round(improvement, 6),
                "improved": improvement > 0,
                "matched_stations": len(county["baseline_apes"]),
            }
            for county, improvement in zip(counties, county_improvements)
        ],
        "criteria": criteria,
        "road_classes": road_class_results,
        "passed": all(
            (
                criteria["counties_improved"]["passed"],
                criteria["median_county_improvement_percentage_points"]["passed"],
                criteria["pooled_station_median_ape"]["passed"],
                criteria["road_classes"]["passed"],
            )
        ),
    }


def guards_pass(results_dir: Path) -> bool:
    guards = read_json(results_dir / "artifact_hashes.json")["guards"]
    convergence = guards.get("convergence") or {}
    provenance = guards.get("provenance") or {}
    return all(
        (
            guards.get("conservation") is True,
            guards.get("zone_resolution_unchanged") is True,
            guards.get("matched_station_set_unchanged") is True,
            bool(convergence) and all(row.get("converged") is True for row in convergence.values()),
            bool(provenance) and all(bool(row) for row in provenance.values()),
        )
    )


def joint_adoption_verdict(
    half: str, guards_green: bool, method_results: Mapping[str, Mapping[str, Any]]
) -> dict[str, bool]:
    both_methods = all(
        method in method_results and method_results[method].get("passed") is True
        for method in DEMAND_METHODS
    )
    return {
        "thresholds_passed_for_both_methods": guards_green and both_methods,
        "adoption_authorized": half == "holdout" and guards_green and both_methods,
    }


def evaluate_half(study_dir: Path, half: str, repo_root: Path = REPO_ROOT) -> dict[str, Any]:
    registry = read_json(study_dir / "registry.json")
    counties = registry["counties"][half]
    thresholds = registry["protocol"]["acceptance_thresholds"]
    by_method: dict[str, list[dict[str, Any]]] = {method: [] for method in DEMAND_METHODS}
    guards_green = True
    for county in counties:
        county_fips = county["county_fips"]
        results_dir = study_dir / "runs" / half / county_fips / "results"
        baseline = read_json(results_dir / "baseline_validation.json")["demand_methods"]
        candidate = read_json(results_dir / "candidate_validation.json")["demand_methods"]
        guards_green = guards_green and guards_pass(results_dir)
        for method in DEMAND_METHODS:
            baseline_record = baseline[method]
            candidate_record = candidate[method]
            baseline_rows = validation_rows(baseline_record, repo_root)
            candidate_rows = validation_rows(candidate_record, repo_root)
            if set(baseline_rows) != set(candidate_rows):
                raise GatewayVolumeEvaluationError(
                    f"{county_fips} {method} changed the matched-station exam"
                )
            baseline_classes: dict[str, list[float]] = {}
            candidate_classes: dict[str, list[float]] = {}
            for station_id in sorted(baseline_rows):
                baseline_row = baseline_rows[station_id]
                candidate_row = candidate_rows[station_id]
                baseline_class = baseline_row["model_link_type"] or "unknown"
                candidate_class = candidate_row["model_link_type"] or "unknown"
                if baseline_class != candidate_class:
                    raise GatewayVolumeEvaluationError(
                        f"{county_fips} {method} station {station_id} changed road class"
                    )
                baseline_classes.setdefault(baseline_class, []).append(numeric_ape(baseline_row))
                candidate_classes.setdefault(candidate_class, []).append(numeric_ape(candidate_row))
            by_method[method].append(
                {
                    "county_fips": county_fips,
                    "baseline_median_ape": baseline_record["summary"]["metrics"][
                        "median_absolute_percent_error"
                    ],
                    "candidate_median_ape": candidate_record["summary"]["metrics"][
                        "median_absolute_percent_error"
                    ],
                    "baseline_apes": [numeric_ape(baseline_rows[key]) for key in sorted(baseline_rows)],
                    "candidate_apes": [numeric_ape(candidate_rows[key]) for key in sorted(candidate_rows)],
                    "baseline_by_road_class": baseline_classes,
                    "candidate_by_road_class": candidate_classes,
                }
            )
    method_results = {
        method: paired_method_metrics(records, thresholds)
        for method, records in by_method.items()
    }
    verdict = joint_adoption_verdict(half, guards_green, method_results)
    return {
        "schema_version": "openplan.gateway-volume-study-evaluation.v1",
        "half": half,
        "county_count": len(counties),
        "methods_are_never_averaged": True,
        "guards_green": guards_green,
        "method_results": method_results,
        **verdict,
        "interpretation": (
            "Development is candidate-selection evidence only."
            if half == "development"
            else "Holdout is the one independent validation used for the adoption decision."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--half", choices=("development", "holdout"), required=True)
    parser.add_argument("--study-dir", default=str(DEFAULT_STUDY_DIR))
    parser.add_argument("--output")
    args = parser.parse_args()
    result = evaluate_half(Path(args.study_dir).resolve(), args.half)
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).resolve().write_text(text)
    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
