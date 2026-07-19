#!/usr/bin/env python3
"""Checks for the worker mode-choice split. Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_mode_choice.py
"""
import sys

import numpy as np

import mode_choice as mc


def test_aggregate_coeffs_blend_golden():
    # trip-weighted blend of the 8 sketch-ABM purposes; pinned so a coefficient
    # or weight edit is caught. Hand-computed from mode-choice.ts MODE_COEFFS ×
    # _PURPOSE_WEIGHTS.
    c = mc.AGGREGATE_COEFFS
    assert abs(c["asc_walk"] - (-1.059)) < 1e-3, c["asc_walk"]
    assert abs(c["asc_bike"] - (-1.990)) < 1e-3, c["asc_bike"]
    assert abs(c["asc_transit"] - (-1.270)) < 1e-3, c["asc_transit"]
    assert abs(c["coef_ivtt"] - (-0.02227)) < 1e-4, c["coef_ivtt"]
    assert abs(c["coef_ovtt"] - (-0.04002)) < 1e-4, c["coef_ovtt"]
    assert abs(c["coef_cost"] - (-0.3175)) < 1e-3, c["coef_cost"]


def test_auto_share_rises_with_distance():
    dist = np.array([[0.75, 0.5, 12.0], [0.5, 0.75, 3.0], [12.0, 3.0, 0.75]])
    tmin = dist / 30.0 * 60.0
    P_auto, P_transit, P_active = mc.mode_share_matrices(tmin, dist)  # transit=None
    assert np.all(P_transit == 0.0)  # no feed → transit 0 everywhere
    # near pair has more active (lower auto) than a far pair
    assert P_auto[0, 1] < P_auto[0, 2]
    assert P_auto[0, 2] == 1.0  # beyond walk/bike feasibility → all auto
    assert 0.0 < P_auto[0, 0] < 1.0  # intrazonal split by the logit
    assert np.allclose(P_auto + P_transit + P_active, 1.0)


def test_transit_available_gets_small_share_else_zero():
    n = 3
    dist = np.full((n, n), 4.0)
    np.fill_diagonal(dist, 0.75)
    tmin = dist / 30.0 * 60.0
    # transit available only for pair (0,1): moderate LOS
    available = np.zeros((n, n), dtype=bool)
    available[0, 1] = True
    transit = {
        "ivtt": np.full((n, n), 15.0),
        "wait": np.full((n, n), 10.0),
        "walk": np.full((n, n), 8.0),
        "fare": np.full((n, n), 1.5),
        "available": available,
    }
    P_auto, P_transit, P_active = mc.mode_share_matrices(tmin, dist, transit=transit)
    assert P_transit[0, 1] > 0.0  # served pair gets a positive transit share
    assert P_transit[0, 2] == 0.0 and P_transit[1, 0] == 0.0  # unavailable → exactly 0
    assert np.allclose(P_auto + P_transit + P_active, 1.0)
    # unavailable cells reproduce the transit=None (F.2) split bit-for-bit
    Pa_none, Pt_none, Pac_none = mc.mode_share_matrices(tmin, dist, transit=None)
    assert np.isclose(P_auto[0, 2], Pa_none[0, 2]) and np.isclose(P_active[0, 2], Pac_none[0, 2])


def test_split_conserves_trips_three_way():
    n = 3
    dist = np.array([[0.75, 0.8, 6.0], [0.8, 0.75, 2.0], [6.0, 2.0, 0.75]])
    tmin = dist / 30.0 * 60.0
    od = np.array([[100, 220, 51], [180, 90, 77], [40, 66, 110.0]])
    available = np.zeros((n, n), dtype=bool)
    available[0, 1] = available[1, 0] = True
    transit = {
        "ivtt": np.full((n, n), 12.0), "wait": np.full((n, n), 8.0),
        "walk": np.full((n, n), 6.0), "fare": np.full((n, n), 1.5), "available": available,
    }
    auto_f, auto_i, transit_i, active_i, meta = mc.split_matrix(od, tmin, dist, transit=transit)
    person_int = np.round(od).astype(np.int64)
    # exact 3-way integer conservation, active as residual
    assert np.all(auto_i + transit_i + active_i == person_int)
    assert np.all(auto_i >= 0) and np.all(transit_i >= 0) and np.all(active_i >= 0)
    assert meta["transit_modeled"] is True
    assert meta["transit_available_pairs"] == 2
    assert meta["transit_trips"] >= 0


def test_aggregate_shares_three_way():
    s = mc.aggregate_shares(1000.0, 850.0, 20.0)
    assert abs(s["auto"] - 85.0) < 1e-6
    assert abs(s["transit"] - 2.0) < 1e-6
    assert abs(s["active"] - 13.0) < 1e-6
    assert abs(s["auto"] + s["transit"] + s["active"] - 100.0) < 1e-6
    # default transit=0
    assert mc.aggregate_shares(1000.0, 900.0)["transit"] == 0.0
    assert mc.aggregate_shares(0.0, 0.0)["auto"] == 100.0


def test_unreachable_cell_is_auto():
    dist = np.array([[0.75, 1.0], [1.0, 0.75]])
    tmin = np.array([[0.0, np.inf], [np.inf, 0.0]])  # unreachable off-diagonal
    P_auto, P_transit, P_active = mc.mode_share_matrices(tmin, dist)
    assert P_auto[0, 1] == 1.0 and P_auto[1, 0] == 1.0
    assert P_transit[0, 1] == 0.0 and P_active[0, 1] == 0.0


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
