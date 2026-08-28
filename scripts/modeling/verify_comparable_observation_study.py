#!/usr/bin/env python3
"""Verify every v0.41 file and hash binding without regenerating the study."""
from __future__ import annotations

import hashlib
import gzip
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "data/modeling/comparable-observation-study-2026-08-28"
REGISTRY = ROOT / "scripts/modeling/development/california_validation_instrument_study.v3.json"
MATCHER = ROOT / "scripts/modeling/validation_instrument_v2.py"
METHODS = ("aequilibrae", "activitysim")


class VerificationError(RuntimeError):
    pass


def load(path: Path) -> dict[str, Any]:
    value = json.loads(artifact_bytes(path))
    if not isinstance(value, dict):
        raise VerificationError(f"not an object: {path}")
    return value


def digest(path: Path) -> str:
    return hashlib.sha256(artifact_bytes(path)).hexdigest()


def artifact_bytes(path: Path) -> bytes:
    """Read logical release bytes from plain or deterministic gzip storage."""
    if path.is_file():
        return path.read_bytes()
    compressed = path.with_suffix(f"{path.suffix}.gz")
    if compressed.is_file():
        return gzip.decompress(compressed.read_bytes())
    raise VerificationError(f"artifact is missing: {path}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def release(value: dict[str, Any], expected_sha: str, label: str) -> None:
    require(value.get("release") == {"version": "0.41.0", "sha": expected_sha}, f"{label} release binding changed")


def main() -> int:
    expected_sha = sys.argv[1] if len(sys.argv) > 1 else ""
    require(len(expected_sha) == 40, "pass the exact release-source Git SHA")
    registry = load(REGISTRY)
    matcher_sha = digest(MATCHER)
    result = load(STUDY / "study-result.json")
    release(result, expected_sha, "study result")
    require(result.get("diagnosis_count") == 14 and len(result.get("diagnoses") or []) == 14, "study does not contain fourteen diagnoses")
    require(result.get("scientific_outcome") == "inconclusive", "study outcome changed")
    require(result.get("model_accuracy_claim") == "not made", "study made a model-accuracy claim")
    require((result.get("registry") or {}).get("sha256") == digest(REGISTRY), "study registry hash changed")

    diagnoses = {(item["geography_id"], item["method"]): item for item in result["diagnoses"]}
    geography_ids = [str(item["geography_id"]) for item in registry["counties"]]
    require(set(diagnoses) == {(geography, method) for geography in geography_ids for method in METHODS}, "county/method diagnosis matrix changed")
    for geography in geography_ids:
        package_path = STUDY / "instruments" / geography / "observation-package-v2.json"
        audit_path = STUDY / "instruments" / geography / "pre-volume-match-audit-v2.json"
        package, audit = load(package_path), load(audit_path)
        release(package, expected_sha, f"{geography} package")
        release(audit, expected_sha, f"{geography} audit")
        require(audit.get("model_output_bytes_read") is False and audit.get("frozen_before_model_volume") is True, f"{geography} audit timing changed")
        require((audit.get("matcher") or {}).get("sha256") == matcher_sha, f"{geography} matcher hash changed")
        require(audit.get("observation_package_sha256") == digest(package_path), f"{geography} package/audit binding changed")
        require([item["observation_id"] for item in package["observations"]] == [item["observation_id"] for item in audit["matches"]], f"{geography} retained ids changed")
        for method in METHODS:
            directory = STUDY / "results" / geography / method
            bundle_path = directory / "validation-input-bundle-v2.json"
            basis_path = directory / "comparison-basis-v2.json"
            assessment_path = directory / "assessment-v2.json"
            diagnosis_path = directory / "structural-diagnosis-v2.json"
            bundle, basis = load(bundle_path), load(basis_path)
            assessment, diagnosis = load(assessment_path), load(diagnosis_path)
            for label, artifact in (("bundle", bundle), ("basis", basis), ("assessment", assessment), ("diagnosis", diagnosis)):
                release(artifact, expected_sha, f"{geography}/{method} {label}")
            require(bundle.get("model_output_bytes_read") is False, f"{geography}/{method} bundle opened output")
            readiness = bundle.get("readiness_inputs") or {}
            require((readiness.get("observation_package") or {}).get("sha256") == digest(package_path), f"{geography}/{method} bundle package hash changed")
            require((readiness.get("pre_volume_match_audit") or {}).get("sha256") == digest(audit_path), f"{geography}/{method} bundle audit hash changed")
            require((basis.get("modeled_quantity") or {}).get("name") == "synthetic_expanded_daily_traffic", f"{geography}/{method} modeled quantity changed")
            require((basis.get("modeled_quantity") or {}).get("not_aadt") is True, f"{geography}/{method} AADT boundary changed")
            require((basis.get("modeled_quantity") or {}).get("expansion_chain", {}).get("peak_hour_factor") == 0.10, f"{geography}/{method} expansion changed")
            require((basis.get("vehicle_basis") or {}).get("vehicle_pce_equivalence", {}).get("class_pce") == 1, f"{geography}/{method} vehicle/PCE proof changed")
            require(assessment.get("method") == method and assessment.get("scientific_outcome") == "inconclusive", f"{geography}/{method} assessment changed")
            exact = assessment.get("exact_inputs") or {}
            require(exact.get("validation_input_bundle_sha256") == digest(bundle_path), f"{geography}/{method} input hash changed")
            require(exact.get("match_audit_sha256") == digest(audit_path), f"{geography}/{method} audit hash changed")
            bindings = diagnosis.get("bindings") or {}
            expected = {
                "observation_package_sha256": digest(package_path),
                "match_audit_sha256": digest(audit_path),
                "input_bundle_sha256": digest(bundle_path),
                "comparison_basis_sha256": digest(basis_path),
                "assessment_sha256": digest(assessment_path),
            }
            require(all(bindings.get(key) == value for key, value in expected.items()), f"{geography}/{method} diagnosis binding changed")
            manifest_record = diagnoses[(geography, method)]
            require(manifest_record.get("sha256") == digest(diagnosis_path), f"{geography}/{method} result diagnosis hash changed")
        comparison = json.loads(artifact_bytes(STUDY / "results" / geography / "method-comparison-v2.json"))
        require(isinstance(comparison, list) and all("average" not in item for item in comparison), f"{geography} methods were averaged")
    print("comparable observation study: all release and custody bindings verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
