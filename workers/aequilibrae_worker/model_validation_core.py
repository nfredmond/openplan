#!/usr/bin/env python3
"""Rules-v4 observed-count comparability and validation core.

This module is intentionally stdlib-only. Both the model worker and the county
validation CLI call it. It never invents a missing fact, converts a daily count
to an hourly count, treats PCE as vehicles without a recorded conversion, or
chooses a match after reading the modeled volume.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence


VALIDATION_RULES_VERSION = 4
OBSERVATION_SCHEMA = "openplan.observed-traffic-observation.v1"
COMPARISON_BASIS_SCHEMA = "openplan.model-comparison-basis.v1"
ASSESSMENT_SCHEMA = "openplan.model-validation-assessment.v1"
UNKNOWN = "unknown"

_GRADE_RANK = {"A": 1, "B": 2, "C": 3, "D": 4}
_OBSERVATION_REQUIRED = {
    "schema",
    "observation_id",
    "source",
    "route_lrs",
    "geometry",
    "direction_lane_carriageway",
    "vehicle_basis",
    "time_basis",
    "measurement",
    "qa",
    "estimate",
    "evidence_grade",
    "match_audit",
    "duplicate_lineage",
}
_BASIS_REQUIRED = {
    "schema",
    "basis_id",
    "model_run_id",
    "model_output_artifact",
    "model_base_year",
    "day_basis",
    "assignment_period",
    "vehicle_basis",
    "direction_basis",
    "planning_use",
    "scenario",
    "engine",
    "coefficient_package",
    "population_vintage",
    "assignment_profile",
    "network_settings",
    "network_state_hashes",
    "acceptance_rule",
    "frozen_at",
}


class ContractError(ValueError):
    """A versioned input is incomplete or claims evidence it cannot support."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_payload(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{path} must be an object or explicit unknown")
    return value


def _required(value: Mapping[str, Any], fields: Iterable[str], path: str) -> None:
    missing = sorted(set(fields) - set(value))
    if missing:
        raise ContractError(f"{path} is missing required field(s): {', '.join(missing)}")


def _known(value: Any) -> bool:
    return value is not None and value != UNKNOWN and value != ""


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def _hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def _date_year(value: Any) -> int | None:
    if isinstance(value, int) and 1900 <= value <= 2200:
        return value
    if isinstance(value, str) and len(value) >= 4 and value[:4].isdigit():
        year = int(value[:4])
        return year if 1900 <= year <= 2200 else None
    return None


def source_supported_interval(observation: Mapping[str, Any]) -> tuple[float, float] | None:
    estimate = _mapping(observation["estimate"], "observation.estimate")
    bounds = estimate.get("source_supported_bounds")
    if bounds == UNKNOWN:
        return None
    bounds = _mapping(bounds, "observation.estimate.source_supported_bounds")
    _required(bounds, {"lower", "upper", "method", "authority", "artifact_sha256"}, "bounds")
    lower, upper = _number(bounds["lower"]), _number(bounds["upper"])
    if lower is None or upper is None:
        raise ContractError("observation bounds must be numeric or the whole bounds field must be unknown")
    if lower > upper:
        raise ContractError("observation bounds are reversed")
    if not _known(bounds["method"]) or not _known(bounds["authority"]) or not _hash(bounds["artifact_sha256"]):
        raise ContractError("observation bounds require a named authoritative method and exact source hash")
    center = _number(estimate.get("center"))
    if center is None or not lower <= center <= upper:
        raise ContractError("observation bounds must contain the center estimate")
    return lower, upper


