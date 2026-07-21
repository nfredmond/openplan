#!/usr/bin/env python3
"""Checks for the resident-VMT convergence diagnostics.

Needs numpy, so run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_convergence.py

The load-bearing invariant: these are DIAGNOSTICS — pure measurements of the
gap between the two estimators. Nothing here touches the OD estimator's fixed
1.30 circuity (that would be a flagged calibration decision).
"""
import sys

import numpy as np

import convergence as cv


def test_network_od_ratio_basic():
    assert abs(cv.network_od_ratio(723944.0, 345582.0) - 2.0949) < 1e-3
    assert cv.network_od_ratio(0.0, 100.0) == 0.0


def test_network_od_ratio_undefined_cases():
    assert cv.network_od_ratio(None, 100.0) is None
    assert cv.network_od_ratio(100.0, None) is None
    assert cv.network_od_ratio(100.0, 0.0) is None       # zero OD estimator
    assert cv.network_od_ratio(100.0, -5.0) is None
    assert cv.network_od_ratio(-1.0, 100.0) is None
    assert cv.network_od_ratio(float("nan"), 100.0) is None
    assert cv.network_od_ratio("n/a", 100.0) is None


def test_routed_circuity_exact_on_synthetic_grid():
    # Straight-line distances of 2 and 4 miles; routing is exactly 1.5x longer.
    straight = np.array([
        [0.0, 2.0, 4.0],
        [2.0, 0.0, 2.0],
        [4.0, 2.0, 0.0],
    ])
    routed_m = straight * 1.5 * cv.METERS_PER_MILE
    demand = np.array([
        [50.0, 10.0, 5.0],   # diagonal must be ignored
        [10.0, 60.0, 5.0],
        [5.0, 5.0, 70.0],
    ])
    out = cv.routed_effective_circuity(demand, routed_m, straight)
    assert out is not None
    assert abs(out["effective_circuity"] - 1.5) < 1e-9, out
    assert out["pairs_used"] == 6, out
    assert abs(out["trips_weighted"] - 40.0) < 1e-9, out  # off-diagonal demand only
    assert out["assumed_circuity"] == cv.VMT_NETWORK_CIRCUITY


def test_routed_circuity_demand_weighting():
    # All demand on the (0,1) pair whose routing detours 2x; the untraveled
    # (0,2) pair's 10x detour must not influence the result.
    straight = np.array([
        [0.0, 1.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 0.0],
    ])
    routed_mi = np.array([
        [0.0, 2.0, 10.0],
        [2.0, 0.0, 1.0],
        [10.0, 1.0, 0.0],
    ])
    demand = np.zeros((3, 3))
    demand[0, 1] = 100.0
    out = cv.routed_effective_circuity(demand, routed_mi * cv.METERS_PER_MILE, straight)
    assert out is not None and abs(out["effective_circuity"] - 2.0) < 1e-9, out
    assert out["pairs_used"] == 1


def test_routed_circuity_excludes_unreachable_and_zero():
    straight = np.array([[0.0, 3.0], [3.0, 0.0]])
    routed_m = np.array([[0.0, np.inf], [3.9 * cv.METERS_PER_MILE, 0.0]])
    demand = np.array([[0.0, 500.0], [500.0, 0.0]])
    out = cv.routed_effective_circuity(demand, routed_m, straight)
    # only the reachable (1,0) pair counts: 3.9 / 3.0
    assert out is not None and abs(out["effective_circuity"] - 1.3) < 1e-9, out
    assert out["pairs_used"] == 1


def test_routed_circuity_degenerate_returns_none():
    z = np.zeros((3, 3))
    assert cv.routed_effective_circuity(z, z, z) is None                 # no demand
    assert cv.routed_effective_circuity(np.zeros((2, 3)), np.zeros((2, 3)), np.zeros((2, 3))) is None  # not square
    assert cv.routed_effective_circuity(np.zeros((2, 2)), np.zeros((3, 3)), np.zeros((3, 3))) is None  # shape mismatch
    only_diag = np.diag([5.0, 5.0])
    assert cv.routed_effective_circuity(only_diag, only_diag, only_diag) is None  # intrazonal only


def test_result_is_json_safe():
    import json
    straight = np.array([[0.0, 2.0], [2.0, 0.0]])
    out = cv.routed_effective_circuity(
        np.array([[0.0, 10.0], [10.0, 0.0]]), straight * 1.3 * cv.METERS_PER_MILE, straight
    )
    json.dumps(out)  # must not raise (no numpy scalar types)
    assert isinstance(out["pairs_used"], int)


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} convergence checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
