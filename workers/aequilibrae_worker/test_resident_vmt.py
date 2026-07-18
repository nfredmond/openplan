#!/usr/bin/env python3
"""Dependency-free checks for the vendored resident-VMT estimator.

Run: ``python3 workers/aequilibrae_worker/test_resident_vmt.py``

Includes a PARITY check that the vendored copy is numerically identical to the
source of truth (``scripts/modeling/screening_metrics.py``) — this is the guard
that keeps the two trees from silently diverging.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import resident_vmt as rv  # noqa: E402


def approx(a, b, tol=1e-9):
    return abs(a - b) <= tol


def test_haversine_and_intrazonal():
    # ~0.75 mi fallback when area is unknown/zero
    assert rv.intrazonal_miles(0.0) == 0.75
    assert rv.intrazonal_miles(-1.0) == 0.75
    # equal-area-circle half radius for a 2 sq-mi zone
    assert approx(rv.intrazonal_miles(2.0), 0.5 * math.sqrt(2.0 / math.pi))
    # known short great-circle distance is positive and small
    d = rv.haversine_miles(-121.0, 39.2, -121.05, 39.25)
    assert 3.0 < d < 6.0, d


def test_gateway_exclusion_drops_through_trips():
    # zone 2 is a gateway → all trips to/from it excluded from resident VMT
    od = [[10, 5, 0], [3, 8, 2], [0, 4, 6]]
    zids = [1, 2, 3]
    lon = [-121.0, -121.05, -120.98]
    lat = [39.2, 39.25, 39.22]
    area = [2.0, 0.0, 1.5]
    pop = [1000, 500, 800]
    with_gw = rv.compute_internal_resident_vmt(od, zids, lon, lat, area, pop, gateway_zone_ids=[2])
    without_gw = rv.compute_internal_resident_vmt(od, zids, lon, lat, area, pop, gateway_zone_ids=[])
    # excluding a gateway can only remove trips/VMT
    assert with_gw["daily_vmt"] < without_gw["daily_vmt"]
    assert with_gw["internal_trips"] < without_gw["internal_trips"]
    # population denominator stays the FULL study-area total (gateways included)
    assert with_gw["population"] == 2300.0 == without_gw["population"]
    assert with_gw["excluded_gateway_zone_ids"] == [2]


def test_closed_boundary_empty_gateway_set():
    od = [[10, 5], [4, 12]]
    zids = [1, 2]
    lon = [-121.0, -121.1]
    lat = [39.2, 39.3]
    area = [1.0, 1.0]
    pop = [600, 900]
    res = rv.compute_internal_resident_vmt(od, zids, lon, lat, area, pop, gateway_zone_ids=[])
    assert res["excluded_gateway_zone_ids"] == []
    assert res["daily_vmt"] > 0
    assert res["vmt_per_capita"] == res["daily_vmt"] / 1500.0


def test_divide_by_zero_population_guard():
    res = rv.compute_internal_resident_vmt(
        [[1.0]], [1], [-121.0], [39.2], [0.0], [0.0], gateway_zone_ids=[]
    )
    assert res["vmt_per_capita"] == 0.0
    assert res["avg_trip_miles"] > 0  # trips exist even if population is 0


def test_network_daily_vmt():
    # 2 links: 1000 veh × 1609.34 m (=1 mi) + 500 veh × 3218.68 m (=2 mi) = 2000
    total = rv.compute_network_daily_vmt([1000, 500], [1609.34, 3218.68])
    assert approx(total, 2000.0, tol=1e-3)
    # non-finite / non-positive entries are skipped
    assert rv.compute_network_daily_vmt([float("nan"), -5, 0], [100, 100, 100]) == 0.0


def test_parity_with_source_of_truth():
    """The vendored copy MUST match scripts/modeling/screening_metrics.py."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "modeling"))
    try:
        import screening_metrics as sm  # type: ignore
    except Exception as e:  # pragma: no cover - only when cross-tree unavailable
        print(f"  (parity check skipped — screening_metrics not importable: {e})")
        return
    od = [[10, 5, 0], [3, 8, 2], [0, 4, 6]]
    zids = [1, 2, 3]
    lon = [-121.0, -121.05, -120.98]
    lat = [39.2, 39.25, 39.22]
    area = [2.0, 0.0, 1.5]
    pop = [1000, 500, 800]
    for gws in ([], [2], [1, 3]):
        a = rv.compute_internal_resident_vmt(od, zids, lon, lat, area, pop, gateway_zone_ids=gws)
        b = sm.compute_internal_resident_vmt(od, zids, lon, lat, area, pop, gateway_zone_ids=gws)
        assert a == b, f"parity drift for gateways={gws}: {a} != {b}"
    assert rv.VMT_NETWORK_CIRCUITY == sm.VMT_NETWORK_CIRCUITY == 1.3


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"All {len(tests)} resident_vmt checks passed.")
