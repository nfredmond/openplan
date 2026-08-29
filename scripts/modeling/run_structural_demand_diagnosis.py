#!/usr/bin/env python3
"""Publish the v0.43 diagnosis without changing the frozen model runs."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "workers" / "aequilibrae_worker"
if str(WORKER) not in sys.path:
    sys.path.insert(0, str(WORKER))

import model_structural_input_audit as structural_audit
import model_validation_structural_diagnosis_v3 as diagnosis_v3


REGISTRY_SCHEMA = "openplan.development-structural-demand-study.v4"
RESULT_SCHEMA = "openplan.structural-demand-diagnosis-study-result.v1"
DEFAULT_REGISTRY = Path("scripts/modeling/development/california_structural_demand_study.v4.json")
DEFAULT_OUTPUT = Path("data/modeling/structural-demand-diagnosis-study-2026-08-28")


class StudyRefused(RuntimeError):
    """The diagnosis would cross a frozen evidence boundary."""


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def load(path: Path) -> dict[str, Any]:
    payload = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise StudyRefused(f"Required JSON is not an object: {path}")
    return value


def stored_path(record: Mapping[str, Any]) -> Path:
    return ROOT / str(record.get("stored_path") or record.get("path") or "")


def published_name(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def verify_record(record: Mapping[str, Any], label: str) -> Path:
    path = stored_path(record)
    if not path.is_file():
        raise StudyRefused(f"Frozen artifact is unavailable: {label}")
    stored = path.read_bytes()
    if record.get("stored_sha256") and hashlib.sha256(stored).hexdigest() != record["stored_sha256"]:
        raise StudyRefused(f"Frozen stored bytes changed: {label}")
    logical = gzip.decompress(stored) if path.suffix == ".gz" else stored
    if hashlib.sha256(logical).hexdigest() != record.get("sha256") or len(logical) != record.get("bytes"):
        raise StudyRefused(f"Frozen logical bytes changed: {label}")
    return path


def write_json(path: Path, value: Any, *, compress: bool = False) -> tuple[Path, str, int]:
    payload = canonical(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if compress:
        stored = path.with_suffix(path.suffix + ".gz")
        stored.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    else:
        stored = path
        stored.write_bytes(payload)
    return stored, hashlib.sha256(payload).hexdigest(), len(payload)


def verify_registry(path: Path) -> dict[str, Any]:
    registry = load(path)
    if registry.get("schema") != REGISTRY_SCHEMA:
        raise StudyRefused("Structural demand diagnosis requires the v4 registry")
    policy = registry.get("policy") or {}
    required_false = ("average_methods", "rank_methods", "select_candidate", "calibrate", "change_defaults", "define_acceptance_criteria", "open_holdout")
    if policy.get("freeze_all_audits_before_output") is not True or any(policy.get(key) is not False for key in required_false):
        raise StudyRefused("v4 registry weakens a diagnosis-only study boundary")
    if registry.get("methods") != list(diagnosis_v3.METHODS):
        raise StudyRefused("v4 registry changed or combined demand methods")
    verify_record(registry["predecessor"], "v3 predecessor registry")
    verify_record(registry["v041_study_result"], "v0.41 study result")
    geographies = registry.get("geographies") or []
    if not geographies:
        raise StudyRefused("v4 registry selected no development geographies")
    for geography in geographies:
        if geography.get("country") not in (registry.get("adapters") or {}):
            raise StudyRefused(f"Registry-selected geography is unsupported: {geography.get('geography_id')}")
        if set((geography.get("methods") or {})) != set(diagnosis_v3.METHODS):
            raise StudyRefused("Every registry geography needs separate exact method records")
        for method, method_record in geography["methods"].items():
            lodes = (method_record.get("source_vintages") or {}).get("lodes") or {}
            if lodes.get("status") == "not_recorded_in_frozen_package" and any(
                lodes.get(key) != "unknown"
                for key in ("vintage", "seed_coverage", "assumed_commute_share", "fallback_use")
            ):
                raise StudyRefused("Unregistered LODES facts cannot be invented")
            if (method_record.get("source_vintages") or {}).get("non_work_through_travel") != "unsupported":
                raise StudyRefused("Non-work through-travel evidence requires an exact registered source")
            for key, record in (method_record.get("artifacts") or {}).items():
                verify_record(record, f"{geography['geography_id']}/{method}/{key}")
            if method_record["artifacts"]["model_output"]["sha256"] != method_record["v041_bindings"]["model_output_sha256"]:
                raise StudyRefused("v4 output binding differs from immutable v0.41 custody")
    return registry


def require_all_audits_before_output(completed: int, expected: int) -> None:
    """The only transition from assignment-blind input work to output access."""
    if completed != expected:
        raise StudyRefused("Every registry method audit must complete before output access")


def run_study(
    registry_path: Path,
    output_root: Path,
    *,
    created_at: str,
    release_sha: str,
    app_version: str,
) -> dict[str, Any]:
    registry = verify_registry(registry_path)
    release = {"version": app_version, "sha": release_sha}
    registry_sha = structural_audit.sha256_file(registry_path)
    audit_records: dict[tuple[str, str], dict[str, Any]] = {}

    # Freeze every method audit before resolving or reading any model output.
    for geography in registry["geographies"]:
        geography_id = str(geography["geography_id"])
        public_geography = {key: geography[key] for key in ("geography_id", "name", "country", "subdivision", "county")}
        for method in diagnosis_v3.METHODS:
            method_record = geography["methods"][method]
            artifacts = method_record["artifacts"]
            audit = structural_audit.build_structural_input_audit(
                repo_root=ROOT,
                audit_id=f"v043:{geography_id}:{method}:input-audit-v1",
                geography=public_geography,
                method=method,
                registry_path=registry_path,
                predecessor_registry_path=stored_path(registry["predecessor"]),
                observation_package_path=stored_path(artifacts["observation_package_v2"]),
                match_audit_path=stored_path(artifacts["pre_volume_match_audit_v2"]),
                network_path=stored_path(artifacts["network"]),
                boundary_path=stored_path(artifacts["boundary"]),
                zone_attributes_path=stored_path(artifacts["zone_attributes"]),
                od_matrix_path=stored_path(artifacts["od_matrix"]),
                demand_layers_path=stored_path(artifacts["demand_layers"]),
                assignment_profile_path=stored_path(artifacts["assignment_profile"]),
                network_setup_summary_path=stored_path(artifacts["network_setup_summary"]),
                source_vintages=method_record["source_vintages"],
                person_to_vehicle_conversion=method_record["person_to_vehicle_conversion"],
                created_at=created_at,
                release=release,
            )
            logical = output_root / "results" / geography_id / method / "model-structural-input-audit-v1.json"
            stored, sha256, byte_count = write_json(logical, audit)
            audit_records[(geography_id, method)] = {"value": audit, "path": stored, "logical_path": logical, "sha256": sha256, "bytes": byte_count}

    require_all_audits_before_output(
        len(audit_records), len(registry["geographies"]) * len(diagnosis_v3.METHODS)
    )

    diagnoses: dict[tuple[str, str], dict[str, Any]] = {}
    county_results = []
    for geography in registry["geographies"]:
        geography_id = str(geography["geography_id"])
        methods = {}
        for method in diagnosis_v3.METHODS:
            method_record = geography["methods"][method]
            artifacts = method_record["artifacts"]
            audit_record = audit_records[(geography_id, method)]
            diagnosis = diagnosis_v3.build_structural_diagnosis(
                diagnosis_id=f"v043:{geography_id}:{method}:structural-diagnosis-v3",
                audit=audit_record["value"],
                observation_package_path=stored_path(artifacts["observation_package_v2"]),
                match_audit_path=stored_path(artifacts["pre_volume_match_audit_v2"]),
                v041_diagnosis_path=stored_path(artifacts["v041_diagnosis"]),
                model_output_path=stored_path(artifacts["model_output"]),
                expected_output_sha256=artifacts["model_output"]["sha256"],
                registry_sha256=registry_sha,
                audit_sha256=audit_record["sha256"],
                created_at=created_at,
                release=release,
            )
            logical = output_root / "results" / geography_id / method / "model-validation-structural-diagnosis-v3.json"
            stored, sha256, byte_count = write_json(logical, diagnosis, compress=True)
            record = {
                "geography_id": geography_id, "method": method,
                "input_audit_path": published_name(audit_record["logical_path"]),
                "input_audit_sha256": audit_record["sha256"], "input_audit_bytes": audit_record["bytes"],
                "diagnosis_path": published_name(logical),
                "diagnosis_stored_path": published_name(stored),
                "diagnosis_sha256": sha256, "diagnosis_bytes": byte_count,
                "record_coverage": diagnosis["record_coverage"],
                "scientific_outcome": "inconclusive",
            }
            diagnoses[(geography_id, method)] = {"value": diagnosis, "record": record}
            methods[method] = record
        comparison = diagnosis_v3.compare_methods(
            diagnoses[(geography_id, "aequilibrae")]["value"],
            diagnoses[(geography_id, "activitysim")]["value"],
        )
        comparison_path = output_root / "results" / geography_id / "method-comparison-v3.json"
        stored, comparison_sha, comparison_bytes = write_json(comparison_path, comparison, compress=True)
        county_results.append({
            "geography_id": geography_id, "name": geography["name"], "methods": methods,
            "method_comparison_path": published_name(comparison_path),
            "method_comparison_stored_path": published_name(stored),
            "method_comparison_sha256": comparison_sha, "method_comparison_bytes": comparison_bytes,
            "method_aggregation": "separate",
        })

    result = {
        "schema": RESULT_SCHEMA,
        "study_id": registry["study_id"],
        "created_at": created_at,
        "release": release,
        "v4_registry": {"path": str(registry_path.relative_to(ROOT)), "sha256": registry_sha},
        "v041_study_result": registry["v041_study_result"],
        "counties": county_results,
        "method_records": len(diagnoses),
        "method_aggregation": "separate",
        "scientific_outcome": "inconclusive",
        "model_accuracy_claim": "not made",
        "claims": {
            "california": "partial", "nationwide": "partial",
            "defaults_changed": False, "calibrated": False, "methods_ranked": False,
            "candidate_selected": False, "acceptance_criteria_defined": False,
            "acceptance_holdout_opened": False,
        },
    }
    write_json(output_root / "study-result.json", result)
    write_report(output_root / "study-report.md", result)
    return result


def write_report(path: Path, result: Mapping[str, Any]) -> None:
    lines = [
        "# Structural demand and loading diagnosis",
        "",
        f"Date: {str(result['created_at'])[:10]}",
        f"OpenPlan: `{result['release']['version']}`",
        f"Release SHA: `{result['release']['sha']}`",
        "",
        "## Result",
        "",
        "All fourteen development diagnoses are inconclusive. They size structural coverage and recorded limitations. They do not show improved accuracy, change a default, calibrate either method, rank methods, select a candidate, define acceptance criteria, or open a holdout.",
        "",
        "The frozen packages do not retain a LODES provenance manifest, so the LODES vintage, seed coverage, commute-share use, and fallback use remain unknown. LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. Non-work through travel remains unsupported. The recorded 0.35 through share is an assumption.",
        "",
        "## Separate method records",
        "",
        "| Geography | Method | Loaded | Unloaded | Unreachable | Excluded | Ambiguous | Unsupported | Missing output | Diagnosis SHA-256 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for county in result["counties"]:
        for method, record in county["methods"].items():
            coverage = record["record_coverage"]
            lines.append(
                f"| {county['geography_id']} | {method} | {coverage['loaded']} | {coverage['unloaded']} | "
                f"{coverage['unreachable']} | {coverage['excluded']} | {coverage['ambiguous']} | "
                f"{coverage['unsupported']} | {coverage['missing_output']} | `{record['diagnosis_sha256']}` |"
            )
    lines.extend([
        "", "## Evidence boundary", "",
        "Every method record binds the release, v4 registry, unchanged v0.41 custody, exact demand matrix, shared network and external layer, pre-output audit, model output, comparison basis, and predecessor diagnosis. AequilibraE and ActivitySim values, differences, and ratios remain separate.",
    ])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def verify_published(registry_path: Path, output_root: Path) -> dict[str, Any]:
    registry = verify_registry(registry_path)
    result = load(output_root / "study-result.json")
    if result.get("schema") != RESULT_SCHEMA or result.get("method_records") != len(registry["geographies"]) * 2:
        raise StudyRefused("Published study has the wrong record count or contract")
    if result.get("scientific_outcome") != "inconclusive" or result.get("method_aggregation") != "separate":
        raise StudyRefused("Published study changed its scientific boundary")
    for county in result["counties"]:
        for method in diagnosis_v3.METHODS:
            record = county["methods"][method]
            audit_path = ROOT / record["input_audit_path"]
            if structural_audit.sha256_file(audit_path) != record["input_audit_sha256"]:
                raise StudyRefused("Published input-audit bytes changed")
            diagnosis_path = ROOT / record["diagnosis_stored_path"]
            logical = gzip.decompress(diagnosis_path.read_bytes())
            if hashlib.sha256(logical).hexdigest() != record["diagnosis_sha256"]:
                raise StudyRefused("Published diagnosis bytes changed")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--created-at", default="2026-08-28T20:00:00Z")
    parser.add_argument("--release-sha")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    registry_path = (ROOT / args.registry).resolve()
    output_root = (ROOT / args.output_root).resolve()
    try:
        if args.verify_only:
            result = verify_published(registry_path, output_root)
        else:
            release_sha = args.release_sha or subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, text=True, capture_output=True).stdout.strip()
            app_version = str(load(ROOT / "openplan" / "package.json")["version"])
            result = run_study(registry_path, output_root, created_at=args.created_at, release_sha=release_sha, app_version=app_version)
    except (StudyRefused, structural_audit.StructuralAuditRefused, diagnosis_v3.StructuralDiagnosisRefused, OSError, ValueError) as exc:
        print(f"structural demand diagnosis refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"schema": result["schema"], "method_records": result["method_records"], "scientific_outcome": result["scientific_outcome"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
