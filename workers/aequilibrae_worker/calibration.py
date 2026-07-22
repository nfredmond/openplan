#!/usr/bin/env python3
"""Pure calibration engine for the AequilibraE worker (count-based, staged).

The product deliberately ships an UNCALIBRATED screening model by default. This
module is the pure logic for an OPT-IN calibration tier that tunes the model
toward observed traffic counts — a distinct, disclosed 'calibrated_to_counts'
claim, never the screening default. Calibrated outputs must carry distinct KPI
names so they never silently feed the CEQA determination screen.

The staged method (Nathaniel's call, 2026-07-21):
  1. Capacity/speed tuning — adjust per-ROAD-CLASS free-flow speed / capacity
     toward counts. Tuning ~5 class parameters (not 24 links) is the overfit-
     resistant stage; the outer loop applies a factor, re-runs equilibrium
     assignment, and repeats.
  2. A light, regularized demand nudge (ODME-lite) for the residual — loop-
     coupled, lives with the assignment plumbing in main.py.

Everything here is pure and stdlib-only (GEH borrowed from count_validation),
so the calibration LOGIC is unit-tested independently of the expensive
assignment re-runs. A ~30% count HOLDOUT is split off up front and never fit;
the holdout objective is the honest, out-of-sample accuracy and the overfit
guard — a step that improves the fit set but degrades the holdout is rejected.
"""
from __future__ import annotations

import random
from statistics import median
from typing import Any, Iterable, Sequence

from count_validation import geh_statistic

# Damped multiplicative step: factor = clip((observed/modeled)**gamma, lo, hi).
# gamma < 1 damps the step for stability across iterations; the clip bounds a
# single iteration's change so one noisy count can't blow up a class default.
DEFAULT_GAMMA = 0.5
DEFAULT_FACTOR_LO = 0.5
DEFAULT_FACTOR_HI = 2.0
DEFAULT_HOLDOUT_FRAC = 0.30
DEFAULT_SEED = 20260721
# GEH must be computed on average-hourly equivalents (daily volume / 24), the
# same basis as count_validation.geh_summary — GEH is scale-dependent
# (GEH(k·o,k·m)=√k·GEH(o,m)), so feeding raw daily AADT would inflate every GEH
# by √24≈4.9× and break the acceptance scale below.
GEH_HOURLY_DIVISOR = 24.0
# GEH per station is normalized to a soft 0..1 penalty at this scale: on the
# average-hourly basis GEH<5 is the customary "good" line, so 5 maps to ~0.5.
GEH_SCALE = 5.0


