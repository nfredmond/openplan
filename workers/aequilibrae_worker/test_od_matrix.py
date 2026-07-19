#!/usr/bin/env python3
"""Checks for the LODES-seeded OD matrix blend in data_pipeline.

Needs numpy/pandas, so run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_od_matrix.py

The load-bearing invariant is MARGINAL PRESERVATION: seeding the Furness loop
with real LODES flows must not change per-zone daily productions/attractions —
only the distribution. That is what makes the annual→daily magnitude problem a
non-issue.
"""
import sys

import numpy as np
import pandas as pd

import data_pipeline as dp


def _zones():
    # Column names match enrich_zone_attributes output — notably "GEOID"
    # (uppercase), the name build_daily_od_matrix / generate_package read.
    return pd.DataFrame({
        "zone_id": [1, 2, 3, 4],
        "GEOID": ["06057000100", "06057000200", "06057000300", "06057000400"],
        "households": [1000.0, 500.0, 800.0, 300.0],
        "est_population": [2500.0, 1200.0, 2000.0, 700.0],
        "total_jobs": [300.0, 900.0, 150.0, 50.0],
        "centroid_lon": [-121.0, -121.05, -120.98, -121.1],
        "centroid_lat": [39.2, 39.25, 39.22, 39.3],
    })


def _productions(z):
    return np.maximum(z["households"].values * 7.5, z["est_population"].values * 1.8)


def test_fallback_matches_pure_gravity_and_marginals():
    z = _zones()
    meta = {}
    od = dp.build_daily_od_matrix(z, od_by_pair=None, od_meta=meta)
    assert meta["used_lodes"] is False
    prod = np.round(_productions(z)).astype(int)
    # doubly-constrained: row sums == productions within rounding
    assert np.all(np.abs(od.to_numpy().sum(axis=1) - prod) <= len(z))


def test_lodes_seed_preserves_marginals_and_shifts_distribution():
    z = _zones()
    gravity = dp.build_daily_od_matrix(z, od_by_pair=None)
    meta = {}
    seeded = dp.build_daily_od_matrix(
        z,
        od_by_pair={("06057000100", "06057000200"): 5000, ("06057000300", "06057000400"): 3000},
        od_meta=meta,
    )
    assert meta["used_lodes"] is True
    assert meta["pairs_matched"] == 2
    assert meta["coverage"] > 0
    prod = np.round(_productions(z)).astype(int)
    # marginals unchanged by the seed (the whole point)
    assert np.all(np.abs(seeded.to_numpy().sum(axis=1) - prod) <= len(z))
    # distribution moved toward the seeded home→work pair (zone 1 -> zone 2)
    assert seeded.to_numpy()[0, 1] > gravity.to_numpy()[0, 1]
    # symmetrization: the return leg (zone 2 -> zone 1) also lifts
    assert seeded.to_numpy()[1, 0] > gravity.to_numpy()[1, 0]


def test_no_zero_rows_with_sparse_seed():
    z = _zones()
    # a single observed pair — the (1-hbw_share)*friction floor must keep every
    # other origin non-empty
    od = dp.build_daily_od_matrix(z, od_by_pair={("06057000100", "06057000200"): 9999})
    assert np.all(od.to_numpy().sum(axis=1) > 0)


def test_coverage_floor_skips_tiny_seed():
    z = _zones()
    meta = {}
    # one pair covering only zone 1's productions (7500 of 19500 ~ 38%) — above floor,
    # so used_lodes True. Now force a below-floor case via OD_MIN_COVERAGE.
    orig = dp.OD_MIN_COVERAGE
    try:
        dp.OD_MIN_COVERAGE = 0.99  # demand near-total coverage
        dp.build_daily_od_matrix(z, od_by_pair={("06057000100", "06057000200"): 10}, od_meta=meta)
        assert meta["used_lodes"] is False  # below the (raised) floor -> pure gravity
    finally:
        dp.OD_MIN_COVERAGE = orig


def test_unmatched_pairs_ignored():
    z = _zones()
    meta = {}
    # tract GEOIDs not in the study area must be ignored, not crash
    od = dp.build_daily_od_matrix(
        z, od_by_pair={("99999999999", "88888888888"): 500}, od_meta=meta
    )
    assert meta["pairs_matched"] == 0
    assert meta["used_lodes"] is False  # no matched flow -> gravity
    assert np.all(od.to_numpy().sum(axis=1) > 0)


def test_enrich_output_feeds_matrix_by_GEOID():
    """Regression: enrich_zone_attributes renames geoid→GEOID; the OD matrix and
    generate_package's keep_tracts must read that exact column, or every real run
    KeyErrors. Build a minimal enriched frame the real way and exercise the path.
    """
    tracts = pd.DataFrame({
        "geoid": ["06057000100", "06057000200", "06057000300"],
        "NAMELSAD": ["Tract 1", "Tract 2", "Tract 3"],
        "NAME": ["Tract 1", "Tract 2", "Tract 3"],
        "centroid_lon": [-121.0, -121.05, -120.98],
        "centroid_lat": [39.2, 39.25, 39.22],
        "est_population": [2500.0, 1200.0, 2000.0],
        "households": [1000.0, 500.0, 800.0],
    })
    enriched = dp.enrich_zone_attributes(tracts, jobs_by_geoid={"06057000100": 400})
    assert "GEOID" in enriched.columns and "geoid" not in enriched.columns
    # the exact extraction generate_package performs (line ~432)
    keep = {str(g) for g in enriched["GEOID"].astype(str)}
    assert keep == {"06057000100", "06057000200", "06057000300"}
    # build the matrix directly off the enriched frame with a real-shaped pair
    meta = {}
    od = dp.build_daily_od_matrix(
        enriched, od_by_pair={("06057000100", "06057000200"): 300}, od_meta=meta
    )
    assert meta["used_lodes"] is True and meta["pairs_matched"] == 1
    assert np.all(od.to_numpy().sum(axis=1) > 0)


def test_output_format():
    z = _zones()
    od = dp.build_daily_od_matrix(z, od_by_pair=None)
    assert list(od.columns) == ["1", "2", "3", "4"]  # str(zone_id) columns
    assert od.index.tolist() == [1, 2, 3, 4]  # int index
    assert od.index.name == "origin_zone"


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} OD-matrix checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
