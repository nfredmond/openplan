#!/usr/bin/env python3
"""Build and assess the v0.41 seven-county comparable observation instrument."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
WORKER_DIR = ROOT / "workers" / "aequilibrae_worker"
for directory in (SCRIPT_DIR, WORKER_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import model_validation_core_v5 as rules
import us_observed_traffic_adapter_v2 as adapter
import validation_instrument_v2 as instrument


STUDY_RESULT_SCHEMA = "openplan.comparable-observation-study-result.v1"
DIAGNOSIS_SCHEMA = "openplan.model-validation-structural-diagnosis.v2"
METHODS = ("aequilibrae", "activitysim")
OLD_ROOT = Path("data/modeling/development-validation-study-2026-08-28")
DEFAULT_OUTPUT = Path("data/modeling/comparable-observation-study-2026-08-28")


class StudyRefused(RuntimeError):
    """The study cannot continue without weakening frozen custody."""


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise StudyRefused(f"Required JSON is not an object: {path}")
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rules.canonical_json(value))


def verify_protocol(registry_path: Path, registry: Mapping[str, Any]) -> None:
    if registry.get("schema") != "openplan.development-validation-instrument-study.v3":
        raise StudyRefused("v0.41 requires the v3 seven-county registry")
    frozen = registry.get("frozen_protocol") or {}
    for field in ("v2_registry", "nationwide_preregistration", "frozen_v1_matcher"):
        path = ROOT / str(frozen.get(field) or "")
        if not path.is_file() or instrument.sha256_file(path) != frozen.get(f"{field}_sha256"):
            raise StudyRefused(f"Frozen predecessor changed: {field}")
    if frozen.get("matcher_version") != instrument.MATCHER_VERSION:
        raise StudyRefused("Registry matcher version differs from the shared matcher")
    if frozen.get("validation_rules_version") != rules.VALIDATION_RULES_VERSION:
        raise StudyRefused("Registry rules version differs from the shared evaluator")
    if instrument.sha256_file(registry_path) == frozen.get("v2_registry_sha256"):
        raise StudyRefused("v3 registry cannot replace the frozen v2 registry")


def old_instrument(geography_id: str) -> Path:
    return ROOT / OLD_ROOT / "instruments" / geography_id


def source_artifacts(old_package: Mapping[str, Any], source_ids: list[str]) -> list[dict[str, Any]]:
    records = []
    for attempt in old_package.get("source_attempts") or []:
        if attempt.get("source_id") in source_ids:
            records.extend(dict(item) for item in attempt.get("artifacts") or [])
    return records


def build_packages(registry_path: Path, registry: Mapping[str, Any], output_root: Path, created_at: str, release: Mapping[str, Any]) -> list[dict[str, Any]]:
    adapter_record = instrument.registry_adapter_for_geography(registry, registry["counties"][0])
    if adapter_record["status"] != "supported":
        raise StudyRefused("The registry does not support the selected study jurisdiction")
    source_ids = list(adapter_record["source_ids"])
    shared = ROOT / OLD_ROOT / "shared-sources" / "tmas-2024"
    tmas_manifest = load(shared / "source-manifest.json")
    tmas_downloaded_at = str(tmas_manifest["archives"][0]["downloaded_at"])
    tmas = adapter.build_tmas_series(
        shared / "2024_station_data.zip",
        sorted(shared.glob("*_2024_ccs_data.zip")),
        downloaded_at=tmas_downloaded_at,
        state_codes={"06"},
        county_codes={str(row["county"]) for row in registry["counties"]},
    )
    tmas_by_county: dict[str, list[dict[str, Any]]] = {}
    for item in tmas:
        tmas_by_county.setdefault(str(item["geography"]["county"]), []).append(item)
    ready = []
    for geography in registry["counties"]:
        if instrument.registry_adapter_for_geography(registry, geography) != adapter_record:
            raise StudyRefused("Every study geography must select the same explicit registry adapter and sources")
        geography_id = str(geography["geography_id"])
        old_dir = old_instrument(geography_id)
        old_package_path = old_dir / "observation-package.json"
        old_package = load(old_package_path)
        hpms_path = old_dir / "sources" / "us-fhwa-hpms-2024" / "002-data.response"
        hpms = adapter.build_hpms_series(
            hpms_path,
            source_url="https://datahub.transportation.gov/Roadways-and-Bridges/Highway-Performance-Monitoring-System-HPMS-Nationa/42um-tgh5",
            downloaded_at=str(next(
                item["attempted_at"] for item in old_package["source_attempts"]
                if item.get("source_id") == "us-fhwa-hpms-2024"
            )),
        )
        observations = sorted(
            [*tmas_by_county.get(str(geography["county"]), []), *hpms],
            key=lambda item: str(item["observation_id"]),
        )
        attempts = []
        for source_id in source_ids:
            prior = next((item for item in old_package.get("source_attempts") or [] if item.get("source_id") == source_id), None)
            if prior is None:
                attempts.append({"source_id": source_id, "status": "source_unavailable", "artifacts": [], "reason": "No frozen source attempt exists."})
            else:
                dataset_id = "fhwa:tmas:continuous-volume:2024" if source_id == "us-fhwa-tmas-2024" else "42um-tgh5"
                attempts.append({
                    **prior,
                    "record_count": sum(1 for item in observations if item["source"].get("dataset_id") == dataset_id),
                    "reason": "Exact predecessor source bytes re-normalized through the registered US v2 adapter.",
                })
        destination = output_root / "instruments" / geography_id
        package_path = destination / "observation-package-v2.json"
        network_path = old_dir / "network" / "project_database.sqlite"
        audit_path = destination / "pre-volume-match-audit-v2.json"
        merged_geography = {**geography, "source_ids": source_ids}
        package = instrument.build_observation_package(
            package_path,
            study_id=str(registry["study_id"]),
            geography={key: geography[key] for key in ("geography_id", "name", "country", "subdivision", "county")},
            registry_artifact=instrument.artifact_record(registry_path, relative_to=ROOT),
            source_attempts=attempts,
            observations=observations,
            created_at=created_at,
        )
        package["release"] = dict(release)
        package_path.write_bytes(instrument.canonical_json_bytes(package))
        instrument.validate_observation_package(package_path)
        audit = instrument.build_pre_volume_match_audit(
            network_path, package_path, registry_path, audit_path,
            geography_entry=merged_geography, created_at=created_at,
        )
        audit["release"] = dict(release)
        audit_path.write_bytes(instrument.canonical_json_bytes(audit))
        instrument.validate_match_audit(audit_path, network_path, package_path, registry_path)
        ready.append({
            "geography_id": geography_id,
            "network_path": network_path,
            "package_path": package_path,
            "audit_path": audit_path,
            "source_artifacts": source_artifacts(old_package, source_ids),
        })
    return ready


def freeze_all_inputs(registry_path: Path, registry: Mapping[str, Any], rows: list[dict[str, Any]], output_root: Path, created_at: str, release: Mapping[str, Any]) -> None:
    for row in rows:
        geography_id = row["geography_id"]
        for method in METHODS:
            profile = ROOT / OLD_ROOT / "results" / geography_id / method / "assignment-profile.json"
            bundle = instrument.build_input_bundle(
                study_id=str(registry["study_id"]), geography_id=geography_id,
                registry_path=registry_path, network_path=row["network_path"],
                observation_package_path=row["package_path"], match_audit_path=row["audit_path"],
                assignment_profile_path=profile, source_artifacts=row["source_artifacts"], created_at=created_at,
                relative_to=ROOT,
            )
            bundle["release"] = dict(release)
            path = output_root / "results" / geography_id / method / "validation-input-bundle-v2.json"
            write_json(path, bundle)
            row[f"{method}_bundle"] = path
    expected = len(registry["counties"]) * len(METHODS)
    bundles = [row[f"{method}_bundle"] for row in rows for method in METHODS]
    if len(bundles) != expected or not all(load(path).get("model_output_bytes_read") is False for path in bundles):
        raise StudyRefused("Every geography and method must freeze readiness before output bytes open")


def read_volumes(path: Path) -> dict[str, float]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        field = next((name for name in ("PCE_tot", "demand_tot", "volume", "loaded_volume") if name in fields), None)
        if field is None or "link_id" not in fields:
            raise StudyRefused(f"Unreadable model output contract: {path}")
        return {str(row["link_id"]): float(row[field]) for row in reader}


def build_basis(
    geography_id: str, method: str, observations: list[dict[str, Any]], audit: Mapping[str, Any], created_at: str,
    release: Mapping[str, Any],
) -> tuple[dict[str, Any], Path]:
    run = ROOT / OLD_ROOT / "runs" / f"v039-development-{geography_id}-{method}"
    output = run / "run_output" / "link_volumes.csv"
    summary_path = run / "run_summary.json"
    conservation_path = run / "conservation.json"
    profile_path = ROOT / OLD_ROOT / "results" / geography_id / method / "assignment-profile.json"
    conservation = load(conservation_path)
    profile = load(profile_path)
    if conservation.get("assignment", {}).get("period_factor") != 0.10:
        raise StudyRefused("Exact conservation record does not prove the frozen 0.10 factor")
    if profile.get("class_pce") != 1:
        raise StudyRefused("Exact assignment profile does not prove class_pce = 1")
    matches = {item["observation_id"]: item for item in audit["matches"]}
    facts = {}
    for item in observations:
        match = matches[item["observation_id"]]
        modeled_direction = {
            "one_direction": "one_direction",
            "paired_carriageways": "combined_directions",
            "one_bidirectional_link": "both_directions",
        }.get(match.get("direction_aggregation"), "unknown")
        facts[item["observation_id"]] = {
            "day_basis": "synthetic_expanded_daily_traffic",
            "observed_direction_basis": item["direction_lane_carriageway"]["basis"],
            "modeled_direction_basis": modeled_direction,
            "modeled_vehicle_unit": "vehicles",
            "synthetic_expanded_daily_traffic": True,
        }
    basis = {
        "schema": rules.COMPARISON_BASIS_SCHEMA,
        "basis_id": f"v041:{geography_id}:{method}:basis-v2",
        "model_run_id": f"v039-development-{geography_id}-{method}",
        "method": method,
        "model_output_artifact": {"path": str(output.relative_to(ROOT)), "sha256": instrument.sha256_file(output), "bytes": output.stat().st_size},
        "model_base_year": "unknown",
        "modeled_quantity": {"name": "synthetic_expanded_daily_traffic", "not_aadt": True, "expansion_chain": {"representative_assignment_period": "peak_hour", "peak_hour_factor": 0.10, "daily_expansion_factor": 10.0, "run_summary_sha256": instrument.sha256_file(summary_path), "conservation_sha256": instrument.sha256_file(conservation_path)}},
        "assignment_period": {"name": "representative_peak_hour", "factor_of_synthetic_day": 0.10},
        "vehicle_basis": {"unit": "vehicles", "vehicle_pce_equivalence": {"class_pce": 1, "assignment_profile_sha256": instrument.sha256_file(profile_path)}},
        "observation_facts": facts,
        "assignment_settings": {"profile": profile, "sha256": instrument.sha256_file(profile_path)},
        "coefficient_package": {"status": "bound_in_run_summary", "run_summary_sha256": instrument.sha256_file(summary_path)},
        "network_state_hashes": {"network": audit["network_sha256"]},
        "acceptance_rule": "unknown",
        "frozen_at": created_at,
        "release": dict(release),
    }
    rules.validate_basis(basis)
    return basis, output


def diagnose(geography_id: str, method: str, assessment: Mapping[str, Any], bindings: Mapping[str, Any], created_at: str, release: Mapping[str, Any]) -> dict[str, Any]:
    coverage = dict(assessment["coverage"])
    return {
        "schema": DIAGNOSIS_SCHEMA,
        "diagnosis_id": f"v041:{geography_id}:{method}:structural-diagnosis-v2",
        "created_at": created_at,
        "geography_id": geography_id,
        "method": method,
        "coverage": coverage,
        "instrument_change": "repaired observation identity and full-geometry matching coverage; not improved model accuracy",
        "modeled_quantity": "synthetic expanded daily traffic; not AADT",
        "scientific_outcome": assessment["scientific_outcome"],
        "bindings": dict(bindings),
        "release": dict(release),
    }


def assess_all(registry: Mapping[str, Any], rows: list[dict[str, Any]], output_root: Path, created_at: str, release: Mapping[str, Any]) -> list[dict[str, Any]]:
    diagnoses = []
    for row in rows:
        package = load(row["package_path"])
        audit = load(row["audit_path"])
        assessments = []
        for method in METHODS:
            basis, output_path = build_basis(row["geography_id"], method, package["observations"], audit, created_at, release)
            result_dir = output_root / "results" / row["geography_id"] / method
            basis_path = result_dir / "comparison-basis-v2.json"
            write_json(basis_path, basis)
            volumes = read_volumes(output_path)
            assessment = rules.assess_validation(
                package["observations"], audit, basis, volumes,
                assessment_id=f"v041:{row['geography_id']}:{method}:assessment-v2",
                input_bundle_sha256=instrument.sha256_file(row[f"{method}_bundle"]),
                match_audit_sha256=instrument.sha256_file(row["audit_path"]), created_at=created_at,
            )
            assessment["release"] = dict(release)
            assessment_path = result_dir / "assessment-v2.json"
            write_json(assessment_path, assessment)
            bindings = {
                "registry_sha256": instrument.sha256_file(ROOT / "scripts/modeling/development/california_validation_instrument_study.v3.json"),
                "network_sha256": audit["network_sha256"],
                "observation_package_sha256": instrument.sha256_file(row["package_path"]),
                "matcher_sha256": audit["matcher"]["sha256"],
                "match_audit_sha256": instrument.sha256_file(row["audit_path"]),
                "input_bundle_sha256": instrument.sha256_file(row[f"{method}_bundle"]),
                "model_output_sha256": instrument.sha256_file(output_path),
                "comparison_basis_sha256": instrument.sha256_file(basis_path),
                "assessment_sha256": instrument.sha256_file(assessment_path),
            }
            diagnosis = diagnose(row["geography_id"], method, assessment, bindings, created_at, release)
            diagnosis_path = result_dir / "structural-diagnosis-v2.json"
            write_json(diagnosis_path, diagnosis)
            diagnoses.append({**diagnosis, "path": str(diagnosis_path.relative_to(ROOT)), "sha256": instrument.sha256_file(diagnosis_path)})
            assessments.append(assessment)
        comparison = rules.compare_methods(assessments)
        write_json(output_root / "results" / row["geography_id"] / "method-comparison-v2.json", comparison)
    return diagnoses


def write_study_result(registry_path: Path, output_root: Path, diagnoses: list[dict[str, Any]], created_at: str, release: Mapping[str, Any]) -> None:
    result = {
        "schema": STUDY_RESULT_SCHEMA,
        "study_id": "california-seven-county-comparable-observation-instrument-v3",
        "created_at": created_at,
        "release": dict(release),
        "registry": instrument.artifact_record(registry_path, relative_to=ROOT),
        "diagnoses": diagnoses,
        "diagnosis_count": len(diagnoses),
        "scientific_outcome": "inconclusive",
        "model_accuracy_claim": "not made",
        "boundaries": ["no calibration", "no candidate selection", "no acceptance threshold", "no holdout opened", "California and nationwide capability remain partial"],
    }
    write_json(output_root / "study-result.json", result)
    report = "\n".join([
        "# v0.41 comparable observation instrument",
        "",
        f"Generated: {created_at}",
        "",
        "The repaired instrument produced fourteen separate structural diagnoses: seven geographies by two unchanged methods.",
        "It improves observation identity and full-geometry match coverage. It does not demonstrate improved model accuracy.",
        "The modeled quantity is synthetic expanded daily traffic, not AADT. With no frozen use-specific acceptance rule, every assessment is inconclusive.",
        "AequilibraE and ActivitySim values, differences, and ratios remain separate. No method average is published.",
        "",
    ])
    (output_root / "study-report.md").write_text(report)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default="scripts/modeling/development/california_validation_instrument_study.v3.json")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--created-at", default="2026-08-28T12:00:00Z")
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--app-version", default="0.41.0")
    args = parser.parse_args()
    registry_path = ROOT / args.registry
    output_root = ROOT / args.output_root
    registry = load(registry_path)
    if len(args.release_sha) != 40 or any(char not in "0123456789abcdef" for char in args.release_sha):
        raise StudyRefused("--release-sha must be one exact Git commit SHA")
    release = {"version": args.app_version, "sha": args.release_sha}
    verify_protocol(registry_path, registry)
    rows = build_packages(registry_path, registry, output_root, args.created_at, release)
    freeze_all_inputs(registry_path, registry, rows, output_root, args.created_at, release)
    diagnoses = assess_all(registry, rows, output_root, args.created_at, release)
    if len(diagnoses) != 14:
        raise StudyRefused("The study must publish fourteen separate diagnosis records")
    write_study_result(registry_path, output_root, diagnoses, args.created_at, release)
    print(f"wrote {len(diagnoses)} diagnoses to {output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
