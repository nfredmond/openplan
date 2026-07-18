#!/usr/bin/env python3
"""Stdlib checks for screening_metrics — run: python3 scripts/modeling/test_screening_metrics.py"""
from __future__ import annotations

import math

from screening_metrics import (
    GEH_BASIS_NOTE,
    compute_internal_resident_vmt,
    compute_network_daily_vmt,
    geh_statistic,
    geh_summary,
    haversine_miles,
    intrazonal_miles,
    percent_rmse,
)

CHECKS: list[str] = []


def check(name: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(f"FAILED: {name}")
    CHECKS.append(name)


def approx(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol


def main() -> None:
    # SF (-122.4194, 37.7749) to LA (-118.2437, 34.0522): ~347.4 great-circle miles.
    sf_la = haversine_miles(-122.4194, 37.7749, -118.2437, 34.0522)
    check("haversine SF-LA ~347 mi", 345.0 < sf_la < 350.0)
    check("haversine zero distance", approx(haversine_miles(-120.0, 39.0, -120.0, 39.0), 0.0))

    check("intrazonal area=pi -> 0.5 mi", approx(intrazonal_miles(math.pi), 0.5))
    check("intrazonal unknown area -> 0.75 mi", approx(intrazonal_miles(0.0), 0.75))

    # 3-zone case: zones 1,2 internal; zone 3 a gateway. Centroids 0.5 deg of
    # longitude apart at the equator; areas of pi sq mi so intrazonals are 0.5 mi.
    zone_ids = [1, 2, 3]
    lon = [0.0, 0.5, 1.0]
    lat = [0.0, 0.0, 0.0]
    areas = [math.pi, math.pi, math.pi]
    pops = [100.0, 100.0, 50.0]
    od = [
        [10.0, 20.0, 5.0],
        [0.0, 4.0, 7.0],
        [3.0, 6.0, 9.0],
    ]
    result = compute_internal_resident_vmt(od, zone_ids, lon, lat, areas, pops, gateway_zone_ids=[3])
    d12 = haversine_miles(0.0, 0.0, 0.5, 0.0) * 1.3
    expected_vmt = 10.0 * 0.5 + 20.0 * d12 + 4.0 * 0.5
    check("internal VMT hand-computed", approx(result["daily_vmt"], expected_vmt, 1e-9))
    check("internal trips exclude gateway pairs", approx(result["internal_trips"], 34.0))
    check("population includes gateway-zone residents", approx(result["population"], 250.0))
    check("vmt per capita", approx(result["vmt_per_capita"], expected_vmt / 250.0, 1e-12))
    check("excluded gateway ids recorded", result["excluded_gateway_zone_ids"] == [3])

    all_gateway = compute_internal_resident_vmt(od, zone_ids, lon, lat, areas, pops, gateway_zone_ids=[1, 2, 3])
    check("all-gateway case yields zero VMT without dividing by zero", approx(all_gateway["daily_vmt"], 0.0) and approx(all_gateway["avg_trip_miles"], 0.0))

    check("network VMT one mile link", approx(compute_network_daily_vmt([100.0], [1609.34]), 100.0))
    check("network VMT skips zero-volume links", approx(compute_network_daily_vmt([0.0, 50.0], [5000.0, 3218.68]), 100.0))

    # obs [100, 200], mod [110, 190]: rmse = 10, mean obs = 150 -> 6.6667%
    prmse = percent_rmse([100.0, 200.0], [110.0, 190.0])
    check("percent RMSE hand-computed", prmse is not None and approx(prmse, 100.0 * 10.0 / 150.0, 1e-9))
    check("percent RMSE empty -> None", percent_rmse([], []) is None)

    geh_equal = geh_statistic(1000.0, 1000.0)
    check("GEH identical volumes -> 0", geh_equal is not None and approx(geh_equal, 0.0))
    # c=100, m=50: GEH = sqrt(2*2500/150) = sqrt(33.333) = 5.7735
    geh = geh_statistic(100.0, 50.0)
    check("GEH hand-computed", geh is not None and approx(geh, math.sqrt(2 * 2500.0 / 150.0), 1e-9))
    check("GEH zero-total -> None", geh_statistic(0.0, 0.0) is None)

    summary = geh_summary([24000.0, 48000.0], [24000.0, 24000.0])
    check("GEH summary counts stations", summary["stations"] == 2)
    check("GEH summary max is worst station", summary["max"] is not None and summary["max"] > summary["mean"])
    check("GEH summary states its basis", summary["basis"] == GEH_BASIS_NOTE)

    print(f"OK — {len(CHECKS)} checks passed")


if __name__ == "__main__":
    main()
