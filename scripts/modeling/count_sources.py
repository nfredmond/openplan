#!/usr/bin/env python3
"""Multi-state observed-count sources for the calibration/validation pipeline.

The screening model is geo-general (any US corridor, driven by geometry). The
one place counts are CALIFORNIA-scoped today is the AADT source — but every
state DOT publishes AADT through an ArcGIS FeatureServer with the same REST
shape, differing only in field names and point-vs-segment geometry. This module
is a small REGISTRY of those sources plus a normalizer, so adding a state is
one registry entry (its FeatureServer URL + a field map), not new plumbing.

`fetch_aadt_geojson(bbox, region)` queries the region's FeatureServer for the
study bbox and writes a GeoJSON FeatureCollection whose properties are
normalized to the columns build_expanded_aadt_counts.py already reads
(RTE / PM / DESCRIPTION / BACK_AADT / AHEAD_AADT). Every value is real DOT data.

Not included: a single national HPMS source — FHWA HPMS is distributed as bulk
per-state shapefiles / functional-system-split linework, not a clean bbox API,
so a national ingest is a larger follow-up. The per-state FeatureServer path
here covers any state that publishes one (most do).
"""
from __future__ import annotations

import json
from typing import Any

# region -> AADT FeatureServer. `fields` maps this source's attribute names to
# the normalized keys. A source with a single directional-total AADT field uses
# "aadt"; one that splits back/ahead (like Caltrans) uses "back_aadt"/"ahead_aadt".
COUNT_SOURCES: dict[str, dict[str, Any]] = {
    "CA": {
        "name": "Caltrans Traffic_Volumes_AADT (2023)",
        "query_url": (
            "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/"
            "Traffic_AADT/FeatureServer/0/query"
        ),
        "geometry": "point",
        "fields": {
            "route": "RTE", "postmile": "PM", "description": "DESCRIPTION",
            "back_aadt": "BACK_AADT", "ahead_aadt": "AHEAD_AADT",
        },
    },
    # To add a state: append its AADT FeatureServer /query URL + field map, e.g.
    #   "WA": {"name": "WSDOT AADT", "query_url": ".../FeatureServer/0/query",
    #          "geometry": "point", "fields": {"route": "StateRouteNumber",
    #          "description": "LocationDescription", "aadt": "AADT"}},
    # then `fetch_aadt_geojson(bbox, "WA")`. Segment (linework) sources also work
    # — the normalizer takes the geometry centroid.
}


def _centroid(geom: dict[str, Any]) -> tuple[float, float] | None:
    """(lon, lat) for a GeoJSON Point / LineString / (Multi)Polygon — the mean of
    its coordinates. Segment/area AADT sources thus reduce to a representative
    point the network matcher can bbox-match, same as a point source."""
    xs, ys = [], []

    def walk(o: Any) -> None:
        if isinstance(o, (list, tuple)):
            if len(o) == 2 and all(isinstance(v, (int, float)) for v in o):
                xs.append(float(o[0]))
                ys.append(float(o[1]))
            else:
                for e in o:
                    walk(e)

    walk((geom or {}).get("coordinates"))
    if not xs:
        return None
    return sum(xs) / len(xs), sum(ys) / len(ys)


def normalize_features(raw_features: list[dict[str, Any]], fields: dict[str, str]) -> list[dict[str, Any]]:
    """Map a FeatureServer response's features to the generator's schema (a
    Point FeatureCollection with RTE/PM/DESCRIPTION/BACK_AADT/AHEAD_AADT). A
    single-`aadt` source is expanded to equal back/ahead. Pure — no network."""
    out = []
    for f in raw_features:
        props = f.get("properties") or f.get("attributes") or {}
        geom = f.get("geometry")
        # attributes-form (esri json) carries x/y instead of geometry
        if geom is None and "x" in (f.get("geometry") or {}):
            geom = f.get("geometry")
        cent = _centroid(geom) if geom and "coordinates" in geom else None
        if cent is None and isinstance(geom, dict) and "x" in geom:
            cent = (float(geom["x"]), float(geom["y"]))
        if cent is None:
            continue
        if "aadt" in fields:
            aadt = props.get(fields["aadt"])
            back = ahead = aadt
        else:
            back = props.get(fields.get("back_aadt", ""))
            ahead = props.get(fields.get("ahead_aadt", ""))
        norm = {
            "RTE": props.get(fields.get("route", ""), ""),
            "PM": props.get(fields.get("postmile", ""), ""),
            "DESCRIPTION": props.get(fields.get("description", ""), ""),
            "BACK_AADT": back,
            "AHEAD_AADT": ahead,
        }
        out.append({"type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [cent[0], cent[1]]},
                    "properties": norm})
    return out


def fetch_aadt_geojson(bbox: tuple[float, float, float, float], region: str, out_path: str,
                       timeout: int = 60) -> int:
    """Query the region's AADT FeatureServer for `bbox` (minlon,minlat,maxlon,
    maxlat, WGS84) and write a normalized Point GeoJSON to out_path. Returns the
    feature count. Real DOT data only — never synthesized."""
    import requests  # lazy so the module imports without requests

    if region not in COUNT_SOURCES:
        raise ValueError(f"No count source registered for region {region!r}. "
                         f"Registered: {sorted(COUNT_SOURCES)}. Add one to COUNT_SOURCES.")
    src = COUNT_SOURCES[region]
    fields = src["fields"]
    out_fields = ",".join(sorted({v for v in fields.values()}))
    params = {
        "where": "1=1",
        "geometry": ",".join(str(v) for v in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": out_fields,
        "f": "geojson",
    }
    res = requests.get(src["query_url"], params=params, timeout=timeout)
    res.raise_for_status()
    data = res.json()
    feats = normalize_features(data.get("features", []), fields)
    with open(out_path, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh)
    return len(feats)
