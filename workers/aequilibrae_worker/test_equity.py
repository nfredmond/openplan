#!/usr/bin/env python3
"""Dependency-free checks for the equity/EJ overlay pure logic.

Run: python3 workers/aequilibrae_worker/test_equity.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import equity as eq  # noqa: E402


def test_build_equity_zone_shares():
    z = eq.build_equity_zone("06057000100", 1000, {
        "B01003_001E": 1000,
        "B17001_001E": 900, "B17001_002E": 180,   # 20% below poverty
        "B03002_001E": 1000, "B03002_003E": 600,  # 40% minority
        "B25044_001E": 400, "B25044_003E": 20, "B25044_010E": 20,  # 10% zero-vehicle
    })
    assert abs(z["low_income_share"] - 0.20) < 1e-9
    assert abs(z["minority_share"] - 0.40) < 1e-9
    assert abs(z["zero_vehicle_share"] - 0.10) < 1e-9
    assert z["population"] == 1000


def test_classify_flags_two_of_three_above_average():
    zones = [
        {"zone_id": 1, "population": 100, "low_income_share": 0.40, "minority_share": 0.60, "zero_vehicle_share": 0.20},  # high
        {"zone_id": 2, "population": 100, "low_income_share": 0.05, "minority_share": 0.10, "zero_vehicle_share": 0.02},  # low
        {"zone_id": 3, "population": 100, "low_income_share": 0.10, "minority_share": 0.12, "zero_vehicle_share": 0.03},  # low
    ]
    classified = eq.classify_equity_focus(zones)
    by_id = {z["zone_id"]: z for z in classified}
    assert by_id[1]["is_equity_focus"] is True and by_id[1]["indicators_above_avg"] == 3
    assert by_id[2]["is_equity_focus"] is False
    assert by_id[3]["is_equity_focus"] is False


def test_resident_vmt_by_origin_excludes_gateways():
    # 3 zones on a line; zone 3 is a gateway. OD: each origin sends 10 trips to zone 2.
    od = [[0, 10, 0], [0, 0, 0], [5, 5, 0]]
    lon = [-121.00, -121.02, -121.04]
    lat = [39.20, 39.20, 39.20]
    area = [1.0, 1.0, 1.0]
    vmt = eq.resident_vmt_by_origin_zone(od, [1, 2, 3], lon, lat, area, gateway_zone_ids=[3])
    assert 3 not in vmt                       # gateway origin excluded
    assert set(vmt.keys()) == {1, 2}
    assert vmt[1] > 0 and vmt[2] == 0.0       # zone 1 -> 2 has distance; zone 2 sends nothing internal


def test_summarize_disparity():
    zones = eq.classify_equity_focus([
        {"zone_id": 1, "population": 200, "low_income_share": 0.40, "minority_share": 0.60, "zero_vehicle_share": 0.20},
        {"zone_id": 2, "population": 300, "low_income_share": 0.05, "minority_share": 0.10, "zero_vehicle_share": 0.02},
    ])
    resident_vmt = {1: 2000.0, 2: 6000.0}  # focus zone 10/cap, rest 20/cap
    s = eq.summarize_equity(zones, resident_vmt)
    assert s["focus_zone_count"] == 1 and s["total_zone_count"] == 2
    assert s["equity_focus"]["resident_vmt_per_capita"] == 10.0
    assert s["rest_of_area"]["resident_vmt_per_capita"] == 20.0
    assert s["vmt_per_capita_disparity_ratio"] == 0.5
    assert "not the official" in s["method"].lower()


def test_build_equity_zone_uses_c17002_for_block_groups():
    # BG ACS rows carry C17002 (B17001 is null at BG geography): below-poverty
    # = under-0.50 + 0.50-0.99 over the C17002 universe.
    z = eq.build_equity_zone("060570001001", 1000.0, {
        "B01003_001E": 1000.0,
        "C17002_001E": 800.0, "C17002_002E": 60.0, "C17002_003E": 100.0,
        "B03002_001E": 900.0, "B03002_003E": 600.0,
        "B25044_001E": 400.0, "B25044_003E": 10.0, "B25044_010E": 30.0,
    })
    assert abs(z["low_income_share"] - 0.2) < 1e-9, z
    assert abs(z["minority_share"] - (300.0 / 900.0)) < 1e-9, z
    assert abs(z["zero_vehicle_share"] - 0.1) < 1e-9, z


def test_build_equity_zone_keeps_b17001_for_tracts():
    z = eq.build_equity_zone("06057000100", 2000.0, {
        "B01003_001E": 2000.0,
        "B17001_001E": 1900.0, "B17001_002E": 380.0,
        "B03002_001E": 2000.0, "B03002_003E": 1500.0,
        "B25044_001E": 800.0, "B25044_003E": 20.0, "B25044_010E": 60.0,
    })
    assert abs(z["low_income_share"] - 0.2) < 1e-9, z


def test_acs_equity_vars_bg_swaps_only_poverty_table():
    assert "B17001_001E" not in eq.ACS_EQUITY_VARS_BG
    assert "C17002_001E" in eq.ACS_EQUITY_VARS_BG and "C17002_003E" in eq.ACS_EQUITY_VARS_BG
    # every non-poverty var is identical across the two lists
    assert [v for v in eq.ACS_EQUITY_VARS if not v.startswith("B17001")] == [
        v for v in eq.ACS_EQUITY_VARS_BG if not v.startswith("C17002")
    ]


def test_repair_geoids_block_group_restores_leading_zero():
    # CA BG GEOID int-coerced by a CSV round-trip: 060570001001 -> 60570001001.
    out = eq.repair_geoids([60570001001, "060570001002"], "block_group")
    assert out == ["060570001001", "060570001002"], out


def test_repair_geoids_tract_default():
    out = eq.repair_geoids([6057000100, "06057000200"], None)
    assert out == ["06057000100", "06057000200"], out


def test_repair_geoids_never_truncates():
    # A clean 12-char BG under a tract expectation stays 12 chars (zfill no-op),
    # so unstamped pre-staged BG packages still level-detect correctly.
    out = eq.repair_geoids(["060570001001"], "tract")
    assert out == ["060570001001"], out


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} equity checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
