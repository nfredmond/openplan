#!/usr/bin/env python3
"""Comparable v2 observation packages and assignment-blind geometry matching.

This module has no model-output argument, path, or discovery code. It freezes
source facts, full geometries, stable series identifiers, and selected links
before an assignment result can be opened.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from shapely.geometry import Point, box, shape
from shapely.ops import transform
from shapely.strtree import STRtree


OBSERVATION_SCHEMA = "openplan.observed-traffic-observation.v2"
PACKAGE_SCHEMA = "openplan.validation-observation-package.v2"
MATCH_AUDIT_SCHEMA = "openplan.pre-volume-observation-match-audit.v2"
INPUT_BUNDLE_SCHEMA = "openplan.validation-input-bundle.v2"
MATCHER_VERSION = "openplan.pre-volume-observation-matcher.v2"
UNKNOWN = "unknown"
ALLOWED_SOURCE_STATES = {
    "available", "source_unavailable", "supported_but_empty", "geography_unsupported",
}
ALLOWED_MATCH_STATES = {
    "matched", "ambiguous", "excluded", "unresolved", "unsupported", "genuine_network_absence",
}
MODELED_VALUE_KEYS = {
    "best_modeled_daily_pce", "modeled", "modeled_daily_pce", "modeled_volume",
    "model_volume", "pce_tot", "volume", "link_volumes", "model_output",
}
ASSIGNMENT_BLIND_CONTROL_KEYS = {"frozen_before_model_volume", "model_output_bytes_read"}
SPATIALITE_PATHS = (
    "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite",
)
EARTH_RADIUS_METERS = 6_371_008.8
FACILITY_RANKS = {
    "motorway": 1, "trunk": 2, "primary": 3, "secondary": 4,
    "tertiary": 5, "unclassified": 6, "residential": 7, "service": 8,
    "interstate": 1, "principal_arterial_freeway_expressway": 2,
    "principal_arterial_other": 3, "minor_arterial": 4,
    "major_collector": 5, "minor_collector": 6, "local": 7,
}
TMAS_CLASS_RANKS = {"1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7}
DIRECTION_ANGLES = {
    "north": 0.0, "northeast": 45.0, "east": 90.0, "southeast": 135.0,
    "south": 180.0, "southwest": 225.0, "west": 270.0, "northwest": 315.0,
}


class InstrumentV2Error(RuntimeError):
    """The v2 instrument cannot preserve its scientific boundary."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_record(path: Path, *, relative_to: Path | None = None) -> dict[str, Any]:
    if not path.is_file():
        raise InstrumentV2Error(f"Required artifact is missing: {path}")
    label = str(path.relative_to(relative_to)) if relative_to is not None else str(path)
    return {"path": label, "sha256": sha256_file(path), "bytes": path.stat().st_size}


def registry_adapter_for_geography(
    registry: Mapping[str, Any], geography: Mapping[str, Any]
) -> dict[str, Any]:
    """Resolve jurisdiction support only from the registry, never a core default."""
    country = str(geography.get("country") or "")
    adapters = registry.get("adapters")
    entry = adapters.get(country) if isinstance(adapters, Mapping) else None
    if not isinstance(entry, Mapping):
        return {"status": "unsupported", "country": country or UNKNOWN, "source_ids": []}
    source_ids = entry.get("source_ids")
    if not isinstance(source_ids, list) or not all(isinstance(item, str) for item in source_ids):
        raise InstrumentV2Error("Registered country adapter omitted explicit source_ids")
    return {"status": "supported", "country": country, "source_ids": list(source_ids), "module": entry.get("module", UNKNOWN)}


def verify_artifact(path: Path, record: Mapping[str, Any]) -> None:
    if not path.is_file():
        raise InstrumentV2Error(f"Frozen artifact is missing: {path}")
    if path.stat().st_size != record.get("bytes") or sha256_file(path) != record.get("sha256"):
        raise InstrumentV2Error(f"Frozen artifact bytes changed: {path}")


