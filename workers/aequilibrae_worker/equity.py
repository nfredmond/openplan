#!/usr/bin/env python3
"""Screening-grade environmental-justice / Title VI equity overlay for the
AequilibraE worker.

For each zone it pulls the standard EJ/Title VI ACS indicators — low-income
share, minority (non-white or Hispanic) share, and zero-vehicle-household share
— at the run's own geography (tract OR block group), flags the zones with
above-typical disadvantage, and compares resident VMT per capita and transit
access between the equity-focus zones and the rest of the study area.

This is a SCREENING comparison against real ACS data. It is NOT the official
CalEnviroScreen / SB 535 disadvantaged-community designation (which is a fixed
OEHHA tract list); the focus flag here is a relative, within-study-area
screening indicator. Requires a CENSUS_API_KEY for the ACS pull.

The pure aggregation (per-zone VMT, classification, summary) is stdlib-only and
unit-testable; only ``fetch_acs_equity`` touches the network.
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

from resident_vmt import haversine_miles, intrazonal_miles, VMT_NETWORK_CIRCUITY

# ACS 5-year variables:
#   B01003_001E total population
#   B17001_001E / _002E  poverty universe / income below poverty (TRACT ONLY —
#     the ACS does not publish B17001 at block-group geography; the API returns
#     HTTP 200 with null cells, verified live 2026-07-21)
#   C17002_001E / _002E / _003E  income-to-poverty-ratio universe / under 0.50 /
#     0.50-0.99 (the block-group-published poverty table; _002E+_003E = below
#     poverty, same universe concept as B17001)
#   B03002_001E / _003E  race-ethnicity total / white-alone-not-Hispanic
#   B25044_001E / _003E / _010E  occupied HH / owner no-vehicle / renter no-vehicle
ACS_EQUITY_VARS = [
    "B01003_001E",
    "B17001_001E", "B17001_002E",
    "B03002_001E", "B03002_003E",
    "B25044_001E", "B25044_003E", "B25044_010E",
]

ACS_EQUITY_VARS_BG = [
    "B01003_001E",
    "C17002_001E", "C17002_002E", "C17002_003E",
    "B03002_001E", "B03002_003E",
    "B25044_001E", "B25044_003E", "B25044_010E",
]

EQUITY_METHOD_NOTE = (
    "Screening EJ/Title VI overlay: ACS 5-year low-income (below-poverty), "
    "minority (non-white or Hispanic), and zero-vehicle-household shares at the "
    "run's geography. A zone is 'equity focus' when it exceeds the study-area "
    "population-weighted average on at least 2 of the 3 indicators. Resident VMT "
    "per capita is attributed to each trip's ORIGIN zone (auto internal OD, "
    "gateway zones excluded). Screening-grade and RELATIVE to this study area — "
    "NOT the official CalEnviroScreen/SB 535 disadvantaged-community designation."
)


def _share(numerator: float, denominator: float) -> float:
    return float(numerator) / float(denominator) if denominator and denominator > 0 else 0.0


def repair_geoids(raw_values: Iterable[Any], zone_geography: str | None = None) -> list[str]:
    """Restore Census GEOID strings that lost leading zeros to numeric coercion.

    A CSV round-trip can turn a leading-zero GEOID into an int (CA tract
    ``06057000100`` → ``6057000100``). Zero-padding needs the EXPECTED length —
    a CA block group coerced to 11 digits is indistinguishable from a clean
    tract GEOID by length alone. ``zone_geography`` supplies it: 'block_group'
    pads to 12, anything else to 11. When the package manifest doesn't stamp a
    geography (pre-staged pilots), pass None and tract length is assumed —
    exactly the historical behavior.
    """
    expected_len = 12 if str(zone_geography or "").lower() in ("block_group", "blockgroup", "bg") else 11
    return [str(v).strip().zfill(expected_len) for v in raw_values]


def resident_vmt_by_origin_zone(
    od_matrix: Sequence[Sequence[float]],
    zone_ids: Sequence[int],
    centroid_lon: Sequence[float],
    centroid_lat: Sequence[float],
    area_sq_mi: Sequence[float],
    gateway_zone_ids: Iterable[int],
    circuity: float = VMT_NETWORK_CIRCUITY,
) -> dict[int, float]:
    """Daily internal-resident VMT attributed to each ORIGIN zone (same distance
    basis as compute_internal_resident_vmt: haversine × circuity, intrazonal by
    area; gateway zones excluded from both ends). Returns {zone_id: vmt}."""
    gateway_set = {int(z) for z in gateway_zone_ids}
    n = len(zone_ids)
    out: dict[int, float] = {}
    for i in range(n):
        zid = int(zone_ids[i])
        if zid in gateway_set:
            continue
        row = od_matrix[i]
        vmt = 0.0
        for j in range(n):
            if int(zone_ids[j]) in gateway_set:
                continue
            trips = float(row[j])
            if not (trips > 0) or trips != trips:  # skip <=0 and NaN
                continue
            if i == j:
                miles = intrazonal_miles(float(area_sq_mi[i]))
            else:
                miles = haversine_miles(
                    float(centroid_lon[i]), float(centroid_lat[i]),
                    float(centroid_lon[j]), float(centroid_lat[j]),
                ) * circuity
            vmt += trips * miles
        out[zid] = vmt
    return out


def _weighted_avg(values: Sequence[float], weights: Sequence[float]) -> float:
    wsum = sum(float(w) for w in weights)
    if wsum <= 0:
        return 0.0
    return sum(float(v) * float(w) for v, w in zip(values, weights)) / wsum


def classify_equity_focus(zones: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flag equity-focus zones: above the study-area population-weighted average
    on >= 2 of {low_income_share, minority_share, zero_vehicle_share}. Mutates a
    copy of each zone dict with `is_equity_focus` + `indicators_above_avg`."""
    pops = [float(z.get("population", 0.0)) for z in zones]
    li = [float(z.get("low_income_share", 0.0)) for z in zones]
    mi = [float(z.get("minority_share", 0.0)) for z in zones]
    zv = [float(z.get("zero_vehicle_share", 0.0)) for z in zones]
    avg_li, avg_mi, avg_zv = _weighted_avg(li, pops), _weighted_avg(mi, pops), _weighted_avg(zv, pops)
    out = []
    for z in zones:
        above = 0
        above += 1 if float(z.get("low_income_share", 0.0)) > avg_li else 0
        above += 1 if float(z.get("minority_share", 0.0)) > avg_mi else 0
        above += 1 if float(z.get("zero_vehicle_share", 0.0)) > avg_zv else 0
        zc = dict(z)
        zc["indicators_above_avg"] = above
        zc["is_equity_focus"] = above >= 2
        out.append(zc)
    return out


