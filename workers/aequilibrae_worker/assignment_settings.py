#!/usr/bin/env python3
"""One assignment method and one defensible equilibrium profile for the worker.

This module is deliberately stdlib-only.  The worker container is its own
deployment unit, and tests must be able to inspect the method without importing
AequilibraE or constructing a network.

The target and ceiling are measured settings, not runtime preferences.  On
2026-08-16, assigning effectively identical demand twice at a relative gap near
0.009 moved 21% of busy individual links by more than 10%.  At a gap of 0.00046,
no busy link crossed GEH 10.  Every worker assignment therefore aims for 0.0005
and allows at least 3,000 iterations.  An operator may ask for a tighter target
or a higher ceiling, but may not trade the measured accuracy back away.
The core count is also recorded because parallel execution is part of the exact
method that must survive a handoff between worker instances.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from collections.abc import Mapping, Sequence
from importlib import metadata as importlib_metadata
from typing import Any, Callable


PROFILE_SCHEMA_VERSION = "openplan.assignment-profile.v1"
PROFILE_ID = "aequilibrae-bfw-bpr-tight-v1"
ENGINE_NAME = "aequilibrae"

DEFENSIBLE_TARGET_GAP = 0.0005
DEFENSIBLE_MAX_ITERATIONS = 3000

TARGET_GAP_ENV = "OPENPLAN_ASSIGNMENT_RGAP_TARGET"
MAX_ITERATIONS_ENV = "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS"
CORES_ENV = "AEQ_CORES"

_FIXED_PROFILE = {
    "schema_version": PROFILE_SCHEMA_VERSION,
    "profile_id": PROFILE_ID,
    "engine": ENGINE_NAME,
    "algorithm": "bfw",
    "vdf": "BPR",
    "vdf_parameters": {"alpha": 0.15, "beta": 4},
    "capacity_field": "capacity",
    "time_field": "travel_time",
    "class_pce": 1,
}
_PROFILE_KEYS = frozenset(
    {*_FIXED_PROFILE, "engine_version", "target_gap", "max_iterations", "cores"}
)


class AssignmentSettingsError(ValueError):
    """An assignment profile is absent, invalid, loosened, or inconsistent."""


def installed_assignment_engine_version() -> str | None:
    """Read the engine version from the environment that will execute it."""
    try:
        version = importlib_metadata.version(ENGINE_NAME).strip()
    except importlib_metadata.PackageNotFoundError:
        return None
    return version or None


def _require_local_assignment_engine(profile: Mapping[str, Any]) -> None:
    local_version = installed_assignment_engine_version()
    if local_version is None:
        raise AssignmentSettingsError(
            "Cannot construct an assignment because the installed AequilibraE version is unknown"
        )
    if profile.get("engine") != ENGINE_NAME or profile.get("engine_version") != local_version:
        raise AssignmentSettingsError(
            "Refusing assignment profile for "
            f"{profile.get('engine')} {profile.get('engine_version')}; this worker has "
            f"{ENGINE_NAME} {local_version}"
        )


def _configured_target_gap(env: Mapping[str, str]) -> float:
    raw = str(env.get(TARGET_GAP_ENV) or "").strip()
    if not raw:
        return DEFENSIBLE_TARGET_GAP
    try:
        value = float(raw)
    except ValueError as error:
        raise AssignmentSettingsError(f"{TARGET_GAP_ENV} must be a number") from error
    if not math.isfinite(value) or value <= 0:
        raise AssignmentSettingsError(f"{TARGET_GAP_ENV} must be finite and greater than zero")
    if value > DEFENSIBLE_TARGET_GAP:
        raise AssignmentSettingsError(
            f"Refusing {TARGET_GAP_ENV}={value}: production assignments may tighten the "
            f"measured {DEFENSIBLE_TARGET_GAP} target, not loosen it"
        )
    return value


def _configured_max_iterations(env: Mapping[str, str]) -> int:
    raw = str(env.get(MAX_ITERATIONS_ENV) or "").strip()
    if not raw:
        return DEFENSIBLE_MAX_ITERATIONS
    try:
        value = int(raw)
    except ValueError as error:
        raise AssignmentSettingsError(f"{MAX_ITERATIONS_ENV} must be an integer") from error
    if value < DEFENSIBLE_MAX_ITERATIONS:
        raise AssignmentSettingsError(
            f"Refusing {MAX_ITERATIONS_ENV}={value}: production assignments may raise the "
            f"measured {DEFENSIBLE_MAX_ITERATIONS}-iteration ceiling, not lower it"
        )
    return value


def _configured_cores(env: Mapping[str, str]) -> int:
    raw = str(env.get(CORES_ENV) or "").strip()
    if not raw:
        return 1
    try:
        value = int(raw)
    except ValueError as error:
        raise AssignmentSettingsError(f"{CORES_ENV} must be an integer") from error
    if value < 1:
        raise AssignmentSettingsError(f"{CORES_ENV} must be at least one")
    return value


def canonical_assignment_profile(profile: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and normalize a profile received from persisted run state.

    Exact keys make the digest a complete method contract.  A future method
    change must bump the profile rather than riding through as an ignored field.
    """
    if not isinstance(profile, Mapping):
        raise AssignmentSettingsError("Assignment profile is missing")
    keys = frozenset(profile)
    if keys != _PROFILE_KEYS:
        missing = sorted(_PROFILE_KEYS - keys)
        extra = sorted(keys - _PROFILE_KEYS)
        raise AssignmentSettingsError(
            f"Assignment profile fields do not match {PROFILE_SCHEMA_VERSION}; "
            f"missing={missing}, extra={extra}"
        )

    canonical = {
        **_FIXED_PROFILE,
        "vdf_parameters": dict(_FIXED_PROFILE["vdf_parameters"]),
        "engine_version": profile.get("engine_version"),
        "target_gap": profile.get("target_gap"),
        "max_iterations": profile.get("max_iterations"),
        "cores": profile.get("cores"),
    }
    for key, expected in _FIXED_PROFILE.items():
        if key == "class_pce" and isinstance(profile.get(key), bool):
            raise AssignmentSettingsError("Assignment profile class_pce must be numeric, not boolean")
        if profile.get(key) != expected:
            raise AssignmentSettingsError(
                f"Assignment profile {key}={profile.get(key)!r} does not match {expected!r}"
            )
    raw_vdf_parameters = profile.get("vdf_parameters")
    if not isinstance(raw_vdf_parameters, Mapping):
        raise AssignmentSettingsError("Assignment profile vdf_parameters must be an object")
    if any(isinstance(raw_vdf_parameters.get(key), bool) for key in ("alpha", "beta")):
        raise AssignmentSettingsError(
            "Assignment profile VDF parameters must be numeric, not boolean"
        )

    engine_version = canonical["engine_version"]
    if (
        not isinstance(engine_version, str)
        or not engine_version.strip()
        or engine_version.strip().lower() == "unknown"
    ):
        raise AssignmentSettingsError(
            "Assignment profile engine_version must name the exact installed version"
        )
    canonical["engine_version"] = engine_version.strip()

    target_gap = canonical["target_gap"]
    if isinstance(target_gap, bool) or not isinstance(target_gap, (int, float)):
        raise AssignmentSettingsError("Assignment profile target_gap must be numeric")
    target_gap = float(target_gap)
    if not math.isfinite(target_gap) or target_gap <= 0:
        raise AssignmentSettingsError("Assignment profile target_gap must be finite and positive")
    if target_gap > DEFENSIBLE_TARGET_GAP:
        raise AssignmentSettingsError(
            f"Assignment profile target_gap {target_gap} loosens the measured "
            f"{DEFENSIBLE_TARGET_GAP} target"
        )

    max_iterations = canonical["max_iterations"]
    if isinstance(max_iterations, bool) or not isinstance(max_iterations, int):
        raise AssignmentSettingsError("Assignment profile max_iterations must be an integer")
    if max_iterations < DEFENSIBLE_MAX_ITERATIONS:
        raise AssignmentSettingsError(
            f"Assignment profile max_iterations {max_iterations} lowers the measured "
            f"{DEFENSIBLE_MAX_ITERATIONS}-iteration ceiling"
        )

    cores = canonical["cores"]
    if isinstance(cores, bool) or not isinstance(cores, int) or cores < 1:
        raise AssignmentSettingsError("Assignment profile cores must be an integer of at least one")

    canonical["target_gap"] = target_gap
    canonical["max_iterations"] = int(max_iterations)
    canonical["cores"] = int(cores)
    return canonical