def _contains_modeled_value(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).lower()
            if normalized in ASSIGNMENT_BLIND_CONTROL_KEYS:
                if _contains_modeled_value(item):
                    return True
                continue
            if normalized in MODELED_VALUE_KEYS or ("model" in normalized and "volume" in normalized):
                return True
            if _contains_modeled_value(item):
                return True
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return any(_contains_modeled_value(item) for item in value)
    return False


def assert_assignment_blind(value: Any) -> None:
    if _contains_modeled_value(value):
        raise InstrumentV2Error("Assignment-blind artifact contains a modeled-output field")


def validate_observation(observation: Mapping[str, Any]) -> None:
    if observation.get("schema") != OBSERVATION_SCHEMA:
        raise InstrumentV2Error(f"Observation must use {OBSERVATION_SCHEMA}")
    required = {
        "observation_id", "site_id", "series_id", "source_kind", "observation_status",
        "source", "route_lrs", "geometry", "direction_lane_carriageway", "facility",
        "vehicle_basis", "time_basis", "measurements", "estimate", "evidence_grade",
        "duplicate_lineage",
    }
    missing = sorted(required - set(observation))
    if missing:
        raise InstrumentV2Error(f"Observation omitted fields: {missing}")
    if observation["observation_id"] != observation["series_id"]:
        raise InstrumentV2Error("observation_id must remain the stable series_id")
    if not isinstance(observation["measurements"], list) or not observation["measurements"]:
        raise InstrumentV2Error("Observation series must retain at least one source measurement")
    measurement_ids: set[str] = set()
    for measurement in observation["measurements"]:
        for field in (
            "measurement_id", "source_member_path", "source_member_sha256", "period",
            "value", "unit", "complete", "exact_record_sha256",
        ):
            if field not in measurement:
                raise InstrumentV2Error(f"Measurement omitted {field}")
        if measurement["measurement_id"] in measurement_ids:
            raise InstrumentV2Error("Measurement ids must be unique inside a series")
        measurement_ids.add(str(measurement["measurement_id"]))
        for field in ("source_member_sha256", "exact_record_sha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", str(measurement[field])):
                raise InstrumentV2Error(f"Measurement {field} is not an exact SHA-256")
    geometry = observation["geometry"]
    if geometry.get("coordinates") != UNKNOWN:
        try:
            shape({"type": geometry["type"], "coordinates": geometry["coordinates"]})
        except Exception as exc:
            raise InstrumentV2Error(f"Observation geometry is unreadable: {exc}") from exc


def build_observation_package(
    output_path: Path,
    *,
    study_id: str,
    geography: Mapping[str, Any],
    registry_artifact: Mapping[str, Any],
    source_attempts: Sequence[Mapping[str, Any]],
    observations: Sequence[Mapping[str, Any]],
    created_at: str | None = None,
) -> dict[str, Any]:
    for attempt in source_attempts:
        if attempt.get("status") not in ALLOWED_SOURCE_STATES:
            raise InstrumentV2Error(f"Unknown source status: {attempt.get('status')}")
        if attempt.get("status") == "available" and not attempt.get("artifacts"):
            raise InstrumentV2Error("Available source attempt has no exact artifact")
    seen_series: set[str] = set()
    seen_measurements: set[str] = set()
    for observation in observations:
        validate_observation(observation)
        series_id = str(observation["series_id"])
        if series_id in seen_series:
            raise InstrumentV2Error(f"Series id changed or repeated: {series_id}")
        seen_series.add(series_id)
        for measurement in observation["measurements"]:
            measurement_id = str(measurement["measurement_id"])
            if measurement_id in seen_measurements:
                raise InstrumentV2Error(f"Measurement lineage collapsed across series: {measurement_id}")
            seen_measurements.add(measurement_id)
    counts = Counter(str(item["observation_status"]) for item in observations)
    counts.update(str(item["status"]) for item in source_attempts if item["status"] != "available")
    package = {
        "schema": PACKAGE_SCHEMA,
        "package_id": f"{study_id}:{geography['geography_id']}:observation-package-v2",
        "study_id": study_id,
        "created_at": created_at or utc_now(),
        "geography": dict(geography),
        "registry_artifact": dict(registry_artifact),
        "source_attempts": list(source_attempts),
        "observations": list(observations),
        "series_count": len(seen_series),
        "measurement_count": len(seen_measurements),
        "state_counts": dict(sorted(counts.items())),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canonical_json_bytes(package))
    validate_observation_package(output_path)
    return package


