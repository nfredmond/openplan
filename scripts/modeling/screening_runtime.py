#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import re
import shutil
import sqlite3
import string
import warnings
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely import wkt
from shapely.geometry import Point, box

from screening_boundary import (
    download_if_needed,
    intersecting_state_fips,
    resolve_boundary,
    zip_uri,
)
from screening_bundle import build_run_summary, ensure_dir, slugify, write_boundary_artifact, write_bundle_outputs

ACS_5_URL = os.getenv("CENSUS_ACS5_URL", "https://api.census.gov/data/2022/acs/acs5")
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
TIGER_TRACT_ZIP_TEMPLATE = "https://www2.census.gov/geo/tiger/TIGER2023/TRACT/tl_2023_{state_fips}_tract.zip"

DEFAULT_SPATIALITE_PATHS = [
    os.getenv("SPATIALITE_LIBRARY_PATH", ""),
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite.so",
    "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
]

LINK_DEFAULTS = {
    "motorway": (65, 2000, 2),
    "trunk": (55, 1800, 2),
    "primary": (45, 1200, 1),
    "secondary": (35, 900, 1),
    "tertiary": (30, 600, 1),
    "residential": (25, 400, 1),
    "unclassified": (25, 400, 1),
    "service": (15, 200, 1),
    "services": (15, 200, 1),
    "living_street": (15, 200, 1),
    "pedestrian": (5, 100, 1),
    "centroid_connector": (50, 99999, 1),
}

LINK_CLASS_PRIORITY = {
    "motorway": 8,
    "trunk": 7,
    "primary": 6,
    "secondary": 5,
    "tertiary": 4,
    "unclassified": 3,
    "residential": 2,
    "service": 1,
    "services": 1,
    "living_street": 0,
    "pedestrian": 0,
}

GATEWAY_DAILY_TRIPS = {
    "motorway": 15000,
    "trunk": 9000,
    "primary": 6000,
    "secondary": 3000,
    "tertiary": 1500,
}

HBW_GAMMA = 1.8
HBO_GAMMA = 1.5
NHB_GAMMA = 1.2
HBO_PROD_RATE = 2.2
NHB_PROD_RATE = 0.9
HBO_ATTR_RETAIL_RATE = 12.0
HBO_ATTR_SERVICE_RATE = 5.0
HBO_ATTR_POP_RATE = 0.5
NHB_ATTR_EMP_RATE = 2.5
PEAK_HOUR_FACTOR = 0.10


def find_spatialite_path() -> str:
    for candidate in DEFAULT_SPATIALITE_PATHS:
        if candidate and os.path.exists(candidate):
            return candidate
    raise RuntimeError("Could not locate mod_spatialite shared library")


