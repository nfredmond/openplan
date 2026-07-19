#!/usr/bin/env python3
"""Checks for the worker mode-choice split. Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_mode_choice.py
"""
import sys

import numpy as np

import mode_choice as mc


def test_aggregate_coeffs_blend_golden():
    # trip-weighted blend of the 8 sketch-ABM purposes; pinned so a coefficient
    # or weight edit is caught. Values match a hand computation from
    # mode-choice.ts MODE_COEFFS × _PURPOSE_WEIGHTS.
    c = mc.AGGREGATE_COEFFS
    assert abs(c["asc_walk"] - (-1.059)) < 1e-3, c["asc_walk"]
    assert abs(c["asc_bike"] - (-1.990)) < 1e-3, c["asc_bike"]
    assert abs(c["coef_ivtt"] - (-0.02227)) < 1e-4, c["coef_ivtt"]
    assert abs(c["coef_ovtt"] - (-0.04002)) < 1e-4, c["coef_ovtt"]


def test_auto_share_rises_with_distance():
    dist = np.array([[0.75, 0.5, 12.0], [0.5, 0.75, 3.0], [12.0, 3.0, 0.75]])
    tmin = dist / 30.0 * 60.0
    P = mc.auto_share_matrix(tmin, dist)
    # near pair has more active (lower P_auto) than a far pair
    assert P[0, 1] < P[0, 2]
    # far trip beyond bike/walk feasibility → all auto
    assert P[0, 2] == 1.0
    # intrazonal (0.75 mi) is split by the logit — walk-feasible, so < all-auto
    assert 0.0 < P[0, 0] < 1.0 and 0.0 < P[1, 1] < 1.0
    # probabilities are valid
    assert np.all((P >= 0) & (P <= 1))


def test_infeasible_active_all_auto_no_warnings():
    # every pair beyond bike/walk range → P_auto must be exactly 1 everywhere
    dist = np.full((3, 3), 20.0)
    np.fill_diagonal(dist, 0.75)
    tmin = dist / 30.0 * 60.0
    with np.errstate(all="raise"):  # any unmasked nan/inf op would raise here
        P = mc.auto_share_matrix(tmin, dist)
    off = ~np.eye(3, dtype=bool)
    assert np.all(P[off] == 1.0)


def test_split_conserves_trips():
    dist = np.array([[0.75, 0.8, 6.0], [0.8, 0.75, 2.0], [6.0, 2.0, 0.75]])
    tmin = dist / 30.0 * 60.0
    od = np.array([[100, 220, 51], [180, 90, 77], [40, 66, 110.0]])
    auto_f, auto_i, active_i, meta = mc.split_matrix(od, tmin, dist)
    # exact integer conservation on the persisted matrices
    assert np.all(auto_i + active_i == np.round(od).astype(np.int64))
    assert np.all(auto_i <= np.round(od).astype(np.int64))
    assert np.all(active_i >= 0)
    # auto_float is bounded by person trips
    assert np.all(auto_f <= od + 1e-9)
    assert meta["transit_modeled"] is False


def test_aggregate_shares_percentage_points_and_zero_transit():
    s = mc.aggregate_shares(1000.0, 870.0)
    assert abs(s["auto"] - 87.0) < 1e-6
    assert abs(s["active"] - 13.0) < 1e-6
    assert s["transit"] == 0.0  # hard zero — not modeled
    # sums to 100 (auto + active), transit excluded
    assert abs(s["auto"] + s["active"] - 100.0) < 1e-6
    # empty demand → all auto by convention
    assert mc.aggregate_shares(0.0, 0.0)["auto"] == 100.0


def test_unreachable_cell_is_auto():
    dist = np.array([[0.75, 1.0], [1.0, 0.75]])
    tmin = np.array([[0.0, np.inf], [np.inf, 0.0]])  # unreachable off-diagonal
    P = mc.auto_share_matrix(tmin, dist)
    assert P[0, 1] == 1.0 and P[1, 0] == 1.0


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} mode-choice checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
