"""Planner-supplied, run-scoped adjustments for guided comparisons.

The app stamps this object into ``model_runs.input_snapshot_json`` only after a
planner enters a non-zero percentage and a reviewable basis. The worker does
not infer a benefit from project text, and invalid or absent input means a
factor of exactly 1.0.
"""

from __future__ import annotations

import math

KIND = "assigned_auto_trip_change_pct"


def resolve_assigned_auto_trip_adjustment(run_row: dict | None) -> dict | None:
    snapshot = (run_row or {}).get("input_snapshot_json") or {}
    candidate = snapshot.get("scenarioAdjustment")
    if not isinstance(candidate, dict) or candidate.get("kind") != KIND:
        return None

    change = candidate.get("autoTripChangePct")
    basis = candidate.get("basis")
    if (
        isinstance(change, bool)
        or not isinstance(change, (int, float))
        or not math.isfinite(float(change))
        or float(change) < -90
        or float(change) > 200
        or float(change) == 0
        or not isinstance(basis, str)
        or len(basis.strip()) < 3
    ):
        return None

    return {
        "kind": KIND,
        "auto_trip_change_pct": float(change),
        "factor": 1.0 + float(change) / 100.0,
        "basis": basis.strip(),
    }


def apply_assigned_auto_trip_adjustment(auto_demand, adjustment: dict | None):
    """Scale only internal assigned-auto demand; external cordon demand is evidence-based."""
    if adjustment is None:
        return auto_demand
    return auto_demand * adjustment["factor"]
