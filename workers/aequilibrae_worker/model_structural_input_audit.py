#!/usr/bin/env python3
"""Assignment-blind structural audit for an exact OpenPlan model input package.

The development study and the normal local worker call this module.  Its public
entry point has no model-output argument, and the returned contract refuses any
output-derived key before serialization.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import math
import re
import sqlite3
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, Mapping, Sequence

from shapely.geometry import shape
from shapely.ops import unary_union
from shapely import wkt


AUDIT_SCHEMA = "openplan.model-structural-input-audit.v1"
UNKNOWN = "unknown"
OUTPUT_DERIVED_KEYS = {
    "modeled_value", "modeled_volume", "residual", "loaded_volume",
    "model_output_sha256", "model_output_path",
}


class StructuralAuditRefused(ValueError):
    """The exact input package cannot support an assignment-blind audit."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def artifact(path: str | Path, *, root: str | Path) -> dict[str, Any]:
    candidate = Path(path)
    if not candidate.is_file():
        raise StructuralAuditRefused(f"Required structural input is unavailable: {candidate}")
    base = Path(root).resolve()
    resolved = candidate.resolve()
    try:
        name = str(resolved.relative_to(base))
    except ValueError:
        name = str(resolved)
    payload = gzip.decompress(resolved.read_bytes()) if resolved.suffix == ".gz" else resolved.read_bytes()
    logical_name = name[:-3] if name.endswith(".gz") else name
    return {
        "path": logical_name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "stored_path": name,
        "stored_sha256": sha256_file(resolved),
    }


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _read_matrix(path: Path) -> tuple[list[int], list[list[float]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 2 or len(rows[0]) < 2:
        raise StructuralAuditRefused("OD matrix is empty")
    try:
        destination_ids = [int(float(value)) for value in rows[0][1:]]
        origin_ids = [int(float(row[0])) for row in rows[1:]]
        matrix = [[float(value) for value in row[1:]] for row in rows[1:]]
    except (TypeError, ValueError) as exc:
        raise StructuralAuditRefused("OD matrix has unreadable zone ids or values") from exc
    if origin_ids != destination_ids or any(len(row) != len(destination_ids) for row in matrix):
        raise StructuralAuditRefused("OD matrix must be square with identical ordered zone ids")
    if any(not math.isfinite(value) or value < 0 for row in matrix for value in row):
        raise StructuralAuditRefused("OD matrix contains negative or non-finite demand")
    return origin_ids, matrix


def _slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def _distance_miles(left: Mapping[str, Any], right: Mapping[str, Any]) -> float:
    lon1, lat1 = math.radians(float(left["centroid_lon"])), math.radians(float(left["centroid_lat"]))
    lon2, lat2 = math.radians(float(right["centroid_lon"])), math.radians(float(right["centroid_lat"]))
    dlon = (lon2 - lon1 + math.pi) % (2 * math.pi) - math.pi
    dlat = lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 3958.7613 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def _network_rows(network_path: Path) -> tuple[list[dict[str, Any]], set[int]]:
    conn = sqlite3.connect(network_path)
    try:
        links = [
            {
                "link_id": int(row[0]), "a_node": int(row[1]), "b_node": int(row[2]),
                "direction": int(row[3] or 0), "distance_meters": float(row[4] or 0),
                "link_type": str(row[5] or "unknown"), "name": str(row[6] or ""),
            }
            for row in conn.execute(
                "SELECT link_id,a_node,b_node,direction,distance,link_type,COALESCE(name,'') FROM links"
            )
        ]
        centroids = {int(row[0]) for row in conn.execute("SELECT node_id FROM nodes WHERE COALESCE(is_centroid,0)=1")}
    finally:
        conn.close()
    if not links:
        raise StructuralAuditRefused("Network has no links")
    return links, centroids


def _components(links: Sequence[Mapping[str, Any]]) -> tuple[dict[int, int], Counter[int]]:
    graph: dict[int, set[int]] = defaultdict(set)
    for item in links:
        left, right = int(item["a_node"]), int(item["b_node"])
        graph[left].add(right)
        graph[right].add(left)
    component_of: dict[int, int] = {}
    sizes: Counter[int] = Counter()
    for start in sorted(graph):
        if start in component_of:
            continue
        identifier = len(sizes) + 1
        queue = deque([start])
        component_of[start] = identifier
        while queue:
            current = queue.popleft()
            sizes[identifier] += 1
            for neighbor in graph[current]:
                if neighbor not in component_of:
                    component_of[neighbor] = identifier
                    queue.append(neighbor)
    return component_of, sizes


def _crossings(network_path: Path, boundary_path: Path) -> list[dict[str, Any]]:
    boundary_value = json.loads(boundary_path.read_text())
    if boundary_value.get("type") == "FeatureCollection":
        boundary = unary_union([shape(item["geometry"]) for item in boundary_value.get("features") or []])
    else:
        geometry = boundary_value.get("geometry") if boundary_value.get("type") == "Feature" else boundary_value
        boundary = shape(geometry)
    conn = sqlite3.connect(network_path)
    try:
        conn.enable_load_extension(True)
        conn.load_extension("/usr/lib/x86_64-linux-gnu/mod_spatialite.so")
        rows = conn.execute(
            "SELECT link_id,link_type,COALESCE(name,''),COALESCE(direction,0),AsText(geometry) "
            "FROM links WHERE link_type IN ('motorway','trunk','primary','secondary','tertiary')"
        ).fetchall()
    except (sqlite3.Error, OSError) as exc:
        raise StructuralAuditRefused(f"Boundary-crossing audit requires SpatiaLite: {exc}") from exc
    finally:
        conn.close()
    result = []
    for link_id, link_type, name, direction, geometry_wkt in rows:
        if not geometry_wkt:
            continue
        line = wkt.loads(geometry_wkt)
        if line.intersects(boundary.boundary) and line.intersection(boundary).length > 0 and line.difference(boundary).length > 0:
            result.append({
                "link_id": int(link_id), "facility_class": str(link_type),
                "route_name": str(name or ""), "direction": int(direction or 0),
            })
    return sorted(result, key=lambda item: item["link_id"])


def _assert_assignment_blind(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            lowered = str(key).lower()
            if lowered in OUTPUT_DERIVED_KEYS or "residual" in lowered:
                raise StructuralAuditRefused(f"Pre-output audit contains output-derived field: {key}")
            _assert_assignment_blind(child)
    elif isinstance(value, list):
        for child in value:
            _assert_assignment_blind(child)


def build_structural_input_audit(
    *,
    repo_root: str | Path,
    audit_id: str,
    geography: Mapping[str, Any],
    method: str,
    registry_path: str | Path,
    predecessor_registry_path: str | Path,
    observation_package_path: str | Path,
    match_audit_path: str | Path,
    network_path: str | Path,
    boundary_path: str | Path,
    zone_attributes_path: str | Path,
    od_matrix_path: str | Path,
    demand_layers_path: str | Path,
    assignment_profile_path: str | Path,
    network_setup_summary_path: str | Path,
    source_vintages: Mapping[str, Any],
    person_to_vehicle_conversion: Mapping[str, Any] | str,
    created_at: str,
    release: Mapping[str, Any],
) -> dict[str, Any]:
    """Audit exact inputs. This function cannot receive or open assignment output."""
    if method not in {"aequilibrae", "activitysim"}:
        raise StructuralAuditRefused("Demand methods must remain separate")
    root = Path(repo_root).resolve()
    paths = {
        "registry": Path(registry_path), "predecessor_registry": Path(predecessor_registry_path),
        "observation_package": Path(observation_package_path), "match_audit": Path(match_audit_path),
        "network": Path(network_path), "boundary": Path(boundary_path),
        "zone_attributes": Path(zone_attributes_path), "od_matrix": Path(od_matrix_path),
        "demand_layers": Path(demand_layers_path), "assignment_profile": Path(assignment_profile_path),
        "network_setup_summary": Path(network_setup_summary_path),
    }
    source_hashes = {key: artifact(path, root=root) for key, path in paths.items()}
    zones_raw = _read_csv(paths["zone_attributes"])
    zones = {int(float(row["zone_id"])): row for row in zones_raw}
    zone_ids, matrix = _read_matrix(paths["od_matrix"])
    if zone_ids != list(zones):
        raise StructuralAuditRefused("Zone ids differ between the matrix and exact zone table")
    layers = json.loads(paths["demand_layers"].read_text())
    setup = json.loads(paths["network_setup_summary"].read_text())
    assignment_profile = json.loads(paths["assignment_profile"].read_text())
    links, centroid_nodes = _network_rows(paths["network"])
    component_of, component_sizes = _components(links)
    centroid_components = {component_of[node] for node in centroid_nodes if node in component_of}

    productions = [sum(row) for row in matrix]
    attractions = [sum(matrix[i][j] for i in range(len(matrix))) for j in range(len(matrix))]
    total = sum(productions)
    intrazonal = sum(matrix[i][i] for i in range(len(matrix)))
    bands = Counter({"intrazonal": 0.0, "0_to_5_miles": 0.0, "5_to_15_miles": 0.0, "15_to_30_miles": 0.0, "over_30_miles": 0.0})
    for i, origin in enumerate(zone_ids):
        for j, destination in enumerate(zone_ids):
            value = matrix[i][j]
            if i == j:
                band = "intrazonal"
            else:
                distance = _distance_miles(zones[origin], zones[destination])
                band = "0_to_5_miles" if distance < 5 else "5_to_15_miles" if distance < 15 else "15_to_30_miles" if distance < 30 else "over_30_miles"
            bands[band] += value

    connector_rows = [item for item in links if item["link_type"] == "centroid_connector"]
    connector_by_link = {int(item["link_id"]): item for item in connector_rows}
    connector_diagnostics = setup.get("connector_diagnostics") or []
    zone_connectors = []
    zone_node_by_id: dict[int, int] = {}
    external_ids = {zone_id for zone_id, row in zones.items() if str(row.get("zone_kind") or "internal").lower() in {"external", "cordon", "gateway"}}
    for item in connector_diagnostics:
        zone_id = int(item["zone_id"])
        zone_node_by_id[zone_id] = int(item["centroid_node"])
        for chosen in item.get("chosen_connectors") or []:
            link = connector_by_link.get(int(chosen["link_id"]), {})
            zone_connectors.append({
                "zone_id": zone_id,
                "zone_kind": "cordon" if zone_id in external_ids else "internal",
                "link_id": int(chosen["link_id"]),
                "attachment_node": int(chosen["to_node"]),
                "length_meters": float(chosen.get("distance_m", link.get("distance_meters", 0))),
                "in_largest_component": bool(chosen.get("in_largest_component")),
            })

    unreachable = 0.0
    for i, origin in enumerate(zone_ids):
        origin_component = component_of.get(zone_node_by_id.get(origin, -1))
        for j, destination in enumerate(zone_ids):
            if origin_component is None or origin_component != component_of.get(zone_node_by_id.get(destination, -2)):
                unreachable += matrix[i][j]

    component_totals = Counter({"II": 0.0, "IE": 0.0, "EI": 0.0, "EE": 0.0})
    for i, origin in enumerate(zone_ids):
        for j, destination in enumerate(zone_ids):
            key = ("E" if origin in external_ids else "I") + ("E" if destination in external_ids else "I")
            component_totals[key] += matrix[i][j]

    detected = _crossings(paths["network"], paths["boundary"])
    retained_gateways = list(layers.get("external_gateways") or [])
    retained_ids = {int(item["link_id"]) for item in retained_gateways}
    route_groups: dict[str, list[int]] = defaultdict(list)
    for item in detected:
        name = _slug(item.get("route_name"))
        if name:
            route_groups[name].append(int(item["link_id"]))
    pairing = []
    for item in detected:
        route = _slug(item.get("route_name"))
        partners = [link for link in route_groups.get(route, []) if link != int(item["link_id"])] if route else []
        pairing.append({
            "link_id": int(item["link_id"]), "route_name": str(item.get("route_name") or ""),
            "route_key": route or UNKNOWN, "partner_link_ids": partners,
            "retention_state": "retained" if int(item["link_id"]) in retained_ids else "dropped",
            "pairing_state": "blank_route_name" if not route else "unpaired" if not partners else "paired" if len(partners) == 1 else "multi_crossing",
        })

    facility_counts = Counter(str(item["link_type"]) for item in links if item["link_type"] != "centroid_connector")
    link_component = {int(item["link_id"]): component_of.get(int(item["a_node"])) for item in links}
    structurally_unreachable = [int(item["link_id"]) for item in links if item["link_type"] != "centroid_connector" and link_component[int(item["link_id"])] not in centroid_components]
    registered_total = float(layers.get("total_trips", total))
    jobs_sources = Counter(str(row.get("jobs_source") or UNKNOWN) for row in zones_raw if int(float(row["zone_id"])) not in external_ids)
    lodes = source_vintages.get("lodes") if isinstance(source_vintages.get("lodes"), Mapping) else {}
    through_share = (layers.get("trip_rates") or {}).get("gateway_passthrough_share", UNKNOWN)
    audit = {
        "schema": AUDIT_SCHEMA,
        "audit_id": audit_id,
        "created_at": created_at,
        "geography": dict(geography),
        "method": method,
        "frozen_before_model_output": True,
        "model_output_bytes_read": False,
        "release": dict(release),
        "source_hashes": source_hashes,
        "source_vintages": dict(source_vintages),
        "demand_distribution": {
            "zone_productions": [{"zone_id": zone, "trips": productions[index]} for index, zone in enumerate(zone_ids)],
            "zone_attractions": [{"zone_id": zone, "trips": attractions[index]} for index, zone in enumerate(zone_ids)],
            "source_coverage": {"jobs_by_recorded_source": dict(sorted(jobs_sources.items()))},
            "lodes_seed_coverage": lodes.get("seed_coverage", UNKNOWN),
            "assumed_commute_share": lodes.get("assumed_commute_share", UNKNOWN),
            "fallback_use": lodes.get("fallback_use", UNKNOWN),
            "lodes_limitation": "LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips.",
            "intrazonal_trips": intrazonal,
            "intrazonal_share": intrazonal / total if total else 0.0,
            "distance_band_trips": dict(bands),
            "distance_band_shares": {key: value / total if total else 0.0 for key, value in bands.items()},
            "row_total": sum(productions), "column_total": sum(attractions),
            "row_column_difference": sum(productions) - sum(attractions),
            "registered_total": registered_total,
            "rounding_loss": registered_total - total,
            "unreachable_od_trips": unreachable,
            "person_to_vehicle_conversion": (
                dict(person_to_vehicle_conversion)
                if isinstance(person_to_vehicle_conversion, Mapping)
                else person_to_vehicle_conversion
            ),
        },
        "external_and_through_travel": {
            "detected_crossings_before_caps": detected,
            "retained_crossings": [item for item in detected if item["link_id"] in retained_ids],
            "dropped_crossings": [item for item in detected if item["link_id"] not in retained_ids],
            "registered_gateway_cap": source_vintages.get("gateway_cap", UNKNOWN),
            "route_pairing": pairing,
            "exterior_connectivity": [{
                "zone_id": item["zone_id"], "link_id": int(next(gateway["link_id"] for gateway in retained_gateways if int(gateway["zone_id"]) == item["zone_id"])),
                "connector_attachment_node": item["attachment_node"], "in_loadable_component": item["in_largest_component"],
            } for item in zone_connectors if item["zone_kind"] == "cordon" and any(int(gateway["zone_id"]) == item["zone_id"] for gateway in retained_gateways)],
            "volume_basis": [{"zone_id": int(item["zone_id"]), "basis": "inferred", "daily_in": float(item["daily_in"]), "daily_out": float(item["daily_out"])} for item in retained_gateways],
            "through_share_evidence": UNKNOWN,
            "applied_through_share_assumption": through_share,
            "non_work_through_travel": "unsupported",
            "demand_totals": dict(component_totals),
            "conservation_difference": sum(component_totals.values()) - total,
        },
        "network_loading_readiness": {
            "connected_components": len(component_sizes),
            "largest_component_nodes": max(component_sizes.values(), default=0),
            "zone_connectors": zone_connectors,
            "connector_count": len(zone_connectors),
            "long_connector_count_over_1609m": sum(item["length_meters"] > 1609.344 for item in zone_connectors),
            "skimmable_od_pairs": sum(1 for origin in zone_ids for destination in zone_ids if component_of.get(zone_node_by_id.get(origin, -1)) is not None and component_of.get(zone_node_by_id.get(origin, -1)) == component_of.get(zone_node_by_id.get(destination, -2))),
            "total_od_pairs": len(zone_ids) ** 2,
            "demand_removed_as_unreachable": unreachable,
            "directional_restrictions": dict(Counter("bidirectional" if int(item["direction"]) == 0 else "one_way" for item in links if item["link_type"] != "centroid_connector")),
            "facility_coverage": dict(sorted(facility_counts.items())),
            "loadable_roadway_links": sum(facility_counts.values()) - len(structurally_unreachable),
            "structurally_unreachable_roadway_links": len(structurally_unreachable),
            "structurally_unreachable_link_ids_sha256": hashlib.sha256(canonical_json(sorted(structurally_unreachable)).encode()).hexdigest(),
            "boundary_crossing_link_count": len(detected),
            "assignment_readiness": {
                "algorithm": assignment_profile.get("algorithm", UNKNOWN),
                "maximum_iterations": assignment_profile.get("max_iterations", UNKNOWN),
                "target_gap": assignment_profile.get("target_gap", UNKNOWN),
                "convergence_evidence": "unavailable_in_bound_pre_output_inputs",
                "stability_evidence": "unavailable_in_bound_pre_output_inputs",
                "parameters_changed_by_diagnosis": False,
            },
        },
        "scientific_status": "inconclusive",
    }
    _assert_assignment_blind(audit)
    validate_structural_input_audit(audit)
    return audit


def validate_structural_input_audit(audit: Mapping[str, Any]) -> None:
    if audit.get("schema") != AUDIT_SCHEMA or audit.get("frozen_before_model_output") is not True:
        raise StructuralAuditRefused("Structural input audit has the wrong contract")
    if audit.get("model_output_bytes_read") is not False:
        raise StructuralAuditRefused("Model output was opened before the structural input audit")
    if audit.get("method") not in {"aequilibrae", "activitysim"}:
        raise StructuralAuditRefused("Structural input audit combined demand methods")
    hashes = audit.get("source_hashes")
    if not isinstance(hashes, Mapping) or not hashes:
        raise StructuralAuditRefused("Structural input audit omitted exact source hashes")
    distribution = audit.get("demand_distribution") or {}
    if abs(float(distribution.get("row_column_difference", math.inf))) > 1e-6:
        raise StructuralAuditRefused("OD rows and columns do not conserve demand")
    unreachable = float(distribution.get("unreachable_od_trips", -1))
    loading = audit.get("network_loading_readiness") or {}
    if unreachable < 0 or abs(unreachable - float(loading.get("demand_removed_as_unreachable", -2))) > 1e-6:
        raise StructuralAuditRefused("Unreachable OD demand was omitted or swallowed")
    external = audit.get("external_and_through_travel") or {}
    if external.get("non_work_through_travel") != "unsupported":
        raise StructuralAuditRefused("Non-work through travel cannot be invented")
    if external.get("through_share_evidence") != UNKNOWN:
        raise StructuralAuditRefused("Through-share evidence cannot be invented")
    detected = {int(item["link_id"]) for item in external.get("detected_crossings_before_caps") or []}
    retained = {int(item["link_id"]) for item in external.get("retained_crossings") or []}
    dropped = {int(item["link_id"]) for item in external.get("dropped_crossings") or []}
    if retained & dropped or retained | dropped != detected:
        raise StructuralAuditRefused("Detected boundary crossings were discarded or duplicated")
    facilities = loading.get("facility_coverage") or {}
    roadway_total = sum(int(value) for value in facilities.values())
    loadable = int(loading.get("loadable_roadway_links", -1))
    structural = int(loading.get("structurally_unreachable_roadway_links", -1))
    if loadable < 0 or structural < 0 or loadable + structural != roadway_total:
        raise StructuralAuditRefused("Roadway loading readiness discarded non-centroid links")
    _assert_assignment_blind(audit)
