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

The registry also carries the national HPMS fallback. Its U.S.-specific Socrata
adapter lives in ``hpms_count_source.py``; FHWA field names and coding never
enter the country-neutral descriptor or normalized-record contracts here.
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal, Mapping, TypedDict


class ObservedCountSourceDescriptor(TypedDict):
    """Country-neutral description of an observed-count source adapter."""

    adapter: str
    country: str
    dataset_id: str
    vintage: str
    coverage_statement: str
    field_map: dict[str, str]
    geometry_field: str
    priority: int


class ObservedCountRecord(TypedDict):
    """Normalized section/count evidence shared by source adapters."""

    source_dataset_id: str
    vintage: str
    section_id: str
    measurement_date: str | None
    observed_volume: float | None
    longitude: float
    latitude: float
    directionality: str
    facility_class: str
    source_state: str
    source_county: str
    route_identifiers: dict[str, str]
    section_limits: dict[str, str]
    exclusion_status: Literal["eligible", "excluded"]
    exclusion_reason: str | None
    provenance: dict[str, Any]

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
        # WSDOT counts ramps as their own stations ("OFF RAMP WYE CONNECTION",
        # "TODD RD ON RAMP"). See `station_role` for why they must not be
        # compared against a screening network that has no ramp links.
        "non_mainline_patterns": [r"\bramps?\b"],
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
        # ODOT's LOCATION field is "<COUNTED FACILITY>, <where it is>", so the
        # facility is the clause before the first comma and the rest is a
        # positional reference to other roads. Measured 2026-08-20 across 1,334
        # stations: without this, six mainline highway stations were discarded
        # because their POSITION mentioned a ramp — including the largest count
        # in the whole set, 95,729 on Beaverton-Tigard Highway "Nw of
        # southbound Pacific Highway (I5) ramps".
        "facility_clause_pattern": r"^([^,]*)",
        # ODOT publishes ramp counts ("SB I-5 off-ramp"), counts on numbered
        # CONNECTIONS — short connector highways between routes ("HAINES RD.
        # CONN. NO. 3"), which are ramps by another name and are 300 of this
        # feed's stations in the study counties, and counts on FRONTAGE ROADS
        # filed under the parallel highway's own route number and milepost.
        # Every spelling below is taken from the feed's own descriptions.
        #
        # The frontage-road case was measured 2026-08-20: 72 stations whose
        # counted facility is a frontage road were being graded against the
        # highway they run beside — "Biddle Frontage Road", 450 vehicles a day,
        # against Crater Lake Highway's 69,385. Twenty-five of the 27 that
        # reached a comparison had matched a differently-named mainline.
        #
        # "CONNECTION" spelled out and unnumbered is deliberately NOT here:
        # "DEPOT ST. CONNECTION" matched a link actually named Depot Street, so
        # excluding it would discard a fair comparison to make the model look
        # better. The abbreviated "CONN." is ODOT's interchange-connection
        # marker and all 24 of its stations are interchange connectors.
        "non_mainline_patterns": [
            r"\bramps?\b",
            r"\bconn(?:ection)?\.?\s*(?:no\.?\s*)?\d+",
            r"\bconn\.",
            r"\bcn\.?\s*\d+\b",
            r"\bfront(?:age|\.)\s*(?:rd|road)?\b",
        ],
    },
    # To add a state: append its AADT FeatureServer /query URL + field map + the
    # provenance keys above (agency and station_prefix are mandatory). A
    # single-total AADT source uses "aadt"; one that splits back/ahead (Caltrans)
    # uses "back_aadt"/"ahead_aadt". Segment (linework) sources work too — the
    # normalizer takes the geometry centroid. Also add the state's bbox to
    # workers/aequilibrae_worker/main.py::_REGION_BOUNDS so auto-ingest recognizes it.
}


HPMS_SOURCE_ID = "us-fhwa-hpms-2024"
HPMS_DATASET_ID = "42um-tgh5"
HPMS_COVERAGE_STATEMENT = (
    "Section-level AADT covers Federal-aid highways nationwide. Rural minor collectors and "
    "local roads may be represented only in summary data; a missing section value is unknown, "
    "not zero traffic. Counts may be three to six years old under FHWA traffic-count cycles."
)


