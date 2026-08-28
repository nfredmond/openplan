#!/usr/bin/env python3
"""Rules-v5 comparison of frozen v2 observations and model outputs.

The development study and local worker share this module. Matching is already
frozen when it is called; it never selects a link from modeled values.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence


VALIDATION_RULES_VERSION = 5
OBSERVATION_SCHEMA = "openplan.observed-traffic-observation.v2"
MATCH_AUDIT_SCHEMA = "openplan.pre-volume-observation-match-audit.v2"
COMPARISON_BASIS_SCHEMA = "openplan.model-comparison-basis.v2"
ASSESSMENT_SCHEMA = "openplan.model-validation-assessment.v2"
UNKNOWN = "unknown"
MATCH_STATES = {
    "matched", "ambiguous", "excluded", "unresolved", "unsupported",
    "genuine_network_absence",
}


class ContractError(ValueError):
    """A v2 artifact lost a required fact or custody binding."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_payload(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def _hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(float(value)) else None


def _require(value: Mapping[str, Any], fields: set[str], label: str) -> None:
    missing = sorted(fields - set(value))
    if missing:
        raise ContractError(f"{label} omitted {', '.join(missing)}")


def validate_basis(basis: Mapping[str, Any]) -> None:
    _require(basis, {
        "schema", "basis_id", "model_run_id", "method", "model_output_artifact",
        "model_base_year", "modeled_quantity", "assignment_period", "vehicle_basis",
        "observation_facts", "assignment_settings", "coefficient_package",
        "network_state_hashes", "acceptance_rule", "frozen_at",
    }, "comparison basis")
    if basis["schema"] != COMPARISON_BASIS_SCHEMA:
        raise ContractError(f"comparison basis must use {COMPARISON_BASIS_SCHEMA}")
    if basis["method"] not in {"aequilibrae", "activitysim"}:
        raise ContractError("method must remain separate")
    artifact = basis["model_output_artifact"]
    if not isinstance(artifact, Mapping) or not _hash(artifact.get("sha256")):
        raise ContractError("comparison basis requires exact model-output bytes")
    quantity = basis["modeled_quantity"]
    if not isinstance(quantity, Mapping) or quantity.get("name") != "synthetic_expanded_daily_traffic":
        raise ContractError("expanded peak-hour assignment may not be described as AADT")
    expansion = quantity.get("expansion_chain")
    if not isinstance(expansion, Mapping) or _number(expansion.get("peak_hour_factor")) != 0.10:
        raise ContractError("the exact 0.10 representative peak-hour expansion chain is not proven")
    for field in ("run_summary_sha256", "conservation_sha256"):
        if not _hash(expansion.get(field)):
            raise ContractError(f"expansion chain omitted {field}")
    vehicle = basis["vehicle_basis"]
    conversion = vehicle.get("vehicle_pce_equivalence") if isinstance(vehicle, Mapping) else None
    if not isinstance(conversion, Mapping) or conversion.get("class_pce") != 1 or not _hash(conversion.get("assignment_profile_sha256")):
        raise ContractError("vehicle/PCE equivalence requires an exact class_pce = 1 profile")
    facts = basis["observation_facts"]
    if not isinstance(facts, Mapping):
        raise ContractError("comparison basis requires facts per observation")


