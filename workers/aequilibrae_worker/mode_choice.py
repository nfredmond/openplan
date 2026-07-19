#!/usr/bin/env python3
"""Screening-grade mode choice for the AequilibraE worker.

Splits the daily person-trip OD into AUTO / TRANSIT / ACTIVE (walk+bike) with a
3-way logit; only auto trips are assigned to the road network (transit and
active are split off — there is no transit network to assign to at screening
grade). This is a deliberate, honest subset of a full mode-choice model:

  * TRANSIT is modeled from REAL published GTFS schedules (roadmap F.3) via
    `gtfs_skim.py`: a headway-based LOS (access-walk + wait≈headway/2 +
    scheduled in-vehicle time + one optional transfer + egress-walk). Transit
    is available ONLY where a walk-access served stop exists at both ends and a
    direct-or-one-transfer scheduled itinerary runs on the modeled day; where it
    does not, transit utility is −inf and the share is exactly 0. This is the
    honest replacement for the sketch ABM's fabricated "transit everywhere"
    (transit_ivtt = auto_time×1.5, available at every pair) — it can only ADD
    honest non-auto travel, and is 0 by construction outside the served area.
    With no feed loaded it degrades to the auto/active split (transit 0).

  * The split is driven by REAL inputs the worker actually has: the congested
    auto travel-time skim (auto disutility) and centroid great-circle distance
    (walk/bike feasibility + active travel times at fixed planning speeds).
    Income / auto-ownership / age / parking terms are DROPPED (not zero-imputed)
    because the worker has no per-OD sociodemographics. Auto per-OD COST is also
    dropped, while TRANSIT FARE (coef_cost) is kept — this asymmetry slightly
    under-states transit, a conservative screening choice. The auto ASC is
    dropped too (u_auto = coef_ivtt·time only): the binary/3-way split conflates
    SOV+HOV whereas the sketch asc_auto_sov is SOV-only, so the small blended
    auto ASC (~-0.2) is omitted rather than misapplied. Net effect is a slight
    auto over-statement — conservative for a CEQA VMT screen.

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
    "work":       {"asc_walk": -2.5, "asc_bike": -2.0, "asc_transit": -0.5, "coef_ivtt": -0.025, "coef_ovtt": -0.045, "coef_cost": -0.35, "coef_density_walk": 0.0003},
    "school":     {"asc_walk":  0.0, "asc_bike":  0.2, "asc_transit": -0.3, "coef_ivtt": -0.020, "coef_ovtt": -0.035, "coef_cost": -0.50, "coef_density_walk": 0.0004},
    "shopping":   {"asc_walk": -1.0, "asc_bike": -2.5, "asc_transit": -1.5, "coef_ivtt": -0.022, "coef_ovtt": -0.040, "coef_cost": -0.30, "coef_density_walk": 0.0005},
    "social":     {"asc_walk": -0.5, "asc_bike": -1.5, "asc_transit": -0.8, "coef_ivtt": -0.018, "coef_ovtt": -0.032, "coef_cost": -0.25, "coef_density_walk": 0.0004},
    "recreation": {"asc_walk": -0.8, "asc_bike": -0.5, "asc_transit": -1.0, "coef_ivtt": -0.020, "coef_ovtt": -0.035, "coef_cost": -0.28, "coef_density_walk": 0.0003},
    "dining":     {"asc_walk":  0.5, "asc_bike": -1.0, "asc_transit": -1.2, "coef_ivtt": -0.019, "coef_ovtt": -0.034, "coef_cost": -0.22, "coef_density_walk": 0.0006},
    "escort":     {"asc_walk": -1.5, "asc_bike": -4.0, "asc_transit": -3.0, "coef_ivtt": -0.023, "coef_ovtt": -0.042, "coef_cost": -0.35, "coef_density_walk": 0.0002},
    "personal":   {"asc_walk": -0.7, "asc_bike": -2.0, "asc_transit": -1.3, "coef_ivtt": -0.024, "coef_ovtt": -0.043, "coef_cost": -0.32, "coef_density_walk": 0.0003},
}

# Rough NHTS national daily trip-purpose shares (documented approximation; the
# worker OD has no purpose dimension). Sums to 1.0.
_PURPOSE_WEIGHTS: dict[str, float] = {
    "work": 0.19, "school": 0.05, "shopping": 0.20, "social": 0.08,
    "recreation": 0.08, "dining": 0.08, "escort": 0.12, "personal": 0.20,
}

_COEFF_KEYS = ("asc_walk", "asc_bike", "asc_transit", "coef_ivtt", "coef_ovtt", "coef_cost", "coef_density_walk")


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


def mode_share_matrices(
    time_skim_min: np.ndarray,
    dist_miles: np.ndarray,
    transit: dict[str, np.ndarray] | None = None,
    density_per_sqkm: np.ndarray | None = None,
    coeffs: dict[str, float] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """3-way auto/transit/active logit → (P_auto, P_transit, P_active), each n×n.

    `transit` (optional) is the GTFS transit-LOS dict from
    `gtfs_skim.transit_skim`: {ivtt, wait, walk (minutes), fare, available(bool)}.
    Where transit is UNAVAILABLE (no served stop at both ends / no ≤1-transfer
    scheduled itinerary), transit utility is −inf and P_transit is exactly 0 —
    the honest replacement for a blanket/fabricated transit share. With
    `transit=None` the split is auto-vs-active only (transit 0 everywhere), which
    reproduces the F.2 binary split.

    `time_skim_min` is the congested auto travel time (minutes); non-finite
    (unreachable) cells resolve to auto. `density_per_sqkm` (destination column)
    is optional — omitted when zone areas are unavailable rather than fabricated.
    """
    c = coeffs or AGGREGATE_COEFFS
    n = time_skim_min.shape[0]
    reachable = np.isfinite(time_skim_min)

    # auto — per-OD cost dropped (no data; F.2 rationale). Auto ASC dropped.
    u_auto = c["coef_ivtt"] * np.where(reachable, time_skim_min, 0.0)

    # active nest (walk+bike), unchanged from F.2
    walk_min = dist_miles / WALK_MPH * 60.0
    bike_min = dist_miles / BIKE_MPH * 60.0
    dens_term = 0.0
    if density_per_sqkm is not None:
        dens_term = c["coef_density_walk"] * density_per_sqkm[np.newaxis, :]
    u_walk = c["asc_walk"] + c["coef_ovtt"] * walk_min + dens_term
    u_bike = c["asc_bike"] + c["coef_ivtt"] * (bike_min * 0.6) + dens_term
    u_walk = np.where(walk_min < WALK_MAX_MIN, u_walk, -np.inf)
    u_bike = np.where(dist_miles < BIKE_MAX_MILES, u_bike, -np.inf)
    m = np.maximum(u_walk, u_bike)
    feasible = np.isfinite(m)
    with np.errstate(invalid="ignore"):
        exp_walk = np.where(np.isfinite(u_walk) & feasible, np.exp(u_walk - m), 0.0)
        exp_bike = np.where(np.isfinite(u_bike) & feasible, np.exp(u_bike - m), 0.0)
    exp_sum = exp_walk + exp_bike
    u_active = np.where(feasible, m + np.log(np.where(exp_sum > 0, exp_sum, 1.0)), -np.inf)

    # transit — sketch utility form (wait weighted 1.5× within OVTT). Transit
    # fare IS kept (coef_cost) while auto cost is dropped, which slightly
    # under-states transit — a conservative screening choice. −inf where
    # unavailable so P_transit is exactly 0 there.
    if transit is not None:
        ovtt = transit["walk"] + 1.5 * transit["wait"]
        u_transit = (
            c["asc_transit"]
            + c["coef_ivtt"] * transit["ivtt"]
            + c["coef_ovtt"] * ovtt
            + c["coef_cost"] * transit["fare"]
        )
        u_transit = np.where(transit["available"], u_transit, -np.inf)
    else:
        u_transit = np.full((n, n), -np.inf)

    # 3-way softmax. u_auto is always finite, so the shift `big` is finite and
    # exp(−inf − big) = 0 cleanly (no nan).
    big = np.maximum.reduce([u_auto, u_transit, u_active])
    with np.errstate(over="ignore"):
        e_auto = np.exp(u_auto - big)
        e_transit = np.exp(u_transit - big)
        e_active = np.exp(u_active - big)
    z = e_auto + e_transit + e_active
    z = np.where(z > 0, z, 1.0)
    p_auto = np.where(reachable, e_auto / z, 1.0)
    p_transit = np.where(reachable, e_transit / z, 0.0)
    p_active = np.where(reachable, e_active / z, 0.0)
    return np.clip(p_auto, 0, 1), np.clip(p_transit, 0, 1), np.clip(p_active, 0, 1)


def split_matrix(
    od_person: np.ndarray,
    time_skim_min: np.ndarray,
    dist_miles: np.ndarray,
    transit: dict[str, np.ndarray] | None = None,
    density_per_sqkm: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    """Split a person-trip OD into (auto_float, auto_int, transit_int, active_int, meta).

    `auto_float` (assigned to the network) is the exact P(auto)-weighted demand;
    the integer matrices conserve trips exactly (`auto`+`transit`+`active` ==
    round(person)) with active as the last residual, so nothing leaks in
    rounding. Only auto is assigned; transit and active are split off (there is
    no transit network to assign to at screening grade).
    """
    p_auto, p_transit, p_active = mode_share_matrices(time_skim_min, dist_miles, transit, density_per_sqkm)
    auto_float = od_person * p_auto
    transit_float = od_person * p_transit
    person_int = np.round(od_person).astype(np.int64)
    auto_int = np.minimum(np.round(auto_float).astype(np.int64), person_int)
    transit_int = np.minimum(np.round(transit_float).astype(np.int64), np.maximum(person_int - auto_int, 0))
    active_int = np.maximum(person_int - auto_int - transit_int, 0)  # residual to active LAST

    total = float(od_person.sum())
    auto = float(auto_float.sum())
    transit_tot = float(transit_float.sum())

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

    avail = transit["available"] if transit is not None else np.zeros_like(p_auto, dtype=bool)
    n = od_person.shape[0]
    meta = {
        "auto_trips": int(auto_int.sum()),
        "transit_trips": int(transit_int.sum()),
        "active_trips": int(active_int.sum()),
        "auto_share": auto / total if total > 0 else 1.0,
        "transit_share": transit_tot / total if total > 0 else 0.0,
        "distance_bands": bands,
        "walk_mph": WALK_MPH,
        "bike_mph": BIKE_MPH,
        "transit_modeled": transit is not None,
        "transit_available_pairs": int(avail.sum()),
        "transit_total_pairs": n * (n - 1),
        "avg_transit_ivtt_min": round(float(transit["ivtt"][avail].mean()), 1) if (transit is not None and avail.any()) else None,
        "avg_transit_wait_min": round(float(transit["wait"][avail].mean()), 1) if (transit is not None and avail.any()) else None,
    }
    return auto_float, auto_int, transit_int, active_int, meta


def aggregate_shares(total_person: float, auto_person: float, transit_person: float = 0.0) -> dict[str, float]:
    """Mode shares in PERCENTAGE POINTS (0-100). Active is the residual."""
    if total_person <= 0:
        return {"auto": 100.0, "transit": 0.0, "active": 0.0}
    share_auto = 100.0 * auto_person / total_person
    share_transit = 100.0 * transit_person / total_person
    return {
        "auto": round(share_auto, 2),
        "transit": round(share_transit, 2),
        "active": round(max(100.0 - share_auto - share_transit, 0.0), 2),
    }