def connect_spatialite(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    conn.load_extension(find_spatialite_path())
    return conn


def buffered_bbox(bounds: tuple[float, float, float, float], miles: float) -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = bounds
    mid_lat = (min_lat + max_lat) / 2.0
    lat_pad = miles / 69.0
    lon_pad = miles / max(69.0 * math.cos(math.radians(mid_lat)), 10.0)
    return (min_lon - lon_pad, min_lat - lat_pad, max_lon + lon_pad, max_lat + lat_pad)


def fetch_acs_tract_attributes(county_pairs: set[tuple[str, str]]) -> pd.DataFrame:
    rows: list[pd.DataFrame] = []
    for state_fips, county_fips in sorted(county_pairs):
        params = {
            "get": "NAME,B01003_001E,B11001_001E,B23025_004E",
            "for": "tract:*",
            "in": f"state:{state_fips} county:{county_fips}",
        }
        if CENSUS_API_KEY:
            params["key"] = CENSUS_API_KEY
        response = requests.get(ACS_5_URL, params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        if len(data) < 2:
            continue
        header = data[0]
        df = pd.DataFrame(data[1:], columns=header)
        for col in ["B01003_001E", "B11001_001E", "B23025_004E"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        df["geoid"] = df["state"] + df["county"] + df["tract"]
        df["est_population"] = df["B01003_001E"].astype(float)
        df["households"] = df["B11001_001E"].astype(float)
        df["worker_residents"] = df["B23025_004E"].astype(float)
        rows.append(df[["geoid", "NAME", "est_population", "households", "worker_residents"]])
    if not rows:
        raise RuntimeError("No ACS tract attributes were returned for intersecting counties")
    return pd.concat(rows, ignore_index=True).drop_duplicates(subset=["geoid"])


def estimate_jobs(df: pd.DataFrame) -> pd.DataFrame:
    jobs_seed = np.maximum(df["worker_residents"].to_numpy() * 0.9, df["est_population"].to_numpy() * 0.47)
    total_jobs = np.maximum(np.round(jobs_seed), 25).astype(int)
    df["total_jobs"] = total_jobs
    df["retail_jobs"] = np.round(total_jobs * 0.15).astype(int)
    df["health_jobs"] = np.round(total_jobs * 0.09).astype(int)
    df["education_jobs"] = np.round(total_jobs * 0.10).astype(int)
    df["accommodation_jobs"] = np.round(total_jobs * 0.04).astype(int)
    df["govt_jobs"] = np.round(total_jobs * 0.07).astype(int)
    return df


def build_zone_package(boundary_geom, package_dir: Path, cache_dir: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    ensure_dir(package_dir)
    states = intersecting_state_fips(boundary_geom, cache_dir)

    tract_frames = []
    for state_fips in states:
        zip_path = download_if_needed(
            TIGER_TRACT_ZIP_TEMPLATE.format(state_fips=state_fips),
            cache_dir / "tiger" / f"tl_2023_{state_fips}_tract.zip",
        )
        gdf = gpd.read_file(zip_uri(zip_path))
        tract_frames.append(gdf.copy())

    tracts = pd.concat(tract_frames, ignore_index=True)
    tract_gdf = gpd.GeoDataFrame(tracts, geometry="geometry", crs="EPSG:4269").to_crs(4326)
    tract_gdf = tract_gdf[tract_gdf.geometry.intersects(boundary_geom)].copy()
    if tract_gdf.empty:
        raise RuntimeError("Boundary does not intersect any Census tracts")

    boundary_series = gpd.GeoSeries([boundary_geom], crs="EPSG:4326")
    boundary_geom_4326 = boundary_series.iloc[0]
    tract_gdf["orig_geometry"] = tract_gdf.geometry
    tract_gdf["geometry"] = tract_gdf.geometry.intersection(boundary_geom_4326)
    tract_gdf = tract_gdf[~tract_gdf.geometry.is_empty].copy()

    if tract_gdf.empty:
        raise RuntimeError("No tract fragments remained after clipping to boundary")

    original_proj = gpd.GeoSeries(tract_gdf["orig_geometry"], crs="EPSG:4326").to_crs(6933)
    clipped_proj = gpd.GeoSeries(tract_gdf.geometry, crs="EPSG:4326").to_crs(6933)
    tract_gdf["orig_area_sq_mi"] = original_proj.area / 2_589_988.110336
    tract_gdf["area_sq_mi"] = clipped_proj.area / 2_589_988.110336
    tract_gdf["area_share"] = np.where(
        tract_gdf["orig_area_sq_mi"] > 0,
        tract_gdf["area_sq_mi"] / tract_gdf["orig_area_sq_mi"],
        0,
    )
    tract_gdf = tract_gdf[(tract_gdf["area_sq_mi"] >= 0.01) | (tract_gdf.geometry.representative_point().within(boundary_geom))].copy()
    if tract_gdf.empty:
        raise RuntimeError("All clipped tract fragments were tiny slivers; no usable zones remain")

    acs = fetch_acs_tract_attributes({(g[:2], g[2:5]) for g in tract_gdf["GEOID"].tolist()})
    tract_gdf = tract_gdf.merge(acs, left_on="GEOID", right_on="geoid", how="left")
    for col in ["est_population", "households", "worker_residents"]:
        tract_gdf[col] = tract_gdf[col].fillna(0).astype(float) * tract_gdf["area_share"].clip(lower=0, upper=1)

    name_fallback = None
    for candidate in ["NAME_y", "NAME", "NAME_x"]:
        if candidate in tract_gdf.columns:
            name_fallback = tract_gdf[candidate]
            break
    if name_fallback is None:
        name_fallback = tract_gdf["GEOID"]
    tract_gdf["NAMELSAD"] = tract_gdf["NAMELSAD"].fillna(name_fallback).fillna(tract_gdf["GEOID"])
    tract_gdf["centroid"] = tract_gdf.geometry.representative_point()
    tract_gdf["centroid_lon"] = tract_gdf["centroid"].x
    tract_gdf["centroid_lat"] = tract_gdf["centroid"].y
    tract_gdf = tract_gdf.sort_values(["STATEFP", "COUNTYFP", "TRACTCE", "GEOID"]).reset_index(drop=True)
    tract_gdf["zone_id"] = np.arange(1, len(tract_gdf) + 1)
    tract_gdf = estimate_jobs(tract_gdf)

    zone_cols = [
        "GEOID",
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
        "worker_residents",
        "area_share",
    ]
    zones_df = tract_gdf[zone_cols].copy()
    zones_df.to_csv(package_dir / "zone_attributes.csv", index=False)

    zones_export = tract_gdf[zone_cols + ["geometry"]].copy()
    zones_export = gpd.GeoDataFrame(zones_export, geometry="geometry", crs="EPSG:4326")
    zones_export.to_file(package_dir / "zones.geojson", driver="GeoJSON")

    centroids_export = gpd.GeoDataFrame(
        tract_gdf[["GEOID", "NAMELSAD", "zone_id"]].copy(),
        geometry=gpd.GeoSeries(tract_gdf["centroid"], crs="EPSG:4326"),
        crs="EPSG:4326",
    )
    centroids_export.to_file(package_dir / "zone_centroids.geojson", driver="GeoJSON")

    manifest = {
        "zones": int(len(zones_df)),
        "tract_states": states,
        "zone_type": "census-tract-fragments",
        "total_population": float(zones_df["est_population"].sum()),
        "total_households": float(zones_df["households"].sum()),
        "total_worker_residents": float(zones_df["worker_residents"].sum()),
        "total_jobs_est": float(zones_df["total_jobs"].sum()),
        "files": {
            "zone_attributes": "package/zone_attributes.csv",
            "zones_geojson": "package/zones.geojson",
            "zone_centroids_geojson": "package/zone_centroids.geojson",
        },
    }
    (package_dir / "package_manifest.json").write_text(json.dumps(manifest, indent=2))
    return zones_df, manifest


def patch_osm_builder() -> None:
    from aequilibrae.project.network.osm.osm_builder import OSMBuilder

    def _patched_define_link_type(self, link_type: str):
        proj_link_types = self.project.network.link_types
        original = link_type
        link_type = "".join([x for x in link_type if x in string.ascii_letters + "_"]).lower()
        split = link_type.split("_")
        for i, piece in enumerate(split[1:]):
            if piece in ["link", "segment", "stretch"]:
                link_type = "_".join(split[: i + 1])
        if self._OSMBuilder__all_ltp.shape[0] >= 51:
            link_type = "aggregate_link_type"
        if len(link_type) == 0:
            link_type = "empty"
        if link_type in self._OSMBuilder__all_ltp.link_type.values:
            lt = proj_link_types.get_by_name(link_type)
            if lt is not None:
                if original not in lt.description:
                    lt.description += f", {original}"
                    lt.save()
                return [lt.link_type_id, link_type]
        letter = link_type[0]
        if letter in self._OSMBuilder__all_ltp.link_type_id.values:
            letter = letter.upper()
            if letter in self._OSMBuilder__all_ltp.link_type_id.values:
                for next_letter in string.ascii_letters:
                    if next_letter not in self._OSMBuilder__all_ltp.link_type_id.values:
                        letter = next_letter
                        break
        try:
            lt = proj_link_types.new(letter)
            lt.link_type = link_type
            lt.description = f"OSM: {original}"
            lt.save()
        except Exception:
            lt = proj_link_types.get(letter)
            if lt is not None:
                lt.link_type = link_type
                lt.description = f"OSM: {original}"
                lt.save()
        return [letter, link_type]

    OSMBuilder._OSMBuilder__define_link_type = _patched_define_link_type


def _parse_speed(value: Any) -> int | None:
    if value is None:
        return None
    match = re.search(r"(\d+)", str(value))
    return int(match.group(1)) if match else None


def extract_missing_centroids_from_warnings(caught_warnings: list[warnings.WarningMessage]) -> list[int]:
    missing: set[int] = set()
    for caught in caught_warnings:
        message = str(caught.message)
        if "Found centroids not present in the graph" not in message:
            continue
        for block in re.findall(r"\[([^\]]+)\]", message, flags=re.MULTILINE):
            for token in re.split(r"[\s,]+", block.strip()):
                if token.isdigit():
                    missing.add(int(token))
    return sorted(missing)


def rank_connector_candidate(conn: sqlite3.Connection, node_id: int, d2: float) -> tuple[float, float, float, float]:
    rows = conn.execute(
        "SELECT DISTINCT COALESCE(link_type, '') FROM links WHERE a_node=? OR b_node=?",
        (node_id, node_id),
    ).fetchall()
    best_priority = max((LINK_CLASS_PRIORITY.get(str(link_type or '').strip().lower(), -1) for (link_type,) in rows), default=-1)
    distance_m = max((float(d2) ** 0.5) * 111000, 10)
    # Conservative scoring: a one-class road upgrade is only worth a few hundred meters,
    # so very close local collectors can still beat farther arterials.
    score = best_priority * 250.0 - distance_m
    return (score, float(best_priority), -distance_m, -float(node_id))


def build_network(bundle_dir: Path, boundary_geom, zones_df: pd.DataFrame, network_buffer_miles: float) -> dict[str, Any]:
    from aequilibrae import Project

    patch_osm_builder()

    work_dir = ensure_dir(bundle_dir / "work")
    proj_dir = work_dir / "aeq_project"
    if proj_dir.exists():
        shutil.rmtree(proj_dir)

    network_bbox = buffered_bbox(boundary_geom.bounds, network_buffer_miles)
    project = Project()
    project.new(str(proj_dir))
    project.network.create_from_osm(model_area=box(*network_bbox), modes=["car"], clean=True)
    project.close()

    conn = connect_spatialite(proj_dir / "project_database.sqlite")
    nodes_all = [row[0] for row in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
    links_raw = conn.execute("SELECT a_node, b_node FROM links").fetchall()
    adjacency: dict[int, set[int]] = {}
    for a_node, b_node in links_raw:
        adjacency.setdefault(a_node, set()).add(b_node)
        adjacency.setdefault(b_node, set()).add(a_node)

    components = []
    visited: set[int] = set()
    for node in nodes_all:
        if node in visited:
            continue
        comp: set[int] = set([node])
        queue = [node]
        while queue:
            current = queue.pop(0)
            for neighbor in adjacency.get(current, set()):
                if neighbor not in comp:
                    comp.add(neighbor)
                    queue.append(neighbor)
        visited |= comp
        components.append(comp)
    components.sort(key=len, reverse=True)
    largest_component = components[0] if components else set()

    if not conn.execute("SELECT 1 FROM link_types WHERE link_type='centroid_connector'").fetchone():
        conn.execute(
            "INSERT INTO link_types (link_type, link_type_id, description, lanes, lane_capacity) VALUES "
            "('centroid_connector', 'z', 'Virtual centroid connectors', 10, 10000)"
        )
        conn.commit()

    max_node = int(conn.execute("SELECT COALESCE(MAX(node_id), 0) FROM nodes").fetchone()[0] or 0)
    max_link = int(conn.execute("SELECT COALESCE(MAX(link_id), 0) FROM links").fetchone()[0] or 0)
    next_node = max_node + 1
    next_link = max_link + 1
    centroid_map: dict[int, int] = {}
    connector_diagnostics: list[dict[str, Any]] = []

    for _, zone in zones_df.iterrows():
        zone_id = int(zone["zone_id"])
        clon = float(zone["centroid_lon"])
        clat = float(zone["centroid_lat"])
        centroid_node = next_node
        next_node += 1
        conn.execute(
            "INSERT INTO nodes (node_id, is_centroid, geometry) VALUES (?, 1, MakePoint(?, ?, 4326))",
            (centroid_node, clon, clat),
        )

        nearest = conn.execute(
            "SELECT node_id, (X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
            "FROM nodes WHERE is_centroid=0 AND node_id!=? ORDER BY d2 ASC LIMIT 50",
            (clon, clon, clat, clat, centroid_node),
        ).fetchall()
        nearest_in_largest = [(nid, d2) for nid, d2 in nearest if nid in largest_component]
        candidate_pool = nearest_in_largest or nearest
        preferred = sorted(
            candidate_pool,
            key=lambda item: rank_connector_candidate(conn, int(item[0]), float(item[1])),
            reverse=True,
        )[:3]
        chosen_connectors = []
        for near_node, d2 in preferred:
            nx, ny = conn.execute("SELECT X(geometry), Y(geometry) FROM nodes WHERE node_id=?", (near_node,)).fetchone()
            line_wkt = f"LINESTRING({clon} {clat}, {nx} {ny})"
            length_m = max((d2 ** 0.5) * 111000, 10)
            conn.execute(
                "INSERT INTO links (link_id, a_node, b_node, direction, distance, modes, link_type, name, "
                "speed_ab, speed_ba, capacity_ab, capacity_ba, geometry) "
                "VALUES (?, ?, ?, 0, ?, 'c', 'centroid_connector', 'connector', 50, 50, 99999, 99999, GeomFromText(?, 4326))",
                (next_link, centroid_node, near_node, length_m, line_wkt),
            )
            adjacent_link_types = [
                str(link_type or '').strip().lower()
                for (link_type,) in conn.execute(
                    "SELECT DISTINCT COALESCE(link_type, '') FROM links WHERE a_node=? OR b_node=?",
                    (near_node, near_node),
                ).fetchall()
            ]
            chosen_connectors.append(
                {
                    "link_id": int(next_link),
                    "to_node": int(near_node),
                    "distance_m": round(float(length_m), 1),
                    "in_largest_component": bool(near_node in largest_component),
                    "adjacent_link_types": adjacent_link_types,
                    "best_adjacent_link_priority": max((LINK_CLASS_PRIORITY.get(t, -1) for t in adjacent_link_types), default=-1),
                }
            )
            next_link += 1
        connector_diagnostics.append(
            {
                "zone_id": zone_id,
                "zone_label": str(zone.get("NAMELSAD") or zone.get("GEOID") or zone_id),
                "centroid_node": int(centroid_node),
                "nearest_candidates_considered": int(len(nearest)),
                "largest_component_candidates_in_nearest_50": int(len(nearest_in_largest)),
                "used_fallback_non_largest_component": int(len(nearest_in_largest)) == 0,
                "chosen_connectors": chosen_connectors,
            }
        )
        centroid_map[zone_id] = centroid_node
    conn.commit()

    links_data = conn.execute(
        "SELECT link_id, link_type, speed_ab, speed_ba, distance, lanes_ab, lanes_ba FROM links"
    ).fetchall()
    updates = []
    for link_id, link_type, speed_ab, speed_ba, distance, lanes_ab, lanes_ba in links_data:
        default_speed, cap_per_lane, default_lanes = LINK_DEFAULTS.get(link_type, (25, 400, 1))
        speed_ab_val = _parse_speed(speed_ab) or default_speed
        speed_ba_val = _parse_speed(speed_ba) or speed_ab_val
        distance_val = float(distance or 0.01)
        tt_ab = distance_val / (speed_ab_val * 1609.34 / 60) if distance_val > 0 else 0.01
        tt_ba = distance_val / (speed_ba_val * 1609.34 / 60) if distance_val > 0 else 0.01
        lanes_ab_val = int(lanes_ab or default_lanes or 1)
        lanes_ba_val = int(lanes_ba or default_lanes or 1)
        cap_ab = cap_per_lane * lanes_ab_val
        cap_ba = cap_per_lane * lanes_ba_val
        updates.append((speed_ab_val, speed_ba_val, tt_ab, tt_ba, cap_ab, cap_ba, link_id))
    conn.executemany(
        "UPDATE links SET speed_ab=?, speed_ba=?, travel_time_ab=?, travel_time_ba=?, capacity_ab=?, capacity_ba=? WHERE link_id=?",
        updates,
    )
    conn.commit()
    conn.close()

    summary = {
        "network_bbox": [float(v) for v in network_bbox],
        "zones_connected": int(len(centroid_map)),
        "nodes_before_centroids": int(len(nodes_all)),
        "links_before_centroids": int(len(links_raw)),
        "largest_component_pct": round(100 * len(largest_component) / max(len(nodes_all), 1), 2),
        "project_dir": str(proj_dir),
        "node_id_strategy": "preserve_osm_ids",
        "centroid_map": centroid_map,
        "connector_diagnostics": connector_diagnostics,
    }
    (bundle_dir / "work" / "network_setup_summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def compute_freeflow_skims(project_dir: Path, centroid_map: dict[int, int], run_output_dir: Path) -> dict[str, Any]:
    from aequilibrae import Project
    from aequilibrae.paths import NetworkSkimming

    ensure_dir(run_output_dir)
    centroids_sorted = np.array(sorted(int(v) for v in centroid_map.values()))
    project = Project()
    project.open(str(project_dir))
    project.network.build_graphs(modes=["c"])
    graph = project.network.graphs["c"]
    columns = list(graph.graph.columns)
    time_field = "travel_time" if "travel_time" in columns else "distance"
    capacity_field = "capacity" if "capacity" in columns else "capacity_ab"
    graph.set_graph(time_field)
    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always")
        graph.prepare_graph(centroids_sorted)
    missing_centroids = extract_missing_centroids_from_warnings(caught_warnings)
    graph.set_blocked_centroid_flows(True)
    graph.set_skimming([time_field])

    skimming = NetworkSkimming(graph)
    skimming.execute()
    skim_mat = skimming.results.skims
    skim_path = run_output_dir / "travel_time_skims.omx"
    skim_mat.export(str(skim_path))
    matrix = np.array(skim_mat.matrix[time_field], dtype=float)
    finite = np.isfinite(matrix) & (matrix > 0)
    np.fill_diagonal(finite, False)
    reachable_pairs = int(finite.sum())
    total_pairs = int(len(centroids_sorted) * max(len(centroids_sorted) - 1, 0))

    result = {
        "matrix": matrix,
        "centroids_sorted": centroids_sorted.tolist(),
        "time_field": time_field,
        "capacity_field": capacity_field,
        "missing_centroids_in_graph": missing_centroids,
        "reachable_pairs": reachable_pairs,
        "total_pairs": total_pairs,
        "avg_time_min": float(matrix[finite].mean()) if reachable_pairs else None,
        "max_time_min": float(matrix[finite].max()) if reachable_pairs else None,
        "skim_path": str(skim_path),
    }
    project.close()
    return result


def gravity_distribute(
    productions: np.ndarray,
    attractions: np.ndarray,
    impedance: np.ndarray,
    gamma: float,
    max_iter: int = 60,
    tolerance: float = 0.01,
) -> np.ndarray:
    n = len(productions)
    matrix = np.array(impedance, dtype=float, copy=True)
    positive = matrix[np.isfinite(matrix) & (matrix > 0)]
    intrazonal = max(float(np.nanpercentile(positive, 20)) if positive.size else 2.0, 1.0)
    np.fill_diagonal(matrix, intrazonal)
    valid = np.isfinite(matrix) & (matrix > 0)

    with np.errstate(divide="ignore", invalid="ignore"):
        friction = np.where(valid, np.power(matrix, -gamma), 0.0)
    friction = np.nan_to_num(friction, nan=0.0, posinf=0.0, neginf=0.0)

    if attractions.sum() > 0:
        attractions = attractions * (productions.sum() / attractions.sum())

    a_factors = np.ones(n, dtype=float)
    b_factors = np.ones(n, dtype=float)

    for _ in range(max_iter):
        denom_a = friction @ (b_factors * attractions)
        a_factors = np.divide(1.0, denom_a, out=np.zeros_like(denom_a), where=denom_a > 0)

        denom_b = friction.T @ (a_factors * productions)
        b_factors = np.divide(1.0, denom_b, out=np.zeros_like(denom_b), where=denom_b > 0)

        balanced = np.outer(a_factors * productions, b_factors * attractions) * friction
        row_sums = balanced.sum(axis=1)
        error = np.max(np.abs(row_sums - productions) / np.maximum(productions, 1.0))
        if error < tolerance:
            break

    result = np.outer(a_factors * productions, b_factors * attractions) * friction
    return np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)


def detect_external_gateways(project_dir: Path, boundary_geom, zones_df: pd.DataFrame, max_gateways: int = 8) -> list[dict[str, Any]]:
    conn = connect_spatialite(project_dir / "project_database.sqlite")
    rows = conn.execute(
        "SELECT link_id, link_type, COALESCE(name, ''), COALESCE(lanes_ab, 1), COALESCE(lanes_ba, 1), AsText(geometry) "
        "FROM links WHERE link_type IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')"
    ).fetchall()
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

    gateways = []
    for idx, gateway in enumerate(clusters, start=1):
        zone_id = min(zone_points, key=lambda zid: gateway["point"].distance(zone_points[zid]))
        label_bits = [gateway["link_type"], gateway["name"] or f"gateway-{idx:02d}"]
        label = slugify("-".join(label_bits))
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
    zone_ids = zones_df["zone_id"].astype(int).tolist()
    index_lookup = {zone_id: idx for idx, zone_id in enumerate(zone_ids)}
    pop = zones_df["est_population"].to_numpy(dtype=float)
    jobs = zones_df["total_jobs"].to_numpy(dtype=float)
    pop_shares = pop / pop.sum() if pop.sum() > 0 else np.full(len(zone_ids), 1 / len(zone_ids))
    job_shares = jobs / jobs.sum() if jobs.sum() > 0 else np.full(len(zone_ids), 1 / len(zone_ids))
    matrix = np.zeros((len(zone_ids), len(zone_ids)), dtype=float)

    for gateway in gateways:
        idx = index_lookup[int(gateway["zone_id"])]
        matrix[idx, :] += float(gateway["daily_in"]) * job_shares
        matrix[:, idx] += float(gateway["daily_out"]) * pop_shares
    return matrix


def write_od_csv(od_matrix: np.ndarray, zone_ids: list[int], output_path: Path) -> None:
    df = pd.DataFrame(np.round(od_matrix, 2), index=zone_ids, columns=[str(zid) for zid in zone_ids])
    df.index.name = "origin_zone"
    df.to_csv(output_path)


def synthesize_demand(
    zones_df: pd.DataFrame,
    skim_matrix: np.ndarray,
    project_dir: Path,
    boundary_geom,
    package_dir: Path,
    overall_demand_scalar: float = 1.0,
    external_demand_scalar: float = 1.0,
    hbw_scalar: float = 1.0,
    hbo_scalar: float = 1.0,
    nhb_scalar: float = 1.0,
) -> dict[str, Any]:
    zone_ids = zones_df["zone_id"].astype(int).tolist()
    pop = zones_df["est_population"].to_numpy(dtype=float)
    households = zones_df["households"].to_numpy(dtype=float)
    workers = zones_df["worker_residents"].to_numpy(dtype=float)
    jobs = zones_df["total_jobs"].to_numpy(dtype=float)
    retail = zones_df["retail_jobs"].to_numpy(dtype=float)
    service = (
        zones_df["health_jobs"].to_numpy(dtype=float)
        + zones_df["education_jobs"].to_numpy(dtype=float)
        + zones_df["accommodation_jobs"].to_numpy(dtype=float)
        + zones_df["govt_jobs"].to_numpy(dtype=float)
    )

    hbw_prod = np.maximum(workers, households * 0.35)
    hbw_attr = np.maximum(jobs, 10)
    hbw = gravity_distribute(hbw_prod, hbw_attr, skim_matrix, HBW_GAMMA) * hbw_scalar

    hbo_prod = np.maximum(pop * HBO_PROD_RATE, 1)
    hbo_attr = np.maximum(retail * HBO_ATTR_RETAIL_RATE + service * HBO_ATTR_SERVICE_RATE + pop * HBO_ATTR_POP_RATE, 1)
    hbo = gravity_distribute(hbo_prod, hbo_attr, skim_matrix, HBO_GAMMA) * hbo_scalar

    nhb_prod = np.maximum(pop * NHB_PROD_RATE, 1)
    nhb_attr = np.maximum(jobs * NHB_ATTR_EMP_RATE, 1)
    nhb = gravity_distribute(nhb_prod, nhb_attr, skim_matrix, NHB_GAMMA) * nhb_scalar

    gateways = detect_external_gateways(project_dir, boundary_geom, zones_df)
    if external_demand_scalar != 1.0:
        gateways = [
            {
                **gateway,
                "daily_in": float(gateway["daily_in"]) * external_demand_scalar,
                "daily_out": float(gateway["daily_out"]) * external_demand_scalar,
                "daily": float(gateway.get("daily", 0.0)) * external_demand_scalar,
            }
            for gateway in gateways
        ]
    external = build_external_gateway_matrix(gateways, zones_df)

    valid_pairs = np.isfinite(skim_matrix) & (skim_matrix > 0)
    np.fill_diagonal(valid_pairs, True)
    total = (hbw + hbo + nhb + external) * valid_pairs
    if overall_demand_scalar != 1.0:
        total = total * overall_demand_scalar
        hbw = hbw * overall_demand_scalar
        hbo = hbo * overall_demand_scalar
        nhb = nhb * overall_demand_scalar
        external = external * overall_demand_scalar

    write_od_csv(total, zone_ids, package_dir / "od_trip_matrix.csv")
    layers = {
        "hbw_trips": round(float(hbw.sum()), 2),
        "hbo_trips": round(float(hbo.sum()), 2),
        "nhb_trips": round(float(nhb.sum()), 2),
        "external_trips": round(float(external.sum()), 2),
        "total_trips": round(float(total.sum()), 2),
        "trip_rates": {
            "hbw_gamma": HBW_GAMMA,
            "hbo_prod_per_person": HBO_PROD_RATE,
            "nhb_prod_per_person": NHB_PROD_RATE,
            "gravity_gamma_hbo": HBO_GAMMA,
            "gravity_gamma_nhb": NHB_GAMMA,
            "overall_demand_scalar": overall_demand_scalar,
            "external_demand_scalar": external_demand_scalar,
            "hbw_scalar": hbw_scalar,
            "hbo_scalar": hbo_scalar,
            "nhb_scalar": nhb_scalar,
        },
        "external_gateways": gateways,
        "files": {"od_trip_matrix": "package/od_trip_matrix.csv"},
    }
    (package_dir / "demand_layers.json").write_text(json.dumps(layers, indent=2))
    return {
        "matrix": total,
        "zone_ids": zone_ids,
        "gateways": gateways,
        "summary": layers,
    }


def export_loaded_links_geojson(project_dir: Path, link_results: pd.DataFrame, run_output_dir: Path) -> dict[str, str]:
    conn = connect_spatialite(project_dir / "project_database.sqlite")
    volume_lookup = {
        int(float(row["link_id"])): row
        for _, row in link_results.iterrows()
        if float(row.get("PCE_tot", 0) or 0) > 0
    }
    features = []
    for link_id, row in volume_lookup.items():
        db_row = conn.execute(
            "SELECT link_id, link_type, COALESCE(name, ''), AsGeoJSON(geometry) FROM links WHERE link_id=?",
            (link_id,),
        ).fetchone()
        if not db_row or not db_row[3]:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "link_id": int(db_row[0]),
                    "link_type": db_row[1],
                    "name": db_row[2],
                    "pce_tot": round(float(row.get("PCE_tot", 0) or 0), 2),
                    "pce_ab": round(float(row.get("PCE_AB", 0) or 0), 2),
                    "pce_ba": round(float(row.get("PCE_BA", 0) or 0), 2),
                    "voc_max": round(float(row.get("VOC_max", 0) or 0), 4),
                },
                "geometry": json.loads(db_row[3]),
            }
        )
    conn.close()

    loaded_geojson_path = run_output_dir / "loaded_links.geojson"
    loaded_geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=2))

    top_features = sorted(features, key=lambda feat: feat["properties"]["pce_tot"], reverse=True)[:250]
    top_geojson_path = run_output_dir / "top_loaded_links.geojson"
    top_geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": top_features}, indent=2))
    return {
        "loaded_links_geojson": str(loaded_geojson_path),
        "top_loaded_links_geojson": str(top_geojson_path),
    }