def summarize_equity(
    zones: Sequence[dict[str, Any]],
    resident_vmt_by_zone: dict[int, float],
) -> dict[str, Any]:
    """Compare equity-focus zones vs the rest: population share, resident VMT per
    capita, and the disparity ratio. `zones` must carry zone_id, population,
    is_equity_focus and the three share fields (post classify_equity_focus)."""
    def _agg(subset: list[dict[str, Any]]) -> dict[str, Any]:
        pop = sum(float(z.get("population", 0.0)) for z in subset)
        vmt = sum(float(resident_vmt_by_zone.get(int(z["zone_id"]), 0.0)) for z in subset)
        return {
            "zones": len(subset),
            "population": round(pop),
            "resident_vmt": round(vmt, 1),
            "resident_vmt_per_capita": round(vmt / pop, 4) if pop > 0 else None,
            "avg_low_income_share": round(_weighted_avg(
                [float(z.get("low_income_share", 0.0)) for z in subset],
                [float(z.get("population", 0.0)) for z in subset]), 4),
            "avg_minority_share": round(_weighted_avg(
                [float(z.get("minority_share", 0.0)) for z in subset],
                [float(z.get("population", 0.0)) for z in subset]), 4),
            "avg_zero_vehicle_share": round(_weighted_avg(
                [float(z.get("zero_vehicle_share", 0.0)) for z in subset],
                [float(z.get("population", 0.0)) for z in subset]), 4),
        }

    focus = [z for z in zones if z.get("is_equity_focus")]
    rest = [z for z in zones if not z.get("is_equity_focus")]
    focus_agg, rest_agg = _agg(focus), _agg(rest)
    total_pop = focus_agg["population"] + rest_agg["population"]

    disparity = None
    fpc, rpc = focus_agg["resident_vmt_per_capita"], rest_agg["resident_vmt_per_capita"]
    if fpc is not None and rpc is not None and rpc > 0:
        disparity = round(fpc / rpc, 3)

    return {
        "focus_zone_count": len(focus),
        "total_zone_count": len(zones),
        "focus_population_share": round(focus_agg["population"] / total_pop, 4) if total_pop > 0 else None,
        "equity_focus": focus_agg,
        "rest_of_area": rest_agg,
        "vmt_per_capita_disparity_ratio": disparity,
        "method": EQUITY_METHOD_NOTE,
    }


