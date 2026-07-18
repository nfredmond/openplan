#!/usr/bin/env python3
"""Pure-math helpers for the screening runtime and count validator.

Stdlib-only on purpose (mirrors workers/aequilibrae_worker/lodes.py): every
estimator and validation metric here is unit-testable without the heavy
geo/modeling stack via `python3 scripts/modeling/test_screening_metrics.py`.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

EARTH_RADIUS_MILES = 3958.7613
METERS_PER_MILE = 1609.34
# Great-circle -> network distance adjustment used by the internal-resident VMT
# estimator; matches the seeded NCTC derivation (openplan/scripts/seed-nctc-demo.ts).
VMT_NETWORK_CIRCUITY = 1.3


def haversine_miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))


def intrazonal_miles(area_sq_mi: float) -> float:
    """Half the radius of the equal-area circle; 0.75 mi when area is unknown."""
    return 0.5 * math.sqrt(area_sq_mi / math.pi) if area_sq_mi > 0 else 0.75


def compute_internal_resident_vmt(
    od_matrix: Sequence[Sequence[float]],
    zone_ids: Sequence[int],
    centroid_lon: Sequence[float],
    centroid_lat: Sequence[float],
    area_sq_mi: Sequence[float],
    est_population: Sequence[float],
    gateway_zone_ids: Iterable[int],
    circuity: float = VMT_NETWORK_CIRCUITY,
) -> dict[str, Any]:
    """Internal-resident VMT: Σ internal→internal OD trips × centroid distance.

    External gateway zones are excluded from both trip ends so pass-through
    travel loaded at the gateways is not counted — CEQA §15064.3 measures
    resident/employee-generated VMT, not through traffic. Population stays the
    full study-area total (gateway zones are real resident zones that also
    carry the external loads).
    """
    gateway_set = {int(z) for z in gateway_zone_ids}
    n = len(zone_ids)
    daily_vmt = 0.0
    internal_trips = 0.0
    for i in range(n):
        if int(zone_ids[i]) in gateway_set:
            continue
        row = od_matrix[i]
        for j in range(n):
            if int(zone_ids[j]) in gateway_set:
                continue
            trips = float(row[j])
            if not math.isfinite(trips) or trips <= 0:
                continue
            if i == j:
                miles = intrazonal_miles(float(area_sq_mi[i]))
            else:
                miles = (
                    haversine_miles(
                        float(centroid_lon[i]), float(centroid_lat[i]),
                        float(centroid_lon[j]), float(centroid_lat[j]),
                    )
                    * circuity
                )
            daily_vmt += trips * miles
            internal_trips += trips

    population = sum(float(p) for p in est_population if math.isfinite(float(p)))
    return {
        "daily_vmt": daily_vmt,
        "population": population,
        "vmt_per_capita": daily_vmt / population if population > 0 else 0.0,
        "internal_trips": internal_trips,
        "avg_trip_miles": daily_vmt / internal_trips if internal_trips > 0 else 0.0,
        "circuity": circuity,
        "excluded_gateway_zone_ids": sorted(gateway_set),
    }


def compute_network_daily_vmt(volumes: Sequence[float], distances_m: Sequence[float]) -> float:
    """Unfiltered network VMT: Σ link daily volume × link length (metres→miles).

    Includes external/through travel — this is the figure the resident-VMT
    estimator deliberately excludes, archived alongside it for transparency.
    """
    total = 0.0
    for volume, distance_m in zip(volumes, distances_m):
        v = float(volume)
        d = float(distance_m)
        if math.isfinite(v) and math.isfinite(d) and v > 0 and d > 0:
            total += v * d / METERS_PER_MILE
    return total


def percent_rmse(observed: Sequence[float], modeled: Sequence[float]) -> float | None:
    """Root-mean-square error as a percent of the mean observed volume."""
    pairs = [(float(o), float(m)) for o, m in zip(observed, modeled)]
    if not pairs:
        return None
    mean_observed = sum(o for o, _ in pairs) / len(pairs)
    if mean_observed <= 0:
        return None
    rmse = math.sqrt(sum((m - o) ** 2 for o, m in pairs) / len(pairs))
    return 100.0 * rmse / mean_observed


def geh_statistic(observed_hourly: float, modeled_hourly: float) -> float | None:
    """GEH for one station on hourly volumes: sqrt(2(m-c)^2 / (m+c))."""
    total = observed_hourly + modeled_hourly
    if total <= 0:
        return None
    return math.sqrt(2.0 * (modeled_hourly - observed_hourly) ** 2 / total)


GEH_BASIS_NOTE = (
    "GEH computed on average-hourly equivalents (daily volume / 24); "
    "peak-hour GEH, the customary basis for the <5 acceptance rule, will differ."
)


def geh_summary(
    observed_daily: Sequence[float],
    modeled_daily: Sequence[float],
    hourly_divisor: float = 24.0,
) -> dict[str, Any]:
    """Mean/max GEH across stations on an explicit average-hourly basis.

    Observed counts here are daily (AADT-style), while GEH acceptance
    thresholds are defined for hourly flows — so the basis is stated in the
    result rather than silently assumed.
    """
    values = []
    for obs, mod in zip(observed_daily, modeled_daily):
        geh = geh_statistic(float(obs) / hourly_divisor, float(mod) / hourly_divisor)
        if geh is not None:
            values.append(geh)
    if not values:
        return {"mean": None, "max": None, "stations": 0, "basis": GEH_BASIS_NOTE}
    return {
        "mean": sum(values) / len(values),
        "max": max(values),
        "stations": len(values),
        "basis": GEH_BASIS_NOTE,
    }