def validate_inputs(
    observations: Sequence[Mapping[str, Any]],
    audit: Mapping[str, Any],
    basis: Mapping[str, Any],
) -> dict[str, Mapping[str, Any]]:
    validate_basis(basis)
    if audit.get("schema") != MATCH_AUDIT_SCHEMA or audit.get("frozen_before_model_volume") is not True:
        raise ContractError("matching was not frozen before output")
    if audit.get("model_output_bytes_read") is not False:
        raise ContractError("assignment output was opened before all readiness gates")
    matches = audit.get("matches")
    if not isinstance(matches, list):
        raise ContractError("match audit omitted retained records")
    by_id: dict[str, Mapping[str, Any]] = {}
    for match in matches:
        identifier = str(match.get("observation_id") or "")
        if not identifier or identifier in by_id or match.get("status") not in MATCH_STATES:
            raise ContractError("match audit changed ids or states")
        by_id[identifier] = match
    ids = [str(item.get("observation_id") or "") for item in observations]
    if ids != [str(item.get("observation_id") or "") for item in matches]:
        raise ContractError("assessment cannot drop, reorder, or invent observation ids")
    measurement_ids: set[str] = set()
    for observation in observations:
        if observation.get("schema") != OBSERVATION_SCHEMA:
            raise ContractError(f"observation must use {OBSERVATION_SCHEMA}")
        if observation.get("observation_id") != observation.get("series_id"):
            raise ContractError("stable series id changed")
        measurements = observation.get("measurements")
        if not isinstance(measurements, list) or not measurements:
            raise ContractError("measurement lineage collapsed")
        for measurement in measurements:
            identifier = str(measurement.get("measurement_id") or "")
            if not identifier or identifier in measurement_ids:
                raise ContractError("measurement lineage collapsed")
            measurement_ids.add(identifier)
            if not _hash(measurement.get("exact_record_sha256")):
                raise ContractError("measurement omitted exact source-record hash")
    if set(basis["observation_facts"]) != set(ids):
        raise ContractError("comparison basis facts must cover every retained observation")
    return by_id


def _sum_selected(match: Mapping[str, Any], volumes: Mapping[str | int, float]) -> tuple[float | None, str]:
    identifiers = match.get("selected_link_ids")
    if not isinstance(identifiers, list) or not identifiers:
        return None, "missing_output"
    values: list[float] = []
    for identifier in identifiers:
        value = _number(volumes.get(str(identifier), volumes.get(identifier)))
        if value is None:
            return None, "missing_output"
        values.append(value)
    total = sum(values)
    return total, "unloaded" if total == 0 else "matched"


def _comparability(observation: Mapping[str, Any], basis: Mapping[str, Any]) -> list[dict[str, Any]]:
    facts = basis["observation_facts"][observation["observation_id"]]
    if not isinstance(facts, Mapping):
        raise ContractError("observation fact row must be an object")
    findings = []
    checks = (
        ("model_base_year", observation.get("time_basis", {}).get("year"), basis["model_base_year"]),
        ("day_basis", observation.get("time_basis", {}).get("day_basis"), facts.get("day_basis")),
        ("direction_aggregation", facts.get("observed_direction_basis"), facts.get("modeled_direction_basis")),
        ("vehicle_basis", observation.get("vehicle_basis", {}).get("unit"), facts.get("modeled_vehicle_unit")),
    )
    for key, observed, modeled in checks:
        status = "compatible" if observed == modeled and observed not in {None, UNKNOWN} else "conflict"
        findings.append({"key": key, "status": status, "observation": observed or UNKNOWN, "model": modeled or UNKNOWN})
    findings.append({
        "key": "modeled_quantity",
        "status": "compatible" if facts.get("synthetic_expanded_daily_traffic") is True else "conflict",
        "observation": observation.get("time_basis", {}).get("period", UNKNOWN),
        "model": "synthetic_expanded_daily_traffic",
    })
    return findings


