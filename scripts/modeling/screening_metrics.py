#!/usr/bin/env python3
"""Pure-math helpers for the screening runtime and count validator.

Stdlib-only on purpose (mirrors workers/aequilibrae_worker/lodes.py): every
estimator and validation metric here is unit-testable without the heavy
geo/modeling stack via `python3 scripts/modeling/test_screening_metrics.py`.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

EARTH_RADIUS_MILES = 3958.7613
# International mile, exact. Shared with the serialized-artifact conservation
# reread: two rounded variants differed by 2.5 ppm, which becomes 15 VMT on a
# six-million-VMT network and correctly tripped the fail-closed accounting gate.
METERS_PER_MILE = 1609.344
# Great-circle -> network distance adjustment used by the internal-resident VMT
# estimator. A screening constant, not a calibrated per-place value: straight-line
# zone-to-zone distance understates travel on a real network, and 1.3 is the
# conventional planning circuity factor. It applies to every study area equally.
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
    # Trips on the OD matrix DIAGONAL: they begin and end in the same zone and
    # therefore never travel on a link. They are real travel — they carry VMT,
    # via intrazonal_miles above — but no link volume, so a comparison of
    # modelled volumes to traffic counts cannot see them at all. Counted here so
    # the app can tell a planner what share of their travel that is, instead of
    # leaving them to read the gap as failed demand.
    intrazonal_trips = 0.0
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
            if i == j:
                intrazonal_trips += trips

    population = sum(float(p) for p in est_population if math.isfinite(float(p)))
    return {
        "daily_vmt": daily_vmt,
        "population": population,
        "vmt_per_capita": daily_vmt / population if population > 0 else 0.0,
        "internal_trips": internal_trips,
        "intrazonal_trips": intrazonal_trips,
        # Share of INTERNAL trips, so gateway/through traffic is out of both
        # halves — the denominator is the resident travel this study area is
        # actually modelling.
        "intrazonal_share": intrazonal_trips / internal_trips if internal_trips > 0 else 0.0,
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


# The road classes a screening model is graded on, coarsest first. Ordered so a
# report reads from the roads carrying the most traffic down to the ones
# carrying the least, which is also the order of how much the model gets right.
ROAD_CLASS_ORDER = ("motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified")


def accuracy_by_road_class(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """How accurate this run is on each kind of road, not just overall.

    WHY ONE NUMBER IS NOT ENOUGH, AND IS ARGUABLY MISLEADING. Measured on a real
    county run, matched against 17 published Caltrans stations:

        motorway   9 stations   median error  22.8%   model/observed 1.10
        secondary  4 stations   median error 132.4%   model/observed 1.63
        primary    2 stations   median error 146.6%   model/observed 2.47
        trunk      1 station    median error 227.1%   model/observed 3.27

    The headline for that run is "39.7% median error". A planner asking about a
    freeway corridor and a planner asking about an arterial are being handed
    numbers of completely different quality, and the single figure tells neither
    of them which one they have.

    The ratio matters as much as the error: consistently above 1 is a model
    putting traffic where it does not belong, which is a different problem from
    a model that is merely imprecise, and it is the direction that overstates a
    corridor's volume in a funding application.
    """
    grouped: dict[str, list[dict[str, float]]] = {}
    for row in rows:
        road_class = str(row.get("model_link_type") or "").strip().lower()
        if not road_class:
            continue
        observed = _as_float(row.get("observed_volume"))
        modeled = _as_float(row.get("modeled_daily_pce"))
        error = _as_float(row.get("absolute_percent_error"))
        if observed is None or modeled is None or error is None or observed <= 0:
            continue
        grouped.setdefault(road_class, []).append(
            {"error": error, "ratio": modeled / observed}
        )

    def sort_key(name: str) -> tuple[int, str]:
        return (ROAD_CLASS_ORDER.index(name) if name in ROAD_CLASS_ORDER else len(ROAD_CLASS_ORDER), name)

    breakdown: list[dict[str, Any]] = []
    for road_class in sorted(grouped, key=sort_key):
        entries = grouped[road_class]
        breakdown.append(
            {
                "road_class": road_class,
                "stations": len(entries),
                "median_absolute_percent_error": round(_median([e["error"] for e in entries]), 2),
                "median_model_over_observed": round(_median([e["ratio"] for e in entries]), 3),
                # One station is a data point, not an accuracy. Said here rather
                # than left to a reader who sees a tidy percentage next to it.
                "single_station": len(entries) == 1,
            }
        )
    return breakdown


def road_class_accuracy_note(breakdown: Sequence[Mapping[str, Any]]) -> str:
    """The by-class result in a sentence a planner can act on."""
    usable = [entry for entry in breakdown if not entry["single_station"]]
    if not breakdown:
        return (
            "No matched count station recorded the kind of road it was on, so this run's accuracy "
            "cannot be broken down by road type."
        )
    if not usable:
        return (
            "Every road type here was matched by a single count station, so the per-type figures "
            "are individual comparisons rather than measures of accuracy."
        )
    best = min(usable, key=lambda entry: entry["median_absolute_percent_error"])
    worst = max(usable, key=lambda entry: entry["median_absolute_percent_error"])
    if best["road_class"] == worst["road_class"]:
        return (
            f"Accuracy was measured on {best['road_class']} roads only "
            f"({best['stations']} stations, {best['median_absolute_percent_error']}% median error). "
            "Other road types in this study area have no published counts to check against."
        )
    return (
        f"Accuracy is not the same on every kind of road. On {best['road_class']} the median error "
        f"is {best['median_absolute_percent_error']}% across {best['stations']} stations; on "
        f"{worst['road_class']} it is {worst['median_absolute_percent_error']}% across "
        f"{worst['stations']}. A figure for a {worst['road_class']} road is far weaker evidence "
        f"than the same figure for a {best['road_class']}, and the study-area median hides that."
    )


def _as_float(value: Any) -> float | None:
    if value in (None, "", "null"):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0