def validate_observation_package(path: Path) -> dict[str, Any]:
    package = json.loads(path.read_text())
    if package.get("schema") != PACKAGE_SCHEMA:
        raise InstrumentV2Error(f"Observation package must use {PACKAGE_SCHEMA}")
    observations = package.get("observations")
    if not isinstance(observations, list):
        raise InstrumentV2Error("Observation package omitted observations")
    for observation in observations:
        validate_observation(observation)
    if package.get("series_count") != len(observations):
        raise InstrumentV2Error("Observation package series_count does not match retained series")
    actual_measurements = sum(len(item["measurements"]) for item in observations)
    if package.get("measurement_count") != actual_measurements:
        raise InstrumentV2Error("Observation package measurement_count collapsed lineage")
    return package


def _connect_network(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path))
    connection.enable_load_extension(True)
    for extension in SPATIALITE_PATHS:
        if not Path(extension).exists():
            continue
        try:
            connection.load_extension(extension)
            return connection
        except sqlite3.Error:
            continue
    connection.close()
    raise InstrumentV2Error("SpatiaLite is required to read full network geometry")


def read_network_links(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise InstrumentV2Error(f"Frozen network is missing: {path}")
    connection = _connect_network(path)
    try:
        columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(links)")}
        required = {"link_id", "geometry"}
        if not required.issubset(columns):
            raise InstrumentV2Error("Frozen network links table omitted link_id or geometry")
        fields = ["link_id"]
        fields.append("name" if "name" in columns else "'' AS name")
        fields.append("link_type" if "link_type" in columns else "'' AS link_type")
        fields.append("direction" if "direction" in columns else "0 AS direction")
        fields.append("AsGeoJSON(geometry)")
        rows = connection.execute(f"SELECT {', '.join(fields)} FROM links ORDER BY link_id").fetchall()
    finally:
        connection.close()
    links = []
    for link_id, name, link_type, direction, geometry_json in rows:
        if not geometry_json:
            continue
        geometry = json.loads(geometry_json)
        if geometry.get("type") not in {"LineString", "MultiLineString"}:
            continue
        links.append({
            "link_id": str(link_id),
            "name": str(name or ""),
            "link_type": str(link_type or ""),
            "direction": int(direction or 0),
            "geometry": geometry,
        })
    return links


def _coordinates(value: Any) -> Iterable[tuple[float, float]]:
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            yield float(value[0]), float(value[1])
        else:
            for item in value:
                yield from _coordinates(item)


def _reference_coordinate(*geometries: Mapping[str, Any]) -> tuple[float, float]:
    points = [point for geometry in geometries for point in _coordinates(geometry.get("coordinates"))]
    if not points:
        raise InstrumentV2Error("Geometry has no numeric coordinate")
    return points[0]


def _normalized_delta_lon(lon: float, origin: float) -> float:
    return (lon - origin + 540.0) % 360.0 - 180.0


def _project_geometry(geometry: Mapping[str, Any], origin_lon: float, origin_lat: float):
    factor_y = math.pi * EARTH_RADIUS_METERS / 180.0
    factor_x = factor_y * max(math.cos(math.radians(origin_lat)), 1e-9)
    value = shape({"type": geometry["type"], "coordinates": geometry["coordinates"]})
    def project(x: Any, y: Any, z: Any = None):
        if isinstance(x, Iterable) and not isinstance(x, (str, bytes)):
            projected_x = [_normalized_delta_lon(float(item), origin_lon) * factor_x for item in x]
            projected_y = [(float(item) - origin_lat) * factor_y for item in y]
            return (projected_x, projected_y) if z is None else (projected_x, projected_y, z)
        projected = (_normalized_delta_lon(float(x), origin_lon) * factor_x, (float(y) - origin_lat) * factor_y)
        return projected if z is None else (*projected, z)

    return transform(project, value)


def full_geometry_relationship(observation_geometry: Mapping[str, Any], link_geometry: Mapping[str, Any]) -> dict[str, Any]:
    origin_lon, origin_lat = _reference_coordinate(observation_geometry, link_geometry)
    observed = _project_geometry(observation_geometry, origin_lon, origin_lat)
    link = _project_geometry(link_geometry, origin_lon, origin_lat)
    distance = float(observed.distance(link))
    overlap = float(observed.intersection(link).length) if not isinstance(observed, Point) else 0.0
    return {
        "method": "point_to_full_link" if isinstance(observed, Point) else "section_overlap_or_full_geometry_distance",
        "distance_meters": distance,
        "overlap_meters": overlap,
    }


def _tokens(value: Any) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]+", str(value or "").lower())
        if token not in {"road", "rd", "street", "st", "route", "highway", "hwy", "the", "unknown"}
    }


