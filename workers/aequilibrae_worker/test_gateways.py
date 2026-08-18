#!/usr/bin/env python3
"""Dependency-light checks for the pure gateway helpers (pairing + share math).

Run: python3 workers/aequilibrae_worker/test_gateways.py

The DB-backed helpers (detect_external_gateways, resolve_exterior_node) need a
spatialite fixture and are exercised by the live worker run, not here.
"""
import ast
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



def test_the_two_lanes_agree_on_what_a_crossing_carries():
    """PARITY: the worker and the county-script lane must inject the same demand.

    Both files define GATEWAY_DAILY_TRIPS and a comment in each says it is
    identical to the other. That was a convention, and this constant is next in
    line to change — the flat per-crossing figure is being replaced with
    observed AADT where a count station sits near the crossing. Drift here means
    the app and a county study disagree about how much traffic enters the study
    area, which moves every corridor volume without moving anything a reader
    can see.

    Imported rather than transcribed: a copy in this file would be a third
    place to drift.
    """
    import importlib.util  # noqa: PLC0415

    scripts_runtime = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                     "scripts", "modeling", "screening_runtime.py")
    )
    assert os.path.exists(scripts_runtime), scripts_runtime

    # Read the literal rather than importing the module: screening_runtime pulls
    # in the whole modelling stack, and this check must run wherever the worker
    # tests do.
    source = open(scripts_runtime, encoding="utf-8").read()
    start = source.index("GATEWAY_DAILY_TRIPS = {")
    end = source.index("}", start) + 1
    scripts_value = ast.literal_eval(source[start + len("GATEWAY_DAILY_TRIPS = "):end])

    assert scripts_value == gw.GATEWAY_DAILY_TRIPS, (
        "gateway demand drift between the lanes: "
        f"scripts={scripts_value}, worker={gw.GATEWAY_DAILY_TRIPS}"
    )