def resolve_assignment_profile(
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Resolve the production profile, accepting only accuracy-tightening overrides."""
    source = os.environ if env is None else env
    engine_version = installed_assignment_engine_version()
    if engine_version is None:
        raise AssignmentSettingsError(
            "Cannot resolve an assignment profile because the installed AequilibraE version is unknown"
        )
    return canonical_assignment_profile(
        {
            **_FIXED_PROFILE,
            "vdf_parameters": dict(_FIXED_PROFILE["vdf_parameters"]),
            "engine_version": engine_version,
            "target_gap": _configured_target_gap(source),
            "max_iterations": _configured_max_iterations(source),
            "cores": _configured_cores(source),
        }
    )


def assignment_profile_payload_json(profile: Mapping[str, Any]) -> str:
    """The authoritative UTF-8 JSON payload for an assignment profile."""
    canonical = canonical_assignment_profile(profile)
    return json.dumps(
        canonical,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=False,
    )


def assignment_profile_digest(
    profile: Mapping[str, Any],
    payload_json: str | None = None,
) -> str:
    """Full SHA-256 of the exact canonical profile payload bytes."""
    expected_payload = assignment_profile_payload_json(profile)
    payload = expected_payload if payload_json is None else payload_json
    if payload != expected_payload:
        raise AssignmentSettingsError(
            "Assignment profile payload is not the canonical JSON for its profile object"
        )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validated_assignment_profile(
    profile: Mapping[str, Any] | None,
    payload_json: str | None,
    digest: str | None,
    context: str,
) -> tuple[dict[str, Any], str, str]:
    """Validate all three representations at a profile trust boundary."""
    canonical = canonical_assignment_profile(profile)
    expected_payload = assignment_profile_payload_json(canonical)
    if not isinstance(payload_json, str) or payload_json != expected_payload:
        raise AssignmentSettingsError(
            f"{context} assignment-profile payload is absent or noncanonical"
        )
    try:
        parsed_payload = json.loads(payload_json)
    except json.JSONDecodeError as error:
        raise AssignmentSettingsError(
            f"{context} assignment-profile payload is not valid JSON"
        ) from error
    if parsed_payload != canonical:
        raise AssignmentSettingsError(
            f"{context} assignment-profile payload does not equal its profile object"
        )
    expected_digest = assignment_profile_digest(canonical, payload_json)
    if digest != expected_digest:
        raise AssignmentSettingsError(
            f"{context} assignment-profile digest mismatch: expected {expected_digest}, got {digest}"
        )
    return canonical, payload_json, expected_digest


def build_traffic_assignment(
    traffic_assignment_factory: Callable[[], Any],
    traffic_classes: Sequence[Any],
    *,
    profile: Mapping[str, Any],
) -> Any:
    """Construct and configure every worker TrafficAssignment in one place."""
    settings = canonical_assignment_profile(profile)
    _require_local_assignment_engine(settings)
    assignment = traffic_assignment_factory()
    for traffic_class in traffic_classes:
        traffic_class.set_pce(settings["class_pce"])
        assignment.add_class(traffic_class)
    assignment.set_cores(settings["cores"])
    if getattr(assignment, "cores", None) != settings["cores"]:
        raise AssignmentSettingsError(
            "AequilibraE did not retain the requested core count: "
            f"requested {settings['cores']}, effective {getattr(assignment, 'cores', None)!r}"
        )
    assignment.set_vdf(settings["vdf"])
    assignment.set_vdf_parameters(dict(settings["vdf_parameters"]))
    assignment.set_capacity_field(settings["capacity_field"])
    assignment.set_time_field(settings["time_field"])
    assignment.max_iter = settings["max_iterations"]
    assignment.rgap_target = settings["target_gap"]
    assignment.set_algorithm(settings["algorithm"])
    return assignment


def assignment_iteration_count(assignment_state: Any) -> int | None:
    """Read the engine's actual iteration counter across supported releases."""
    for attribute in ("iter", "iteration"):
        value = getattr(assignment_state, attribute, None)
        if isinstance(value, bool) or value is None:
            continue
        try:
            count = int(value)
        except (TypeError, ValueError, OverflowError):
            continue
        if count >= 0:
            return count
    return None


def assignment_convergence_record(
    final_gap: Any,
    iterations: Any,
    profile: Mapping[str, Any],
) -> dict[str, Any]:
    """Persist the result and the complete method that produced it."""
    settings = canonical_assignment_profile(profile)
    try:
        gap = float(final_gap) if not isinstance(final_gap, bool) else float("nan")
    except (TypeError, ValueError, OverflowError):
        gap = float("nan")
    finite_gap = gap if math.isfinite(gap) and gap >= 0 else None
    try:
        iteration_count = int(iterations)
    except (TypeError, ValueError, OverflowError):
        iteration_count = None
    if isinstance(iterations, bool) or (iteration_count is not None and iteration_count < 0):
        iteration_count = None
    profile_payload = assignment_profile_payload_json(settings)
    return {
        "final_gap": finite_gap,
        "iterations": iteration_count,
        "target_gap": settings["target_gap"],
        "max_iterations": settings["max_iterations"],
        "algorithm": settings["algorithm"],
        "converged": bool(finite_gap is not None and finite_gap <= settings["target_gap"]),
        "assignment_profile": settings,
        "assignment_profile_payload_json": profile_payload,
        "assignment_profile_digest": assignment_profile_digest(settings, profile_payload),
    }


def validated_convergence_profile(
    convergence_record: Mapping[str, Any] | None,
    context: str,
) -> tuple[dict[str, Any], str, str]:
    """Read a profile from a convergence record and verify its recorded digest."""
    if not isinstance(convergence_record, Mapping):
        raise AssignmentSettingsError(f"{context} has no convergence record")
    profile, payload, digest = validated_assignment_profile(
        convergence_record.get("assignment_profile"),
        convergence_record.get("assignment_profile_payload_json"),
        convergence_record.get("assignment_profile_digest"),
        context,
    )
    if convergence_record.get("target_gap") != profile["target_gap"]:
        raise AssignmentSettingsError(f"{context} target gap does not match its assignment profile")
    if convergence_record.get("max_iterations") != profile["max_iterations"]:
        raise AssignmentSettingsError(
            f"{context} iteration ceiling does not match its assignment profile"
        )
    if convergence_record.get("algorithm") != profile["algorithm"]:
        raise AssignmentSettingsError(f"{context} algorithm does not match its assignment profile")
    return profile, payload, digest


def canonical_convergence_record(
    convergence_record: Mapping[str, Any] | None,
    context: str,
) -> dict[str, Any]:
    """Validate the complete convergence record before it crosses an artifact boundary."""
    profile, payload, digest = validated_convergence_profile(convergence_record, context)
    assert convergence_record is not None
    final_gap = convergence_record.get("final_gap")
    if final_gap is not None:
        if (
            isinstance(final_gap, bool)
            or not isinstance(final_gap, (int, float))
            or not math.isfinite(float(final_gap))
            or float(final_gap) < 0
        ):
            raise AssignmentSettingsError(f"{context} final gap is not a valid nonnegative number")
        final_gap = float(final_gap)
    iterations = convergence_record.get("iterations")
    if iterations is not None and (
        isinstance(iterations, bool)
        or not isinstance(iterations, int)
        or iterations < 0
    ):
        raise AssignmentSettingsError(f"{context} iteration count is not a nonnegative integer")
    converged = bool(final_gap is not None and final_gap <= profile["target_gap"])
    if convergence_record.get("converged") is not converged:
        raise AssignmentSettingsError(f"{context} converged flag does not match its final gap")
    return {
        "final_gap": final_gap,
        "iterations": iterations,
        "target_gap": profile["target_gap"],
        "max_iterations": profile["max_iterations"],
        "algorithm": profile["algorithm"],
        "converged": converged,
        "assignment_profile": profile,
        "assignment_profile_payload_json": payload,
        "assignment_profile_digest": digest,
    }


def require_matching_assignment_profiles(
    first_record: Mapping[str, Any] | None,
    second_record: Mapping[str, Any] | None,
    context: str,
) -> tuple[dict[str, Any], str, str]:
    """Refuse a comparison unless both assignments prove one exact method."""
    first_profile, first_payload, first_digest = validated_convergence_profile(
        first_record, f"{context} first side"
    )
    _, second_payload, second_digest = validated_convergence_profile(
        second_record, f"{context} second side"
    )
    if first_payload != second_payload or first_digest != second_digest:
        raise AssignmentSettingsError(
            f"{context} assignments used different profiles: {first_digest} != {second_digest}"
        )
    return first_profile, first_payload, first_digest