def supported_evidence_grade(observation: Mapping[str, Any]) -> str:
    """Strongest grade supported without looking at modeled volume.

    A requires a source-supported interval and at least 28 complete days. B
    requires at least one complete day. C retains hashed but derived or
    incompletely documented evidence for diagnostics. Everything else is D.
    """
    source = _mapping(observation["source"], "observation.source")
    measurement = _mapping(observation["measurement"], "observation.measurement")
    qa = _mapping(observation["qa"], "observation.qa")
    estimate = _mapping(observation["estimate"], "observation.estimate")
    time_basis = _mapping(observation["time_basis"], "observation.time_basis")
    vehicle = _mapping(observation["vehicle_basis"], "observation.vehicle_basis")
    duration = _mapping(measurement.get("duration"), "observation.measurement.duration")

    if not _hash(source.get("artifact_sha256")) or _number(estimate.get("center")) is None:
        return "D"

    complete_hours = _number(duration.get("complete_hours"))
    direct_or_supported = measurement.get("method") in {"direct", "source_derived"}
    documented = (
        direct_or_supported
        and qa.get("status") == "accepted"
        and _known(time_basis.get("day_basis"))
        and _known(time_basis.get("year"))
        and vehicle.get("unit") == "vehicles"
    )
    if documented and complete_hours is not None and complete_hours >= 28 * 24:
        try:
            interval = source_supported_interval(observation)
        except ContractError:
            raise
        if interval is not None:
            return "A"
    if documented and complete_hours is not None and complete_hours >= 24:
        return "B"
    return "C"


def validate_observation(observation: Mapping[str, Any]) -> None:
    _required(observation, _OBSERVATION_REQUIRED, "observation")
    if observation["schema"] != OBSERVATION_SCHEMA:
        raise ContractError(f"observation schema must be {OBSERVATION_SCHEMA}")
    for field in (
        "source",
        "route_lrs",
        "geometry",
        "direction_lane_carriageway",
        "vehicle_basis",
        "time_basis",
        "measurement",
        "qa",
        "estimate",
        "match_audit",
        "duplicate_lineage",
    ):
        _mapping(observation[field], f"observation.{field}")
    _required(observation["source"], {"dataset_id", "publisher", "source_url", "downloaded_at", "artifact_sha256", "member_path", "member_sha256"}, "observation.source")
    if not _hash(observation["source"].get("artifact_sha256")):
        raise ContractError("observation source requires the SHA-256 of the exact downloaded bytes")
    _required(observation["estimate"], {"center", "source_supported_bounds"}, "observation.estimate")
    if observation["estimate"]["source_supported_bounds"] != UNKNOWN:
        source_supported_interval(observation)
    _required(observation["measurement"], {"method", "duration", "factors"}, "observation.measurement")
    _required(observation["measurement"]["duration"], {"start", "end", "complete_hours"}, "observation.measurement.duration")
    _required(observation["qa"], {"status", "flags", "source_fields"}, "observation.qa")
    _required(observation["match_audit"], {"status", "frozen_at", "frozen_before_model_volume", "geometry", "route", "direction", "facility", "candidate_link_ids", "selected_link_id", "reason"}, "observation.match_audit")
    _required(observation["duplicate_lineage"], {"lineage_id", "canonical_observation_id", "duplicate_of", "resolution"}, "observation.duplicate_lineage")
    declared = observation["evidence_grade"]
    if declared not in _GRADE_RANK:
        raise ContractError("observation evidence_grade must be A, B, C, or D")
    supported = supported_evidence_grade(observation)
    if _GRADE_RANK[declared] < _GRADE_RANK[supported]:
        raise ContractError(f"observation declares Grade {declared} but its fields support at most Grade {supported}")


def validate_comparison_basis(basis: Mapping[str, Any]) -> None:
    _required(basis, _BASIS_REQUIRED, "comparison basis")
    if basis["schema"] != COMPARISON_BASIS_SCHEMA:
        raise ContractError(f"comparison basis schema must be {COMPARISON_BASIS_SCHEMA}")
    for field in (
        "model_output_artifact",
        "assignment_period",
        "vehicle_basis",
        "direction_basis",
        "scenario",
        "engine",
        "coefficient_package",
        "population_vintage",
        "assignment_profile",
        "network_settings",
        "network_state_hashes",
        "acceptance_rule",
    ):
        if basis[field] != UNKNOWN:
            _mapping(basis[field], f"comparison_basis.{field}")
    artifact = _mapping(basis["model_output_artifact"], "comparison_basis.model_output_artifact")
    _required(artifact, {"artifact_id", "artifact_type", "sha256"}, "comparison_basis.model_output_artifact")
    if not _hash(artifact.get("sha256")):
        raise ContractError("comparison basis requires the exact model-output artifact SHA-256")


