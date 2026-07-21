#!/usr/bin/env python3
"""Convergence diagnostics between the worker's two resident-VMT estimators.

The worker reports resident VMT two ways: the OD estimator (great-circle ×
fixed 1.30 circuity — the CEQA §15064.3 screening input) and the M7
network-routed figure (per-class assigned link flows). The M7 live runs showed
they can differ by 1.7–2.1× in foothill terrain, so these helpers MEASURE the
gap per run and report it with provenance instead of leaving it to be
rediscovered ad hoc.

Diagnostics only: nothing here may alter either estimator's inputs. In
particular the OD estimator's 1.30 circuity stays fixed — replacing it with a
per-run measured value is a flagged calibration decision, not a code change.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from resident_vmt import VMT_NETWORK_CIRCUITY

METERS_PER_MILE = 1609.34


def network_od_ratio(network_vmt: Any, od_vmt: Any) -> float | None:
    """resident_vmt_network ÷ resident_vmt, or None when undefined."""
    try:
        n = float(network_vmt)
        o = float(od_vmt)
    except (TypeError, ValueError):
        return None
    if not (np.isfinite(n) and np.isfinite(o)) or o <= 0 or n < 0:
        return None
    return n / o


def routed_effective_circuity(
    demand: Any,
    routed_dist_m: Any,
    straight_dist_mi: Any,
    assumed_circuity: float = VMT_NETWORK_CIRCUITY,
) -> dict[str, Any] | None:
    """Demand-weighted routed/straight distance ratio over interzonal pairs.

    ``demand`` (trips), ``routed_dist_m`` (metres — the blended assignment
    distance skim, flow-consistent with the BFW solution), and
    ``straight_dist_mi`` (great-circle miles) are same-shape square arrays over
    the same zone ordering. Intrazonal cells are excluded (a skim diagonal is 0
    — there is no self-path), as are unreachable or zero-distance pairs.
    Returns a JSON-safe dict, or None when no usable pair exists.
    """
    d = np.asarray(demand, dtype=float)
    r = np.asarray(routed_dist_m, dtype=float) / METERS_PER_MILE
    s = np.asarray(straight_dist_mi, dtype=float)
    if d.ndim != 2 or d.shape[0] != d.shape[1] or d.shape != r.shape or d.shape != s.shape:
        return None
    mask = np.isfinite(d) & np.isfinite(r) & np.isfinite(s) & (d > 0) & (r > 0) & (s > 0)
    np.fill_diagonal(mask, False)
    if not mask.any():
        return None
    routed_vm = float((d[mask] * r[mask]).sum())
    straight_vm = float((d[mask] * s[mask]).sum())
    if straight_vm <= 0:
        return None
    return {
        "effective_circuity": round(routed_vm / straight_vm, 4),
        "assumed_circuity": float(assumed_circuity),
        "routed_vehicle_miles": round(routed_vm, 1),
        "straight_line_vehicle_miles": round(straight_vm, 1),
        "trips_weighted": round(float(d[mask].sum()), 1),
        "pairs_used": int(mask.sum()),
    }
