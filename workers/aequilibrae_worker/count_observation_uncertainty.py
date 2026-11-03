"""Opt-in AADT observation intervals. No universal percentage or grade promotion.

Evidence bytes are a reviewed, source-transcribed calibration record, not a
model output. Callers freeze those bytes with their new study inputs. This
module verifies bindings and arithmetic; it cannot authenticate a publisher or
establish that a research distribution transfers to a new station.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from datetime import datetime
from typing import Any, Mapping

SCHEMA = "openplan.count-observation-uncertainty.v1"
EVIDENCE_SCHEMA = "openplan.count-interval-evidence.v1"
PUBLISHED = "source-published-aadt-bounds.v1"
QUANTILES = "source-calibrated-aadt-relative-error-quantiles.v1"
COUNT_TYPES = {"continuous", "short_duration", "estimated", "modeled"}
DIMENSIONS = (
    "year", "day_basis", "period", "direction", "lane", "carriageway",
    "vehicle_unit", "vehicle_class",
)
UNKNOWN = "unknown"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _object(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _known(value: Any) -> bool:
    return value is not None and value != UNKNOWN and value != "" and value != [] and value != {}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def observation_dimensions(observation: Mapping[str, Any]) -> dict[str, Any]:
    """Read explicit facts. Published AADT text is not a vehicle-class code."""
    time = _object(observation.get("time_basis"))
    direction = _object(observation.get("direction_lane_carriageway"))
    vehicle = _object(observation.get("vehicle_basis"))
    return {
        "year": time.get("year", UNKNOWN),
        "day_basis": time.get("day_basis", UNKNOWN),
        "period": time.get("observation_period", time.get("period", UNKNOWN)),
        "direction": direction.get("direction", UNKNOWN),
        "lane": direction.get("lane", UNKNOWN),
        "carriageway": direction.get("carriageway", UNKNOWN),
        "vehicle_unit": vehicle.get("unit", UNKNOWN),
        "vehicle_class": vehicle.get("vehicle_class", UNKNOWN),
    }


def attach_observation_interval(
    observation: Mapping[str, Any], evidence_bytes: bytes | None = None,
) -> dict[str, Any]:
    """Return a copy with an annotation; leave center, bounds and grade intact.