def build_equity_zone(geoid: str, population: float, acs_row: dict[str, float]) -> dict[str, Any]:
    """Compute the three EJ shares for one geography from its ACS variable row."""
    total = float(acs_row.get("B01003_001E", population) or population)
    if "C17002_001E" in acs_row:
        # Block-group rows carry C17002 (B17001 is not published at BG level):
        # below-poverty = ratio under 0.50 + ratio 0.50-0.99, same universe.
        pov_univ = float(acs_row.get("C17002_001E", 0.0) or 0.0)
        pov_below = (
            float(acs_row.get("C17002_002E", 0.0) or 0.0)
            + float(acs_row.get("C17002_003E", 0.0) or 0.0)
        )
    else:
        pov_univ = float(acs_row.get("B17001_001E", 0.0) or 0.0)
        pov_below = float(acs_row.get("B17001_002E", 0.0) or 0.0)
    race_total = float(acs_row.get("B03002_001E", 0.0) or 0.0)
    white_nh = float(acs_row.get("B03002_003E", 0.0) or 0.0)
    hh_total = float(acs_row.get("B25044_001E", 0.0) or 0.0)
    zero_veh = float(acs_row.get("B25044_003E", 0.0) or 0.0) + float(acs_row.get("B25044_010E", 0.0) or 0.0)
    return {
        "geoid": geoid,
        "population": total,
        "low_income_share": _share(pov_below, pov_univ),
        "minority_share": _share(race_total - white_nh, race_total),
        "zero_vehicle_share": _share(zero_veh, hh_total),
    }


def fetch_acs_equity(
    state_county_pairs: Iterable[tuple[str, str]],
    level: str,
    census_key: str,
    acs_url: str = "https://api.census.gov/data/2022/acs/acs5",
    timeout: int = 45,
) -> dict[str, dict[str, float]]:
    """Fetch the equity ACS variables for every tract/block-group in the given
    counties. `level` is 'tract' or 'block group'. Returns {GEOID: {var: value}}
    keyed by 11-digit (tract) or 12-digit (block group) GEOID. Network call;
    returns {} on any failure so equity is skipped rather than failing the run."""
    import requests  # lazy

    if not census_key:
        return {}
    # BG requests must swap B17001 for C17002 — B17001 comes back all-null at
    # block-group geography (HTTP 200, no error), silently zeroing poverty.
    acs_vars = ACS_EQUITY_VARS_BG if level == "block group" else ACS_EQUITY_VARS
    out: dict[str, dict[str, float]] = {}
    for state_fips, county_fips in sorted(set(state_county_pairs)):
        params = {
            "get": "NAME," + ",".join(acs_vars),
            "for": f"{level}:*",
            "in": f"state:{state_fips} county:{county_fips}"
            + (" tract:*" if level == "block group" else ""),
            "key": census_key,
        }
        try:
            res = requests.get(acs_url, params=params, timeout=timeout)
            data = res.json()
        except Exception:
            continue
        if not isinstance(data, list) or len(data) < 2:
            continue
        header = data[0]
        idx = {name: i for i, name in enumerate(header)}
        for row in data[1:]:
            if level == "block group":
                geoid = row[idx["state"]] + row[idx["county"]] + row[idx["tract"]] + row[idx["block group"]]
            else:
                geoid = row[idx["state"]] + row[idx["county"]] + row[idx["tract"]]
            vals: dict[str, float] = {}
            for var in acs_vars:
                try:
                    vals[var] = float(row[idx[var]])
                except (TypeError, ValueError, KeyError):
                    vals[var] = 0.0
            out[geoid] = vals
    return out
