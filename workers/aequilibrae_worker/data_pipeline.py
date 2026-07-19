#!/usr/bin/env python3
"""
Dynamic data package generation for the AequilibraE worker.

Given a study-area corridor polygon (or a fallback bbox), this module:
1. Resolves intersecting Census tracts via TIGERweb
2. Pulls ACS tract population + household counts
3. Builds a synthetic-but-plausible daily OD matrix with a gravity model
4. Writes zone_attributes.csv + od_trip_matrix.csv in the worker package format

Why gravity instead of bulk LODES right now?
- State LODES OD files are very large for big states like California
- Bulk-download filtering is slow and brittle for on-demand interactive runs
- A reliable synthetic matrix is better than a stalled job for MVP

This is the right product move for now: make "draw anywhere, get a model"
work consistently, then layer in richer OD sourcing later.
"""
from __future__ import annotations

import json
import math
import os
from typing import Any

import numpy as np
import pandas as pd
import requests
from shapely.geometry import Point, shape

from lodes import (
    DEFAULT_LODES_YEAR,
    fetch_lodes_jobs_by_tract,
    fetch_lodes_od_by_tract_pair,
)

CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
TIGER_TRACT_LAYER = os.getenv(
    "TIGER_TRACT_LAYER_URL",
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query",
)
ACS_5_URL = os.getenv("CENSUS_ACS5_URL", "https://api.census.gov/data/2022/acs/acs5")

# Real LODES employment: LODES8 Workplace Area Characteristics (total jobs).
LODES_YEAR = os.getenv("LODES_YEAR", DEFAULT_LODES_YEAR)
LODES_CACHE_DIR = os.getenv(
    "LODES_CACHE_DIR", os.path.join(os.path.dirname(__file__), ".lodes_cache")
)
# Share of daily person-trips that are home-based-work commutes (NHTS ballpark).
# LODES OD (home→work) reshapes only this fraction of the trip distribution; the
# rest keeps the gravity deterrence shape. Env-overridable.
HBW_SHARE = min(1.0, max(0.0, float(os.getenv("HBW_SHARE", "0.19"))))
# Skip the LODES seed when observed pairs cover too little of the productions
# mass, so a handful of flows can't dominate the whole distribution.
OD_MIN_COVERAGE = float(os.getenv("OD_MIN_COVERAGE", "0.05"))


class DataPipelineError(RuntimeError):
    pass


def bbox_from_corridor_geojson(corridor_geojson: dict[str, Any]) -> tuple[float, float, float, float]:
    geom = shape(corridor_geojson)
    if geom.is_empty:
        raise DataPipelineError("Study area geometry is empty")
    min_lon, min_lat, max_lon, max_lat = geom.bounds
    return float(min_lon), float(min_lat), float(max_lon), float(max_lat)


