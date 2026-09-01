#!/usr/bin/env python3
"""Verify the published v0.44 study without regenerating assignment output."""
from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "data/modeling/distributed-work-loading-study-2026-08-31"
REGISTRY = ROOT / "scripts/modeling/development/california_distributed_work_loading_study.v1.json"
METHODS = ("aequilibrae", "activitysim")
STATES = {
    "covered",
    "explicit_zero",
    "suppressed",
    "unavailable_source",
    "unmapped",
    "unroutable",
    "inconclusive_missing_pair",
}


class VerificationError(RuntimeError):
    """The published result no longer matches its custody contract."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_bytes())
    require(isinstance(value, dict), f"not a JSON object: {path}")
    return value


def exact_artifact(record: Mapping[str, Any], label: str) -> tuple[bytes, dict[str, Any]]:
    stored_path = ROOT / str(record.get("stored_path") or "")
    require(stored_path.resolve().is_relative_to(STUDY.resolve()), f"{label} escaped the published study directory")
    require(stored_path.is_file(), f"{label} stored bytes are missing: {stored_path}")
    stored = stored_path.read_bytes()
    require(len(stored) == record.get("stored_bytes"), f"{label} stored byte count changed")
    require(sha256(stored) == record.get("stored_sha256"), f"{label} stored SHA-256 changed")
    logical = gzip.decompress(stored) if stored_path.suffix == ".gz" else stored
    require(len(logical) == record.get("bytes"), f"{label} logical byte count changed")
    require(sha256(logical) == record.get("sha256"), f"{label} logical SHA-256 changed")
    value = json.loads(logical)
    require(isinstance(value, dict), f"{label} is not a JSON object")
    return logical, value


def release(value: Mapping[str, Any], expected_sha: str, label: str) -> None:
    require(value.get("release") == {"version": "0.44.0", "sha": expected_sha}, f"{label} release binding changed")


def main() -> int:
    expected_sha = sys.argv[1] if len(sys.argv) > 1 else ""
    require(len(expected_sha) == 40, "pass the exact release-source Git SHA")
    registry_bytes = REGISTRY.read_bytes()
    registry = json.loads(registry_bytes)
    result = load(STUDY / "study-result.json")
    release(result, expected_sha, "study result")
    require(result.get("schema") == "openplan.distributed-work-loading-study-result.v1", "study schema changed")
    require(result.get("method_records") == 14 and result.get("method_aggregation") == "separate", "study no longer has fourteen separate method records")
    require(result.get("scientific_outcome") == "inconclusive", "study outcome changed")
    require(result.get("defaults_changed") is False and result.get("holdout_accessed") is False, "study crossed a rollout boundary")
    require((result.get("registry") or {}).get("sha256") == sha256(registry_bytes), "study registry hash changed")
    require(registry.get("partition") == "unchanged v0.39 seven-county development partition", "development partition changed")
    partition_custody = registry.get("partition_custody") or {}
    require(partition_custody.get("acceptance_holdout_opened") is False, "registry opened an acceptance holdout")
    legacy_note = str(partition_custody.get("legacy_path_note") or "")
    require("not treat the legacy directory name as untouched evidence" in legacy_note, "registry obscured legacy holdout-directory custody")
    require("does not" in legacy_note and "reopen an acceptance holdout" in legacy_note, "registry weakened its holdout boundary")
    policy = registry.get("policy") or {}
    require(policy.get("arbitrary_point_cap") is None and policy.get("arbitrary_gateway_cap") is None, "registry introduced an arbitrary loading cap")
    require(policy.get("average_methods") is False and policy.get("change_defaults") is False, "registry weakened the method/default boundary")

    counties = result.get("counties") or []
    geography_ids = [str(item["geography_id"]) for item in registry.get("geographies") or []]
    require(len(counties) == 7 and {str(item.get("geography_id")) for item in counties} == set(geography_ids), "development geography matrix changed")
    every_advanced = True
    comparable_bindings = (
        "registry",
        "source_release",
        "source_od",
        "source_rac",
        "source_wac",
        "source_crosswalk",
        "source_documentation",
        "loading_algorithm",
        "candidate_network",
        "frozen_network",
        "observation_package",
        "match_audit",
        "assignment_profile",
    )
    for county in counties:
        geography = str(county["geography_id"])
        methods = county.get("methods") or {}
        require(set(methods) == set(METHODS), f"{geography} method set changed")
        audits: dict[str, dict[str, Any]] = {}
        for method in METHODS:
            record = methods[method]
            _, loading_input = exact_artifact(record["input"], f"{geography}/{method} loading input")
            _, audit = exact_artifact(record["audit"], f"{geography}/{method} pre-output audit")
            _, comparison = exact_artifact(record["comparison"], f"{geography}/{method} comparison")
            audits[method] = audit
            for label, value in (("loading input", loading_input), ("pre-output audit", audit), ("comparison", comparison)):
                require(value.get("method") == method, f"{geography}/{method} {label} method changed")
            require(loading_input.get("schema") == "openplan.distributed-work-loading-input.v1", f"{geography}/{method} input schema changed")
            source_release_keys = (
                "publisher",
                "product",
                "release",
                "year",
                "jobs_type",
                "segment",
                "block_vintage",
                "limitations",
            )
            expected_source_release = {key: registry["source_release"][key] for key in source_release_keys}
            require(loading_input.get("source_release") == expected_source_release, f"{geography}/{method} Census source release changed")
            release(audit, expected_sha, f"{geography}/{method} pre-output audit")
            release(comparison, expected_sha, f"{geography}/{method} comparison")
            require(audit.get("schema") == "openplan.pre-output-audit.v1", f"{geography}/{method} audit schema changed")
            require(audit.get("frozen_before_assignment_output") is True and audit.get("assignment_output_bytes_read") is False, f"{geography}/{method} audit opened output early")
            require(audit.get("holdout_accessed") is False and audit.get("methods_averaged") is False and audit.get("defaults_changed") is False, f"{geography}/{method} audit crossed a forbidden boundary")
            require((audit.get("bindings") or {}).get("loading_input") == record["input"], f"{geography}/{method} audit/loading-input binding changed")
            accounting = audit.get("demand_accounting") or {}
            require(set(accounting.get("source_state_demand") or {}) == STATES, f"{geography}/{method} source-state vocabulary changed")
            require(abs(float(accounting["candidate_total"]) - float(accounting["original_total"])) <= max(1e-6, float(accounting["original_total"]) * 1e-10), f"{geography}/{method} demand is not conserved")
            require(abs(float(accounting["work_loaded_at_access_points"]) + float(accounting["work_retained_at_original_centroids"]) - float(accounting["original_work_total"])) <= 1e-6, f"{geography}/{method} work demand is missing")
            require(comparison.get("schema") == "openplan.development-comparison.v1", f"{geography}/{method} comparison schema changed")
            require(comparison.get("scientific_outcome") == "inconclusive" and comparison.get("method_aggregation") == "separate", f"{geography}/{method} comparison claimed or averaged a result")
            require(comparison.get("holdout_accessed") is False and comparison.get("defaults_changed") is False, f"{geography}/{method} comparison crossed a rollout boundary")
            require((comparison.get("bindings") or {}).get("pre_output_audit_sha256") == record["audit"]["sha256"], f"{geography}/{method} comparison/audit binding changed")
            runtime = comparison.get("assignment_runtime") or {}
            require(runtime.get("assignment_profile_sha256") == (audit.get("bindings") or {}).get("assignment_profile", {}).get("sha256"), f"{geography}/{method} assignment runtime escaped the pre-output profile")
            require(runtime.get("converged") is True and isinstance(runtime.get("iterations"), int), f"{geography}/{method} assignment did not prove convergence")
            require(runtime.get("engine_version") == "1.6.2", f"{geography}/{method} assignment engine changed from the frozen comparison runtime")
            gate = comparison.get("development_gate") or {}
            if gate.get("advanced") is True:
                require(all(gate.get(key) is True for key in ("demand_conserved", "observed_link_reach_improved", "no_county_stratum_worsened", "no_road_class_worsened", "same_source_network_custody")), f"{geography}/{method} advanced without every gate")
            every_advanced = every_advanced and gate.get("advanced") is True
        left = audits["aequilibrae"].get("bindings") or {}
        right = audits["activitysim"].get("bindings") or {}
        require(all((left.get(key) or {}).get("sha256") == (right.get(key) or {}).get("sha256") and (left.get(key) or {}).get("bytes") == (right.get(key) or {}).get("bytes") for key in comparable_bindings), f"{geography} methods do not share exact source/network custody")
    require(result.get("candidate_advanced") is every_advanced, "study candidate disposition disagrees with county-method gates")
    report = (STUDY / "study-report.md").read_text()
    geography_names = [str(item["name"]) for item in registry.get("geographies") or []]
    require(all(name in report for name in geography_names), "study report omitted a development geography")
    require(all(method in report for method in METHODS), "study report omitted a separate method")
    require("inconclusive" in report and "No default changed" in report, "study report weakened its scientific boundary")
    print("distributed work loading study: all release, artifact, conservation, and custody bindings verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
