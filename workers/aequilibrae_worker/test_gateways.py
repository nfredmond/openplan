#!/usr/bin/env python3
"""Dependency-light checks for the pure gateway helpers (pairing + share math).

Run: python3 workers/aequilibrae_worker/test_gateways.py

The DB-backed helpers (detect_external_gateways, resolve_exterior_node) need a
spatialite fixture and are exercised by the live worker run, not here.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import gateways as gw  # noqa: E402


def _gwrec(cordon_zid, name):
    return {"cordon_zone_id": cordon_zid, "name": name, "link_type": "motorway",
            "daily_in": 15000.0, "daily_out": 15000.0}


def test_pair_same_route_cordons():
    recs = [
        _gwrec(9_000_001, "State Route 20"),   # west crossing
        _gwrec(9_000_002, "State Route 20"),   # east crossing — same route
        _gwrec(9_000_003, "Interstate 80"),    # single crossing — no partner
    ]
    pairs = gw.pair_passthrough_cordons(recs)
    assert pairs.get(9_000_001) == [9_000_002], pairs
    assert pairs.get(9_000_002) == [9_000_001], pairs
    assert 9_000_003 not in pairs, pairs  # unpaired route never passes through


def test_blank_and_null_names_never_pair():
    recs = [
        _gwrec(9_000_001, ""),          # blank name — no route identity
        _gwrec(9_000_002, ""),          # blank name — must NOT pair with the other blank
        {"cordon_zone_id": None, "name": "State Route 49"},  # no cordon id
    ]
    assert gw.pair_passthrough_cordons(recs) == {}


def test_three_crossings_all_cross_paired():
    recs = [_gwrec(9_000_001, "US 20"), _gwrec(9_000_002, "US 20"), _gwrec(9_000_003, "US 20")]
    pairs = gw.pair_passthrough_cordons(recs)
    assert sorted(pairs[9_000_001]) == [9_000_002, 9_000_003]
    assert sorted(pairs[9_000_002]) == [9_000_001, 9_000_003]


def test_passthrough_share_is_a_bounded_fraction():
    # A fixed screening constant, not a calibration output.
    assert 0.0 < gw.GATEWAY_PASSTHROUGH_SHARE < 1.0


def test_build_cordon_injections_shares_sum_to_one():
    df = pd.DataFrame({"est_population": [100.0, 300.0], "total_jobs": [50.0, 150.0]})
    job_shares, pop_shares = gw.build_cordon_injections(df)
    assert abs(job_shares.sum() - 1.0) < 1e-9 and abs(pop_shares.sum() - 1.0) < 1e-9
    assert np.allclose(pop_shares, [0.25, 0.75]) and np.allclose(job_shares, [0.25, 0.75])


def test_build_cordon_injections_zero_totals_fall_back_uniform():
    df = pd.DataFrame({"est_population": [0.0, 0.0], "total_jobs": [0.0, 0.0]})
    job_shares, pop_shares = gw.build_cordon_injections(df)
    assert np.allclose(job_shares, [0.5, 0.5]) and np.allclose(pop_shares, [0.5, 0.5])


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} gateway checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