def _tigerweb_features_for_bbox(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    min_lon, min_lat, max_lon, max_lat = bbox
    params = {
        "where": "1=1",
        "geometry": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "GEOID,STATE,COUNTY,CENTLAT,CENTLON",
        "returnGeometry": "false",
        "f": "json",
        "resultRecordCount": 5000,
        "inSR": "4326",
    }
    res = requests.get(TIGER_TRACT_LAYER, params=params, timeout=45)
    if res.status_code != 200:
        raise DataPipelineError(f"TIGERweb query failed: {res.status_code}")

    payload = res.json()
    if payload.get("error"):
        raise DataPipelineError(f"TIGERweb error: {payload['error']}")

    return payload.get("features", [])


def fetch_tracts_for_study_area(
    bbox: tuple[float, float, float, float],
    corridor_geojson: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """Return tract rows with ACS attributes for centroids inside the study area."""
    print("  Identifying candidate tracts via TIGERweb...")
    features = _tigerweb_features_for_bbox(bbox)
    if not features:
        raise DataPipelineError("No Census tracts found in the requested study area")

    study_geom = shape(corridor_geojson) if corridor_geojson else None
    min_lon, min_lat, max_lon, max_lat = bbox

    centroid_rows: dict[str, dict[str, Any]] = {}
    county_set: set[tuple[str, str]] = set()

    for feat in features:
        attrs = feat.get("attributes") or {}
        raw_geoid = str(attrs.get("GEOID", ""))
        if not raw_geoid:
            continue

        # TIGER layer 8 returns block-group-like 12-digit ids. Truncate to tract GEOID.
        tract_geoid = raw_geoid[:11] if len(raw_geoid) > 11 else raw_geoid
        try:
            lat = float(str(attrs.get("CENTLAT", "0")).replace("+", ""))
            lon = float(str(attrs.get("CENTLON", "0")).replace("+", ""))
        except ValueError:
            continue

        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue

        if study_geom is not None:
            pt = Point(lon, lat)
            if not (study_geom.contains(pt) or study_geom.touches(pt)):
                continue

        centroid_rows[tract_geoid] = {
            "geoid": tract_geoid,
            "NAMELSAD": attrs.get("NAMELSAD") or f"Census Tract {tract_geoid[-6:]}",
            "centroid_lon": lon,
            "centroid_lat": lat,
        }
        county_set.add((tract_geoid[:2], tract_geoid[2:5]))

    if not centroid_rows:
        raise DataPipelineError("No populated tract centroids fall inside the requested study area")

    print(f"  Candidate tracts: {len(centroid_rows)} across {len(county_set)} counties")

    all_acs = []
    for state_fips, county_fips in sorted(county_set):
        params = {
            "get": "NAME,B01003_001E,B11001_001E",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
        }
        if CENSUS_API_KEY:
            params["key"] = CENSUS_API_KEY

        res = requests.get(ACS_5_URL, params=params, timeout=45)
        if res.status_code != 200:
            print(f"  Warning: ACS fetch failed for {state_fips}/{county_fips}: {res.status_code}")
            continue

        # The Census API returns HTTP 200 with an HTML "Missing Key" page when
        # no API key is supplied — surface that as an actionable error instead
        # of a cryptic JSONDecodeError.
        try:
            data = res.json()
        except ValueError as exc:
            body_head = res.text[:300]
            if "key" in body_head.lower():
                raise DataPipelineError(
                    "Census ACS API rejected the request — an API key is required. "
                    "Get a free key at https://api.census.gov/data/key_signup.html "
                    "and set CENSUS_API_KEY in openplan/.env.local (the worker reads it)."
                ) from exc
            raise DataPipelineError(
                f"Census ACS API returned non-JSON for {state_fips}/{county_fips}: {body_head!r}"
            ) from exc
        if not data or len(data) < 2:
            continue

        header = data[0]
        df = pd.DataFrame(data[1:], columns=header)
        for col in df.columns:
            if col not in {"NAME", "state", "county", "tract"}:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        df["geoid"] = df["state"] + df["county"] + df["tract"]
        df["est_population"] = df["B01003_001E"].astype(float)
        df["households"] = df["B11001_001E"].astype(float)
        all_acs.append(df[["geoid", "NAME", "est_population", "households"]])

    if not all_acs:
        raise DataPipelineError("No ACS tract data retrieved for the study area")

    acs = pd.concat(all_acs, ignore_index=True)
    tracts = acs.merge(pd.DataFrame(centroid_rows.values()), on="geoid", how="inner")
    tracts = tracts[tracts["est_population"] > 0].copy()
    tracts = tracts.drop_duplicates(subset=["geoid"]).reset_index(drop=True)

    if tracts.empty:
        raise DataPipelineError("Study area contains no populated tracts after ACS merge")

    print(f"  Populated tracts retained: {len(tracts)}")
    return tracts


def enrich_zone_attributes(
    tracts: pd.DataFrame, jobs_by_geoid: dict[str, int] | None = None
) -> pd.DataFrame:
    """Shape dynamic tract rows into the worker's expected zone package schema.

    Total jobs come from real LODES WAC counts (`jobs_by_geoid`, keyed by
    11-digit tract GEOID) when available; tracts without a LODES value fall back
    to a population proxy. The per-tract source is recorded in `jobs_source`.
    """
    zones = tracts.copy().reset_index(drop=True)
    zones.insert(2, "zone_id", np.arange(1, len(zones) + 1))

    jobs_by_geoid = jobs_by_geoid or {}
    total_jobs_values: list[int] = []
    jobs_sources: list[str] = []
    for _, zone in zones.iterrows():
        geoid = str(zone["geoid"])
        lodes_jobs = jobs_by_geoid.get(geoid)
        if lodes_jobs is not None:
            # Real LODES total jobs (may legitimately be small/zero — gravity
            # attractions floor separately, so no artificial floor here).
            total_jobs_values.append(int(max(lodes_jobs, 0)))
            jobs_sources.append("lodes_wac")
        else:
            total_jobs_values.append(int(max(round(float(zone["est_population"]) * 0.47), 25)))
            jobs_sources.append("synthetic_pop_proxy")

    total_jobs = np.array(total_jobs_values)
    zones["total_jobs"] = total_jobs.astype(int)
    zones["jobs_source"] = jobs_sources
    # Sector splits remain fixed shares of total jobs (screening-grade); only the
    # total is sourced from LODES. Downstream demand uses total_jobs only.
    zones["retail_jobs"] = np.round(total_jobs * 0.15).astype(int)
    zones["health_jobs"] = np.round(total_jobs * 0.09).astype(int)
    zones["education_jobs"] = np.round(total_jobs * 0.10).astype(int)
    zones["accommodation_jobs"] = np.round(total_jobs * 0.04).astype(int)
    zones["govt_jobs"] = np.round(total_jobs * 0.07).astype(int)
    zones["area_sq_mi"] = 0.0

    zones["NAMELSAD"] = zones["NAME"].fillna(zones["NAMELSAD"])

    ordered = zones[
        [
            "geoid",
            "NAMELSAD",
            "zone_id",
            "centroid_lon",
            "centroid_lat",
            "area_sq_mi",
            "total_jobs",
            "jobs_source",
            "retail_jobs",
            "health_jobs",
            "education_jobs",
            "accommodation_jobs",
            "govt_jobs",
            "est_population",
            "households",
        ]
    ].rename(columns={"geoid": "GEOID"})

    return ordered


# ─── Block-group (sub-tract TAZ) support ───────────────────────────────────
# Census tracts are coarse: on the Nevada County pilot ~36% of daily trips are
# intrazonal and never load the network, so link-level volumes fall far below
# observed counts. Block groups (~3x finer, 80 vs 26 here) cut that intrazonal
# share. TIGERweb layer 8 already serves 12-digit block-group GEOIDs (the tract
# path truncates them to 11). ACS/Decennial population at BG level needs a
# CENSUS key, so when unavailable we DISAGGREGATE the known tract population to
# its block groups by LODES residence share (RAC) — screening-grade, marginal-
# preserving, keyless. NOT an ACS-measured BG population.
BLOCK_GROUP_LAYER = os.getenv(
    "TIGER_BLOCK_GROUP_LAYER_URL",
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query",
)


def fetch_block_groups_for_study_area(
    bbox: tuple[float, float, float, float],
    corridor_geojson: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """Return block-group rows (12-digit GEOID, centroid, land area, geometry)
    whose centroid falls inside the study area. Keyless (TIGERweb geometry only).
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    params = {
        "where": "1=1",
        "geometry": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "GEOID,STATE,COUNTY,TRACT,BLKGRP,CENTLAT,CENTLON,AREALAND",
        "returnGeometry": "true",
        "f": "geojson",
        "resultRecordCount": 5000,
        "inSR": "4326",
        "outSR": "4326",
    }
    res = requests.get(BLOCK_GROUP_LAYER, params=params, timeout=60)
    if res.status_code != 200:
        raise DataPipelineError(f"TIGERweb block-group query failed: {res.status_code}")
    payload = res.json()
    if payload.get("error"):
        raise DataPipelineError(f"TIGERweb block-group error: {payload['error']}")

    study_geom = shape(corridor_geojson) if corridor_geojson else None
    rows: list[dict[str, Any]] = []
    for feat in payload.get("features", []):
        props = feat.get("properties") or {}
        geoid = str(props.get("GEOID", ""))
        if len(geoid) != 12:
            continue
        try:
            lat = float(str(props.get("CENTLAT", "0")).replace("+", ""))
            lon = float(str(props.get("CENTLON", "0")).replace("+", ""))
        except ValueError:
            continue
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        if study_geom is not None:
            pt = Point(lon, lat)
            if not (study_geom.contains(pt) or study_geom.touches(pt)):
                continue
        area_land = props.get("AREALAND")
        try:
            area_sq_mi = float(area_land) / 2_589_988.11 if area_land not in (None, "") else 0.0
        except (TypeError, ValueError):
            area_sq_mi = 0.0
        rows.append({
            "geoid": geoid,
            "parent_tract": geoid[:11],
            "NAMELSAD": props.get("NAMELSAD") or f"Block Group {props.get('BLKGRP','')} (Tract {geoid[5:11]})",
            "centroid_lon": lon,
            "centroid_lat": lat,
            "area_sq_mi": round(area_sq_mi, 6),
            "geometry_geojson": feat.get("geometry"),
        })
    if not rows:
        raise DataPipelineError("No block groups found in the requested study area")
    return pd.DataFrame(rows)


def disaggregate_tracts_to_block_groups(
    tract_zones: pd.DataFrame,
    bg_rows: pd.DataFrame,
    residents_by_bg: dict[str, int] | None = None,
    jobs_by_bg: dict[str, int] | None = None,
) -> pd.DataFrame:
    """Split each tract's population/households across its block groups and emit
    the worker zone schema at block-group resolution.

    Population & households are distributed by LODES residence share
    (`residents_by_bg`, RAC C000), falling back to land-area share, then equal
    share — always preserving each parent tract's ACS total (screening-grade,
    keyless). Jobs come from real BG-level LODES WAC (`jobs_by_bg`) when present,
    else a population proxy. `tract_zones` must carry GEOID (11-digit),
    est_population, households.
    """
    residents_by_bg = residents_by_bg or {}
    jobs_by_bg = jobs_by_bg or {}
    tz = tract_zones.copy()
    tz["GEOID"] = tz["GEOID"].astype(str)
    pop_by_tract = dict(zip(tz["GEOID"], tz["est_population"].astype(float)))
    hh_by_tract = dict(zip(tz["GEOID"], tz["households"].astype(float))) if "households" in tz.columns else {}

    bg = bg_rows[bg_rows["parent_tract"].isin(pop_by_tract)].copy().reset_index(drop=True)
    if bg.empty:
        raise DataPipelineError("No block groups match the study-area tracts")

    est_pop: list[int] = []
    households: list[int] = []
    total_jobs: list[int] = []
    jobs_sources: list[str] = []
    for parent, group in bg.groupby("parent_tract", sort=False):
        idx = group.index.tolist()
        res_w = np.array([float(residents_by_bg.get(str(bg.at[i, "geoid"]), 0.0)) for i in idx])
        if res_w.sum() > 0:
            shares = res_w / res_w.sum()
        else:
            area_w = np.array([float(bg.at[i, "area_sq_mi"]) for i in idx])
            shares = area_w / area_w.sum() if area_w.sum() > 0 else np.full(len(idx), 1.0 / len(idx))
        p_total = float(pop_by_tract.get(parent, 0.0))
        h_total = float(hh_by_tract.get(parent, 0.0))
        # Largest-remainder round so the tract marginal is preserved exactly.
        p_alloc = _largest_remainder(p_total * shares)
        h_alloc = _largest_remainder(h_total * shares)
        for k, i in enumerate(idx):
            bg.at[i, "_pop"] = int(p_alloc[k])
            bg.at[i, "_hh"] = int(h_alloc[k])

    for i in range(len(bg)):
        geoid = str(bg.at[i, "geoid"])
        est_pop.append(int(bg.at[i, "_pop"]))
        households.append(int(bg.at[i, "_hh"]))
        j = jobs_by_bg.get(geoid)
        if j is not None:
            total_jobs.append(int(max(j, 0)))
            jobs_sources.append("lodes_wac_bg")
        else:
            total_jobs.append(int(max(round(int(bg.at[i, "_pop"]) * 0.47), 5)))
            jobs_sources.append("synthetic_pop_proxy")

    tj = np.array(total_jobs)
    out = pd.DataFrame({
        "GEOID": bg["geoid"].astype(str),
        "NAMELSAD": bg["NAMELSAD"],
        "zone_id": np.arange(1, len(bg) + 1),
        "centroid_lon": bg["centroid_lon"].astype(float),
        "centroid_lat": bg["centroid_lat"].astype(float),
        "area_sq_mi": bg["area_sq_mi"].astype(float),
        "total_jobs": tj.astype(int),
        "jobs_source": jobs_sources,
        "retail_jobs": np.round(tj * 0.15).astype(int),
        "health_jobs": np.round(tj * 0.09).astype(int),
        "education_jobs": np.round(tj * 0.10).astype(int),
        "accommodation_jobs": np.round(tj * 0.04).astype(int),
        "govt_jobs": np.round(tj * 0.07).astype(int),
        "est_population": np.array(est_pop, dtype=int),
        "households": np.array(households, dtype=int),
    })
    return out


def _refine_zones_to_block_groups(
    tract_zones: pd.DataFrame,
    bbox: tuple[float, float, float, float],
    corridor_geojson: dict[str, Any] | None,
    state_fips: set[str],
) -> pd.DataFrame:
    """Refine enriched tract zones to block groups: fetch BG geometry (keyless),
    LODES RAC residence weights + WAC BG jobs per state, then disaggregate. Raises
    DataPipelineError on any hard failure so the caller can fall back to tracts."""
    from lodes import (
        STATE_FIPS_TO_ABBR,
        aggregate_rac_by_block_group,
        aggregate_wac_jobs_by_block_group,
        download_lodes_rac,
        download_lodes_wac,
    )

    bg_rows = fetch_block_groups_for_study_area(bbox, corridor_geojson)
    residents_by_bg: dict[str, int] = {}
    jobs_by_bg: dict[str, int] = {}
    for fips in sorted(state_fips):
        abbr = STATE_FIPS_TO_ABBR.get(fips)
        if not abbr:
            continue
        try:
            residents_by_bg.update(aggregate_rac_by_block_group(download_lodes_rac(abbr, LODES_YEAR, LODES_CACHE_DIR)))
        except Exception as exc:  # RAC is a weight only; area fallback covers it
            print(f"  LODES RAC unavailable for {abbr} ({exc}); using area-share fallback.")
        try:
            jobs_by_bg.update(aggregate_wac_jobs_by_block_group(download_lodes_wac(abbr, LODES_YEAR, LODES_CACHE_DIR)))
        except Exception as exc:  # WAC absent -> synthetic jobs proxy per BG
            print(f"  LODES WAC (BG) unavailable for {abbr} ({exc}); using synthetic jobs proxy.")
    return disaggregate_tracts_to_block_groups(
        tract_zones, bg_rows, residents_by_bg=residents_by_bg, jobs_by_bg=jobs_by_bg
    )


def _largest_remainder(values: np.ndarray) -> np.ndarray:
    """Round a float vector to ints preserving the (rounded) total — largest-
    remainder method, so disaggregated marginals match the parent exactly."""
    target = int(round(float(values.sum())))
    floors = np.floor(values).astype(int)
    remainder = target - int(floors.sum())
    if remainder <= 0:
        return floors
    order = np.argsort(-(values - floors))  # largest fractional parts first
    floors[order[:remainder]] += 1
    return floors


def _haversine_miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 3958.7613 * math.asin(math.sqrt(a))


def build_daily_od_matrix(
    zones: pd.DataFrame,
    od_by_pair: dict[tuple[str, str], int] | None = None,
    od_meta: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """Generate a doubly-constrained gravity-model OD matrix in daily trips.

    When `od_by_pair` (real LODES home→work tract-pair flows) is supplied, it
    reshapes the Furness SEED — not the marginals. The doubly-constrained loop
    already balances every cell to the productions/attractions totals, and only
    the seed's *relative shape* enters the result (any scaling is absorbed into
    the balancing factors). So real commute geography changes the trip
    DISTRIBUTION while per-zone daily productions (households×7.5) stay
    identical — no annual→daily expansion constant is needed or invented. With
    `od_by_pair` None/empty the seed is the pure gravity friction and the output
    is byte-identical to the previous behaviour. `od_meta`, if given, is filled
    with {used_lodes, coverage, pairs_matched} for provenance.
    """
    if zones.empty:
        raise DataPipelineError("Cannot build OD matrix with zero zones")

    zone_ids = zones["zone_id"].astype(int).tolist()
    households = zones["households"].astype(float).to_numpy()
    population = zones["est_population"].astype(float).to_numpy()
    jobs = zones["total_jobs"].astype(float).to_numpy()
    lons = zones["centroid_lon"].astype(float).to_numpy()
    lats = zones["centroid_lat"].astype(float).to_numpy()
    n = len(zone_ids)

    # Daily trip productions / attractions.
    # Conservative but useful MVP estimates.
    productions = np.maximum(households * 7.5, population * 1.8)
    attractions = np.maximum(jobs * 3.2 + population * 0.15, 50)
    if attractions.sum() > 0:
        attractions = attractions * (productions.sum() / attractions.sum())

    dist = np.zeros((n, n), dtype=float)
    for i in range(n):
        for j in range(n):
            if i == j:
                dist[i, j] = 0.75  # intrazonal friction surrogate
            else:
                dist[i, j] = max(_haversine_miles(lons[i], lats[i], lons[j], lats[j]), 0.25)

    # Smooth distance decay to avoid zeroing moderate-length rural flows.
    friction = 1.0 / np.power(1.0 + (dist / 6.0), 1.6)
    np.fill_diagonal(friction, friction.diagonal() * 1.8)

    # Blend real LODES commute geography into the seed (shape only; marginals
    # unchanged). friction is strictly positive, so the (1-HBW_SHARE) term alone
    # guarantees no zero rows regardless of LODES sparsity.
    seed = friction
    used_lodes = False
    coverage = 0.0
    pairs_matched = 0
    if od_by_pair:
        # enrich_zone_attributes emits the tract column as "GEOID" (uppercase).
        geoids = zones["GEOID"].astype(str).tolist()
        idx_of: dict[str, int] = {}
        for i, g in enumerate(geoids):
            idx_of.setdefault(g, i)  # first zone for a tract wins (tracts are unique here)
        lodes = np.zeros((n, n), dtype=float)
        for (home_tract, work_tract), flow in od_by_pair.items():
            hi = idx_of.get(home_tract)
            wi = idx_of.get(work_tract)
            if hi is None or wi is None:
                continue
            lodes[hi, wi] += float(flow)
            pairs_matched += 1
        if lodes.sum() > 0:
            lodes = lodes + lodes.T  # symmetrize: approximate AM/PM round-trip
            origin_covered = lodes.sum(axis=1) > 0
            coverage = (
                float(productions[origin_covered].sum() / productions.sum())
                if productions.sum() > 0
                else 0.0
            )
            if coverage >= OD_MIN_COVERAGE:
                lodes_norm = lodes / lodes.sum()
                friction_norm = friction / friction.sum()
                seed = HBW_SHARE * lodes_norm + (1.0 - HBW_SHARE) * friction_norm
                used_lodes = True

    if od_meta is not None:
        od_meta["used_lodes"] = used_lodes
        od_meta["coverage"] = round(coverage, 4)
        od_meta["pairs_matched"] = pairs_matched

    a_factors = np.ones(n, dtype=float)
    b_factors = np.ones(n, dtype=float)

    for _ in range(30):
        denom_a = seed @ (b_factors * attractions)
        a_factors = np.divide(1.0, denom_a, out=np.zeros_like(denom_a), where=denom_a > 0)

        denom_b = seed.T @ (a_factors * productions)
        b_factors = np.divide(1.0, denom_b, out=np.zeros_like(denom_b), where=denom_b > 0)

    matrix = np.outer(a_factors * productions, b_factors * attractions) * seed
    matrix = np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0)

    # Round while keeping the matrix usable; tiny cells can become zero.
    matrix = np.round(matrix).astype(int)

    # Guarantee each origin has at least some internal demand if rounding erased everything.
    row_sums = matrix.sum(axis=1)
    for i in range(n):
        if row_sums[i] <= 0:
            matrix[i, i] = max(1, int(round(productions[i])))

    od = pd.DataFrame(matrix, index=zone_ids, columns=[str(z) for z in zone_ids])
    od.index.name = "origin_zone"
    return od


def generate_package(
    output_dir: str,
    bbox: tuple[float, float, float, float] | None = None,
    corridor_geojson: dict[str, Any] | None = None,
    zone_geography: str = "tract",
) -> dict[str, Any]:
    """Generate zone_attributes.csv + od_trip_matrix.csv in output_dir.

    ``zone_geography`` selects the zone resolution: "tract" (default) or
    "block_group" (~3x finer TAZs — cuts the intrazonal share, more accurate
    trip lengths/VMT; requires no extra key, disaggregates tract ACS population
    by keyless LODES residence share). Falls back to tracts if BG refinement
    fails.
    """
    if corridor_geojson is not None and bbox is None:
        bbox = bbox_from_corridor_geojson(corridor_geojson)
    if bbox is None:
        raise DataPipelineError("Either bbox or corridor_geojson is required")

    os.makedirs(output_dir, exist_ok=True)

    print(f"  Fetching Census tracts for study area bbox {bbox}...")
    tracts = fetch_tracts_for_study_area(bbox=bbox, corridor_geojson=corridor_geojson)

    # Real LODES employment (WAC total jobs) per state, aggregated to tracts,
    # with the population-proxy synthesis kept as an explicit fallback.
    state_fips = {str(g)[:2] for g in tracts["geoid"].astype(str) if len(str(g)) >= 2}
    try:
        jobs_by_geoid, lodes_used, lodes_failed = fetch_lodes_jobs_by_tract(
            state_fips, LODES_YEAR, LODES_CACHE_DIR
        )
    except Exception as exc:  # never let LODES stop a run
        print(f"  LODES fetch error ({exc}); falling back to synthetic jobs.")
        jobs_by_geoid, lodes_used, lodes_failed = {}, [], sorted(state_fips)

    zones = enrich_zone_attributes(tracts, jobs_by_geoid)
    lodes_tract_count = int((zones["jobs_source"] == "lodes_wac").sum())
    synth_tract_count = int((zones["jobs_source"] == "synthetic_pop_proxy").sum())
    if lodes_tract_count:
        print(
            f"  Jobs: {lodes_tract_count} tracts from LODES8 WAC {LODES_YEAR} "
            f"(states {','.join(lodes_used) or '—'}), {synth_tract_count} from synthetic fallback."
        )
    else:
        print(f"  Jobs: synthetic population proxy for all {synth_tract_count} tracts (LODES unavailable).")

    # Optional finer sub-tract TAZs: disaggregate tract zones to block groups.
    use_block_groups = str(zone_geography).lower() in ("block_group", "blockgroup", "bg")
    if use_block_groups:
        try:
            zones = _refine_zones_to_block_groups(zones, bbox, corridor_geojson, state_fips)
            print(f"  Zones refined to {len(zones)} block groups (from {len(tracts)} tracts).")
        except DataPipelineError as exc:
            print(f"  Block-group refinement failed ({exc}); keeping {len(tracts)} tract zones.")
            use_block_groups = False

    # Real LODES OD (home→work commute flows), aggregated to the study-area
    # tract pairs, to shape the trip distribution. keep_tracts bounds the fetch
    # to this study area (memory-safe on state-scale OD files). Never fails a run.
    # LODES OD is tract-keyed, so it only seeds TRACT zones; block-group zones use
    # the pure gravity distribution (their marginals still carry real BG pop/jobs).
    if use_block_groups:
        od_by_pair, od_states_used, od_states_failed = {}, [], []
    else:
        try:
            # enrich_zone_attributes emits the tract column as "GEOID" (uppercase).
            keep_tracts = {str(g) for g in zones["GEOID"].astype(str)}
            od_by_pair, od_states_used, od_states_failed = fetch_lodes_od_by_tract_pair(
                state_fips, keep_tracts, LODES_YEAR, LODES_CACHE_DIR
            )
        except Exception as exc:  # never let LODES stop a run
            print(f"  LODES OD fetch error ({exc}); using pure gravity distribution.")
            od_by_pair, od_states_used, od_states_failed = {}, [], sorted(state_fips)

    od_meta: dict[str, Any] = {}
    od = build_daily_od_matrix(zones, od_by_pair=od_by_pair, od_meta=od_meta)
    od_used_lodes = bool(od_meta.get("used_lodes"))
    if od_used_lodes:
        print(
            f"  OD: LODES8-seeded gravity — {od_meta['pairs_matched']} tract-pair flows, "
            f"coverage {od_meta['coverage']:.0%} (states {','.join(od_states_used) or '—'})."
        )
    else:
        print("  OD: synthetic gravity distribution (LODES OD unavailable or below coverage floor).")

    zone_path = os.path.join(output_dir, "zone_attributes.csv")
    od_path = os.path.join(output_dir, "od_trip_matrix.csv")
    manifest_path = os.path.join(output_dir, "manifest.json")

    zones.to_csv(zone_path, index=False)
    od.to_csv(od_path)

    manifest = {
        "version": "dynamic-v1",
        "bbox": [float(v) for v in bbox],
        "zone_geography": "block_group" if use_block_groups else "tract",
        "zones": int(len(zones)),
        "total_population": int(zones["est_population"].sum()),
        "total_households": int(zones["households"].sum()),
        "total_jobs_est": int(zones["total_jobs"].sum()),
        "total_trips": int(od.to_numpy().sum()),
        "demand_method": "lodes_seeded_gravity_v1" if od_used_lodes else "gravity_daily_v1",
        "source": {
            "tracts": "Census TIGERweb 2020",
            "demographics": "ACS 2022 5-year",
            "jobs": (
                f"LEHD LODES8 WAC S000/JT00 {LODES_YEAR} (states {','.join(lodes_used)})"
                if lodes_tract_count
                else "synthetic: jobs = 0.47 × ACS population (LODES unavailable)"
            ),
            "od": (
                "LODES8-seeded doubly-constrained gravity, HBW-weighted (screening-grade, derived)"
                if od_used_lodes
                else "synthetic gravity model"
            ),
        },
        "jobs_provenance": {
            "primary": "lehd_lodes8_wac_s000_jt00",
            "year": str(LODES_YEAR),
            "states_used": lodes_used,
            "states_failed": lodes_failed,
            "tracts_from_lodes": lodes_tract_count,
            "tracts_from_synthetic_fallback": synth_tract_count,
            "fallback_method": "jobs = round(0.47 × ACS population), floor 25",
            "caveat": (
                "Screening-grade. Total jobs are LODES WAC workplace counts where available; "
                "a population proxy is used for any tract LODES could not supply. Sector splits "
                "remain fixed shares of the total."
            ),
        },
        "od_provenance": {
            "primary": "lehd_lodes8_od_s000_jt00",
            "year": str(LODES_YEAR),
            "parts": ["main", "aux"],
            "states_used": od_states_used,
            "states_failed": od_states_failed,
            "seed_method": "furness_ipf_seed_v1",
            "blend": (
                f"seed = {HBW_SHARE:.2f}·LODES(home→work, symmetrized, normalized) + "
                f"{1 - HBW_SHARE:.2f}·gravity_friction(normalized); marginals unchanged, "
                "LODES supplies distribution shape only"
            ),
            "hbw_share": HBW_SHARE,
            "pairs_matched": od_meta.get("pairs_matched", 0),
            "od_pair_coverage": od_meta.get("coverage", 0.0),
            "used_lodes": od_used_lodes,
            "marginals": (
                "unchanged — daily productions = max(households×7.5, pop×1.8), attractions "
                "from jobs; magnitude fixed by marginals via IPF, no expansion constant"
            ),
            "directionality": (
                "LODES is one-directional home→work; the seed is symmetrized (L+Lᵀ) to "
                "approximate a daily AM/PM round-trip"
            ),
            "fallback_method": (
                "pure gravity friction seed when LODES OD is unavailable or coverage is below "
                f"{OD_MIN_COVERAGE:.0%} of productions mass (identical to gravity_daily_v1)"
            ),
            "caveat": (
                "Screening-grade, derived. LODES OD is annual home-based-WORK commute worker "
                "counts; it is used only to SHAPE the trip distribution via IPF seeding at an "
                "assumed commute share, weighted against a gravity deterrence prior — not "
                "calibrated or validated against observed traffic counts. Non-work trips are not "
                "separately modeled; directionality assumes symmetric round-trips. Not a "
                "validated travel model or calibrated forecast."
            ),
        },
        "files": {
            "zone_attributes": os.path.basename(zone_path),
            "od_trip_matrix": os.path.basename(od_path),
        },
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(
        f"  Package ready: {manifest['zones']} zones, "
        f"{manifest['total_trips']:,} estimated daily trips"
    )
    return manifest


if __name__ == "__main__":
    demo_bbox = (-121.30, 39.00, -120.00, 39.50)
    result = generate_package(output_dir="/tmp/test_dynamic_package", bbox=demo_bbox)
    print(json.dumps(result, indent=2))
