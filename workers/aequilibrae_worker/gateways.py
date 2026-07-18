#!/usr/bin/env python3
"""External / cordon gateway detection for the AequilibraE worker.

Ported from the county screening lane
(``scripts/modeling/screening_runtime.py`` :: ``detect_external_gateways`` /
``build_external_gateway_matrix``) so the worker lane loads real pass-through
travel on highways that cross the study-area boundary (US-20 / SR-49 / I-80),
instead of running closed-boundary. Keep this in step with the county lane's
logic; the daily-trip constants and share-based OD distribution are identical.

All figures are screening-grade heuristics (uncalibrated to real cordon
counts), matching the county lane's disclosed behaviour.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

import numpy as np
import pandas as pd
from shapely import wkt
from shapely.geometry import Point

# Screening-grade daily boundary-crossing trips per gateway link type
# (identical to scripts/modeling/screening_runtime.py:GATEWAY_DAILY_TRIPS).
GATEWAY_DAILY_TRIPS = {
    "motorway": 15000,
    "trunk": 9000,
    "primary": 6000,
    "secondary": 3000,
    "tertiary": 1500,
}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    return slug or "gateway"


def detect_external_gateways(
    db_path: str,
    boundary_geom,
    zones_df: pd.DataFrame,
    spatialite_path: str,
    max_gateways: int = 8,
) -> list[dict[str, Any]]:
    """Find highways that cross the study-area boundary and attach each to the
    nearest resident zone centroid. ``boundary_geom`` is the (un-buffered)
    study-area polygon; the OSM network must be downloaded with a buffer so
    crossing links physically extend beyond it.
    """
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    conn.load_extension(spatialite_path)
    try:
        rows = conn.execute(
            "SELECT link_id, link_type, COALESCE(name, ''), COALESCE(lanes_ab, 1), "
            "COALESCE(lanes_ba, 1), AsText(geometry) "
            "FROM links WHERE link_type IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')"
        ).fetchall()
    finally:
        conn.close()

    tol_deg = 0.005
    cluster_tol_deg = 0.02
    candidates: list[dict[str, Any]] = []
    for link_id, link_type, name, lanes_ab, lanes_ba, geom_wkt in rows:
        if not geom_wkt:
            continue
        line = wkt.loads(geom_wkt)
        if line.is_empty or line.within(boundary_geom):
            continue
        if not line.intersects(boundary_geom.boundary.buffer(tol_deg)):
            continue
        inside_len = line.intersection(boundary_geom).length
        outside_len = line.difference(boundary_geom).length
        if inside_len <= 0 or outside_len <= 0:
            continue
        hit = line.intersection(boundary_geom.boundary)
        point = hit.representative_point() if not hit.is_empty else line.interpolate(0.5, normalized=True)
        base_daily = GATEWAY_DAILY_TRIPS.get(link_type, 0)
        lanes = max(float(lanes_ab or 1), float(lanes_ba or 1), 1.0)
        daily = min(base_daily * lanes, 20000)
        candidates.append(
            {
                "link_id": int(link_id),
                "link_type": str(link_type),
                "name": str(name or ""),
                "point": point,
                "daily": float(daily),
            }
        )

    candidates.sort(key=lambda item: item["daily"], reverse=True)
    clusters: list[dict[str, Any]] = []
    for candidate in candidates:
        matched = None
        for cluster in clusters:
            if candidate["point"].distance(cluster["point"]) <= cluster_tol_deg:
                matched = cluster
                break
        if matched is None:
            clusters.append(candidate.copy())
            continue
        matched["daily"] = max(float(matched["daily"]), float(candidate["daily"]))

    clusters = sorted(clusters, key=lambda item: item["daily"], reverse=True)[:max_gateways]
    zone_points = {
        int(row.zone_id): Point(float(row.centroid_lon), float(row.centroid_lat))
        for row in zones_df.itertuples(index=False)
    }
    if not zone_points:
        return []

    gateways = []
    for idx, gateway in enumerate(clusters, start=1):
        zone_id = min(zone_points, key=lambda zid: gateway["point"].distance(zone_points[zid]))
        label_bits = [gateway["link_type"], gateway["name"] or f"gateway-{idx:02d}"]
        label = _slugify("-".join(label_bits))
        gateways.append(
            {
                "label": label,
                "zone_id": int(zone_id),
                "link_type": gateway["link_type"],
                "link_id": gateway["link_id"],
                "daily_in": round(float(gateway["daily"]), 2),
                "daily_out": round(float(gateway["daily"]), 2),
                "boundary_lon": round(float(gateway["point"].x), 6),
                "boundary_lat": round(float(gateway["point"].y), 6),
            }
        )
    return gateways


def build_external_gateway_matrix(gateways: list[dict[str, Any]], zones_df: pd.DataFrame) -> np.ndarray:
    """External OD layer: each gateway injects ``daily_in`` trips distributed to
    zones by job share (attraction row) and ``daily_out`` by population share
    (production column). Returned matrix is aligned to ``zones_df`` row order.
    """
    zone_ids = zones_df["zone_id"].astype(int).tolist()
    index_lookup = {zone_id: idx for idx, zone_id in enumerate(zone_ids)}
    pop = zones_df["est_population"].to_numpy(dtype=float)
    jobs = zones_df["total_jobs"].to_numpy(dtype=float)
    pop_shares = pop / pop.sum() if pop.sum() > 0 else np.full(len(zone_ids), 1 / len(zone_ids))
    job_shares = jobs / jobs.sum() if jobs.sum() > 0 else np.full(len(zone_ids), 1 / len(zone_ids))
    matrix = np.zeros((len(zone_ids), len(zone_ids)), dtype=float)

    for gateway in gateways:
        gid = int(gateway["zone_id"])
        if gid not in index_lookup:
            continue
        idx = index_lookup[gid]
        matrix[idx, :] += float(gateway["daily_in"]) * job_shares
        matrix[:, idx] += float(gateway["daily_out"]) * pop_shares
    return matrix
