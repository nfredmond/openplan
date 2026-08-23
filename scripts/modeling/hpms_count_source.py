#!/usr/bin/env python3
"""U.S. HPMS observed-count adapter for the country-neutral source registry.

The adapter queries the FHWA-published Socrata dataset by study-area bounds,
normalizes only the evidence OpenPlan needs, and retains excluded rows with a
machine-readable reason. It never turns absent AADT into zero traffic.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence, TypedDict

import count_sources


API_ROOT = "https://data.transportation.gov"
DEFAULT_PAGE_SIZE = 5_000

# Country-adapter coverage, not a core-model assumption. Separate boxes avoid
# treating the oceans between non-contiguous U.S. areas as supported geography.
US_COVERAGE_BOUNDS: tuple[tuple[float, float, float, float], ...] = (
    (-125.0, 24.0, -66.0, 50.0),   # contiguous states
    (-180.0, 51.0, -129.0, 72.0),  # Alaska, western longitude
    (172.0, 51.0, 180.0, 72.0),    # Alaska across the antimeridian
    (-161.0, 18.0, -154.0, 23.0),  # Hawaii
    (-68.5, 17.5, -64.0, 19.5),    # Puerto Rico and U.S. Virgin Islands
    (144.0, 13.0, 146.5, 21.0),    # Guam and Northern Mariana Islands
    (-171.5, -15.0, -168.0, -10.5),  # American Samoa
)

FACILITY_CLASSES = {
    "1": "interstate",
    "2": "principal_arterial_freeway_expressway",
    "3": "principal_arterial_other",
    "4": "minor_arterial",
    "5": "major_collector",
    "6": "minor_collector",
    "7": "local",
}
FACILITY_TYPES = {
    "1": "one_way",
    "2": "two_way",
    "4": "ramp",
    "5": "non_mainline",
    "6": "non_inventory_direction",
    "7": "planned_unbuilt",
}
EXCLUDED_FACILITY_TYPES = {
    "4": "ramp_not_represented_by_retained_network",
    "5": "non_mainline_not_represented_by_retained_network",
    "6": "non_inventory_direction",
    "7": "planned_or_unbuilt_facility",
}


class HPMSSchemaDriftError(RuntimeError):
    """The live source no longer satisfies the pinned descriptor contract."""


class HPMSFetchResult(TypedDict):
    status: str
    records: list[count_sources.ObservedCountRecord]
    source: dict[str, Any]
    query_bounds: list[list[float]]
    excluded_rows: int
    error: str | None


def split_spatial_bounds(
    bbox: Sequence[float],
) -> list[tuple[float, float, float, float]]:
    """Validate WGS84 bounds and split a box that crosses the antimeridian."""
    if len(bbox) != 4:
        raise ValueError("bbox must contain min longitude, min latitude, max longitude, max latitude")
    min_lon, min_lat, max_lon, max_lat = (float(value) for value in bbox)
    if not all(math.isfinite(value) for value in (min_lon, min_lat, max_lon, max_lat)):
        raise ValueError("bbox values must be finite")
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise ValueError("bbox longitudes must be within -180..180")
    if not (-90 <= min_lat <= max_lat <= 90):
        raise ValueError("bbox latitudes must be ordered within -90..90")
    if min_lon == max_lon or min_lat == max_lat:
        raise ValueError("bbox must have non-zero width and height")
    if min_lon < max_lon:
        return [(min_lon, min_lat, max_lon, max_lat)]
    return [
        (min_lon, min_lat, 180.0, max_lat),
        (-180.0, min_lat, max_lon, max_lat),
    ]


def _intersects(a: Sequence[float], b: Sequence[float]) -> bool:
    return not (a[0] > b[2] or a[2] < b[0] or a[1] > b[3] or a[3] < b[1])


def geography_supported(bbox: Sequence[float]) -> bool:
    """Whether this U.S.-specific adapter is applicable to the requested box."""
    return any(
        _intersects(part, coverage)
        for part in split_spatial_bounds(bbox)
        for coverage in US_COVERAGE_BOUNDS
    )


def _line_parts(geometry: Mapping[str, Any]) -> list[list[tuple[float, float]]]:
    coordinates = geometry.get("coordinates") or []
    raw_parts = [coordinates] if geometry.get("type") == "LineString" else coordinates
    parts: list[list[tuple[float, float]]] = []
    for raw_part in raw_parts:
        part: list[tuple[float, float]] = []
        for coordinate in raw_part or []:
            if (
                isinstance(coordinate, (list, tuple))
                and len(coordinate) >= 2
                and all(isinstance(value, (int, float)) for value in coordinate[:2])
            ):
                part.append((float(coordinate[0]), float(coordinate[1])))
        if part:
            parts.append(part)
    return parts


def section_midpoint(geometry: Mapping[str, Any]) -> tuple[float, float] | None:
    """Length-weighted midpoint of a LineString or MultiLineString."""
    parts = _line_parts(geometry)
    segments: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    for part in parts:
        for start, end in zip(part, part[1:]):
            length = math.hypot(end[0] - start[0], end[1] - start[1])
            if length > 0:
                segments.append((start, end, length))
    if not segments:
        return parts[0][0] if parts and parts[0] else None
    target = sum(segment[2] for segment in segments) / 2.0
    traversed = 0.0
    for start, end, length in segments:
        if traversed + length >= target:
            fraction = (target - traversed) / length
            return (
                start[0] + fraction * (end[0] - start[0]),
                start[1] + fraction * (end[1] - start[1]),
            )
        traversed += length
    return segments[-1][1]


def _source_code(value: Any, width: int) -> str:
    try:
        return str(int(float(value))).zfill(width)
    except (TypeError, ValueError):
        return ""


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _truthy(value: Any) -> bool:
    return value is True or str(value).strip().lower() in {"1", "true", "yes", "y"}


def _stable_section_id(properties: Mapping[str, Any], vintage: str) -> str:
    values = (
        _source_code(properties.get("stateid"), 2),
        _text(properties.get("route_id")),
        _text(properties.get("begin_point")),
        _text(properties.get("end_point")),
        _text(properties.get("shapeid")),
    )
    return "hpms:" + vintage + ":" + ":".join(values)


def normalize_hpms_feature(
    feature: Mapping[str, Any],
    *,
    descriptor: count_sources.ObservedCountSourceDescriptor | None = None,
    source_update_timestamp: str,
) -> count_sources.ObservedCountRecord:
    """Normalize one selected HPMS section and retain any exclusion reason."""
    descriptor = descriptor or count_sources.observed_count_source_descriptor(
        count_sources.HPMS_SOURCE_ID
    )
    properties = feature.get("properties") or {}
    required = set(descriptor["field_map"].values())
    missing = sorted(field for field in required if field not in properties)
    if missing:
        raise HPMSSchemaDriftError(
            f"HPMS {descriptor['dataset_id']} schema drift: response omitted {missing}"
        )
    geometry = feature.get("geometry") or {}
    midpoint = section_midpoint(geometry)
    if midpoint is None:
        raise HPMSSchemaDriftError(
            f"HPMS {descriptor['dataset_id']} schema drift: section geometry is missing or unusable"
        )

    facility_type_code = _text(properties.get("facility_type"))
    facility_class_code = _text(properties.get("f_system"))
    aadt = _number(properties.get("aadt"))
    exclusion_reason: str | None = None
    if _truthy(properties.get("is_restricted")):
        exclusion_reason = "public_travel_restricted"
    elif facility_type_code in EXCLUDED_FACILITY_TYPES:
        exclusion_reason = EXCLUDED_FACILITY_TYPES[facility_type_code]
    elif facility_class_code not in FACILITY_CLASSES:
        exclusion_reason = "facility_class_unavailable"
    elif aadt is None:
        exclusion_reason = "aadt_unavailable_for_section"
    elif aadt < 0:
        exclusion_reason = "invalid_negative_aadt"

    state = _source_code(properties.get("stateid"), 2)
    county = _source_code(properties.get("county_id"), 3)
    route_identifiers = {
        key: _text(properties.get(source_field))
        for key, source_field in descriptor["field_map"].items()
        if key in {"route_id", "route_number", "route_signing", "route_name"}
    }
    section_limits = {
        "begin": _text(properties.get("begin_point")),
        "end": _text(properties.get("end_point")),
    }
    return {
        "source_dataset_id": descriptor["dataset_id"],
        "vintage": descriptor["vintage"],
        "section_id": _stable_section_id(properties, descriptor["vintage"]),
        "measurement_date": _text(properties.get("aadt_d")) or None,
        "observed_volume": aadt,
        "longitude": midpoint[0],
        "latitude": midpoint[1],
        "directionality": FACILITY_TYPES.get(facility_type_code, "unknown"),
        "facility_class": FACILITY_CLASSES.get(facility_class_code, "unknown"),
        "source_state": state,
        "source_county": county,
        "route_identifiers": route_identifiers,
        "section_limits": section_limits,
        "exclusion_status": "excluded" if exclusion_reason else "eligible",
        "exclusion_reason": exclusion_reason,
        "provenance": {
            "adapter": descriptor["adapter"],
            "source_update_timestamp": source_update_timestamp,
            "source_year": _text(properties.get("year_record")),
            "source_shape_id": _text(properties.get("shapeid")),
            "facility_type_code": facility_type_code,
            "functional_system_code": facility_class_code,
            "restriction_flag": properties.get("is_restricted"),
            "coverage_statement": descriptor["coverage_statement"],
        },
    }


def _polygon_wkt(bounds: Sequence[float]) -> str:
    min_lon, min_lat, max_lon, max_lat = bounds
    return (
        f"POLYGON (({min_lon} {min_lat}, {max_lon} {min_lat}, {max_lon} {max_lat}, "
        f"{min_lon} {max_lat}, {min_lon} {min_lat}))"
    )


def _cache_path(
    cache_dir: Path,
    descriptor: count_sources.ObservedCountSourceDescriptor,
    source_update_timestamp: str,
    bounds: Sequence[float],
) -> Path:
    payload = json.dumps(
        {
            "descriptor": descriptor,
            "source_update_timestamp": source_update_timestamp,
            "bounds": list(bounds),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return cache_dir / f"hpms-{descriptor['dataset_id']}-{digest}.json"


def _response_json(response: Any, context: str) -> Any:
    try:
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise RuntimeError(f"HPMS source unavailable during {context}: {exc}") from exc


def dataset_update_timestamp(
    descriptor: count_sources.ObservedCountSourceDescriptor,
    request_get: Callable[..., Any],
    *,
    timeout: int,
) -> str:
    metadata = _response_json(
        request_get(
            f"{API_ROOT}/api/views/{descriptor['dataset_id']}",
            timeout=timeout,
        ),
        "dataset metadata check",
    )
    timestamp = metadata.get("rowsUpdatedAt")
    if timestamp is None:
        raise HPMSSchemaDriftError(
            f"HPMS {descriptor['dataset_id']} schema drift: metadata omitted rowsUpdatedAt"
        )
    return str(timestamp)


def _fetch_raw_features(
    bounds: Sequence[float],
    descriptor: count_sources.ObservedCountSourceDescriptor,
    source_update_timestamp: str,
    cache_dir: Path,
    request_get: Callable[..., Any],
    *,
    timeout: int,
    page_size: int,
) -> list[dict[str, Any]]:
    cache_path = _cache_path(cache_dir, descriptor, source_update_timestamp, bounds)
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        return list(cached.get("features") or [])

    selected_fields = [descriptor["geometry_field"], *descriptor["field_map"].values()]
    features: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "$select": ",".join(dict.fromkeys(selected_fields)),
            "$where": f"intersects({descriptor['geometry_field']}, '{_polygon_wkt(bounds)}')",
            "$order": "shapeid",
            "$limit": page_size,
            "$offset": offset,
        }
        page = _response_json(
            request_get(
                f"{API_ROOT}/resource/{descriptor['dataset_id']}.geojson",
                params=params,
                timeout=timeout,
            ),
            f"paged spatial query at offset {offset}",
        )
        page_features = page.get("features") if isinstance(page, Mapping) else None
        if page_features is None:
            raise HPMSSchemaDriftError(
                f"HPMS {descriptor['dataset_id']} schema drift: GeoJSON response omitted features"
            )
        features.extend(page_features)
        if len(page_features) < page_size:
            break
        offset += page_size

    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"features": features}, sort_keys=True))
    return features


def _result_status(records: Iterable[count_sources.ObservedCountRecord]) -> str:
    records = list(records)
    eligible = [record for record in records if record["exclusion_status"] == "eligible"]
    if not eligible:
        return "no_eligible_sections"
    if not any((record["observed_volume"] or 0) > 0 for record in eligible):
        return "no_traffic_found"
    return "available"


def fetch_hpms_records(
    bbox: Sequence[float],
    cache_dir: str | Path,
    *,
    request_get: Callable[..., Any] | None = None,
    timeout: int = 60,
    page_size: int = DEFAULT_PAGE_SIZE,
    fail_on_source_error: bool = False,
) -> HPMSFetchResult:
    """Fetch and normalize all HPMS sections intersecting a study-area bbox."""
    descriptor = count_sources.observed_count_source_descriptor(count_sources.HPMS_SOURCE_ID)
    query_bounds = split_spatial_bounds(bbox)
    source = {"source_id": count_sources.HPMS_SOURCE_ID, **descriptor}
    if not geography_supported(bbox):
        return {
            "status": "geography_unsupported",
            "records": [],
            "source": source,
            "query_bounds": [list(bounds) for bounds in query_bounds],
            "excluded_rows": 0,
            "error": None,
        }

    if request_get is None:
        import requests

        request_get = requests.get
    try:
        update_timestamp = dataset_update_timestamp(
            descriptor, request_get, timeout=timeout
        )
        raw_features = [
            feature
            for bounds in query_bounds
            for feature in _fetch_raw_features(
                bounds,
                descriptor,
                update_timestamp,
                Path(cache_dir),
                request_get,
                timeout=timeout,
                page_size=page_size,
            )
        ]
        records = [
            normalize_hpms_feature(
                feature,
                descriptor=descriptor,
                source_update_timestamp=update_timestamp,
            )
            for feature in raw_features
        ]
    except HPMSSchemaDriftError:
        raise
    except Exception as exc:
        if fail_on_source_error:
            raise
        return {
            "status": "source_unavailable",
            "records": [],
            "source": source,
            "query_bounds": [list(bounds) for bounds in query_bounds],
            "excluded_rows": 0,
            "error": str(exc),
        }

    seen: dict[str, int] = {}
    for record in records:
        original_id = record["section_id"]
        duplicate_number = seen.get(original_id, 0)
        seen[original_id] = duplicate_number + 1
        if duplicate_number:
            record["section_id"] = f"{original_id}:duplicate:{duplicate_number}"
            record["exclusion_status"] = "excluded"
            record["exclusion_reason"] = "duplicate_source_section"
            record["provenance"]["duplicate_of"] = original_id

    return {
        "status": _result_status(records),
        "records": records,
        "source": {
            **source,
            "source_update_timestamp": update_timestamp,
        },
        "query_bounds": [list(bounds) for bounds in query_bounds],
        "excluded_rows": sum(record["exclusion_status"] == "excluded" for record in records),
        "error": None,
    }


def choose_preferred_records(
    records_by_source: Mapping[str, Sequence[count_sources.ObservedCountRecord]],
) -> dict[str, Any]:
    """Choose one publisher per source state; never blend state and HPMS rows."""
    descriptors = count_sources.OBSERVED_COUNT_SOURCE_DESCRIPTORS
    states = sorted(
        {
            record["source_state"]
            for records in records_by_source.values()
            for record in records
            if record["source_state"]
        }
    )
    selected: list[count_sources.ObservedCountRecord] = []
    sources_by_state: dict[str, str] = {}
    for state in states:
        candidates = []
        for source_id, records in records_by_source.items():
            in_state = [
                record
                for record in records
                if record["source_state"] == state
                and record["exclusion_status"] == "eligible"
            ]
            if in_state:
                candidates.append((descriptors[source_id]["priority"], source_id, in_state))
        if not candidates:
            continue
        _, source_id, records = max(candidates, key=lambda row: (row[0], row[1]))
        sources_by_state[state] = source_id
        selected.extend(records)
    return {"records": selected, "sources_by_state": sources_by_state}


def records_geojson(result: HPMSFetchResult) -> dict[str, Any]:
    """Compatibility view for the existing count-set/network matcher.

    Excluded sections remain in the fetched GeoJSON with their reason; the
    builder deliberately filters them before matching to a modeled link.
    """
    features = []
    for record in result["records"]:
        route = (
            record["route_identifiers"].get("route_name")
            or record["route_identifiers"].get("route_number")
            or record["route_identifiers"].get("route_id")
            or record["section_id"]
        )
        begin = record["section_limits"].get("begin", "")
        end = record["section_limits"].get("end", "")
        description = f"HPMS section {begin} to {end}".strip()
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [record["longitude"], record["latitude"]],
                },
                "properties": {
                    "RTE": route,
                    "PM": begin,
                    "DESCRIPTION": description,
                    "BACK_AADT": record["observed_volume"],
                    "AHEAD_AADT": record["observed_volume"],
                    "source_dataset_id": record["source_dataset_id"],
                    "source_vintage": record["vintage"],
                    "source_section_id": record["section_id"],
                    "measurement_date": record["measurement_date"],
                    "directionality": record["directionality"],
                    "facility_class": record["facility_class"],
                    "source_state": record["source_state"],
                    "source_county": record["source_county"],
                    "exclusion_status": record["exclusion_status"],
                    "exclusion_reason": record["exclusion_reason"],
                    "source_provenance": record["provenance"],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