def _route_tokens(observation: Mapping[str, Any]) -> set[str]:
    route = observation.get("route_lrs") or {}
    return set().union(*(_tokens(route.get(field)) for field in ("route_id", "route_number", "route_name")))


def _route_evidence(observation: Mapping[str, Any], link: Mapping[str, Any]) -> dict[str, Any]:
    observed = _route_tokens(observation)
    network = _tokens(link.get("name"))
    shared = sorted(observed & network)
    return {"compatible": bool(shared), "shared_tokens": shared}


def _facility_rank(value: Any) -> int | None:
    text = str(value or "").lower()
    if text and text[0] in TMAS_CLASS_RANKS and (len(text) <= 2 or text[1] in {"r", "u"}):
        return TMAS_CLASS_RANKS[text[0]]
    return FACILITY_RANKS.get(text)


def _facility_evidence(observation: Mapping[str, Any], link: Mapping[str, Any]) -> dict[str, Any]:
    observed = _facility_rank((observation.get("facility") or {}).get("class"))
    network = _facility_rank(link.get("link_type"))
    compatible = observed is not None and network is not None and abs(observed - network) <= 1
    return {"compatible": compatible, "observed_rank": observed or UNKNOWN, "network_rank": network or UNKNOWN}


def _line_endpoints(geometry: Mapping[str, Any]) -> tuple[tuple[float, float], tuple[float, float]] | None:
    points = list(_coordinates(geometry.get("coordinates")))
    return (points[0], points[-1]) if len(points) >= 2 else None


