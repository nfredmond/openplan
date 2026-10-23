"""Opt-in development conditioning of terminating cordon demand.

Network time changes the joint distribution, never its marginal trip totals.
This is a hypothesis about demand, not measured behavior or a production default.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

import numpy as np

SETTING_ENV = "OPENPLAN_EXTERNAL_DISTRIBUTION"
CANDIDATE = "cordon_impedance_v1"
TOLERANCE = 1e-7
MAX_ITERATIONS = 10_000


class ExternalDistributionRefused(ValueError):
    """The experimental distribution cannot preserve its declared inputs."""


def array_sha256(value: np.ndarray) -> str:
    """Bind shape, dtype and ordered bytes, including unreachable skim values."""
    value = np.ascontiguousarray(value)
    header = f"{value.dtype.str}:{value.shape}:".encode()
    return hashlib.sha256(header + value.tobytes()).hexdigest()


def resolve_setting(value: str | None = None) -> str:
    setting = os.environ.get(SETTING_ENV, "default") if value is None else value
    if setting not in ("default", CANDIDATE):
        raise ExternalDistributionRefused("Unknown external distribution setting")
    return setting


def _balance(base: np.ndarray, times: np.ndarray) -> tuple[np.ndarray, int]:
    rows, columns = base.sum(axis=1), base.sum(axis=0)
    candidate = base / np.maximum(times, 1.0)
    tolerance = TOLERANCE * max(1.0, float(rows.max(initial=0)), float(columns.max(initial=0)))
    for iteration in range(1, MAX_ITERATIONS + 1):
        totals = candidate.sum(axis=1)
        candidate *= np.divide(rows, totals, out=np.ones_like(rows), where=totals > 0)[:, None]
        totals = candidate.sum(axis=0)
        candidate *= np.divide(columns, totals, out=np.ones_like(columns), where=totals > 0)[None, :]
        error = max(float(np.abs(candidate.sum(axis=1) - rows).max(initial=0)),
                    float(np.abs(candidate.sum(axis=0) - columns).max(initial=0)))
        if error <= tolerance:
            return candidate, iteration
    raise ExternalDistributionRefused("External distribution did not converge")


def validate_candidate(base: np.ndarray, candidate: np.ndarray, mutable: np.ndarray) -> None:
    """Check independent accounting after fitting, before any assignment."""
    if candidate.shape != base.shape or not np.isfinite(candidate).all() or (candidate < 0).any():
        raise ExternalDistributionRefused("Candidate demand is invalid")
    if candidate[~mutable].tobytes() != base[~mutable].tobytes():
        raise ExternalDistributionRefused("Candidate changed a held-fixed cell")
    if not np.array_equal(candidate > 0, base > 0):
        raise ExternalDistributionRefused("Candidate changed demand support")
    tolerance = TOLERANCE * max(1.0, float(base.sum(axis=0).max(initial=0)),
                                float(base.sum(axis=1).max(initial=0)))
    if (np.abs(candidate.sum(axis=0) - base.sum(axis=0)).max(initial=0) > tolerance
            or np.abs(candidate.sum(axis=1) - base.sum(axis=1)).max(initial=0) > tolerance):
        raise ExternalDistributionRefused("Candidate changed demand marginals")


def condition_external_demand(
    matrix: np.ndarray,
    freeflow_minutes: np.ndarray,
    is_external: np.ndarray,
    *,
    setting: str | None = None,
) -> tuple[np.ndarray, dict[str, Any] | None]:
    """Return the original object by default, or a conserved experimental copy.

The mask and skim must use the matrix's ordered zone system. Callers record
that order and the network source alongside the exact numerical input hashes.
"""
    selected = resolve_setting(setting)
    if selected == "default":
        return matrix, None
    base = np.asarray(matrix)
    times = np.asarray(freeflow_minutes)
    mask = np.asarray(is_external)
    if (base.ndim != 2 or base.shape[0] != base.shape[1] or times.shape != base.shape
            or mask.shape != (base.shape[0],) or mask.dtype != np.dtype(bool)):
        raise ExternalDistributionRefused("External distribution dimensions or mask are invalid")
    if base.dtype != np.dtype("float64") or not np.isfinite(base).all() or (base < 0).any():
        raise ExternalDistributionRefused("Baseline demand must be finite nonnegative float64")
    if np.isnan(times).any() or (times < 0).any():
        raise ExternalDistributionRefused("Skim has NaN or negative travel time")
    cross = mask[:, None] != mask[None, :]
    reachable = np.isfinite(times) & (times > 0)
    mutable = cross & reachable
    candidate = base.copy()
    iterations = []
    for origin_external in (True, False):
        origin = np.flatnonzero(mask == origin_external)
        destination = np.flatnonzero(mask != origin_external)
        ix = np.ix_(origin, destination)
        block, block_times = base[ix], times[ix]
        allowed = reachable[ix]
        active = np.where(allowed, block, 0.0)
        fitted, count = _balance(active, np.where(allowed, block_times, 1.0))
        candidate[ix] = np.where(allowed, fitted, block)
        iterations.append(count)
    validate_candidate(base, candidate, mutable)
    return candidate, {
        "setting": selected,
        "evidence_tier": "development_only",
        "algorithm": "baseline_seed_divided_by_max_minutes_1_then_ipf_v1",
        "algorithm_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "settings": {"time_floor_minutes": 1.0, "inverse_time_exponent": 1,
                     "marginal_relative_tolerance": TOLERANCE, "max_iterations": MAX_ITERATIONS},
        "source": {"kind": "retained_network_freeflow_skim", "units": "minutes",
                   "behavior_estimation": "none", "skim_sha256": array_sha256(times)},
        "input_sha256": array_sha256(base),
        "output_sha256": array_sha256(candidate),
        "external_mask_sha256": array_sha256(mask),
        "iterations": iterations,
        "input_trips": float(base.sum()), "output_trips": float(candidate.sum()),
        "max_row_error": float(np.abs(candidate.sum(axis=1) - base.sum(axis=1)).max(initial=0)),
        "max_column_error": float(np.abs(candidate.sum(axis=0) - base.sum(axis=0)).max(initial=0)),
        "positive_cells_before": int((base > 0).sum()),
        "positive_cells_after": int((candidate > 0).sum()),
        "changed_cells": int((candidate != base).sum()),
        "unreachable_cross_cells": int((cross & ~reachable & (base > 0)).sum()),
        "unreachable_cross_trips_retained": float(base[cross & ~reachable].sum()),
        "defaults_changed": False,
    }
