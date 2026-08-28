#!/usr/bin/env python3
"""Frozen observation packages and assignment-blind network matching.

The functions in this module stop at the custody boundary. They accept source
artifacts, normalized observations, and a network database. There is no model
output argument and no run-directory discovery, so assignment results cannot
affect which observation or link is selected.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


OBSERVATION_PACKAGE_SCHEMA = "openplan.validation-observation-package.v1"
MATCH_AUDIT_SCHEMA = "openplan.pre-volume-observation-match-audit.v1"
MATCHER_VERSION = "openplan.pre-volume-observation-matcher.v1"
OBSERVATION_SCHEMA = "openplan.observed-traffic-observation.v1"
UNKNOWN = "unknown"
MODELED_VALUE_KEYS = {
    "best_modeled_daily_pce",
    "modeled",
    "modeled_daily_pce",
    "modeled_volume",
    "model_volume",
    "pce_tot",
    "volume",
}
SPATIALITE_PATHS = (
    "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite",
)
PAIR_DISTANCE_DEGREES = 0.0015
MAX_MATCH_DISTANCE_METERS = 2_000.0
NETWORK_INDEX_CELL_DEGREES = 0.02


class InstrumentError(RuntimeError):
    """The frozen instrument contract cannot be satisfied."""


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
        raise InstrumentError(f"Required frozen artifact is missing: {path}")
    label = str(path.relative_to(relative_to)) if relative_to is not None else str(path)
    return {"path": label, "sha256": sha256_file(path), "bytes": path.stat().st_size}


def verify_artifact(path: Path, record: Mapping[str, Any]) -> None:
    if not path.is_file():
        raise InstrumentError(f"Frozen artifact is missing: {path}")
    if path.stat().st_size != record.get("bytes"):
        raise InstrumentError(f"Frozen artifact size changed: {path}")
    actual = sha256_file(path)
    if actual != record.get("sha256"):
        raise InstrumentError(f"Frozen artifact SHA-256 changed: {path}")


def _contains_modeled_value(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).lower()
            if normalized in MODELED_VALUE_KEYS or (
                normalized != "frozen_before_model_volume"
                and "model" in normalized
                and "volume" in normalized
            ):
                return True
            if _contains_modeled_value(item):
                return True
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return any(_contains_modeled_value(item) for item in value)
    return False


def assert_assignment_blind(value: Any) -> None:
    if _contains_modeled_value(value):
        raise InstrumentError("Pre-volume match audit contains a modeled-volume field")


def _geometry_from_boundary(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    if payload.get("type") == "FeatureCollection":
        features = [item for item in payload.get("features", []) if isinstance(item, Mapping)]
        if len(features) != 1 or not isinstance(features[0].get("geometry"), Mapping):
            raise InstrumentError("Frozen boundary must contain exactly one resolved geometry")
        return features[0]["geometry"]
    if payload.get("type") == "Feature" and isinstance(payload.get("geometry"), Mapping):
        return payload["geometry"]
    if isinstance(payload.get("coordinates"), list):
        return payload
    raise InstrumentError("Frozen boundary has no readable geometry")


def _validate_source_attempt(attempt: Mapping[str, Any], package_dir: Path) -> None:
    required = {
        "source_id", "adapter", "status", "attempted_at", "source_url",
        "artifacts", "record_count", "reason",
    }
    missing = sorted(required - set(attempt))
    if missing:
        raise InstrumentError(f"Source attempt omitted fields: {missing}")
    status = attempt["status"]
    if status not in {"available", "source_unavailable", "supported_but_empty", "geography_unsupported"}:
        raise InstrumentError(f"Unknown source-attempt status: {status}")
    artifacts = attempt["artifacts"]
    if status == "available" and not artifacts:
        raise InstrumentError(f"Available source {attempt['source_id']} has no exact downloaded artifact")
    if status == "supported_but_empty" and int(attempt["record_count"]) != 0:
        raise InstrumentError(f"Supported-empty source {attempt['source_id']} reports records")
    for record in artifacts:
        verify_artifact(package_dir / str(record["path"]), record)


def write_compatibility_csv(path: Path, observations: Sequence[Mapping[str, Any]]) -> int:
    fields = [
        "station_id", "label", "facility_name", "count_year", "count_type", "direction",
        "observed_volume", "source_agency", "source_description", "candidate_model_names",
        "candidate_link_types", "exclude_model_names", "bbox_min_lon", "bbox_min_lat",
        "bbox_max_lon", "bbox_max_lat", "notes", "station_role", "station_role_reason",
        "observation_id", "evidence_grade", "duplicate_of",
    ]
    rows: list[dict[str, Any]] = []
    for observation in observations:
        geometry = observation.get("geometry") or {}
        coordinates = geometry.get("coordinates") if isinstance(geometry, Mapping) else None
        lon = float(coordinates[0]) if isinstance(coordinates, list) and len(coordinates) >= 2 else None
        lat = float(coordinates[1]) if isinstance(coordinates, list) and len(coordinates) >= 2 else None
        route = observation.get("route_lrs") or {}
        direction = observation.get("direction_lane_carriageway") or {}
        estimate = observation.get("estimate") or {}
        lineage = observation.get("duplicate_lineage") or {}
        match = observation.get("match_audit") or {}
        rows.append({
            "station_id": observation.get("observation_id", ""),
            "label": route.get("label", observation.get("observation_id", "")),
            "facility_name": route.get("facility_name", ""),
            "count_year": (observation.get("time_basis") or {}).get("year", ""),
            "count_type": "AADT",
            "direction": direction.get("basis", UNKNOWN),
            "observed_volume": "" if estimate.get("center") == UNKNOWN else estimate.get("center", ""),
            "source_agency": (observation.get("source") or {}).get("publisher", ""),
            "source_description": route.get("description", ""),
            "candidate_model_names": "|".join(str(item) for item in route.get("candidate_names", [])),
            "candidate_link_types": "|".join(str(item) for item in route.get("candidate_facility_classes", [])),
            "exclude_model_names": "",
            "bbox_min_lon": "" if lon is None else lon - 0.0035,
            "bbox_min_lat": "" if lat is None else lat - 0.0035,
            "bbox_max_lon": "" if lon is None else lon + 0.0035,
            "bbox_max_lat": "" if lat is None else lat + 0.0035,
            "notes": match.get("reason", ""),
            "station_role": "mainline" if match.get("status") != "excluded" else "excluded",
            "station_role_reason": match.get("reason", ""),
            "observation_id": observation.get("observation_id", ""),
            "evidence_grade": observation.get("evidence_grade", "D"),
            "duplicate_of": lineage.get("duplicate_of", UNKNOWN),
        })
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def build_observation_package(
    output_dir: Path,
    *,
    geography_id: str,
    boundary_path: Path,
    subdivisions: Sequence[Mapping[str, str]],
    source_attempts: Sequence[Mapping[str, Any]],
    observations: Sequence[Mapping[str, Any]],
    created_at: str | None = None,
) -> dict[str, Any]:
    """Write one frozen county package and verify every declared source byte."""
    output_dir.mkdir(parents=True, exist_ok=True)
    boundary_payload = json.loads(boundary_path.read_text())
    geometry = _geometry_from_boundary(boundary_payload)
    boundary_target = output_dir / "resolved-polygon.geojson"
    boundary_target.write_bytes(canonical_json_bytes({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": geometry}],
    }))
    if not subdivisions:
        raise InstrumentError("Resolved polygon has no intersected subdivision evidence")
    normalized_subdivisions = sorted(
        ({"country": str(item["country"]), "subdivision": str(item["subdivision"])} for item in subdivisions),
        key=lambda item: (item["country"], item["subdivision"]),
    )
    for attempt in source_attempts:
        _validate_source_attempt(attempt, output_dir)
    for observation in observations:
        if observation.get("schema") != OBSERVATION_SCHEMA:
            raise InstrumentError(f"Observation {observation.get('observation_id')} does not use observation-v1")
    compatibility_path = output_dir / "observations.csv"
    row_count = write_compatibility_csv(compatibility_path, observations)
    counts = Counter(str((item.get("match_audit") or {}).get("status", "unresolved")) for item in observations)
    counts.update(str(item["status"]) for item in source_attempts if item["status"] != "available")
    package = {
        "schema": OBSERVATION_PACKAGE_SCHEMA,
        "package_id": f"{geography_id}:observation-package-v1",
        "created_at": created_at or utc_now(),
        "geography_id": str(geography_id),
        "resolved_polygon": {
            "artifact": boundary_target.name,
            "sha256": sha256_file(boundary_target),
            "geometry": geometry,
        },
        "intersected_subdivisions": normalized_subdivisions,
        "source_attempts": list(source_attempts),
        "observations": list(observations),
        "compatibility_csv": {
            "path": compatibility_path.name,
            "sha256": sha256_file(compatibility_path),
            "rows": row_count,
        },
        "state_counts": dict(sorted(counts.items())),
    }
    target = output_dir / "observation-package.json"
    target.write_bytes(canonical_json_bytes(package))
    validate_observation_package(target)
    return package


def validate_observation_package(path: Path) -> dict[str, Any]:
    package = json.loads(path.read_text())
    if package.get("schema") != OBSERVATION_PACKAGE_SCHEMA:
        raise InstrumentError(f"Observation package schema must be {OBSERVATION_PACKAGE_SCHEMA}")
    required = {
        "package_id", "created_at", "geography_id", "resolved_polygon",
        "intersected_subdivisions", "source_attempts", "observations",
        "compatibility_csv", "state_counts",
    }
    missing = sorted(required - set(package))
    if missing:
        raise InstrumentError(f"Observation package omitted fields: {missing}")
    package_dir = path.parent
    polygon = package["resolved_polygon"]
    polygon_path = package_dir / polygon["artifact"]
    if sha256_file(polygon_path) != polygon["sha256"]:
        raise InstrumentError("Resolved polygon bytes do not match the frozen package")
    compatibility = package["compatibility_csv"]
    compatibility_path = package_dir / compatibility["path"]
    if sha256_file(compatibility_path) != compatibility["sha256"]:
        raise InstrumentError("Compatibility CSV bytes do not match the frozen package")
    for attempt in package["source_attempts"]:
        _validate_source_attempt(attempt, package_dir)
    return package


def observation_from_compatibility_row(
    row: Mapping[str, Any],
    *,
    source_id: str,
    publisher: str,
    source_url: str,
    source_artifact_sha256: str,
    downloaded_at: str,
) -> dict[str, Any]:
    """Normalize a frozen compatibility row without inventing missing facts."""
    observation_id = str(row.get("observation_id") or row.get("station_id") or "").strip()
    if not observation_id:
        raise InstrumentError("Compatibility observation has no stable identifier")
    def number(name: str) -> float | str:
        try:
            value = float(str(row.get(name) or "").strip())
            return value if math.isfinite(value) else UNKNOWN
        except ValueError:
            return UNKNOWN

    min_lon, max_lon = number("bbox_min_lon"), number("bbox_max_lon")
    min_lat, max_lat = number("bbox_min_lat"), number("bbox_max_lat")
    coordinates: list[float] | str = UNKNOWN
    if all(isinstance(value, float) for value in (min_lon, max_lon, min_lat, max_lat)):
        coordinates = [(min_lon + max_lon) / 2.0, (min_lat + max_lat) / 2.0]  # type: ignore[operator]
    center = number("observed_volume")
    year_text = str(row.get("count_year") or "").strip()
    year: int | str = int(year_text) if year_text.isdigit() else UNKNOWN
    duplicate_of = str(row.get("duplicate_of") or UNKNOWN)
    excluded = str(row.get("station_role") or "mainline").lower() not in {"", "mainline"}
    resolution = str(row.get("adjacent_section_resolution") or "")
    ambiguous = center == UNKNOWN and "ambiguous" in resolution
    status = "excluded" if excluded else ("ambiguous" if ambiguous else "unresolved")
    names = [item.strip() for item in str(row.get("candidate_model_names") or "").split("|") if item.strip()]
    facility_classes = [item.strip() for item in str(row.get("candidate_link_types") or "").split("|") if item.strip()]
    return {
        "schema": OBSERVATION_SCHEMA,
        "observation_id": observation_id,
        "source": {
            "dataset_id": source_id,
            "publisher": publisher,
            "source_url": source_url,
            "downloaded_at": downloaded_at,
            "artifact_sha256": source_artifact_sha256,
            "member_path": "compatibility CSV row",
            "member_sha256": source_artifact_sha256,
        },
        "route_lrs": {
            "label": str(row.get("label") or observation_id),
            "facility_name": str(row.get("facility_name") or ""),
            "description": str(row.get("source_description") or ""),
            "candidate_names": names,
            "candidate_facility_classes": facility_classes,
            "route_id": str(row.get("route_id") or UNKNOWN),
            "section_start": str(row.get("section_start") or UNKNOWN),
            "section_end": str(row.get("section_end") or UNKNOWN),
        },
        "geometry": {"type": "Point", "coordinates": coordinates, "crs": "EPSG:4326" if coordinates != UNKNOWN else UNKNOWN},
        "direction_lane_carriageway": {
            "basis": str(row.get("direction") or UNKNOWN),
            "direction": str(row.get("direction") or UNKNOWN),
            "lane": UNKNOWN,
            "carriageway": UNKNOWN,
        },
        "vehicle_basis": {"unit": "vehicles", "vehicle_definition": "published AADT", "conversion": UNKNOWN},
        "time_basis": {
            "year": year, "start_date": UNKNOWN, "end_date": UNKNOWN,
            "day_basis": "annual_average_daily_traffic",
            "observation_period": {"label": "daily", "hours": list(range(24))},
            "frozen_year_adjustment": UNKNOWN,
        },
        "measurement": {
            "method": "source_derived", "duration": {"start": UNKNOWN, "end": UNKNOWN, "complete_hours": UNKNOWN},
            "factors": UNKNOWN,
        },
        "qa": {"status": "unknown", "flags": UNKNOWN, "source_fields": UNKNOWN},
        "estimate": {"center": center, "source_supported_bounds": UNKNOWN},
        "evidence_grade": str(row.get("evidence_grade") or "C"),
        "match_audit": {
            "status": status,
            "frozen_at": UNKNOWN,
            "frozen_before_model_volume": UNKNOWN,
            "geometry": UNKNOWN, "route": UNKNOWN, "direction": UNKNOWN, "facility": UNKNOWN,
            "candidate_link_ids": UNKNOWN, "selected_link_id": UNKNOWN,
            "reason": str(row.get("station_role_reason") or ("Adjacent section remains ambiguous." if ambiguous else "Network match has not been frozen.")),
        },
        "duplicate_lineage": {
            "lineage_id": str(row.get("lineage_id") or observation_id),
            "canonical_observation_id": str(row.get("canonical_observation_id") or (duplicate_of if duplicate_of != UNKNOWN else observation_id)),
            "duplicate_of": duplicate_of,
            "resolution": str(row.get("duplicate_resolution") or ("source-declared duplicate" if duplicate_of != UNKNOWN else "unique source row")),
        },
    }


def observations_from_compatibility_csv(
    path: Path,
    *,
    source_id: str,
    publisher: str,
    source_url: str,
    downloaded_at: str,
) -> list[dict[str, Any]]:
    source_hash = sha256_file(path)
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    return [
        observation_from_compatibility_row(
            row,
            source_id=source_id,
            publisher=publisher,
            source_url=source_url,
            source_artifact_sha256=source_hash,
            downloaded_at=downloaded_at,
        )
        for row in rows
    ]


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
    raise InstrumentError("SpatiaLite is required to read frozen network geometry")


def read_network_links(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise InstrumentError(f"Frozen network is missing: {path}")
    connection = _connect_network(path)
    try:
        rows = connection.execute(
            "SELECT link_id, name, link_type, direction, "
            "X(Centroid(geometry)), Y(Centroid(geometry)) FROM links ORDER BY link_id"
        ).fetchall()
    finally:
        connection.close()
    return [
        {
            "link_id": int(link_id), "name": str(name or ""), "link_type": str(link_type or ""),
            "direction": int(direction or 0), "lon": float(lon), "lat": float(lat),
        }
        for link_id, name, link_type, direction, lon, lat in rows
        if lon is not None and lat is not None
    ]


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").lower().replace("_", " ").replace("-", " ").split())


def _distance_meters(a_lon: float, a_lat: float, b_lon: float, b_lat: float) -> float:
    lat1, lat2 = math.radians(a_lat), math.radians(b_lat)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(((b_lon - a_lon + 180.0) % 360.0) - 180.0)
    term = math.sin(delta_lat / 2.0) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2.0) ** 2
    return 6_371_008.8 * 2.0 * math.asin(min(1.0, math.sqrt(term)))


def _name_score(route: Mapping[str, Any], link: Mapping[str, Any]) -> int:
    link_name = _normalize_text(link.get("name"))
    if not link_name:
        return 0
    names = [route.get("facility_name"), route.get("route_id"), *(route.get("candidate_names") or [])]
    normalized = [_normalize_text(item) for item in names if _normalize_text(item) not in {"", UNKNOWN}]
    if link_name in normalized:
        return 4
    if any(item in link_name or link_name in item for item in normalized):
        return 3
    link_tokens = set(link_name.split())
    return 2 if any(link_tokens & set(item.split()) for item in normalized) else 0


def _facility_score(route: Mapping[str, Any], link: Mapping[str, Any]) -> int:
    classes = {_normalize_text(item) for item in route.get("candidate_facility_classes", [])}
    return 1 if _normalize_text(link.get("link_type")) in classes else 0


def _paired_carriageway(selected: Mapping[str, Any], links: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    if int(selected.get("direction") or 0) == 0:
        return None
    name, link_type = _normalize_text(selected.get("name")), _normalize_text(selected.get("link_type"))
    choices = []
    for link in links:
        if link["link_id"] == selected["link_id"] or int(link.get("direction") or 0) == 0:
            continue
        if _normalize_text(link.get("name")) != name or _normalize_text(link.get("link_type")) != link_type:
            continue
        distance = max(abs(float(link["lon"]) - float(selected["lon"])), abs(float(link["lat"]) - float(selected["lat"])))
        if distance <= PAIR_DISTANCE_DEGREES:
            choices.append((distance, int(link["link_id"]), link))
    return min(choices, default=(None, None, None))[2]


def _network_index(links: Sequence[Mapping[str, Any]]) -> dict[tuple[int, int], list[Mapping[str, Any]]]:
    result: dict[tuple[int, int], list[Mapping[str, Any]]] = {}
    for link in links:
        cell = (
            math.floor(float(link["lon"]) / NETWORK_INDEX_CELL_DEGREES),
            math.floor(float(link["lat"]) / NETWORK_INDEX_CELL_DEGREES),
        )
        result.setdefault(cell, []).append(link)
    return result


def _nearby_links(
    lon: float,
    lat: float,
    index: Mapping[tuple[int, int], Sequence[Mapping[str, Any]]],
) -> list[Mapping[str, Any]]:
    center_x = math.floor(lon / NETWORK_INDEX_CELL_DEGREES)
    center_y = math.floor(lat / NETWORK_INDEX_CELL_DEGREES)
    return [
        link
        for x in range(center_x - 2, center_x + 3)
        for y in range(center_y - 2, center_y + 3)
        for link in index.get((x, y), ())
    ]


def _match_one(
    observation: Mapping[str, Any],
    links: Sequence[Mapping[str, Any]],
    network_index: Mapping[tuple[int, int], Sequence[Mapping[str, Any]]] | None = None,
) -> dict[str, Any]:
    current = observation.get("match_audit") or {}
    observation_id = str(observation["observation_id"])
    lineage = observation.get("duplicate_lineage") or {}
    base = {
        "observation_id": observation_id,
        "candidate_link_ids": [],
        "selected_link_id": UNKNOWN,
        "route": UNKNOWN,
        "geometry": UNKNOWN,
        "direction": UNKNOWN,
        "carriageway": UNKNOWN,
        "facility": UNKNOWN,
        "duplicate_lineage": dict(lineage),
        "reason": "No assignment-blind match could be established.",
    }
    if lineage.get("duplicate_of") not in {None, "", UNKNOWN}:
        return {**base, "status": "duplicate", "reason": "Source-declared duplicate retained once through canonical lineage."}
    if current.get("status") == "excluded":
        return {**base, "status": "excluded", "reason": str(current.get("reason") or "Source excluded the observation before matching.")}
    if current.get("status") == "ambiguous":
        return {**base, "status": "ambiguous", "reason": str(current.get("reason") or "Source section is ambiguous before network matching.")}
    geometry = observation.get("geometry") or {}
    coordinates = geometry.get("coordinates") if isinstance(geometry, Mapping) else None
    if not isinstance(coordinates, list) or len(coordinates) < 2 or not all(isinstance(item, (int, float)) for item in coordinates[:2]):
        return {**base, "status": "unresolved", "reason": "Observation has no usable coordinate."}
    lon, lat = float(coordinates[0]), float(coordinates[1])
    candidate_links = _nearby_links(lon, lat, network_index) if network_index is not None else list(links)
    route = observation.get("route_lrs") or {}
    ranked = []
    for link in candidate_links:
        distance = _distance_meters(lon, lat, float(link["lon"]), float(link["lat"]))
        if distance > MAX_MATCH_DISTANCE_METERS:
            continue
        name_score, facility_score = _name_score(route, link), _facility_score(route, link)
        if name_score == 0 and facility_score == 0:
            continue
        ranked.append((name_score, facility_score, -distance, -int(link["link_id"]), link, distance))
    ranked.sort(reverse=True, key=lambda item: item[:4])
    candidates = [int(item[4]["link_id"]) for item in ranked[:20]]
    if not ranked:
        return {**base, "status": "unresolved", "reason": "No route, geometry, and facility candidate is within the frozen search distance."}
    selected = ranked[0][4]
    partner = _paired_carriageway(selected, candidate_links)
    selected_ids = sorted([int(selected["link_id"]), *([int(partner["link_id"])] if partner else [])])
    if len(ranked) > 1:
        first, second = ranked[0], ranked[1]
        same_rank = first[0:2] == second[0:2] and abs(first[5] - second[5]) <= 10.0
        if same_rank and int(second[4]["link_id"]) not in selected_ids:
            return {
                **base, "status": "ambiguous", "candidate_link_ids": candidates,
                "route": {"score": first[0], "candidate_names": route.get("candidate_names", [])},
                "geometry": {"distance_meters": round(first[5], 3), "runner_up_distance_meters": round(second[5], 3)},
                "facility": {"score": first[1], "link_type": selected.get("link_type", UNKNOWN)},
                "reason": "Top assignment-blind candidates remain tied; residuals may not break the tie.",
            }
    selected_key = "+".join(str(item) for item in selected_ids)
    return {
        **base,
        "status": "matched",
        "candidate_link_ids": candidates,
        "selected_link_id": selected_key,
        "route": {"score": ranked[0][0], "selected_name": selected.get("name") or UNKNOWN},
        "geometry": {"distance_meters": round(ranked[0][5], 3), "observation": [lon, lat], "network": [selected["lon"], selected["lat"]]},
        "direction": {"observation": (observation.get("direction_lane_carriageway") or {}).get("direction", UNKNOWN), "network": selected.get("direction", UNKNOWN)},
        "carriageway": {"basis": "two_way_sum" if partner else "single_link", "link_ids": selected_ids},
        "facility": {"score": ranked[0][1], "link_type": selected.get("link_type") or UNKNOWN},
        "reason": "Selected by frozen route, geometry, direction, carriageway, and facility evidence without assignment output.",
    }


def build_pre_volume_match_audit(
    network_path: Path,
    observation_package_path: Path,
    preregistration_path: Path,
    output_path: Path,
    *,
    created_at: str | None = None,
) -> dict[str, Any]:
    package = validate_observation_package(observation_package_path)
    links = read_network_links(network_path)
    network_index = _network_index(links)
    matches = [_match_one(observation, links, network_index) for observation in package["observations"]]
    coverage = Counter(item["status"] for item in matches)
    source_path = Path(__file__).resolve()
    audit = {
        "schema": MATCH_AUDIT_SCHEMA,
        "audit_id": f"{package['geography_id']}:pre-volume-match-v1",
        "created_at": created_at or utc_now(),
        "frozen_before_model_volume": True,
        "network_sha256": sha256_file(network_path),
        "observation_package_sha256": sha256_file(observation_package_path),
        "preregistration_sha256": sha256_file(preregistration_path),
        "matcher_version": MATCHER_VERSION,
        "matcher_sha256": sha256_file(source_path),
        "matches": matches,
        "coverage": dict(sorted(coverage.items())),
    }
    assert_assignment_blind(audit)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canonical_json_bytes(audit))
    validate_match_audit(output_path, network_path, observation_package_path, preregistration_path)
    return audit


def validate_match_audit(
    path: Path,
    network_path: Path,
    observation_package_path: Path,
    preregistration_path: Path,
) -> dict[str, Any]:
    audit = json.loads(path.read_text())
    if audit.get("schema") != MATCH_AUDIT_SCHEMA or audit.get("frozen_before_model_volume") is not True:
        raise InstrumentError("Match audit is not an explicit pre-volume v1 freeze")
    expected = {
        "network_sha256": sha256_file(network_path),
        "observation_package_sha256": sha256_file(observation_package_path),
        "preregistration_sha256": sha256_file(preregistration_path),
        "matcher_sha256": sha256_file(Path(__file__).resolve()),
    }
    for field, value in expected.items():
        if audit.get(field) != value:
            raise InstrumentError(f"Match audit {field} does not bind the supplied artifact")
    assert_assignment_blind(audit)
    package = validate_observation_package(observation_package_path)
    if [item["observation_id"] for item in audit.get("matches", [])] != [item["observation_id"] for item in package["observations"]]:
        raise InstrumentError("Match audit does not cover every frozen observation in package order")
    return audit


def bind_match_audit_to_observations(
    package: Mapping[str, Any], audit: Mapping[str, Any]
) -> list[dict[str, Any]]:
    matches = {str(item["observation_id"]): item for item in audit["matches"]}
    bound = []
    for source in package["observations"]:
        observation = json.loads(json.dumps(source))
        match = matches[str(observation["observation_id"])]
        observation["match_audit"] = {
            "status": match["status"],
            "frozen_at": audit["created_at"],
            "frozen_before_model_volume": True,
            "geometry": match["geometry"],
            "route": match["route"],
            "direction": match["direction"],
            "facility": match["facility"],
            "candidate_link_ids": match["candidate_link_ids"],
            "selected_link_id": match["selected_link_id"],
            "reason": match["reason"],
            "carriageway": match["carriageway"],
        }
        bound.append(observation)
    return bound


def selected_link_ids(match: Mapping[str, Any]) -> list[str]:
    carriageway = match.get("carriageway")
    if isinstance(carriageway, Mapping) and isinstance(carriageway.get("link_ids"), list):
        return [str(item) for item in carriageway["link_ids"]]
    selected = match.get("selected_link_id")
    return [] if selected in {None, "", UNKNOWN} else str(selected).split("+")


def aggregate_selected_volumes(
    observations: Sequence[Mapping[str, Any]], volumes_by_link: Mapping[str, float]
) -> dict[str, float]:
    """Sum only the carriageways frozen before output was opened."""
    totals: dict[str, float] = {}
    for observation in observations:
        match = observation["match_audit"]
        if match.get("status") != "matched":
            continue
        link_ids = selected_link_ids(match)
        if not link_ids:
            continue
        if any(link_id not in volumes_by_link for link_id in link_ids):
            continue
        totals[str(match["selected_link_id"])] = sum(float(volumes_by_link[link_id]) for link_id in link_ids)
    return totals