def assess_validation(
    observations: Sequence[Mapping[str, Any]],
    audit: Mapping[str, Any],
    basis: Mapping[str, Any],
    modeled_volumes_by_link: Mapping[str | int, float],
    *,
    assessment_id: str,
    input_bundle_sha256: str,
    match_audit_sha256: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    if not _hash(input_bundle_sha256):
        raise ContractError("assessment requires the exact frozen input bundle")
    if match_audit_sha256 is not None and not _hash(match_audit_sha256):
        raise ContractError("assessment requires the exact match-audit bytes")
    matches = validate_inputs(observations, audit, basis)
    rows: list[dict[str, Any]] = []
    coverage = Counter(str(matches[item["observation_id"]]["status"]) for item in observations)
    for observation in observations:
        match = matches[observation["observation_id"]]
        status = str(match["status"])
        row: dict[str, Any] = {
            "observation_id": observation["observation_id"],
            "site_id": observation["site_id"],
            "series_id": observation["series_id"],
            "match_status": status,
            "selected_link_ids": list(match.get("selected_link_ids") or []),
            "direction_aggregation": match.get("direction_aggregation", UNKNOWN),
            "observed_center": observation.get("estimate", {}).get("center", UNKNOWN),
            "observed_bounds": observation.get("estimate", {}).get("source_supported_bounds", UNKNOWN),
            "modeled_value": UNKNOWN,
            "raw_signed_residual": UNKNOWN,
            "raw_absolute_percent_error": UNKNOWN,
            "basis_findings": [],
        }
        if status == "matched":
            modeled, output_status = _sum_selected(match, modeled_volumes_by_link)
            row["match_status"] = output_status
            if output_status != status:
                coverage[status] -= 1
                coverage[output_status] += 1
            observed = _number(observation.get("estimate", {}).get("center"))
            if modeled is not None and observed is not None:
                findings = _comparability(observation, basis)
                residual = modeled - observed
                row.update({
                    "modeled_value": modeled,
                    "raw_signed_residual": residual,
                    "raw_absolute_percent_error": UNKNOWN if observed == 0 else abs(residual) / abs(observed) * 100,
                    "basis_findings": findings,
                })
        rows.append(row)
    scored = [row for row in rows if isinstance(row["raw_signed_residual"], (int, float))]
    acceptance = basis["acceptance_rule"]
    reasons = []
    outcome = "inconclusive"
    if not isinstance(acceptance, Mapping) or acceptance.get("status") != "frozen":
        reasons.append("No frozen, use-specific acceptance rule is bound; the result is inconclusive.")
    else:
        reasons.append("A frozen rule is present, but rules-v5 does not infer omitted criteria.")
    return {
        "schema": ASSESSMENT_SCHEMA,
        "assessment_id": assessment_id,
        "rules_version": VALIDATION_RULES_VERSION,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "method": basis["method"],
        "exact_inputs": {
            "validation_input_bundle_sha256": input_bundle_sha256,
            "observation_package_sha256": audit["observation_package_sha256"],
            "match_audit_sha256": match_audit_sha256 or sha256_payload(audit),
            "comparison_basis_sha256": sha256_payload(basis),
            "model_output_sha256": basis["model_output_artifact"]["sha256"],
            "network_sha256": audit["network_sha256"],
        },
        "observation_results": rows,
        "metrics": {
            "scored_observations": len(scored),
            "median_raw_signed_residual": statistics.median(row["raw_signed_residual"] for row in scored) if scored else UNKNOWN,
        },
        "coverage": dict(sorted(coverage.items())),
        "scientific_outcome": outcome,
        "reasons": reasons,
        "validation_evidence_write": "pending",
    }


def compare_methods(assessments: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return separate values, differences, and ratios; never an average."""
    by_method = {str(item.get("method")): item for item in assessments}
    if set(by_method) != {"aequilibrae", "activitysim"}:
        raise ContractError("paired comparison requires separate AequilibraE and ActivitySim assessments")
    left = {row["observation_id"]: row for row in by_method["aequilibrae"]["observation_results"]}
    right = {row["observation_id"]: row for row in by_method["activitysim"]["observation_results"]}
    if set(left) != set(right):
        raise ContractError("paired methods must retain identical observation ids")
    result = []
    for identifier in sorted(left):
        a = left[identifier]["modeled_value"]
        b = right[identifier]["modeled_value"]
        numeric = isinstance(a, (int, float)) and isinstance(b, (int, float))
        result.append({
            "observation_id": identifier,
            "aequilibrae": a,
            "activitysim": b,
            "difference_activitysim_minus_aequilibrae": b - a if numeric else UNKNOWN,
            "ratio_activitysim_to_aequilibrae": b / a if numeric and a != 0 else UNKNOWN,
        })
    return result