def _finding(key: str, status: str, observation: Any, model: Any, reason: str) -> dict[str, Any]:
    return {"key": key, "status": status, "observation": observation, "model": model, "reason": reason}


def comparability_findings(observation: Mapping[str, Any], basis: Mapping[str, Any]) -> list[dict[str, Any]]:
    time_basis = _mapping(observation["time_basis"], "observation.time_basis")
    obs_vehicle = _mapping(observation["vehicle_basis"], "observation.vehicle_basis")
    obs_direction = _mapping(observation["direction_lane_carriageway"], "observation.direction_lane_carriageway")
    findings: list[dict[str, Any]] = []

    obs_year = _date_year(time_basis.get("year"))
    model_year = _date_year(basis.get("model_base_year"))
    adjustment = time_basis.get("frozen_year_adjustment")
    adjusted = isinstance(adjustment, Mapping) and adjustment.get("status") == "frozen" and _hash(adjustment.get("artifact_sha256"))
    if obs_year is not None and model_year is not None and (obs_year == model_year or adjusted):
        findings.append(_finding("base_year", "compatible", obs_year, model_year, "Years match or a frozen adjustment is bound."))
    else:
        findings.append(_finding("base_year", "incompatible" if obs_year and model_year else "unknown", time_basis.get("year"), basis.get("model_base_year"), "The count and model base year are not proven equal."))

    obs_day, model_day = time_basis.get("day_basis"), basis.get("day_basis")
    if _known(obs_day) and obs_day == model_day:
        findings.append(_finding("day_basis", "compatible", obs_day, model_day, "Day definitions match exactly."))
    else:
        findings.append(_finding("day_basis", "incompatible" if _known(obs_day) and _known(model_day) else "unknown", obs_day, model_day, "Daily, weekday, and average-day quantities are not interchangeable."))

    obs_period = time_basis.get("observation_period")
    model_period = basis.get("assignment_period")
    if isinstance(obs_period, Mapping) and isinstance(model_period, Mapping) and obs_period.get("label") == model_period.get("label") and obs_period.get("hours") == model_period.get("hours"):
        findings.append(_finding("assignment_period", "compatible", obs_period, model_period, "Observed and modeled periods match."))
    else:
        findings.append(_finding("assignment_period", "incompatible" if obs_period != UNKNOWN and model_period != UNKNOWN else "unknown", obs_period, model_period, "No daily-volume/24 or generic K-factor conversion is allowed."))

    obs_unit = obs_vehicle.get("unit")
    model_vehicle = basis.get("vehicle_basis")
    model_unit = model_vehicle.get("unit") if isinstance(model_vehicle, Mapping) else UNKNOWN
    conversion = model_vehicle.get("vehicle_pce_conversion") if isinstance(model_vehicle, Mapping) else UNKNOWN
    conversion_proven = isinstance(conversion, Mapping) and conversion.get("status") == "proven" and _hash(conversion.get("artifact_sha256")) and _number(conversion.get("factor")) is not None
    if obs_unit == model_unit and _known(obs_unit):
        findings.append(_finding("vehicle_units", "compatible", obs_unit, model_unit, "Vehicle units match exactly."))
    elif {obs_unit, model_unit} == {"vehicles", "pce"} and conversion_proven:
        findings.append(_finding("vehicle_units", "compatible", obs_unit, model_unit, "A frozen vehicle/PCE conversion is bound."))
    else:
        findings.append(_finding("vehicle_units", "incompatible" if _known(obs_unit) and _known(model_unit) else "unknown", obs_unit, model_unit, "PCE cannot be treated as vehicles without a recorded conversion."))

    obs_direction_value = obs_direction.get("basis")
    model_direction = basis.get("direction_basis")
    model_direction_value = model_direction.get("basis") if isinstance(model_direction, Mapping) else UNKNOWN
    if _known(obs_direction_value) and obs_direction_value == model_direction_value:
        findings.append(_finding("direction_carriageway", "compatible", obs_direction_value, model_direction_value, "Direction and carriageway bases match."))
    else:
        findings.append(_finding("direction_carriageway", "incompatible" if _known(obs_direction_value) and _known(model_direction_value) else "unknown", obs_direction_value, model_direction_value, "Direction, lane, and carriageway equivalence is not established."))
    return findings