def split_holdout(
    stations: Sequence[dict[str, Any]],
    holdout_frac: float = DEFAULT_HOLDOUT_FRAC,
    seed: int = DEFAULT_SEED,
    strata_key: str = "facility_name",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Deterministically split stations into (fit, holdout).

    Stratified by ``strata_key`` (route by default) so every route contributes
    to both sets and the holdout can't accidentally exclude a whole facility.
    With very few stations the holdout may be empty for a stratum; the overall
    holdout is still non-empty as long as any stratum has >= 2 stations. The
    split is seed-deterministic so a re-run calibrates identically.
    """
    if not stations:
        return [], []
    rng = random.Random(seed)
    by_stratum: dict[Any, list[dict[str, Any]]] = {}
    for st in stations:
        by_stratum.setdefault(st.get(strata_key), []).append(st)

    fit: list[dict[str, Any]] = []
    holdout: list[dict[str, Any]] = []
    for _, group in sorted(by_stratum.items(), key=lambda kv: str(kv[0])):
        # Canonical pre-shuffle order (sort by a stable id) so the split is a
        # pure function of (seed, station set), independent of arrival order.
        g = sorted(group, key=lambda s: str(s.get("station_id")))
        rng.shuffle(g)
        n_hold = int(round(len(g) * holdout_frac))
        # Never hold out an entire small stratum: leave >= 1 in fit.
        n_hold = min(n_hold, max(0, len(g) - 1))
        holdout.extend(g[:n_hold])
        fit.extend(g[n_hold:])
    # Stratifying by route can zero the holdout when every stratum is a singleton
    # (e.g. all distinct facility_names). A calibration that stamps the
    # 'calibrated_to_counts' claim WITHOUT a real holdout would be an unvalidated
    # overclaim — so guarantee a non-empty holdout whenever >= 2 stations exist,
    # via a global un-stratified fallback (still seed-deterministic).
    if not holdout and len(stations) >= 2:
        allst = sorted(stations, key=lambda s: str(s.get("station_id")))
        rng.shuffle(allst)
        n_hold = min(max(1, int(round(len(allst) * holdout_frac))), len(allst) - 1)
        return allst[n_hold:], allst[:n_hold]
    return fit, holdout


def _ratios_by_class(matched: Iterable[dict[str, Any]], class_key: str) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for m in matched:
        obs = float(m.get("observed_volume") or 0.0)
        mod = float(m.get("modeled_daily_pce") or 0.0)
        cls = m.get(class_key)
        if obs > 0 and mod > 0 and cls:
            out.setdefault(str(cls), []).append(obs / mod)
    return out


def class_adjustment_factors(
    matched: Iterable[dict[str, Any]],
    class_key: str = "matched_link_type",
    gamma: float = DEFAULT_GAMMA,
    lo: float = DEFAULT_FACTOR_LO,
    hi: float = DEFAULT_FACTOR_HI,
) -> dict[str, float]:
    """Per-road-class damped adjustment factor from the FIT stations only.

    For each class, factor = clip(median(observed/modeled)**gamma, lo, hi).
    A class the model under-assigns (median obs/mod > 1) gets factor > 1 — the
    outer loop raises that class's free-flow speed (and/or capacity) so its
    links attract more equilibrium flow; over-assigned classes get factor < 1.
    Classes with no usable fit station are absent (left unchanged by the loop).
    """
    factors: dict[str, float] = {}
    for cls, ratios in _ratios_by_class(matched, class_key).items():
        if not ratios:
            continue
        step = median(ratios) ** gamma
        factors[cls] = max(lo, min(hi, step))
    return factors


def compose_factors(base: dict[str, float], new: dict[str, float],
                    lo: float = 0.2, hi: float = 5.0) -> dict[str, float]:
    """Accumulate a per-class factor across iterations (base * new), clipped to a
    total range so the whole calibration can't drift a class default absurdly."""
    out = dict(base)
    for cls, f in new.items():
        out[cls] = max(lo, min(hi, out.get(cls, 1.0) * f))
    return out


def evaluate(stations: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Fit metrics over an already-matched station subset (each dict carries
    observed_volume + modeled_daily_pce). Pure — no assignment here."""
    pairs = [
        (float(s["observed_volume"]), float(s["modeled_daily_pce"]))
        for s in stations
        if s.get("observed_volume") and s.get("modeled_daily_pce") is not None
    ]
    if not pairs:
        return {"n": 0, "median_ape": None, "geh_mean": None, "objective": None}
    apes = sorted(100.0 * abs(m - o) / o for o, m in pairs if o > 0)
    gehs = [g for g in (geh_statistic(o / GEH_HOURLY_DIVISOR, m / GEH_HOURLY_DIVISOR)
                        for o, m in pairs) if g is not None]
    med_ape = median(apes) if apes else None
    geh_mean = (sum(gehs) / len(gehs)) if gehs else None
    return {
        "n": len(pairs),
        "median_ape": round(med_ape, 2) if med_ape is not None else None,
        # Average-hourly basis (daily/24), comparable to the GEH<5 line and to
        # count_validation's validation_geh_mean — NOT raw daily GEH.
        "geh_mean": round(geh_mean, 2) if geh_mean is not None else None,
        "objective": calibration_objective(pairs),
    }


def calibration_objective(obs_mod_pairs: Sequence[tuple[float, float]]) -> float | None:
    """Combined, lower-is-better objective: mean of a GEH soft-penalty and a
    normalized median-APE penalty over (observed, modeled) pairs. Bounded and
    scale-free so fit/holdout objectives are directly comparable."""
    pairs = [(o, m) for o, m in obs_mod_pairs if o > 0 and m >= 0]
    if not pairs:
        return None
    # Average-hourly basis (daily/24) so GEH_SCALE=5 lands on the customary
    # GEH<5 acceptance line — matches count_validation.geh_summary.
    gehs = [g for g in (geh_statistic(o / GEH_HOURLY_DIVISOR, m / GEH_HOURLY_DIVISOR)
                        for o, m in pairs) if g is not None]
    geh_pen = sum(g / (g + GEH_SCALE) for g in gehs) / len(gehs) if gehs else 1.0
    apes = sorted(min(abs(m - o) / o, 1.0) for o, m in pairs)
    ape_pen = median(apes)
    return round((geh_pen + ape_pen) / 2.0, 4)


def accept_step(prev_holdout_obj: float | None, new_holdout_obj: float | None,
                tol: float = 0.0) -> bool:
    """Overfit guard: accept a calibration step only if it does not degrade the
    HOLDOUT objective (new <= prev + tol). Improving the fit set while the
    holdout worsens is overfitting and is rejected. Unknown holdout (None) is
    conservative — never accept a step we can't validate out-of-sample."""
    if new_holdout_obj is None:
        return False
    if prev_holdout_obj is None:
        return True
    return new_holdout_obj <= prev_holdout_obj + tol
