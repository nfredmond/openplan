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

CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
TIGER_TRACT_LAYER = os.getenv(
    "TIGER_TRACT_LAYER_URL",
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query",
)
ACS_5_URL = os.getenv("CENSUS_ACS5_URL", "https://api.census.gov/data/2022/acs/acs5")


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

        data = res.json()
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


def enrich_zone_attributes(tracts: pd.DataFrame) -> pd.DataFrame:
    """Shape dynamic tract rows into the worker's expected zone package schema."""
    zones = tracts.copy().reset_index(drop=True)
    zones.insert(2, "zone_id", np.arange(1, len(zones) + 1))

    # Pragmatic tract-level employment estimates for MVP.
    # Keep the fields the worker bundle already ships so downstream code remains stable.
    total_jobs = np.maximum(np.round(zones["est_population"] * 0.47), 25)
    zones["total_jobs"] = total_jobs.astype(int)
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


def _haversine_miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 3958.7613 * math.asin(math.sqrt(a))


def build_daily_od_matrix(zones: pd.DataFrame) -> pd.DataFrame:
    """Generate a doubly-constrained gravity-model OD matrix in daily trips."""
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

    a_factors = np.ones(n, dtype=float)
    b_factors = np.ones(n, dtype=float)

    for _ in range(30):
        denom_a = friction @ (b_factors * attractions)
        a_factors = np.divide(1.0, denom_a, out=np.zeros_like(denom_a), where=denom_a > 0)

        denom_b = friction.T @ (a_factors * productions)
        b_factors = np.divide(1.0, denom_b, out=np.zeros_like(denom_b), where=denom_b > 0)

    matrix = np.outer(a_factors * productions, b_factors * attractions) * friction
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
) -> dict[str, Any]:
    """Generate zone_attributes.csv + od_trip_matrix.csv in output_dir."""
    if corridor_geojson is not None and bbox is None:
        bbox = bbox_from_corridor_geojson(corridor_geojson)
    if bbox is None:
        raise DataPipelineError("Either bbox or corridor_geojson is required")

    os.makedirs(output_dir, exist_ok=True)

    print(f"  Fetching Census tracts for study area bbox {bbox}...")
    tracts = fetch_tracts_for_study_area(bbox=bbox, corridor_geojson=corridor_geojson)
    zones = enrich_zone_attributes(tracts)
    od = build_daily_od_matrix(zones)

    zone_path = os.path.join(output_dir, "zone_attributes.csv")
    od_path = os.path.join(output_dir, "od_trip_matrix.csv")
    manifest_path = os.path.join(output_dir, "manifest.json")

    zones.to_csv(zone_path, index=False)
    od.to_csv(od_path)

    manifest = {
        "version": "dynamic-v1",
        "bbox": [float(v) for v in bbox],
        "zones": int(len(zones)),
        "total_population": int(zones["est_population"].sum()),
        "total_households": int(zones["households"].sum()),
        "total_jobs_est": int(zones["total_jobs"].sum()),
        "total_trips": int(od.to_numpy().sum()),
        "demand_method": "gravity_daily_v1",
        "source": {
            "tracts": "Census TIGERweb 2020",
            "demographics": "ACS 2022 5-year",
            "od": "synthetic gravity model",
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