def _metric_row(observation: Mapping[str, Any], modeled_volume: float, findings: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    center = _number(observation["estimate"].get("center"))
    assert center is not None
    residual = modeled_volume - center
    ape = None if center == 0 else abs(residual) / abs(center) * 100.0
    interval = source_supported_interval(observation)
    excess = None
    if interval is not None:
        lower, upper = interval
        excess = max(lower - modeled_volume, 0.0, modeled_volume - upper)
    grade = observation["evidence_grade"]
    comparable = all(finding["status"] == "compatible" for finding in findings)
    return {
        "observation_id": observation["observation_id"],
        "evidence_grade": grade,
        "decisive": grade in {"A", "B"} and comparable,
        "diagnostic": grade == "C" and comparable,
        "observed_center": center,
        "observed_bounds": list(interval) if interval is not None else UNKNOWN,
        "modeled_volume": modeled_volume,
        "raw_signed_residual": residual,
        "raw_absolute_percent_error": ape,
        "interval_excess_error": excess,
        "comparability": list(findings),
        "match_status": (
            "unloaded"
            if observation["match_audit"]["status"] == "matched" and modeled_volume == 0
            else observation["match_audit"]["status"]
        ),
    }


def _median(values: Iterable[float | None]) -> float | None:
    known = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return statistics.median(known) if known else None


def _summary(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        "observations": len(rows),
        "median_raw_ape": _median(row.get("raw_absolute_percent_error") for row in rows),
        "median_signed_residual": _median(row.get("raw_signed_residual") for row in rows),
        "median_interval_excess_error": _median(row.get("interval_excess_error") for row in rows),
        "inside_source_interval": sum(1 for row in rows if row.get("interval_excess_error") == 0),
        "interval_scored": sum(1 for row in rows if row.get("interval_excess_error") is not None),
    }


def _coverage(observations: Sequence[Mapping[str, Any]], rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    statuses = {
        "matched": 0,
        "ambiguous": 0,
        "excluded": 0,
        "unloaded": 0,
        "unresolved": 0,
        "unsupported": 0,
        "source_unavailable": 0,
        "supported_but_empty": 0,
        "duplicate": 0,
    }
    for observation in observations:
        status = str(observation["match_audit"].get("status"))
        if status in statuses:
            statuses[status] += 1
        else:
            statuses["unresolved"] += 1
    newly_unloaded = sum(
        1
        for row in rows
        if row.get("match_status") == "unloaded"
        and next(
            (
                observation["match_audit"].get("status")
                for observation in observations
                if observation.get("observation_id") == row.get("observation_id")
            ),
            None,
        ) == "matched"
    )
    statuses["matched"] -= newly_unloaded
    statuses["unloaded"] += newly_unloaded
    statuses["decisive"] = sum(1 for row in rows if row.get("decisive"))
    statuses["diagnostic"] = sum(1 for row in rows if row.get("diagnostic"))
    statuses["grade_d"] = sum(1 for observation in observations if observation["evidence_grade"] == "D")
    return statuses


def _decision(decisive: Sequence[Mapping[str, Any]], basis: Mapping[str, Any], reasons: list[str]) -> str:
    scenario = basis.get("scenario")
    if isinstance(scenario, Mapping) and scenario.get("role") != "baseline":
        reasons.append("Build-run counts cannot establish change or forecast validity against base-year observations.")
        return "inconclusive"
    rule = basis.get("acceptance_rule")
    if not isinstance(rule, Mapping) or rule.get("status") != "frozen" or not _hash(rule.get("preregistration_sha256")):
        reasons.append("No frozen, use-specific acceptance rule is bound to this assessment.")
        return "inconclusive"
    minimum = rule.get("minimum_decisive_observations")
    if not isinstance(minimum, int) or minimum < 1 or len(decisive) < minimum:
        reasons.append(f"Only {len(decisive)} decisive observations are available; the frozen rule requires {minimum if isinstance(minimum, int) else 'an explicit minimum'}.")
        return "inconclusive"
    median_ape = _median(row.get("raw_absolute_percent_error") for row in decisive)
    max_ape = _number(rule.get("maximum_median_raw_ape"))
    if max_ape is not None and median_ape is not None and median_ape > max_ape:
        reasons.append(f"Decisive median raw APE {median_ape:.2f}% exceeds the frozen {max_ape:.2f}% limit.")
        return "fail"
    max_excess = _number(rule.get("maximum_median_interval_excess"))
    median_excess = _median(row.get("interval_excess_error") for row in decisive)
    if max_excess is not None:
        if median_excess is None:
            reasons.append("The frozen rule requires interval-excess error, but decisive observations do not supply authoritative bounds.")
            return "inconclusive"
        if median_excess > max_excess:
            reasons.append(f"Decisive median interval-excess error {median_excess:.2f} exceeds the frozen {max_excess:.2f} limit.")
            return "fail"
    if max_ape is None and max_excess is None:
        reasons.append("The frozen acceptance rule does not name a computable threshold.")
        return "inconclusive"
    reasons.append("Every computable criterion in the frozen acceptance rule passed.")
    return "pass"


def assess_validation(
    observations: Sequence[Mapping[str, Any]],
    basis: Mapping[str, Any],
    modeled_volumes_by_link: Mapping[str | int, float],
    *,
    partition: Mapping[str, Any],
    assessment_id: str,
    created_at: str | None = None,
    validation_input_bundle_sha256: str | None = None,
) -> dict[str, Any]:
    """Assess exact observations against an exact model artifact.

    Matching must already be frozen. The only model-output lookup in this
    function happens after that check, and duplicate canonical ids are retained
    once without inspecting residuals.
    """
    validate_comparison_basis(basis)
    for observation in observations:
        validate_observation(observation)

    rows: list[dict[str, Any]] = []
    reasons: list[str] = []
    seen_canonical: set[str] = set()
    for observation in observations:
        match = observation["match_audit"]
        lineage = observation["duplicate_lineage"]
        canonical = str(lineage.get("canonical_observation_id") or observation["observation_id"])
        if canonical in seen_canonical:
            continue
        seen_canonical.add(canonical)
        status = match.get("status")
        if status not in {"matched", "unloaded"}:
            continue
        if match.get("frozen_before_model_volume") is not True or not _known(match.get("frozen_at")):
            reasons.append(f"Observation {observation['observation_id']} has no pre-volume frozen match audit.")
            continue
        link_id = match.get("selected_link_id")
        modeled = 0.0 if status == "unloaded" else _number(modeled_volumes_by_link.get(str(link_id), modeled_volumes_by_link.get(link_id)))
        if modeled is None:
            reasons.append(f"Observation {observation['observation_id']} matched link {link_id}, but the exact model artifact has no value for it.")
            continue
        findings = comparability_findings(observation, basis)
        rows.append(_metric_row(observation, modeled, findings))

    decisive = [row for row in rows if row["decisive"]]
    diagnostic = [row for row in rows if row["diagnostic"]]
    outcome = _decision(decisive, basis, reasons)
    if not decisive:
        reasons.append("No Grade A or B observation has a fully comparable year, day, period, direction, and vehicle basis.")
        outcome = "inconclusive"

    observation_hashes = [sha256_payload(observation) for observation in observations]
    model_artifact = basis["model_output_artifact"]
    exact_inputs = {
        "observation_sha256": observation_hashes,
        "comparison_basis_sha256": sha256_payload(basis),
        "model_output_artifact_id": model_artifact["artifact_id"],
        "model_output_sha256": model_artifact["sha256"],
        "network_state_hashes": dict(basis["network_state_hashes"]),
    }
    if validation_input_bundle_sha256 is not None:
        if not _hash(validation_input_bundle_sha256):
            raise ContractError("validation_input_bundle_sha256 must be an exact SHA-256")
        exact_inputs["validation_input_bundle_sha256"] = validation_input_bundle_sha256
    return {
        "schema": ASSESSMENT_SCHEMA,
        "assessment_id": assessment_id,
        "rules_version": VALIDATION_RULES_VERSION,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "exact_inputs": exact_inputs,
        "planning_use": basis["planning_use"],
        "partition": dict(partition),
        "comparability_findings": {row["observation_id"]: row["comparability"] for row in rows},
        "observation_results": rows,
        "metrics": {
            "decisive": _summary(decisive),
            "diagnostic_grade_c": _summary(diagnostic),
            "all_computed": _summary(rows),
        },
        "coverage": _coverage(observations, rows),
        "scientific_outcome": outcome,
        "reasons": reasons,
        "legacy_point_count_diagnostic": False,
        "validation_evidence_write": "pending",
    }


def legacy_v1_to_v3_assessment(summary: Mapping[str, Any], *, assessment_id: str) -> dict[str, Any]:
    """Render old rows byte-for-byte as ungraded, same-basis-unproven evidence."""
    return {
        "schema": ASSESSMENT_SCHEMA,
        "assessment_id": assessment_id,
        "rules_version": summary.get("validation_rules_version", UNKNOWN),
        "created_at": UNKNOWN,
        "exact_inputs": UNKNOWN,
        "planning_use": "legacy screening diagnostic",
        "partition": UNKNOWN,
        "comparability_findings": UNKNOWN,
        "observation_results": summary.get("results", []),
        "metrics": {
            "legacy_raw": dict(summary),
            "decisive": UNKNOWN,
            "diagnostic_grade_c": UNKNOWN,
            "all_computed": UNKNOWN,
        },
        "coverage": summary.get("coverage", UNKNOWN),
        "scientific_outcome": "inconclusive",
        "reasons": [
            "Legacy point-count diagnostic: same-basis year, day, direction, carriageway, and vehicle-unit comparability was not established.",
            "OpenPlan did not infer evidence grades or observation bounds during backfill.",
        ],
        "legacy_point_count_diagnostic": True,
        "validation_evidence_write": "legacy_not_applicable",
    }


def uncontracted_v4_assessment(
    summary: Mapping[str, Any],
    basis: Mapping[str, Any],
    *,
    assessment_id: str,
    validation_input_bundle_sha256: str,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Fail closed when a fresh run only has pre-v4 point-count rows."""
    validate_comparison_basis(basis)
    model_artifact = basis["model_output_artifact"]
    reasons = [
        "The available point-count rows do not satisfy the observed-traffic-observation.v1 contract.",
        "Same-basis base year, day, period, direction, carriageway, and vehicle units were not established.",
        "Daily/24 and generic K-factor GEH remain legacy diagnostics and do not enter this scientific outcome.",
    ]
    scenario = basis.get("scenario")
    if isinstance(scenario, Mapping) and scenario.get("role") != "baseline":
        reasons.append("Build-run counts cannot establish change or forecast validity against base-year observations.")
    return {
        "schema": ASSESSMENT_SCHEMA,
        "assessment_id": assessment_id,
        "rules_version": VALIDATION_RULES_VERSION,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "exact_inputs": {
            "observation_sha256": [validation_input_bundle_sha256],
            "comparison_basis_sha256": sha256_payload(basis),
            "model_output_artifact_id": model_artifact["artifact_id"],
            "model_output_sha256": model_artifact["sha256"],
        },
        "planning_use": basis["planning_use"],
        "partition": {"kind": "unpartitioned", "id": UNKNOWN},
        "comparability_findings": UNKNOWN,
        "observation_results": summary.get("results", []),
        "metrics": {
            "decisive": UNKNOWN,
            "diagnostic_grade_c": UNKNOWN,
            "all_computed": {"legacy_point_count_metrics": dict(summary)},
        },
        "coverage": summary.get("coverage", UNKNOWN),
        "scientific_outcome": "inconclusive",
        "reasons": reasons,
        "legacy_point_count_diagnostic": False,
        "validation_evidence_write": "pending",
    }