def _bearing(geometry: Mapping[str, Any], direction: int) -> float | None:
    endpoints = _line_endpoints(geometry)
    if endpoints is None:
        return None
    start, end = endpoints if direction >= 0 else (endpoints[1], endpoints[0])
    delta_lon = math.radians(_normalized_delta_lon(end[0], start[0]))
    lat1, lat2 = math.radians(start[1]), math.radians(end[1])
    x = math.sin(delta_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    if x == 0 and y == 0:
        return None
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _direction_evidence(observation: Mapping[str, Any], link: Mapping[str, Any]) -> dict[str, Any]:
    observed = str((observation.get("direction_lane_carriageway") or {}).get("direction") or UNKNOWN)
    basis = str((observation.get("direction_lane_carriageway") or {}).get("basis") or UNKNOWN)
    network_direction = int(link.get("direction") or 0)
    if basis in {"combined_directions", "both_directions"}:
        return {"compatible": True, "basis": basis, "bearing_difference_degrees": UNKNOWN}
    target = DIRECTION_ANGLES.get(observed)
    if target is None:
        return {"compatible": False, "basis": "direction_unproven", "bearing_difference_degrees": UNKNOWN}
    if network_direction == 0:
        return {"compatible": True, "basis": "bidirectional_link", "bearing_difference_degrees": 0.0}
    bearing = _bearing(link["geometry"], network_direction)
    if bearing is None:
        return {"compatible": False, "basis": "network_bearing_unavailable", "bearing_difference_degrees": UNKNOWN}
    difference = abs((bearing - target + 180.0) % 360.0 - 180.0)
    return {"compatible": difference <= 67.5, "basis": "link_geometry_bearing", "bearing_difference_degrees": difference}


def _candidate(observation: Mapping[str, Any], link: Mapping[str, Any]) -> dict[str, Any]:
    geometry = full_geometry_relationship(observation["geometry"], link["geometry"])
    route = _route_evidence(observation, link)
    facility = _facility_evidence(observation, link)
    direction = _direction_evidence(observation, link)
    return {
        "link_id": link["link_id"],
        "link_name": link["name"],
        "link_type": link["link_type"],
        "link_direction": link["direction"],
        "geometry": geometry,
        "route": route,
        "facility": facility,
        "direction": direction,
        "supported": bool(route["compatible"] and facility["compatible"] and direction["compatible"]),
    }


def _is_opposite_pair(first: Mapping[str, Any], second: Mapping[str, Any]) -> bool:
    if int(first["link_direction"]) * int(second["link_direction"]) != -1:
        return False
    if not (_tokens(first["link_name"]) & _tokens(second["link_name"])):
        return False
    return abs(float(first["geometry"]["distance_meters"]) - float(second["geometry"]["distance_meters"])) <= 100.0


def match_observation(
    observation: Mapping[str, Any],
    links: Sequence[Mapping[str, Any]],
    *,
    search_distance_meters: float,
) -> dict[str, Any]:
    base = {
        "observation_id": observation["observation_id"],
        "site_id": observation["site_id"],
        "series_id": observation["series_id"],
        "status": "unresolved",
        "reason": "No supported unique link was frozen.",
        "candidate_links": [],
        "candidate_link_count": 0,
        "candidate_links_omitted": 0,
        "selected_link_ids": [],
        "direction_aggregation": UNKNOWN,
        "duplicate_lineage": dict(observation["duplicate_lineage"]),
    }
    if observation.get("observation_status") == "unsupported":
        return {**base, "status": "unsupported", "reason": str(observation.get("status_reason"))}
    if observation.get("observation_status") == "excluded":
        return {**base, "status": "excluded", "reason": str(observation.get("status_reason"))}
    lineage = observation.get("duplicate_lineage") or {}
    if lineage.get("duplicate_of") not in {None, "", UNKNOWN}:
        return {**base, "status": "excluded", "reason": "Source-declared duplicate retained without merging."}
    geometry = observation.get("geometry") or {}
    if geometry.get("coordinates") == UNKNOWN:
        return {**base, "status": "unresolved", "reason": "Observation has no usable full geometry."}
    candidates = []
    for link in links:
        item = _candidate(observation, link)
        if float(item["geometry"]["distance_meters"]) <= search_distance_meters:
            candidates.append(item)
    candidates.sort(key=lambda item: (float(item["geometry"]["distance_meters"]), str(item["link_id"])))
    base["candidate_link_count"] = len(candidates)
    if not candidates:
        return {**base, "status": "genuine_network_absence", "reason": "No full network geometry lies within the registry search distance."}
    supported = [item for item in candidates if item["supported"]]
    if not supported:
        nearest_distance = float(candidates[0]["geometry"]["distance_meters"])
        retained = [
            item for item in candidates
            if float(item["geometry"]["distance_meters"]) <= nearest_distance + 25.0
        ][:24]
        base["candidate_links"] = retained
        base["candidate_links_omitted"] = len(candidates) - len(retained)
        return {**base, "status": "ambiguous", "reason": "Nearby links have proximity only; route, direction, and facility evidence do not support a unique match."}
    base["candidate_links"] = supported
    base["candidate_links_omitted"] = len(candidates) - len(supported)
    direction_basis = str((observation.get("direction_lane_carriageway") or {}).get("basis") or UNKNOWN)
    combined = direction_basis in {"combined_directions", "both_directions"}
    bidirectional = [item for item in supported if int(item["link_direction"]) == 0]
    if combined and len(bidirectional) == 1 and len(supported) == 1:
        selected = bidirectional
        aggregation = "one_bidirectional_link"
    elif combined and len(supported) == 2 and _is_opposite_pair(supported[0], supported[1]):
        selected = supported
        aggregation = "paired_carriageways"
    elif not combined and len(supported) == 1:
        selected = supported
        aggregation = "one_direction"
    else:
        return {**base, "status": "ambiguous", "reason": "More than one supported link remains, or a combined count lacks a unique carriageway pair."}
    return {
        **base,
        "status": "matched",
        "reason": "Unique route, direction, facility, and full-geometry support frozen before assignment output.",
        "selected_link_ids": [item["link_id"] for item in selected],
        "direction_aggregation": aggregation,
    }


class LinkSpatialIndex:
    """Coarse geographic index; exact selection still uses metre geometry tests."""

    def __init__(self, links: Sequence[Mapping[str, Any]]):
        self.links = list(links)
        self.geometries = [shape(link["geometry"]) for link in self.links]
        self.tree = STRtree(self.geometries)
        self.by_wkb = {geometry.wkb: index for index, geometry in enumerate(self.geometries)}

    def query(
        self,
        observation_geometry: Mapping[str, Any],
        search_distance_meters: float,
    ) -> list[Mapping[str, Any]]:
        observed = shape({
            "type": observation_geometry["type"],
            "coordinates": observation_geometry["coordinates"],
        })
        _, latitude = _reference_coordinate(observation_geometry)
        latitude_degrees = search_distance_meters / 110_574.0
        longitude_degrees = search_distance_meters / max(
            111_320.0 * abs(math.cos(math.radians(latitude))), 1.0
        )
        min_x, min_y, max_x, max_y = observed.bounds
        windows = [box(
            min_x - longitude_degrees,
            min_y - latitude_degrees,
            max_x + longitude_degrees,
            max_y + latitude_degrees,
        )]
        if min_x - longitude_degrees < -180:
            windows.append(box(
                min_x - longitude_degrees + 360,
                min_y - latitude_degrees,
                180,
                max_y + latitude_degrees,
            ))
        if max_x + longitude_degrees > 180:
            windows.append(box(
                -180,
                min_y - latitude_degrees,
                max_x + longitude_degrees - 360,
                max_y + latitude_degrees,
            ))
        selected: set[int] = set()
        for window in windows:
            for candidate in self.tree.query(window):
                if not hasattr(candidate, "wkb"):
                    selected.add(int(candidate))
                else:
                    selected.add(self.by_wkb[candidate.wkb])
        return [self.links[index] for index in sorted(selected)]


_PROCESS_LINK_INDEX: LinkSpatialIndex | None = None
_PROCESS_SEARCH_DISTANCE = 0.0


def _initialize_match_process(links: Sequence[Mapping[str, Any]], search_distance_meters: float) -> None:
    global _PROCESS_LINK_INDEX, _PROCESS_SEARCH_DISTANCE
    _PROCESS_LINK_INDEX = LinkSpatialIndex(links)
    _PROCESS_SEARCH_DISTANCE = search_distance_meters


def _process_match_observation(observation: Mapping[str, Any]) -> dict[str, Any]:
    if _PROCESS_LINK_INDEX is None:
        raise InstrumentV2Error("Match worker has no frozen link index")
    geometry = observation.get("geometry") or {}
    nearby = (
        _PROCESS_LINK_INDEX.query(geometry, _PROCESS_SEARCH_DISTANCE)
        if geometry.get("coordinates") != UNKNOWN else ()
    )
    return match_observation(
        observation,
        nearby,
        search_distance_meters=_PROCESS_SEARCH_DISTANCE,
    )


def build_pre_volume_match_audit(
    network_path: Path,
    observation_package_path: Path,
    registry_path: Path,
    output_path: Path,
    *,
    geography_entry: Mapping[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    package = validate_observation_package(observation_package_path)
    search_distance = geography_entry.get("search_distance_meters")
    if not isinstance(search_distance, (int, float)) or search_distance <= 0:
        raise InstrumentV2Error("Search distance must come from the registry")
    links = read_network_links(network_path)
    process_count = min(12, max(1, os.cpu_count() or 1))
    with ProcessPoolExecutor(
        max_workers=process_count,
        initializer=_initialize_match_process,
        initargs=(links, float(search_distance)),
    ) as executor:
        matches = list(executor.map(_process_match_observation, package["observations"], chunksize=32))
    coverage = Counter(str(item["status"]) for item in matches)
    audit = {
        "schema": MATCH_AUDIT_SCHEMA,
        "audit_id": f"{package['package_id']}:pre-volume-match-audit-v2",
        "created_at": created_at or utc_now(),
        "frozen_before_model_volume": True,
        "model_output_bytes_read": False,
        "geography": dict(package["geography"]),
        "search_distance_meters": float(search_distance),
        "source_ids": list(geography_entry.get("source_ids") or []),
        "network_sha256": sha256_file(network_path),
        "observation_package_sha256": sha256_file(observation_package_path),
        "registry_sha256": sha256_file(registry_path),
        "matcher": {"version": MATCHER_VERSION, "sha256": sha256_file(Path(__file__))},
        "matches": matches,
        "coverage": dict(sorted(coverage.items())),
    }
    assert_assignment_blind(audit)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canonical_json_bytes(audit))
    validate_match_audit(output_path, network_path, observation_package_path, registry_path)
    return audit


def validate_match_audit(
    path: Path,
    network_path: Path,
    observation_package_path: Path,
    registry_path: Path,
) -> dict[str, Any]:
    audit = json.loads(path.read_text())
    if audit.get("schema") != MATCH_AUDIT_SCHEMA or audit.get("frozen_before_model_volume") is not True:
        raise InstrumentV2Error("Pre-volume match audit has the wrong contract or timing")
    expected = {
        "network_sha256": sha256_file(network_path),
        "observation_package_sha256": sha256_file(observation_package_path),
        "registry_sha256": sha256_file(registry_path),
    }
    for field, value in expected.items():
        if audit.get(field) != value:
            raise InstrumentV2Error(f"Match audit {field} binding changed")
    package = validate_observation_package(observation_package_path)
    if [item["observation_id"] for item in package["observations"]] != [item.get("observation_id") for item in audit.get("matches", [])]:
        raise InstrumentV2Error("Match audit changed, dropped, or reordered observation ids")
    for match in audit["matches"]:
        if match.get("status") not in ALLOWED_MATCH_STATES:
            raise InstrumentV2Error(f"Match audit contains unknown status: {match.get('status')}")
    assert_assignment_blind(audit)
    return audit


def build_input_bundle(
    *,
    study_id: str,
    geography_id: str,
    registry_path: Path,
    network_path: Path,
    observation_package_path: Path,
    match_audit_path: Path,
    assignment_profile_path: Path,
    source_artifacts: Sequence[Mapping[str, Any]],
    created_at: str | None = None,
    relative_to: Path | None = None,
) -> dict[str, Any]:
    audit = validate_match_audit(match_audit_path, network_path, observation_package_path, registry_path)
    if audit.get("model_output_bytes_read") is not False:
        raise InstrumentV2Error("Input bundle was not frozen before output reveal")
    return {
        "schema": INPUT_BUNDLE_SCHEMA,
        "bundle_id": f"{study_id}:{geography_id}:validation-input-v2",
        "created_at": created_at or utc_now(),
        "study_id": study_id,
        "geography_id": geography_id,
        "model_output_bytes_read": False,
        "readiness_inputs": {
            "registry": artifact_record(registry_path, relative_to=relative_to),
            "network": artifact_record(network_path, relative_to=relative_to),
            "observation_package": artifact_record(observation_package_path, relative_to=relative_to),
            "pre_volume_match_audit": artifact_record(match_audit_path, relative_to=relative_to),
            "assignment_profile": artifact_record(assignment_profile_path, relative_to=relative_to),
            "sources": list(source_artifacts),
        },
    }
