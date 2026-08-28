#!/usr/bin/env python3
"""Run the structural diagnosis against the immutable v0.39 study."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import model_validation_structural_diagnosis as diagnosis
import run_development_validation_study as source_study
import validation_instrument as instrument


REGISTRY_SCHEMA = "openplan.model-validation-structural-diagnosis-study.v1"
RESULT_SCHEMA = "openplan.model-validation-structural-diagnosis-study-result.v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose the frozen v0.39 validation study.")
    parser.add_argument(
        "--registry",
        default="scripts/modeling/development/california_validation_structural_diagnosis.v1.json",
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--output-root",
        default="data/modeling/model-validation-structural-diagnosis-2026-08-28",
    )
    parser.add_argument("--created-at")
    parser.add_argument("--verify-only", action="store_true")
    return parser.parse_args()


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise diagnosis.DiagnosisRefused(f"Required JSON is unreadable: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise diagnosis.DiagnosisRefused(f"Required JSON is not an object: {path}")
    return value


def _resolve(repo_root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else repo_root / path


def _verified_artifact(repo_root: Path, record: Mapping[str, Any], label: str) -> Path:
    path = _resolve(repo_root, str(record.get("path") or ""))
    if not path.is_file() or instrument.sha256_file(path) != record.get("sha256"):
        raise diagnosis.DiagnosisRefused(f"Frozen source artifact changed: {label}")
    return path


def verify_source_registry(repo_root: Path, registry_path: Path) -> dict[str, Any]:
    registry = _load(registry_path)
    if registry.get("schema") != REGISTRY_SCHEMA:
        raise diagnosis.DiagnosisRefused("Structural diagnosis requires its v1 registry")
    source = registry.get("source_study")
    if not isinstance(source, Mapping):
        raise diagnosis.DiagnosisRefused("Diagnosis registry has no frozen source study")
    source_registry_path = _verified_artifact(repo_root, source["preregistration"], "preregistration")
    source_result_path = _verified_artifact(repo_root, source["study_result"], "study result")
    readiness_path = _verified_artifact(repo_root, source["instrument_readiness"], "instrument readiness")
    source_registry = _load(source_registry_path)
    source_result = _load(source_result_path)
    readiness = _load(readiness_path)
    expected_geographies = [str(item["geography_id"]) for item in source_registry.get("counties", [])]
    if expected_geographies != [str(item.get("geography_id")) for item in source_result.get("counties", [])]:
        raise diagnosis.DiagnosisRefused("Source study result does not cover registry geographies in order")
    if expected_geographies != [str(item.get("geography_id")) for item in readiness.get("counties", [])]:
        raise diagnosis.DiagnosisRefused("Source readiness does not cover registry geographies in order")
    if readiness.get("readiness") != "ready" or readiness.get("model_output_bytes_read") is not False:
        raise diagnosis.DiagnosisRefused("All source readiness gates must pass before diagnosis opens output")
    return {
        "registry": registry,
        "source_registry_path": source_registry_path,
        "source_registry": source_registry,
        "source_result_path": source_result_path,
        "source_result": source_result,
        "readiness_path": readiness_path,
        "readiness": readiness,
        "geographies": expected_geographies,
    }


def _source_county(source: Mapping[str, Any], geography_id: str) -> Mapping[str, Any]:
    for county in source["source_result"]["counties"]:
        if str(county.get("geography_id")) == geography_id:
            return county
    raise diagnosis.DiagnosisRefused(f"Source result omitted geography {geography_id}")


def _readiness_county(source: Mapping[str, Any], geography_id: str) -> Mapping[str, Any]:
    for county in source["readiness"]["counties"]:
        if str(county.get("geography_id")) == geography_id:
            return county
    raise diagnosis.DiagnosisRefused(f"Readiness omitted geography {geography_id}")


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(instrument.canonical_json_bytes(value))


def run_diagnosis(
    repo_root: Path,
    registry_path: Path,
    output_root: Path,
    *,
    created_at: str | None = None,
) -> dict[str, Any]:
    timestamp = created_at or datetime.now(timezone.utc).isoformat()
    source = verify_source_registry(repo_root, registry_path)
    source_study.preflight_readiness(
        repo_root,
        source["source_registry_path"],
        source["readiness_path"].parent,
    )
    assignment_paths: dict[str, Path] = {}

    # Complete every assignment-blind county stage before any output file is
    # resolved or opened. This ordering is part of the scientific boundary.
    for geography_id in source["geographies"]:
        custody = _readiness_county(source, geography_id)
        assignment = diagnosis.build_assignment_blind_diagnosis(
            repo_root=repo_root,
            geography_id=geography_id,
            network_path=_resolve(repo_root, str(custody["network_path"])),
            observation_package_path=_resolve(repo_root, str(custody["observation_package_path"])),
            match_audit_path=_resolve(repo_root, str(custody["match_audit_path"])),
            preregistration_path=source["source_registry_path"],
            created_at=timestamp,
        )
        assignment_path = output_root / "assignment-blind" / geography_id / "diagnosis.json"
        _write_json(assignment_path, assignment)
        assignment_paths[geography_id] = assignment_path

    git_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    app_version = str(_load(repo_root / "openplan" / "package.json")["version"])
    result_counties = []
    for geography_id in source["geographies"]:
        custody = _readiness_county(source, geography_id)
        source_county = _source_county(source, geography_id)
        output_paths: dict[str, Path] = {}
        loadings: dict[str, Mapping[str, Any]] = {}
        for method in diagnosis.METHODS:
            method_source = source_county["methods"][method]
            run_dir = source["readiness_path"].parent / "runs" / str(method_source["run_id"])
            output_path = run_dir / "run_output" / "link_volumes.csv"
            if not output_path.is_file() or instrument.sha256_file(output_path) != method_source["model_output_sha256"]:
                raise diagnosis.DiagnosisRefused(f"Frozen model output changed: {geography_id}/{method}")
            output_paths[method] = output_path
            volumes = diagnosis.read_link_volumes(output_path)
            audit = _load(_resolve(repo_root, str(custody["match_audit_path"])))
            loadings[method] = diagnosis.build_network_loading_records(audit, volumes, method)
        comparison = diagnosis.compare_methods(loadings["aequilibrae"], loadings["activitysim"])
        method_results = {}
        for method in diagnosis.METHODS:
            method_dir = source["readiness_path"].parent / "results" / geography_id / method
            method_source = source_county["methods"][method]
            basis_path = method_dir / "comparison-basis.json"
            assessment_path = method_dir / "assessment.json"
            if instrument.sha256_file(basis_path) != method_source["comparison_basis_sha256"]:
                raise diagnosis.DiagnosisRefused(f"Frozen comparison basis changed: {geography_id}/{method}")
            if instrument.sha256_file(assessment_path) != method_source["assessment_sha256"]:
                raise diagnosis.DiagnosisRefused(f"Frozen assessment changed: {geography_id}/{method}")
            artifact = diagnosis.build_method_diagnosis(
                repo_root=repo_root,
                study_id=str(source["registry"]["study_id"]),
                geography_id=geography_id,
                method=method,
                created_at=timestamp,
                app_version=app_version,
                git_sha=git_sha,
                source_release={
                    "app_version": source["source_result"]["app_version"],
                    "git_sha": source["source_result"]["git_sha"],
                    "study_result_sha256": instrument.sha256_file(source["source_result_path"]),
                },
                assignment_blind_path=assignment_paths[geography_id],
                loading=loadings[method],
                method_comparison=comparison,
                preregistration_path=source["source_registry_path"],
                network_path=_resolve(repo_root, str(custody["network_path"])),
                observation_package_path=_resolve(repo_root, str(custody["observation_package_path"])),
                match_audit_path=_resolve(repo_root, str(custody["match_audit_path"])),
                model_output_path=output_paths[method],
                comparison_basis_path=basis_path,
                assessment_path=assessment_path,
                assignment_profile_path=method_dir / "assignment-profile.json",
            )
            artifact_path = output_root / "results" / geography_id / method / "structural-diagnosis.json"
            _write_json(artifact_path, artifact)
            method_results[method] = {
                "diagnosis_path": str(artifact_path.relative_to(repo_root)),
                "diagnosis_sha256": instrument.sha256_file(artifact_path),
                "assignment_blind_sha256": instrument.sha256_file(assignment_paths[geography_id]),
                "assessment_sha256": method_source["assessment_sha256"],
                "model_output_sha256": method_source["model_output_sha256"],
                "scientific_outcome": "inconclusive",
                "finding_counts": {
                    item["code"]: item["count"] for item in artifact["findings"]
                },
            }
        result_counties.append({"geography_id": geography_id, "methods": method_results})

    result = {
        "schema": RESULT_SCHEMA,
        "study_id": source["registry"]["study_id"],
        "created_at": timestamp,
        "git_sha": git_sha,
        "app_version": app_version,
        "diagnosis_registry_sha256": instrument.sha256_file(registry_path),
        "source_study_result_sha256": instrument.sha256_file(source["source_result_path"]),
        "counties": result_counties,
        "method_aggregation": "separate",
        "scientific_outcome": "inconclusive",
        "claims": {
            "california": "partial",
            "nationwide": "partial",
            "defaults_changed": False,
            "calibrated": False,
            "candidate_selected": False,
            "acceptance_rule_created": False,
            "acceptance_holdout_opened": False,
        },
    }
    _write_json(output_root / "study-result.json", result)
    write_report(output_root / "study-report.md", result, output_root)
    return result


def write_report(path: Path, result: Mapping[str, Any], output_root: Path) -> None:
    lines = [
        "# Frozen structural diagnosis result",
        "",
        f"Date: {str(result['created_at'])[:10]}",
        f"Git SHA: `{result['git_sha']}`",
        f"OpenPlan: `{result['app_version']}`",
        "",
        "## Decision",
        "",
        "The fourteen frozen v0.39 assessments remain inconclusive. This study explains structural limits without changing matches, calibrating either method, selecting a candidate, creating an acceptance rule, or opening a holdout.",
        "",
        "AequilibraE and ActivitySim remain separate. Raw differences and ratios use identical frozen links; no values are averaged and no method wins.",
        "",
        "## County and method findings",
        "",
        "| Geography | Method | Missing usable coordinates | Centroid-only exclusions | Nearby network without match evidence | Genuine network absence | Zero-volume unloaded matches | Missing output rows | Unknown basis facts | Diagnosis SHA-256 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for county in result["counties"]:
        for method, item in county["methods"].items():
            counts = item["finding_counts"]
            lines.append(
                f"| {county['geography_id']} | {method} | "
                f"{counts.get('missing_usable_point_coordinates', 0)} | "
                f"{counts.get('centroid_geometry_excludes_full_link', 0)} | "
                f"{counts.get('nearby_network_without_name_or_facility_evidence', 0)} | "
                f"{counts.get('genuine_network_absence_within_search_distance', 0)} | "
                f"{counts.get('frozen_matched_links_with_zero_assigned_volume', 0)} | "
                f"{counts.get('frozen_matched_links_missing_from_output', 0)} | "
                f"{counts.get('comparison_basis_facts_unknown', 0)} | "
                f"`{item['diagnosis_sha256']}` |"
            )
    lines.extend([
        "",
        "## Exact artifacts",
        "",
        "`study-result.json` binds every diagnosis to the v0.39 preregistration, readiness gate, network, observation package, pre-volume audit, model output, comparison basis, existing assessment, diagnosis registry, source study result, release version, and source Git SHA.",
    ])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def verify_published(repo_root: Path, registry_path: Path, output_root: Path) -> dict[str, Any]:
    source = verify_source_registry(repo_root, registry_path)
    result = _load(output_root / "study-result.json")
    if result.get("schema") != RESULT_SCHEMA or result.get("method_aggregation") != "separate":
        raise diagnosis.DiagnosisRefused("Published diagnosis result has the wrong contract")
    for county in result.get("counties", []):
        geography_id = str(county["geography_id"])
        if geography_id not in source["geographies"]:
            raise diagnosis.DiagnosisRefused("Published diagnosis added an unregistered geography")
        for method in diagnosis.METHODS:
            record = county["methods"][method]
            path = _resolve(repo_root, str(record["diagnosis_path"]))
            if instrument.sha256_file(path) != record["diagnosis_sha256"]:
                raise diagnosis.DiagnosisRefused(f"Published diagnosis bytes changed: {geography_id}/{method}")
            artifact = _load(path)
            if artifact.get("method") != method or artifact.get("scientific_outcome") != "inconclusive":
                raise diagnosis.DiagnosisRefused("Published diagnosis changed its method or outcome")
    return result


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    registry_path = _resolve(repo_root, args.registry).resolve()
    output_root = _resolve(repo_root, args.output_root).resolve()
    try:
        result = (
            verify_published(repo_root, registry_path, output_root)
            if args.verify_only
            else run_diagnosis(
                repo_root,
                registry_path,
                output_root,
                created_at=args.created_at,
            )
        )
    except (diagnosis.DiagnosisRefused, instrument.InstrumentError, subprocess.CalledProcessError) as exc:
        print(f"structural diagnosis refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
