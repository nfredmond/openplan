#!/usr/bin/env python3
"""Internal-resident VMT estimator for the AequilibraE worker.

SOURCE OF TRUTH: ``scripts/modeling/screening_metrics.py``. This module is a
byte-for-byte vendored mirror of that file's estimator functions. The worker
runs from its own directory (and Docker build context), so it cannot import the
cross-tree ``scripts/modeling`` package at runtime — the same reason
``lodes.py`` is vendored here. A parity test
(``test_resident_vmt.py`` / the county lane's ``test_screening_metrics.py``)
keeps the two copies in numeric lock-step; **edit the source-of-truth file and
re-copy, do not diverge here.**

Stdlib-only on purpose so it is unit-testable without the geo/modeling stack.
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
