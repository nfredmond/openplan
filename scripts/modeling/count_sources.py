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

`source_provenance(region)` returns the attribution facts for a region (agency,
station namespace, published vintage) so the count builder can stamp the agency
that actually published a count set instead of assuming one.

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
#
# Provenance keys — `agency`, `station_prefix`, `route_label_prefix`,
# `count_year` — are what the count builder stamps on every row it writes, so a
# count set always carries the attribution of the DOT that actually published
# it. They are REQUIRED: source_provenance() refuses an entry that does not
# declare its agency, because the alternative (a default) is how counts from one
# state end up wearing another state's name in an evidence packet.
# `count_year` is the vintage the source publishes; None means the feed does not
# expose one we map, and the builder then leaves count_year blank rather than
# asserting a year it cannot support.
COUNT_SOURCES: dict[str, dict[str, Any]] = {
    "CA": {
        "name": "Caltrans Traffic_Volumes_AADT (2023)",
        "agency": "Caltrans",
        "station_prefix": "CT",
        "route_label_prefix": "SR",
        "count_year": 2023,
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
    # Washington — WSDOT "Traffic Counts" AADT point stations. Single total AADT
    # (per-record, one value). Point layer; f=geojson works. Live-verified.
    "WA": {
        "name": "WSDOT Traffic Counts AADT",
        "agency": "WSDOT",
        "station_prefix": "WSDOT",
        # RouteIdentifier is a bare state-route id ("005"); no on-the-ground
        # prefix is asserted because the feed mixes interstates and state routes.
        "route_label_prefix": "",
        "count_year": None,  # layer's vintage field not mapped — never assumed
        "query_url": (
            "https://data.wsdot.wa.gov/arcgis/rest/services/Shared/TrafficData/"
            "FeatureServer/0/query"
        ),
        "geometry": "point",
        "fields": {
            "route": "RouteIdentifier", "postmile": "AccumulatedRouteMile",
            "description": "Location", "aadt": "AADT",
        },
    },
    # Colorado — CDOT "Highways: Traffic Counts" AADT segments (latest year).
    # Linework → the normalizer takes each segment's centroid. Single total AADT.
    # No free-text location field, so description = the count-station id. Live-verified.
    "CO": {
        "name": "CDOT Highways Traffic Counts AADT",
        "agency": "CDOT",
        "station_prefix": "CDOT",
        "route_label_prefix": "",
        "count_year": None,  # "latest year" segments; vintage field not mapped
        "query_url": (
            "https://dtdapps.codot.gov/server/rest/services/Webapps/open_data_sde/"
            "FeatureServer/13/query"
        ),
        "geometry": "line",
        "fields": {
            "route": "ROUTE", "postmile": "REFPT",
            "description": "COUNTSTATIONID", "aadt": "AADT",
        },
    },
    # Oregon — ODOT TransGIS "AADT - State" point stations. Single total AADT.
    # NOTE: this ArcGIS Server advertises GeoJSON but 400s when geometry is
    # serialized; fetch_aadt_geojson falls back to Esri JSON (handled by the
    # normalizer's x/y path). Live-verified via that fallback.
    "OR": {
        "name": "ODOT TransGIS AADT - State",
        "agency": "ODOT",
        "station_prefix": "ODOT",
        # HWYNUMB is ODOT's highway number, which is NOT the posted route number,
        # so no route prefix is invented for it.
        "route_label_prefix": "",
        "count_year": None,  # vintage field not mapped
        "query_url": (
            "https://gis.odot.state.or.us/arcgis1006/rest/services/transgis/catalog/"
            "MapServer/155/query"
        ),
        "geometry": "point",
        "fields": {
            "route": "HWYNUMB", "postmile": "MP",
            "description": "LOCATION", "aadt": "AADT",
        },
    },
    # To add a state: append its AADT FeatureServer /query URL + field map + the
    # provenance keys above (agency and station_prefix are mandatory). A
    # single-total AADT source uses "aadt"; one that splits back/ahead (Caltrans)
    # uses "back_aadt"/"ahead_aadt". Segment (linework) sources work too — the
    # normalizer takes the geometry centroid. Also add the state's bbox to
    # workers/aequilibrae_worker/main.py::_REGION_BOUNDS so auto-ingest recognizes it.
}

# A registry entry without these cannot describe where its counts came from.
_REQUIRED_PROVENANCE_KEYS = ("name", "agency", "station_prefix")


def source_provenance(region: str) -> dict[str, Any]:
    """Who published this region's counts, how its stations are namespaced, and
    what vintage (if the feed declares one) — the facts the count builder stamps
    on every row.

    Fails closed on an unregistered region and on an entry missing its agency: a
    count row must never inherit some other jurisdiction's attribution because a
    default was in scope. Vintage may legitimately be None (unknown ≠ wrong)."""
    if region not in COUNT_SOURCES:
        raise ValueError(f"No count source registered for region {region!r}. "
                         f"Registered: {sorted(COUNT_SOURCES)}. Add one to COUNT_SOURCES.")
    src = COUNT_SOURCES[region]
    missing = [key for key in _REQUIRED_PROVENANCE_KEYS if not src.get(key)]
    if missing:
        raise ValueError(f"Count source {region!r} does not declare {missing}; a count set "
                         f"cannot be written without the agency that published it.")
    return {
        "region": region,
        "name": src["name"],
        "agency": src["agency"],
        "station_prefix": src["station_prefix"],
        "route_label_prefix": src.get("route_label_prefix", ""),
        "count_year": src.get("count_year"),
        "query_url": src.get("query_url"),
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
    feature count. Real DOT data only — never synthesized.

    Requests GeoJSON first (native for most ArcGIS servers). Some servers (e.g.
    ODOT's ArcGIS Server 10.6) advertise GeoJSON but return HTTP 400 whenever
    geometry must be serialized — so on a failed/errored GeoJSON response this
    retries Esri JSON, which normalize_features handles equally (its x/y path).
    A clean response is authoritative even if it holds zero stations, so the
    JSON retry only runs when GeoJSON did not respond cleanly. If BOTH formats
    fail, the underlying error is raised (never a silent empty result)."""
    import requests  # lazy so the module imports without requests

    source_provenance(region)  # refuse to fetch counts we could not attribute
    src = COUNT_SOURCES[region]
    fields = src["fields"]
    out_fields = ",".join(sorted({v for v in fields.values()}))
    base_params = {
        "where": "1=1",
        "geometry": ",".join(str(v) for v in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": out_fields,
    }
    feats: list[dict[str, Any]] = []
    last_error: Exception | None = None
    for fmt in ("geojson", "json"):
        try:
            res = requests.get(src["query_url"], params={**base_params, "f": fmt}, timeout=timeout)
            res.raise_for_status()
            data = res.json()
        except Exception as exc:  # network / HTTP error (e.g. the GeoJSON-geometry 400)
            last_error = exc
            continue
        # Some servers answer HTTP 200 with an {"error": {...}} envelope.
        if isinstance(data, dict) and data.get("error"):
            last_error = RuntimeError(f"ArcGIS query error (f={fmt}): {data['error']}")
            continue
        feats = normalize_features(data.get("features", []), fields)
        last_error = None
        break  # a clean response is authoritative — no need to try the other format
    if last_error is not None and not feats:
        raise last_error
    with open(out_path, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh)
    return len(feats)