def run_assignment(
    project_dir: Path,
    centroid_map: dict[int, int],
    demand_matrix: np.ndarray,
    run_output_dir: Path,
    skim_meta: dict[str, Any],
) -> dict[str, Any]:
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import Graph, TrafficAssignment, TrafficClass

    ensure_dir(run_output_dir)
    centroids_sorted = np.array(sorted(int(v) for v in centroid_map.values()))

    demand_path = run_output_dir / "demand.omx"
    demand_mat = AequilibraeMatrix()
    demand_mat.create_empty(
        file_name=str(demand_path),
        zones=len(centroids_sorted),
        matrix_names=["demand"],
        memory_only=False,
    )
    demand_mat.index = centroids_sorted
    demand_mat.matrix["demand"][:, :] = demand_matrix * PEAK_HOUR_FACTOR
    demand_mat.computational_view(["demand"])

    conn = connect_spatialite(project_dir / "project_database.sqlite")
    links_df = pd.read_sql(
        "SELECT link_id, a_node, b_node, direction, distance, modes, "
        "COALESCE(speed_ab, 25) AS speed_ab, "
        "COALESCE(speed_ba, speed_ab, 25) AS speed_ba, "
        "COALESCE(travel_time_ab, 1.0) AS travel_time, "
        "COALESCE(capacity_ab, 400) AS capacity_ab, "
        "COALESCE(capacity_ba, capacity_ab, 400) AS capacity_ba "
        "FROM links",
        conn,
    )
    conn.close()
    links_df["travel_time"] = pd.to_numeric(links_df["travel_time"], errors="coerce").fillna(1.0).clip(lower=0.01)
    links_df["capacity_ab"] = pd.to_numeric(links_df["capacity_ab"], errors="coerce").fillna(400).clip(lower=1)
    links_df["capacity_ba"] = pd.to_numeric(links_df["capacity_ba"], errors="coerce").fillna(400).clip(lower=1)
    links_df["speed_ab"] = pd.to_numeric(links_df["speed_ab"], errors="coerce").fillna(25).clip(lower=1)
    links_df["speed_ba"] = pd.to_numeric(links_df["speed_ba"], errors="coerce").fillna(25).clip(lower=1)
    links_df["distance"] = pd.to_numeric(links_df["distance"], errors="coerce").fillna(0.01).clip(lower=0.01)
    links_df["direction"] = pd.to_numeric(links_df["direction"], errors="coerce").fillna(0).astype(int)

    graph = Graph()
    graph.network = links_df.copy()
    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always")
        graph.prepare_graph(centroids_sorted, remove_dead_ends=False)
    prepared_graph_df = getattr(graph, "graph", pd.DataFrame())
    graph_columns = list(prepared_graph_df.columns)
    missing_centroids = extract_missing_centroids_from_warnings(caught_warnings)
    time_field = "travel_time" if "travel_time" in graph_columns else "distance"
    capacity_field = next(
        (field for field in ["capacity_ab", "capacity", "capacity_ba"] if field in graph_columns),
        None,
    )
    if capacity_field is None:
        raise RuntimeError(f"No usable capacity field found in prepared graph columns: {graph_columns}")
    graph.set_graph(time_field)
    graph.set_blocked_centroid_flows(True)

    assignment = TrafficAssignment()
    traffic_class = TrafficClass(name="car", graph=graph, matrix=demand_mat)
    traffic_class.set_pce(1.0)
    assignment.add_class(traffic_class)
    assignment.set_vdf("BPR")
    assignment.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
    assignment.set_capacity_field(capacity_field)
    assignment.set_time_field(time_field)
    assignment.max_iter = 50
    assignment.rgap_target = 0.01
    assignment.set_algorithm("bfw")
    assignment.execute()

    rgap = getattr(assignment.assignment, "rgap", float("nan"))
    iterations = int(getattr(assignment.assignment, "iteration", assignment.max_iter))
    results = assignment.results()
    if hasattr(results, "get_load_results"):
        link_results = results.get_load_results()
    else:
        link_results = results
    if "link_id" not in link_results.columns:
        link_results = link_results.reset_index()
        if "link_id" not in link_results.columns:
            link_results = link_results.rename(columns={link_results.columns[0]: "link_id"})
    if "PCE_tot" in link_results.columns:
        link_results["PCE_tot"] = link_results["PCE_tot"] / PEAK_HOUR_FACTOR
        if "PCE_AB" in link_results.columns:
            link_results["PCE_AB"] = link_results["PCE_AB"] / PEAK_HOUR_FACTOR
        if "PCE_BA" in link_results.columns:
            link_results["PCE_BA"] = link_results["PCE_BA"] / PEAK_HOUR_FACTOR
    link_results.to_csv(run_output_dir / "link_volumes.csv", index=False)

    geojson_paths = export_loaded_links_geojson(project_dir, link_results, run_output_dir)

    return {
        "convergence": {
            "final_gap": float(rgap) if np.isfinite(rgap) else None,
            "iterations": iterations,
            "target_gap": 0.01,
        },
        "network": {
            "links": int(graph.num_links),
            "nodes": int(graph.num_nodes),
            "zones": int(len(centroids_sorted)),
            "missing_centroids_in_graph": missing_centroids,
            "graph_centroid_coverage_pct": round(100 * (len(centroids_sorted) - len(missing_centroids)) / max(len(centroids_sorted), 1), 2),
        },
        "demand": {
            "total_trips": float(np.round(demand_matrix.sum(), 2)),
            "peak_hour_factor": PEAK_HOUR_FACTOR,
        },
        "loaded_links": int((link_results["PCE_tot"] > 0).sum()) if "PCE_tot" in link_results.columns else 0,
        "link_results_path": str(run_output_dir / "link_volumes.csv"),
        **geojson_paths,
    }