def _state_source_descriptor(region: str, source: Mapping[str, Any]) -> ObservedCountSourceDescriptor:
    fields = source.get("fields") or {}
    return {
        "adapter": "arcgis-feature-service",
        "country": "US",
        "dataset_id": f"us-{region.lower()}-{source['station_prefix'].lower()}-aadt",
        "vintage": str(source.get("count_year") or "publisher-current-vintage-unspecified"),
        "coverage_statement": f"{source['agency']} roadway count coverage for {region}.",
        "field_map": {
            "route_id": fields.get("route", ""),
            "section_start": fields.get("postmile", ""),
            "description": fields.get("description", ""),
            "aadt": fields.get("aadt") or fields.get("ahead_aadt") or "",
        },
        "geometry_field": "geometry",
        "priority": 100,
    }


OBSERVED_COUNT_SOURCE_DESCRIPTORS: dict[str, ObservedCountSourceDescriptor] = {
    **{
        f"us-state-{region.lower()}": _state_source_descriptor(region, source)
        for region, source in COUNT_SOURCES.items()
    },
    HPMS_SOURCE_ID: {
        "adapter": "us-fhwa-hpms-socrata",
        "country": "US",
        "dataset_id": HPMS_DATASET_ID,
        "vintage": "2024",
        "coverage_statement": HPMS_COVERAGE_STATEMENT,
        "field_map": {
            "aadt": "aadt",
            "measurement_date": "aadt_d",
            "state": "stateid",
            "county": "county_id",
            "facility_class": "f_system",
            "facility_type": "facility_type",
            "restricted": "is_restricted",
            "route_id": "route_id",
            "route_number": "route_number",
            "route_signing": "route_signing",
            "route_name": "routename",
            "section_start": "begin_point",
            "section_end": "end_point",
            "source_year": "year_record",
            "section_shape_id": "shapeid",
        },
        "geometry_field": "line",
        "priority": 10,
    },
}


def observed_count_source_descriptor(source_id: str) -> ObservedCountSourceDescriptor:
    """Resolve a source explicitly; source identity is never guessed."""
    try:
        return OBSERVED_COUNT_SOURCE_DESCRIPTORS[source_id]
    except KeyError as exc:
        raise ValueError(
            f"No observed-count source {source_id!r}; registered: "
            f"{sorted(OBSERVED_COUNT_SOURCE_DESCRIPTORS)}"
        ) from exc


def observed_count_sources_for_regions(regions: list[str]) -> list[tuple[str, ObservedCountSourceDescriptor]]:
    """State publishers first, followed once by the nationwide HPMS fallback."""
    selected: list[tuple[str, ObservedCountSourceDescriptor]] = []
    for region in sorted(set(regions)):
        source_id = f"us-state-{region.lower()}"
        if source_id in OBSERVED_COUNT_SOURCE_DESCRIPTORS:
            selected.append((source_id, OBSERVED_COUNT_SOURCE_DESCRIPTORS[source_id]))
    selected.append((HPMS_SOURCE_ID, OBSERVED_COUNT_SOURCE_DESCRIPTORS[HPMS_SOURCE_ID]))
    return sorted(selected, key=lambda item: (-item[1]["priority"], item[0]))

# A registry entry without these cannot describe where its counts came from.
_REQUIRED_PROVENANCE_KEYS = ("name", "agency", "station_prefix")


def source_provenance(region: str) -> dict[str, Any]:
    """Who published this region's counts, how its stations are namespaced, and
    what vintage (if the feed declares one) — the facts the count builder stamps
    on every row.

    Fails closed on an unregistered region and on an entry missing its agency: a
    count row must never inherit some other jurisdiction's attribution because a
    default was in scope. Vintage may legitimately be None (unknown ≠ wrong)."""
    if region == HPMS_SOURCE_ID:
        descriptor = observed_count_source_descriptor(region)
        return {
            "region": region,
            "name": "FHWA HPMS Spatial All Sections - 2024",
            "agency": "Federal Highway Administration",
            "station_prefix": "HPMS",
            "route_label_prefix": "",
            "count_year": 2024,
            "query_url": f"https://data.transportation.gov/resource/{descriptor['dataset_id']}.geojson",
            "non_mainline_patterns": (),
            "facility_clause_pattern": "",
            "source_dataset_id": descriptor["dataset_id"],
            "vintage": descriptor["vintage"],
            "coverage_statement": descriptor["coverage_statement"],
        }
    if region not in COUNT_SOURCES:
        raise ValueError(f"No count source registered for region {region!r}. "
                         f"Registered: {sorted(COUNT_SOURCES)}. Add one to COUNT_SOURCES.")
    src = COUNT_SOURCES[region]
    missing = [key for key in _REQUIRED_PROVENANCE_KEYS if not src.get(key)]
    if missing:
        raise ValueError(f"Count source {region!r} does not declare {missing}; a count set "
                         f"cannot be written without the agency that published it.")
    descriptor = observed_count_source_descriptor(f"us-state-{region.lower()}")
    return {
        "region": region,
        "name": src["name"],
        "agency": src["agency"],
        "station_prefix": src["station_prefix"],
        "route_label_prefix": src.get("route_label_prefix", ""),
        "count_year": src.get("count_year"),
        "query_url": src.get("query_url"),
        "non_mainline_patterns": tuple(src.get("non_mainline_patterns", ())),
        "facility_clause_pattern": src.get("facility_clause_pattern", ""),
        "source_dataset_id": descriptor["dataset_id"],
        "vintage": descriptor["vintage"],
        "coverage_statement": descriptor["coverage_statement"],
    }


