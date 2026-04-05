#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import requests

TIGER_COUNTY_ZIP = "https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip"
TIGER_STATE_ZIP = "https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def require_boundary_selector(boundary_geojson: str | None, county_fips: str | None) -> None:
    if not boundary_geojson and not county_fips:
        raise RuntimeError("Provide either --boundary-geojson or --county-fips")


def normalize_geometry(geom):
    if geom.is_empty:
        raise RuntimeError("Boundary geometry is empty")
    fixed = geom.buffer(0)
    if fixed.is_empty:
        raise RuntimeError("Boundary geometry became empty during normalization")
    return fixed


def load_geojson_geometry(path: Path):
    from shapely.geometry import shape
    from shapely.ops import unary_union

    payload = json.loads(path.read_text())
    if payload.get("type") == "FeatureCollection":
        geoms = [shape(feature["geometry"]) for feature in payload.get("features", []) if feature.get("geometry")]
        if not geoms:
            raise RuntimeError(f"No geometries found in {path}")
        geom = unary_union(geoms)
    elif payload.get("type") == "Feature":
        geom = shape(payload["geometry"])
    else:
        geom = shape(payload)
    return normalize_geometry(geom)


def boundary_area_sq_mi(boundary_geom) -> float:
    try:
        import geopandas as gpd

        gdf = gpd.GeoDataFrame({"id": [1]}, geometry=[boundary_geom], crs="EPSG:4326")
        return float(gdf.to_crs(6933).geometry.area.iloc[0] / 2_589_988.110336)
    except ModuleNotFoundError:
        return float(_approximate_area_sq_mi(boundary_geom))


def zip_uri(path: Path) -> str:
    return f"zip://{path}"


def download_if_needed(url: str, target_path: Path) -> Path:
    if target_path.exists() and target_path.stat().st_size > 0:
        return target_path
    ensure_dir(target_path.parent)
    response = requests.get(url, stream=True, timeout=180)
    response.raise_for_status()
    with open(target_path, "wb") as fh:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                fh.write(chunk)
    return target_path


def resolve_boundary(boundary_geojson: str | None, county_fips: str | None, cache_dir: Path) -> dict[str, Any]:
    require_boundary_selector(boundary_geojson, county_fips)

    if boundary_geojson:
        path = Path(boundary_geojson).expanduser().resolve()
        geom = load_geojson_geometry(path)
        return {
            "geometry": geom,
            "source": "boundary-geojson",
            "source_path": str(path),
            "label": path.stem,
        }

    county_fips = (county_fips or "").strip()
    if not re.fullmatch(r"\d{5}", county_fips):
        raise RuntimeError("--county-fips must be a 5-digit code like 06057")
    import geopandas as gpd

    zip_path = download_if_needed(TIGER_COUNTY_ZIP, cache_dir / "tiger" / "tl_2023_us_county.zip")
    counties = gpd.read_file(zip_uri(zip_path))
    county = counties[counties["GEOID"] == county_fips]
    if county.empty:
        raise RuntimeError(f"County FIPS {county_fips} not found in TIGER county layer")
    row = county.iloc[0]
    return {
        "geometry": normalize_geometry(row.geometry),
        "source": "county-fips",
        "source_path": county_fips,
        "label": str(row.get("NAMELSAD") or row.get("NAME") or county_fips),
    }


def intersecting_state_fips(boundary_geom, cache_dir: Path) -> list[str]:
    import geopandas as gpd

    zip_path = download_if_needed(TIGER_STATE_ZIP, cache_dir / "tiger" / "tl_2023_us_state.zip")
    states = gpd.read_file(zip_uri(zip_path)).to_crs(4326)
    hits = states[states.geometry.intersects(boundary_geom)].copy()
    if hits.empty:
        raise RuntimeError("Boundary does not intersect any US state polygons")
    return sorted(hits["STATEFP"].astype(str).tolist())


def boundary_feature_collection(boundary_geom) -> dict[str, Any]:
    from shapely.geometry import mapping

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": mapping(boundary_geom),
            }
        ],
    }


def _approximate_area_sq_mi(geom) -> float:
    geom_type = getattr(geom, "geom_type", "")
    if geom_type == "Polygon":
        return _polygon_area_sq_mi(geom)
    if geom_type == "MultiPolygon":
        return sum(_polygon_area_sq_mi(part) for part in geom.geoms)
    if hasattr(geom, "geoms"):
        return sum(_approximate_area_sq_mi(part) for part in geom.geoms)
    return 0.0


def _polygon_area_sq_mi(polygon) -> float:
    area = _ring_area_sq_mi(polygon.exterior.coords)
    for interior in polygon.interiors:
        area -= _ring_area_sq_mi(interior.coords)
    return abs(area)


def _ring_area_sq_mi(coords) -> float:
    points = list(coords)
    if len(points) < 4:
        return 0.0
    mean_lat = sum(lat for _, lat in points) / len(points)
    miles_per_lon = 69.172 * max(abs(math.cos(math.radians(mean_lat))), 1e-6)
    miles_per_lat = 69.0
    projected = [(lon * miles_per_lon, lat * miles_per_lat) for lon, lat in points]
    area = 0.0
    for (x1, y1), (x2, y2) in zip(projected, projected[1:]):
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0
