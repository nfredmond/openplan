#!/usr/bin/env python3
"""Screening-grade mode choice for the AequilibraE worker.

Splits the daily person-trip OD into AUTO vs ACTIVE (walk+bike) with a binary
logit, so only auto trips are assigned to the road network. This is a
deliberate, honest subset of a full mode-choice model:

  * TRANSIT IS NOT MODELED HERE. The worker produces only auto travel-time
    skims; there are no transit skims until GTFS/transit LOS lands (roadmap
    F.3). The upstream sketch ABM only "supports" transit by fabricating its
    LOS (transit_ivtt = auto_time×1.5, flat wait/fare) and then treats transit
    as available at every OD pair beyond ~1 km — including rural cells with no
    service. Rather than emit a fabricated transit share, F.2 reports transit
    share as a hard 0.0 with a "not modeled until F.3" caveat. Omitting transit
    can only UNDER-state non-auto travel (some real transit trips are counted
    as auto) — the safe error direction for a screening claim boundary. Real
    transit LOS slots into this same split in F.3.

  * The split is driven by REAL inputs the worker actually has: the congested
    auto travel-time skim (auto disutility) and centroid great-circle distance
    (walk/bike feasibility + active travel times at fixed planning speeds).
    Cost / income / auto-ownership / age / parking terms are DROPPED (not
    zero-imputed) because the worker has no per-OD sociodemographics. The auto
    ASC is also dropped (u_auto = coef_ivtt·time only): a binary auto vs active
    split conflates SOV+HOV whereas the sketch asc_auto_sov is SOV-only, so the
    small blended auto ASC (~-0.2) is omitted rather than misapplied. Net effect
    is a slight auto over-statement — conservative for a CEQA VMT screen.

Coefficients are a trip-weighted blend of the per-purpose tables in
``openplan/src/lib/models/sketch-abm/mode-choice.ts`` (FreeChAMP lineage) — the
worker OD is an aggregate daily total with no purpose dimension, so the blend
is a single documented global constant. Keep this in step with that file; a
golden-value test pins the blend.

numpy is required (matrix ops); the coefficient blend is stdlib and unit-tested.
"""
from __future__ import annotations

import math
import os
from typing import Any

import numpy as np

# ── Per-purpose auto-vs-active coefficients, copied from mode-choice.ts
# MODE_COEFFS (the subset the binary auto/active logit uses). ──────────────
_PURPOSE_COEFFS: dict[str, dict[str, float]] = {
    "work":       {"asc_walk": -2.5, "asc_bike": -2.0, "coef_ivtt": -0.025, "coef_ovtt": -0.045, "coef_density_walk": 0.0003},
    "school":     {"asc_walk":  0.0, "asc_bike":  0.2, "coef_ivtt": -0.020, "coef_ovtt": -0.035, "coef_density_walk": 0.0004},
    "shopping":   {"asc_walk": -1.0, "asc_bike": -2.5, "coef_ivtt": -0.022, "coef_ovtt": -0.040, "coef_density_walk": 0.0005},
    "social":     {"asc_walk": -0.5, "asc_bike": -1.5, "coef_ivtt": -0.018, "coef_ovtt": -0.032, "coef_density_walk": 0.0004},
    "recreation": {"asc_walk": -0.8, "asc_bike": -0.5, "coef_ivtt": -0.020, "coef_ovtt": -0.035, "coef_density_walk": 0.0003},
    "dining":     {"asc_walk":  0.5, "asc_bike": -1.0, "coef_ivtt": -0.019, "coef_ovtt": -0.034, "coef_density_walk": 0.0006},
    "escort":     {"asc_walk": -1.5, "asc_bike": -4.0, "coef_ivtt": -0.023, "coef_ovtt": -0.042, "coef_density_walk": 0.0002},
    "personal":   {"asc_walk": -0.7, "asc_bike": -2.0, "coef_ivtt": -0.024, "coef_ovtt": -0.043, "coef_density_walk": 0.0003},
}

# Rough NHTS national daily trip-purpose shares (documented approximation; the
# worker OD has no purpose dimension). Sums to 1.0.
_PURPOSE_WEIGHTS: dict[str, float] = {
    "work": 0.19, "school": 0.05, "shopping": 0.20, "social": 0.08,
    "recreation": 0.08, "dining": 0.08, "escort": 0.12, "personal": 0.20,
}

_COEFF_KEYS = ("asc_walk", "asc_bike", "coef_ivtt", "coef_ovtt", "coef_density_walk")


def _blend_coeffs() -> dict[str, float]:
    total_w = sum(_PURPOSE_WEIGHTS.values())
    return {
        k: sum(_PURPOSE_WEIGHTS[p] * _PURPOSE_COEFFS[p][k] for p in _PURPOSE_COEFFS) / total_w
        for k in _COEFF_KEYS
    }


AGGREGATE_COEFFS: dict[str, float] = _blend_coeffs()

WALK_MPH = float(os.getenv("MODE_WALK_MPH", "3.0"))
BIKE_MPH = float(os.getenv("MODE_BIKE_MPH", "10.0"))
WALK_MAX_MIN = float(os.getenv("MODE_WALK_MAX_MIN", "45.0"))   # ~2.25 mi at 3 mph
BIKE_MAX_MILES = float(os.getenv("MODE_BIKE_MAX_MILES", "5.0"))
_DISTANCE_BANDS = ((0.0, 1.0), (1.0, 3.0), (3.0, 5.0), (5.0, math.inf))