MAINLINE_ROLE = "mainline"
NOT_MAINLINE_ROLE = "not_mainline"


def station_role(provenance: Mapping[str, Any], description: str | None) -> tuple[str, str]:
    """Whether a count station measures a road the screening network contains.

    ================================================= WHY THIS EXISTS AT ALL

    A ramp count is a real count of a real facility. The screening network has
    no ramp links — it is built from OSM's road hierarchy at a resolution where
    a freeway is one line — so the nearest thing the matcher can pair a ramp
    count with is the mainline it leaves. Measured 2026-08-17 in Cowlitz County,
    Washington: three WSDOT ramp stations counting 410, 510 and 530 vehicles a
    day were all matched to the mainline carrying 29,040, reporting errors of
    71x, 57x and 55x — while the genuine mainline station on that same link
    (37,000 observed) matched it correctly at 0.8.

    Across the eleven development counties this affected 23% of matched
    stations and carried a median error of 258%. It makes a model look far
    worse than it is, and it would poison any calibration fitted to the counts.

    ==================================================== WHY IT IS PER-FEED

    "Ramp" is a WSDOT spelling and "CONN. NO. 3" is an ODOT one; Caltrans and
    CDOT publish no such stations at all. So each registry entry declares how
    ITS publisher marks a non-mainline station, and this function only applies
    what the feed declared. Nothing here knows about any particular place, and
    a feed that declares nothing gets every station treated as mainline — which
    is exactly the behaviour before this existed.

    ============================= WHY THE FEED ALSO SAYS WHERE TO READ

    A description names more than one road: the one that was counted, and the
    ones that locate it. Which position holds which is the publisher's own
    convention, so the feed declares it too, as `facility_clause_pattern` whose
    first group is the counted facility.

    The two conventions measured 2026-08-20 are opposites, which is why this
    cannot be a shared rule. ODOT writes "<FACILITY>, <where it is>", so
    "CORVALLIS-NEWPORT HIGHWAY NO. 33, West of Toledo Frontage Road" is a
    highway count and must survive, while "US97 Frontage Rd., South of Nels
    Anderson Place" is a frontage-road count and must not. WSDOT writes
    "<direction> OF MILEPOST x: <what is there>", where the counted facility is
    the route and the text names a landmark — so "FRONTAGE RD INTERSECTION" is
    the mainline counted AT a frontage road, at 20,000–37,000 vehicles a day,
    and applying ODOT's rule to it would throw away three true mainline
    stations. A feed that declares no convention is read whole, as before.
    """
    text = str(description or "")
    clause_pattern = provenance.get("facility_clause_pattern", "")
    if clause_pattern:
        found = re.search(clause_pattern, text)
        text = found.group(1) if found else ""
    for pattern in provenance.get("non_mainline_patterns", ()):
        matched = re.search(pattern, text, re.IGNORECASE)
        if matched:
            return (
                NOT_MAINLINE_ROLE,
                f"{provenance.get('agency', 'this source')} publishes this as a count on "
                f"{matched.group(0).strip()!r} — a ramp, connector or frontage road rather than "
                "the mainline; the screening network has no such link, so comparing it against "
                "the mainline beside it would measure the pairing rather than the model.",
            )
    return MAINLINE_ROLE, ""


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