The source evidence must name this exact observation, all quantity dimensions,
and the count process. Percentile errors use (estimate - reference)/reference.
Inverting their endpoints gives reference bounds; multiplying the point by
1 +/- a percentage would use a different denominator.
"""
    result = copy.deepcopy(dict(observation))
    result.pop("observation_uncertainty", None)
    observation_sha256 = digest(result)
    measurement = _object(result.get("measurement"))
    duration = _object(measurement.get("duration"))
    count_type = measurement.get("count_type")
    dimensions = observation_dimensions(result)
    center = _number(_object(result.get("estimate")).get("center"))
    source_sha = _object(result.get("source")).get("artifact_sha256")
    reasons: list[str] = []

    def refuse(condition: bool, reason: str) -> None:
        if not condition:
            reasons.append(reason)

    refuse(count_type in COUNT_TYPES, "count_type_unavailable")
    refuse(center is not None and center >= 0, "invalid_center")
    refuse(_hash(source_sha), "source_hash_unavailable")
    refuse(type(dimensions["year"]) is int and 1900 <= dimensions["year"] <= 2200,
           "year_unavailable")
    refuse(dimensions["day_basis"] == "annual_average_daily_traffic", "not_annual_aadt")
    refuse(dimensions["period"] == "daily" or dimensions["period"] == {"label": "daily", "hours": list(range(24))},
           "period_unavailable")
    for field in ("direction", "lane", "carriageway", "vehicle_class"):
        refuse(_known(dimensions[field]), f"{field}_unavailable")
    refuse(dimensions["vehicle_unit"] == "vehicles", "not_vehicle_counts")
    refuse(_object(result.get("qa")).get("status") == "accepted", "qa_unavailable")
    if count_type in {"continuous", "short_duration"}:
        hours = _number(duration.get("complete_hours"))
        refuse(hours is not None and hours > 0, "duration_unavailable")
        refuse(_known(duration.get("start")) and _known(duration.get("end")), "count_dates_unavailable")
        try:
            start = datetime.fromisoformat(str(duration.get("start")).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(duration.get("end")).replace("Z", "+00:00"))
            span = (end - start).total_seconds() / 3600
            refuse(hours is not None and 0 < hours <= span, "duration_dates_invalid")
            refuse(start.year == dimensions["year"] and (end.year == start.year or
                   (end.month, end.day, end.hour, end.minute, end.second) == (1, 1, 0, 0, 0)
                   and end.year == start.year + 1), "count_year_mismatch")
        except (TypeError, ValueError, OverflowError):
            reasons.append("duration_dates_invalid")
    if count_type == "continuous":
        refuse(_known(measurement.get("missing_data_method")), "missing_data_method_unavailable")
    if count_type == "short_duration":
        factors = _object(measurement.get("factors"))
        refuse(all(_known(factors.get(k)) for k in ("method", "group_id", "seasonal", "day_of_week", "axle")),
               "factor_metadata_unavailable")
    if count_type in {"estimated", "modeled"}:
        refuse(_known(measurement.get("estimation_method")), "estimation_method_unavailable")

    evidence: Mapping[str, Any] = {}
    evidence_sha = None
    if evidence_bytes is None:
        reasons.append("interval_evidence_unavailable")
    else:
        evidence_sha = hashlib.sha256(evidence_bytes).hexdigest()
        try:
            evidence = _object(json.loads(evidence_bytes))
        except (ValueError, UnicodeError):
            reasons.append("interval_evidence_invalid_json")
        refuse(evidence.get("schema") == EVIDENCE_SCHEMA, "interval_evidence_schema")
        refuse(evidence.get("observation_sha256") == observation_sha256, "observation_binding_mismatch")
        refuse(evidence.get("source_artifact_sha256") == source_sha and _hash(source_sha), "source_binding_mismatch")
        refuse(evidence.get("dimensions") == dimensions, "evidence_dimensions_mismatch")
        refuse(evidence.get("measurement") == measurement, "evidence_process_mismatch")
        citation = _object(evidence.get("citation"))
        refuse(all(isinstance(citation.get(k), str) and bool(citation[k].strip()) and "[VERIFY" not in citation[k]
                   for k in ("id", "url", "locator", "title"))
               and str(citation.get("url", "")).startswith("https://"), "citation_unverified")
        refuse(evidence.get("review_status") == "source_verified", "evidence_not_verified")
        refuse(evidence.get("interval_scope") == "station_aadt", "not_station_interval")
        refuse(_number(evidence.get("coverage_probability")) == 0.95, "unsupported_coverage")
        refuse(evidence.get("applicability") == "same_station_or_validated_factor_group", "applicability_unproved")
        refuse(evidence.get("independent_of_evaluated_model") is True, "dependent_evidence")
        refuse(bool(evidence.get("error_components")) and isinstance(evidence.get("error_components"), list),
               "error_components_unavailable")

    lower = upper = None
    model_id = evidence.get("error_model_id")
    if evidence_bytes is not None:
        if model_id == PUBLISHED:
            bounds = _object(evidence.get("bounds"))
            lower, upper = _number(bounds.get("lower")), _number(bounds.get("upper"))
            refuse(lower is not None and upper is not None and center is not None
                   and 0 <= lower <= center <= upper, "invalid_bounds")
        elif model_id == QUANTILES:
            refuse(count_type == "short_duration", "quantiles_require_short_duration")
            errors = _object(evidence.get("relative_error_quantiles"))
            low_error, high_error = _number(errors.get("p025")), _number(errors.get("p975"))
            valid = (low_error is not None and high_error is not None and -1 < low_error <= 0 <= high_error)
            refuse(valid, "invalid_error_quantiles")
            refuse(evidence.get("error_definition") == "(estimate-reference)/reference", "error_definition_mismatch")
            calibration = _object(evidence.get("calibration"))
            refuse(_hash(calibration.get("artifact_sha256")) and _known(calibration.get("sampling_design"))
                   and _known(calibration.get("factor_assignment_method"))
                   and calibration.get("count_duration_hours") == duration.get("complete_hours")
                   and calibration.get("factor_group_id") == _object(measurement.get("factors")).get("group_id")
                   and calibration.get("factor_assignment_method") == _object(measurement.get("factors")).get("method"),
                   "calibration_scope_mismatch")
            if valid and center is not None:
                lower, upper = center / (1 + high_error), center / (1 + low_error)
                refuse(math.isfinite(lower) and math.isfinite(upper), "computed_bounds_invalid")
        else:
            reasons.append("unsupported_error_model")

    available = not reasons
    result["observation_uncertainty"] = {
        "schema": SCHEMA,
        "status": "available" if available else "unavailable",
        "reason": reasons[0] if reasons else None,
        "reasons": reasons,
        "observation_sha256": observation_sha256,
        "source_artifact_sha256": source_sha,
        "evidence_sha256": evidence_sha,
        "error_model_id": model_id,
        "citation_id": _object(evidence.get("citation")).get("id"),
        "citation": dict(_object(evidence.get("citation"))),
        "coverage_probability": 0.95 if available else None,
        "bounds": {"lower": lower, "upper": upper} if available else None,
        "error_components": evidence.get("error_components", []),
        "claim": "observation_interval_only_no_grade_or_acceptance_promotion",
    }
    return result


def uncertainty_residual(
    observation: Mapping[str, Any], modeled_value: float,
    comparison: Mapping[str, Any], *, evidence_bytes: bytes | None = None,
) -> dict[str, Any]:
    """Recompute custody from evidence and refuse any unproved unit alignment."""
    annotated = attach_observation_interval(observation, evidence_bytes)
    interval = annotated["observation_uncertainty"]
    dimensions = observation_dimensions(observation)
    reasons = list(interval["reasons"])
    for field in DIMENSIONS:
        if not _known(dimensions[field]) or dimensions[field] != comparison.get(field):
            reasons.append(f"alignment_{field}")
    modeled = _number(modeled_value)
    if modeled is None or modeled < 0:
        reasons.append("invalid_modeled_value")
    center = _number(_object(observation.get("estimate")).get("center"))
    signed = modeled - center if modeled is not None and center is not None else None
    excess = None
    if not reasons:
        bounds = interval["bounds"]
        excess = max(bounds["lower"] - modeled, 0.0, modeled - bounds["upper"])
    return {
        "status": "available" if not reasons else "unavailable",
        "reasons": reasons, "interval": interval,
        "raw_signed_residual": signed,
        "raw_absolute_percent_error": abs(signed) / center * 100 if signed is not None and center and center > 0 else None,
        "interval_excess_error": excess,
        "interval_excess_percent_error": excess / center * 100 if excess is not None and center and center > 0 else None,
        "inside_interval": excess == 0 if excess is not None else None,
    }