def auto_share_matrix(
    time_skim_min: np.ndarray,
    dist_miles: np.ndarray,
    density_per_sqkm: np.ndarray | None = None,
    coeffs: dict[str, float] | None = None,
) -> np.ndarray:
    """Binary auto-vs-active logit → P(auto) per OD cell (n×n).

    `time_skim_min` is the congested auto travel time (minutes); non-finite
    (unreachable) cells resolve to auto (they are zeroed at assignment anyway).
    `density_per_sqkm` (destination column) is optional — omitted when zone
    areas are unavailable rather than fabricated.
    """
    c = coeffs or AGGREGATE_COEFFS
    n = time_skim_min.shape[0]

    u_auto = c["coef_ivtt"] * np.where(np.isfinite(time_skim_min), time_skim_min, 0.0)

    walk_min = dist_miles / WALK_MPH * 60.0
    bike_min = dist_miles / BIKE_MPH * 60.0
    dens_term = 0.0
    if density_per_sqkm is not None:
        dens_term = c["coef_density_walk"] * density_per_sqkm[np.newaxis, :]

    u_walk = c["asc_walk"] + c["coef_ovtt"] * walk_min + dens_term
    u_bike = c["asc_bike"] + c["coef_ivtt"] * (bike_min * 0.6) + dens_term
    # feasibility gates (from chooseTourMode)
    u_walk = np.where(walk_min < WALK_MAX_MIN, u_walk, -np.inf)
    u_bike = np.where(dist_miles < BIKE_MAX_MILES, u_bike, -np.inf)

    # active nest = logsumexp over feasible {walk, bike}; both infeasible → -inf.
    # The np.where masks make the result correct; errstate silences the
    # harmless (-inf − -inf) in the masked-out branch.
    m = np.maximum(u_walk, u_bike)
    feasible = np.isfinite(m)
    with np.errstate(invalid="ignore"):
        exp_walk = np.where(np.isfinite(u_walk) & feasible, np.exp(u_walk - m), 0.0)
        exp_bike = np.where(np.isfinite(u_bike) & feasible, np.exp(u_bike - m), 0.0)
    exp_sum = exp_walk + exp_bike
    u_active = np.where(feasible, m + np.log(np.where(exp_sum > 0, exp_sum, 1.0)), -np.inf)

    # binary logit; u_active = -inf → P_auto = 1
    with np.errstate(over="ignore"):
        p_auto = 1.0 / (1.0 + np.exp(u_active - u_auto))
    # Unreachable (non-finite skim) cells resolve to auto — they carry no
    # assignable demand anyway. Intrazonal trips ARE split by the logit (short
    # local trips are prime walk/bike candidates); they contribute ~0 network
    # VMT regardless (blocked centroid flows), so this only affects the mode
    # share and the auto-only resident-VMT figure — both more realistic for it.
    p_auto = np.where(np.isfinite(time_skim_min), p_auto, 1.0)
    p_auto = np.clip(p_auto, 0.0, 1.0)
    return p_auto


def split_matrix(
    od_person: np.ndarray,
    time_skim_min: np.ndarray,
    dist_miles: np.ndarray,
    density_per_sqkm: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    """Split a person-trip OD into (auto_float, auto_int, active_int, meta).

    `auto_float` (assigned to the network) is the exact P(auto)-weighted demand;
    `auto_int`/`active_int` are integer-conserving for the persisted CSV
    (`active_int = round(person) − auto_int`, so no rounding leak).
    """
    p_auto = auto_share_matrix(time_skim_min, dist_miles, density_per_sqkm)
    auto_float = od_person * p_auto
    person_int = np.round(od_person).astype(np.int64)
    auto_int = np.round(auto_float).astype(np.int64)
    auto_int = np.minimum(auto_int, person_int)          # never exceed the person trips
    active_int = np.maximum(person_int - auto_int, 0)

    total = float(od_person.sum())
    auto = float(auto_float.sum())
    active = max(total - auto, 0.0)

    # distance-band auto-share breakdown (auditability of the distance mechanism)
    bands = []
    for lo, hi in _DISTANCE_BANDS:
        mask = (dist_miles >= lo) & (dist_miles < hi)
        band_total = float(od_person[mask].sum())
        band_auto = float(auto_float[mask].sum())
        bands.append({
            "band_miles": f"{lo:g}-{'inf' if math.isinf(hi) else f'{hi:g}'}",
            "person_trips": round(band_total, 1),
            "auto_share_pct": round(100.0 * band_auto / band_total, 1) if band_total > 0 else None,
        })

    meta = {
        "auto_trips": int(auto_int.sum()),
        "active_trips": int(active_int.sum()),
        "auto_share": auto / total if total > 0 else 1.0,
        "distance_bands": bands,
        "walk_mph": WALK_MPH,
        "bike_mph": BIKE_MPH,
        "transit_modeled": False,
    }
    return auto_float, auto_int, active_int, meta


def aggregate_shares(total_person: float, auto_person: float) -> dict[str, float]:
    """Mode shares in PERCENTAGE POINTS (0-100). Transit is a hard 0.0."""
    if total_person <= 0:
        return {"auto": 100.0, "active": 0.0, "transit": 0.0}
    share_auto = 100.0 * auto_person / total_person
    return {
        "auto": round(share_auto, 2),
        "active": round(max(100.0 - share_auto, 0.0), 2),
        "transit": 0.0,
    }