def test_one_builder_serves_both_lanes():
    """The county lane must not carry its own copy of this.

    On 2026-08-18 there were three implementations of the external OD layer:
    this module's (unused, no pass-through), the county lane's (live, no
    pass-through), and an inline third in main.py (the only one with it). The
    two lanes therefore disagreed about whether a car can drive across a county,
    and this module's header asked a human to keep them in step.

    Comments are stripped before the check: the comment explaining why the
    county lane imports rather than reimplements names the function, and a guard
    its own explanation satisfies passes after the code it guards is deleted.
    """
    county = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                     "scripts", "modeling", "screening_runtime.py")
    )
    assert os.path.exists(county), county
    code = "\n".join(
        line for line in open(county, encoding="utf-8").read().splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "worker_build_external_gateway_matrix" in code, (
        "the county lane no longer imports the worker's external OD builder — "
        "a second implementation of it will drift, and the drift is invisible "
        "because both sides produce plausible numbers"
    )
    assert "job_shares" not in code, (
        "the county lane is building external OD shares itself again rather than "
        "calling the worker's builder"
    )


def test_a_pass_through_share_reaches_the_matrix():
    """The share is applied, not merely defined.

    Both lanes read GATEWAY_PASSTHROUGH_SHARE, so a change that stopped applying
    it would leave the constant looking correct in both.
    """
    import pandas as pd  # noqa: PLC0415

    zones = pd.DataFrame([
        {"zone_id": 1, "est_population": 1000.0, "total_jobs": 500.0},
        {"zone_id": 100, "est_population": 0.0, "total_jobs": 0.0},
        {"zone_id": 101, "est_population": 0.0, "total_jobs": 0.0},
    ])
    paired = [
        {"zone_id": 100, "name": "Interstate 25", "daily_in": 10000.0, "daily_out": 10000.0},
        {"zone_id": 101, "name": "Interstate 25", "daily_in": 10000.0, "daily_out": 10000.0},
    ]
    matrix = gw.build_external_gateway_matrix(paired, zones)
    assert abs(matrix[1][2] - 10000.0 * gw.GATEWAY_PASSTHROUGH_SHARE) < 1e-6, matrix[1][2]

    # And a route crossing once still sends everything inside.
    single = [
        {"zone_id": 100, "name": "Interstate 25", "daily_in": 10000.0, "daily_out": 10000.0},
        {"zone_id": 101, "name": "State Route 96", "daily_in": 10000.0, "daily_out": 10000.0},
    ]
    assert gw.build_external_gateway_matrix(single, zones)[1][2] == 0.0


def test_a_crossing_carrying_its_own_share_overrides_the_flat_one():
    """One flat figure cannot describe an interstate and a county road.

    Anything able to measure a particular road's through-share attaches it to
    that crossing; the constant is the fallback. Without this the measurement
    is computed, recorded, and ignored — which is how five other corrections
    behaved on 2026-08-18 before anyone measured them.
    """
    import pandas as pd  # noqa: PLC0415

    zones = pd.DataFrame([
        {"zone_id": 1, "est_population": 1000.0, "total_jobs": 500.0},
        {"zone_id": 100, "est_population": 0.0, "total_jobs": 0.0},
        {"zone_id": 101, "est_population": 0.0, "total_jobs": 0.0},
    ])
    base = [
        {"zone_id": 100, "name": "Interstate 25", "daily_in": 10000.0, "daily_out": 10000.0},
        {"zone_id": 101, "name": "Interstate 25", "daily_in": 10000.0, "daily_out": 10000.0},
    ]
    flat = gw.build_external_gateway_matrix(base, zones)[1][2]
    assert abs(flat - 10000.0 * gw.GATEWAY_PASSTHROUGH_SHARE) < 1e-6, flat

    own = [dict(g, passthrough_share=0.84) for g in base]
    assert abs(gw.build_external_gateway_matrix(own, zones)[1][2] - 8400.0) < 1e-6

    # Each crossing keeps its own, so one route's two ends can differ.
    mixed = [dict(base[0], passthrough_share=0.45), dict(base[1], passthrough_share=0.75)]
    matrix = gw.build_external_gateway_matrix(mixed, zones)
    assert abs(matrix[1][2] - 4500.0) < 1e-6, matrix[1][2]
    assert abs(matrix[2][1] - 7500.0) < 1e-6, matrix[2][1]


def test_a_share_outside_zero_to_one_is_clamped_rather_than_trusted():
    """A share above 1 would send more vehicles across than arrived."""
    import pandas as pd  # noqa: PLC0415

    zones = pd.DataFrame([
        {"zone_id": 1, "est_population": 1000.0, "total_jobs": 500.0},
        {"zone_id": 100, "est_population": 0.0, "total_jobs": 0.0},
        {"zone_id": 101, "est_population": 0.0, "total_jobs": 0.0},
    ])
    silly = [
        {"zone_id": 100, "name": "I 25", "daily_in": 10000.0, "daily_out": 10000.0, "passthrough_share": 3.0},
        {"zone_id": 101, "name": "I 25", "daily_in": 10000.0, "daily_out": 10000.0, "passthrough_share": -1.0},
    ]
    matrix = gw.build_external_gateway_matrix(silly, zones)
    assert abs(matrix[1][2] - 10000.0) < 1e-6, matrix[1][2]
    assert matrix[2][1] == 0.0, matrix[2][1]


def test_the_share_override_is_parsed_and_clamped_in_one_place():
    """The override reached ONE lane, and the sweep that revealed it looked fine.

    main.py read GATEWAY_PASSTHROUGH_SHARE from the environment while this
    module hardcoded 0.35, so a five-county sweep at 0.35 / 0.55 / 0.75 / 0.90
    produced byte-identical network VMT — a knob that turned and did nothing,
    reported as "the share does not matter".
    """
    assert gw.share_from_env(None) == gw.DEFAULT_GATEWAY_PASSTHROUGH_SHARE
    assert gw.share_from_env("") == gw.DEFAULT_GATEWAY_PASSTHROUGH_SHARE
    assert gw.share_from_env("0.75") == 0.75
    # Nonsense falls back rather than crashing a run hours in.
    assert gw.share_from_env("banana") == gw.DEFAULT_GATEWAY_PASSTHROUGH_SHARE
    # Clamped: a share above 0.9 would leave a route with almost no local trips,
    # and a negative one would create them out of nothing.
    assert gw.share_from_env("3.0") == 0.9
    assert gw.share_from_env("-1") == 0.0


def test_the_worker_and_the_county_lane_read_the_same_share():
    """Both must resolve to one value, or a sweep means different things in each."""
    import main  # noqa: PLC0415

    assert main.PASSTHROUGH_SHARE == gw.GATEWAY_PASSTHROUGH_SHARE

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