def run_screening_model(
    *,
    name: str,
    boundary_geojson: str | None = None,
    county_fips: str | None = None,
    output_root: str | None = None,
    cache_dir: str | None = None,
    network_buffer_miles: float = 2.0,
    keep_project: bool = False,
    force: bool = False,
    counts_csv: str | None = None,
    ready_median_ape: float = 30.0,
    ready_critical_ape: float = 50.0,
    required_matches: int = 3,
    overall_demand_scalar: float = 1.0,
    external_demand_scalar: float = 1.0,
    hbw_scalar: float = 1.0,
    hbo_scalar: float = 1.0,
    nhb_scalar: float = 1.0,
) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[2]
    output_root_path = Path(output_root).expanduser().resolve() if output_root else repo_root / "data" / "screening-runs"
    cache_path = Path(cache_dir).expanduser().resolve() if cache_dir else repo_root / "data" / "_screening_cache"
    run_dir = output_root_path / slugify(name)
    if run_dir.exists():
        if not force:
            raise RuntimeError(f"Output directory already exists: {run_dir}. Re-run with --force to replace it.")
        shutil.rmtree(run_dir)

    ensure_dir(run_dir)
    boundary_dir = ensure_dir(run_dir / "boundary")
    package_dir = ensure_dir(run_dir / "package")
    run_output_dir = ensure_dir(run_dir / "run_output")
    ensure_dir(run_dir / "work")
    ensure_dir(cache_path)

    boundary_meta = resolve_boundary(boundary_geojson, county_fips, cache_path)
    boundary_path = write_boundary_artifact(boundary_meta["geometry"], boundary_dir)
    boundary_meta["artifact_path"] = str(boundary_path)

    zones_df, zone_meta = build_zone_package(boundary_meta["geometry"], package_dir, cache_path)
    network_meta = build_network(run_dir, boundary_meta["geometry"], zones_df, network_buffer_miles)
    project_dir = Path(network_meta["project_dir"])
    skim_meta = compute_freeflow_skims(project_dir, network_meta["centroid_map"], run_output_dir)
    demand_meta = synthesize_demand(
        zones_df,
        skim_meta["matrix"],
        project_dir,
        boundary_meta["geometry"],
        package_dir,
        overall_demand_scalar=overall_demand_scalar,
        external_demand_scalar=external_demand_scalar,
        hbw_scalar=hbw_scalar,
        hbo_scalar=hbo_scalar,
        nhb_scalar=nhb_scalar,
    )
    assignment_meta = run_assignment(project_dir, network_meta["centroid_map"], demand_meta["matrix"], run_output_dir, skim_meta)
    manifest = write_bundle_outputs(
        run_dir=run_dir,
        run_name=name,
        boundary_meta=boundary_meta,
        zone_meta=zone_meta,
        network_meta=network_meta,
        skim_meta=skim_meta,
        demand_meta=demand_meta,
        assignment_meta=assignment_meta,
        keep_project=keep_project,
    )

    validation_summary = None
    if counts_csv:
        from validate_screening_observed_counts import run_validation_bundle

        counts_csv_path = Path(counts_csv).expanduser().resolve()
        validation_dir = run_dir / "validation"
        validation_summary = run_validation_bundle(
            run_output_dir=run_output_dir,
            counts_csv=counts_csv_path,
            output_dir=validation_dir,
            project_db=project_dir / "project_database.sqlite",
            ready_median_ape=ready_median_ape,
            ready_critical_ape=ready_critical_ape,
            required_matches=required_matches,
        )
        manifest.setdefault("artifacts", {}).update(
            {
                "validation_results": "validation/validation_results.csv",
                "validation_summary": "validation/validation_summary.json",
                "validation_report": "validation/validation_report.md",
                "validation_candidate_audit_json": "validation/validation_candidate_audit.json",
                "validation_candidate_audit_csv": "validation/validation_candidate_audit.csv",
            }
        )
        manifest["validation"] = {
            "counts_csv": str(counts_csv_path),
            "status_label": validation_summary["screening_gate"]["status_label"],
            "matched_stations": validation_summary["stations_matched"],
            "metrics": validation_summary["metrics"],
        }
        (run_dir / "bundle_manifest.json").write_text(json.dumps(manifest, indent=2))

    if not keep_project and project_dir.exists():
        shutil.rmtree(project_dir)

    summary = build_run_summary(name, run_dir, boundary_meta, zone_meta, demand_meta, assignment_meta, manifest)
    if validation_summary is not None:
        summary["validation"] = {
            "status_label": validation_summary["screening_gate"]["status_label"],
            "matched_stations": validation_summary["stations_matched"],
            "metrics": validation_summary["metrics"],
        }
    (run_dir / "run_summary.json").write_text(json.dumps(summary, indent=2))
    return summary
