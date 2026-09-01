#!/usr/bin/env python3
"""Run the source-bound seven-county distributed work-loading checkpoint."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import shutil
import sqlite3
import sys
import time
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = ROOT / "scripts" / "modeling"
WORKER_DIR = ROOT / "workers" / "aequilibrae_worker"
for directory in (SCRIPT_DIR, WORKER_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import activitysim_demand_package
import distributed_work_loading as loading
import model_validation_structural_diagnosis_v3 as diagnosis_v3
import screening_runtime
import us_lodes8_work_loading_adapter as lodes
from centroid_geometry import insert_distinct_centroid


REGISTRY_SCHEMA = "openplan.development-distributed-work-loading-study.v1"
STUDY_SCHEMA = "openplan.distributed-work-loading-study-result.v1"
DEFAULT_REGISTRY = ROOT / "scripts/modeling/development/california_distributed_work_loading_study.v1.json"
DEFAULT_OUTPUT = ROOT / "data/modeling/distributed-work-loading-study-2026-08-31"
DEFAULT_WORK = ROOT / "tmp/distributed-work-loading-study-2026-08-31"


class StudyRefused(RuntimeError):
    """The checkpoint cannot continue without weakening its registered rules."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def artifact(path: Path, *, logical_gzip: bool = False) -> dict[str, Any]:
    stored = path.read_bytes()
    logical = gzip.decompress(stored) if logical_gzip or path.suffix == ".gz" else stored
    try:
        name = str(path.resolve().relative_to(ROOT))
    except ValueError:
        name = str(path.resolve())
    return {
        "path": name[:-3] if name.endswith(".gz") else name,
        "stored_path": name,
        "stored_bytes": len(stored),
        "stored_sha256": hashlib.sha256(stored).hexdigest(),
        "bytes": len(logical),
        "sha256": hashlib.sha256(logical).hexdigest(),
    }


def assignment_network_artifact(path: Path) -> dict[str, Any]:
    """Hash assignment-relevant SQLite content independently of page layout."""
    exact = artifact(path)
    digest = hashlib.sha256()
    logical_bytes = 0

    def add(payload: bytes) -> None:
        nonlocal logical_bytes
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
        logical_bytes += 8 + len(payload)

    connection = sqlite3.connect(path)
    try:
        for table, order in (("nodes", "node_id"), ("links", "link_id")):
            columns = [str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")]
            add(loading.canonical_bytes({"table": table, "columns": columns}))
            for row in connection.execute(f"SELECT * FROM {table} ORDER BY {order}"):
                for value in row:
                    if value is None:
                        add(b"null")
                    elif isinstance(value, bytes):
                        add(b"bytes:" + value)
                    elif isinstance(value, float):
                        add(("float:" + format(value, ".17g")).encode())
                    elif isinstance(value, int):
                        add(("int:" + str(value)).encode())
                    else:
                        add(("text:" + str(value)).encode())
    finally:
        connection.close()
    return {
        "path": exact["path"],
        "bytes": logical_bytes,
        "sha256": digest.hexdigest(),
        "logical_schema": "openplan.assignment-network-logical-content.v1",
        "storage_note": "SQLite page-layout bytes are not a reproducible assignment input; exact ordered nodes and links are hash-bound.",
    }


def registry_record(path: Path, record: Mapping[str, Any], label: str) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size != int(record.get("bytes", -1)) or sha256_file(path) != record.get("sha256"):
        raise StudyRefused(f"Registered input changed: {label}")
    return artifact(path)


def write_json(path: Path, value: Any, *, compress: bool = False) -> dict[str, Any]:
    payload = loading.canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if compress:
        stored = path.with_suffix(path.suffix + ".gz")
        stored.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    else:
        stored = path
        stored.write_bytes(payload)
    return artifact(stored, logical_gzip=compress)


def write_matrix(path: Path, matrix: np.ndarray) -> dict[str, Any]:
    stream = io.BytesIO()
    np.save(stream, np.asarray(matrix, dtype=np.float64), allow_pickle=False)
    payload = stream.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
    return artifact(path, logical_gzip=True)


def read_matrix(path: Path) -> np.ndarray:
    return np.load(io.BytesIO(gzip.decompress(path.read_bytes())), allow_pickle=False)


def read_od_matrix(path: Path) -> tuple[list[int], np.ndarray]:
    frame = pd.read_csv(path, index_col=0)
    ids = [int(float(value)) for value in frame.index]
    if ids != [int(float(value)) for value in frame.columns]:
        raise StudyRefused("Frozen total matrix changed its ordered zone system")
    matrix = frame.to_numpy(dtype=float)
    if not np.isfinite(matrix).all() or (matrix < 0).any():
        raise StudyRefused("Frozen total matrix contains negative or non-finite demand")
    return ids, matrix


def load_json(path: Path) -> dict[str, Any]:
    payload = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise StudyRefused(f"Required JSON is not an object: {path}")
    return value


def verify_registry(path: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Path]]:
    registry = load_json(path)
    if registry.get("schema") != REGISTRY_SCHEMA or registry.get("methods") != list(loading.METHODS):
        raise StudyRefused("Distributed loading registry changed its schema or separate methods")
    policy = registry.get("policy") or {}
    required_true = ("freeze_all_audits_before_output", "preserve_method_work_totals", "non_work_unchanged", "aggregate_only_same_routable_node", "retain_unroutable_demand", "county_gate_no_national_rescue")
    required_false = ("average_methods", "open_holdout", "change_defaults", "promote_candidate")
    if any(policy.get(key) is not True for key in required_true) or any(policy.get(key) is not False for key in required_false):
        raise StudyRefused("Distributed loading registry weakened a custody or rollout rule")
    if policy.get("arbitrary_point_cap") is not None or policy.get("arbitrary_gateway_cap") is not None:
        raise StudyRefused("Distributed loading registry imposed an arbitrary cap")
    gate = registry.get("development_gate") or {}
    if gate != {
        "reach_metric": "loaded_observed_link_count",
        "residual_metric": "median_absolute_raw_residual",
        "county_stratum": "each geography_id evaluated separately",
        "road_class_stratum": "observation.facility.class with unknown retained",
        "requires": [
            "demand_conserved", "observed_link_reach_improved", "no_county_stratum_worsened",
            "no_road_class_worsened", "same_source_network_custody",
        ],
    }:
        raise StudyRefused("Distributed loading registry changed its preregistered development gate")
    predecessor_record = registry["predecessor"]
    predecessor_path = ROOT / str(predecessor_record["path"])
    registry_record(predecessor_path, predecessor_record, "v4 predecessor")
    predecessor = load_json(predecessor_path)
    expected = [str(item["geography_id"]) for item in registry.get("geographies") or []]
    if expected != [str(item["geography_id"]) for item in predecessor.get("geographies") or []]:
        raise StudyRefused("Development geography membership changed from the frozen v4 partition")
    adapters = registry.get("adapters") or {}
    for geography in registry["geographies"]:
        if geography.get("country") not in adapters:
            raise StudyRefused(f"No registered country adapter for {geography.get('geography_id')}")
        for label, record in geography["work_layer_sources"].items():
            registry_record(ROOT / record["path"], record, f"{geography['geography_id']}/{label}")
    sources = lodes.verify_release(ROOT, registry["source_release"])
    return registry, predecessor, sources


def find_method_record(predecessor: Mapping[str, Any], geography_id: str, method: str) -> Mapping[str, Any]:
    geography = next((item for item in predecessor["geographies"] if str(item["geography_id"]) == geography_id), None)
    if geography is None:
        raise StudyRefused(f"Frozen v4 registry omitted {geography_id}")
    return geography["methods"][method]


def stored_path(record: Mapping[str, Any]) -> Path:
    path = ROOT / str(record.get("stored_path") or record.get("path") or "")
    if path.is_file():
        return path
    gzip_path = path.with_suffix(path.suffix + ".gz")
    return gzip_path if gzip_path.is_file() else path


def source_record(record: Mapping[str, Any], label: str) -> dict[str, Any]:
    path = stored_path(record)
    if not path.is_file():
        raise StudyRefused(f"Frozen v4 artifact is unavailable: {label}")
    exact = artifact(path)
    if record.get("stored_sha256") and exact["stored_sha256"] != record["stored_sha256"]:
        raise StudyRefused(f"Frozen v4 stored bytes changed: {label}")
    if exact["sha256"] != record.get("sha256") or exact["bytes"] != int(record.get("bytes", -1)):
        raise StudyRefused(f"Frozen v4 logical bytes changed: {label}")
    return exact


def graph_components(conn: sqlite3.Connection) -> tuple[dict[int, int], set[int], list[tuple[int, float, float]]]:
    nodes = [(int(row[0]), int(row[1] or 0), float(row[2]), float(row[3])) for row in conn.execute("SELECT node_id,COALESCE(is_centroid,0),X(geometry),Y(geometry) FROM nodes")]
    centroid_ids = {node for node, centroid, _, _ in nodes if centroid}
    graph: dict[int, set[int]] = defaultdict(set)
    for left, right in conn.execute("SELECT a_node,b_node FROM links"):
        graph[int(left)].add(int(right)); graph[int(right)].add(int(left))
    component: dict[int, int] = {}
    for start in sorted(graph):
        if start in component:
            continue
        identifier = len(set(component.values())) + 1
        component[start] = identifier
        queue = deque([start])
        while queue:
            current = queue.popleft()
            for neighbor in graph[current]:
                if neighbor not in component:
                    component[neighbor] = identifier; queue.append(neighbor)
    loadable = {component[node] for node in centroid_ids if node in component}
    physical = [(node, lon, lat) for node, centroid, lon, lat in nodes if not centroid]
    return component, loadable, physical


def resolve_blocks(network_path: Path, blocks: Mapping[str, Mapping[str, Any]], block_weights: Mapping[str, float], zone_by_tract: Mapping[str, int]) -> tuple[list[dict[str, Any]], dict[int, tuple[float, float]]]:
    conn = screening_runtime.connect_spatialite(network_path)
    try:
        component, loadable, physical = graph_components(conn)
    finally:
        conn.close()
    if not physical:
        raise StudyRefused("Frozen network has no physical nodes")
    mean_lat = sum(item[2] for item in physical) / len(physical)
    cosine = max(abs(math.cos(math.radians(mean_lat))), 0.01)
    xy = np.array([(lon * 111_320 * cosine, lat * 110_574) for _, lon, lat in physical])
    tree = cKDTree(xy)
    result = []
    node_coordinates = {node: (lon, lat) for node, lon, lat in physical}
    for block_id in sorted(block_weights):
        block = blocks.get(block_id)
        if block is None:
            state = "unavailable_source" if not block_id.startswith("06") else "unmapped"
            result.append({"block_id": block_id, "resolution_state": state, "network_node_id": None, "source_weight": block_weights[block_id]})
            continue
        if str(block.get("tract_id") or "") not in zone_by_tract:
            result.append({
                "block_id": block_id, "resolution_state": "unmapped", "network_node_id": None,
                "source_weight": block_weights[block_id], "longitude": float(block["longitude"]),
                "latitude": float(block["latitude"]),
            })
            continue
        point = np.array([float(block["longitude"]) * 111_320 * cosine, float(block["latitude"]) * 110_574])
        distance, position = tree.query(point, k=1)
        node_id, node_lon, node_lat = physical[int(position)]
        state = "routable" if component.get(node_id) in loadable else "unroutable"
        result.append({
            "block_id": block_id, "resolution_state": state, "network_node_id": node_id,
            "source_weight": float(block_weights[block_id]), "longitude": float(block["longitude"]),
            "latitude": float(block["latitude"]), "distance_to_node_meters": float(distance),
            "component_id": component.get(node_id), "node_longitude": node_lon, "node_latitude": node_lat,
        })
    return result, node_coordinates


def build_candidate_network(source: Path, destination: Path, access_points: Sequence[Mapping[str, Any]], node_coordinates: Mapping[int, tuple[float, float]]) -> dict[str, int]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    conn = screening_runtime.connect_spatialite(destination)
    try:
        next_node = int(conn.execute("SELECT COALESCE(MAX(node_id),0)+1 FROM nodes").fetchone()[0])
        next_link = int(conn.execute("SELECT COALESCE(MAX(link_id),0)+1 FROM links").fetchone()[0])
        result: dict[str, int] = {}
        for point in sorted(access_points, key=lambda item: str(item["access_point_id"])):
            if point.get("resolution_state") != "routable":
                continue
            target = int(point["network_node_id"])
            lon, lat = node_coordinates[target]
            centroid_lon, centroid_lat, _ = insert_distinct_centroid(conn, next_node, lon, lat)
            distance = max(screening_runtime.haversine_miles(centroid_lon, centroid_lat, lon, lat) * screening_runtime.METERS_PER_MILE, 0.1)
            line = f"LINESTRING({centroid_lon} {centroid_lat}, {lon} {lat})"
            conn.execute(
                "INSERT INTO links (link_id,a_node,b_node,direction,distance,modes,link_type,name,speed_ab,speed_ba,travel_time_ab,travel_time_ba,capacity_ab,capacity_ba,lanes_ab,lanes_ba,geometry) VALUES (?,?,?,0,?,'c','centroid_connector','distributed_work_access',50,50,0.001,0.001,99999,99999,1,1,GeomFromText(?,4326))",
                (next_link, next_node, target, distance, line),
            )
            result[str(point["access_point_id"])] = next_node
            next_node += 1; next_link += 1
        conn.commit()
        return result
    finally:
        conn.close()


def reconstruct_aequilibrae_work(zones_path: Path, skim_path: Path, base: np.ndarray) -> np.ndarray:
    import openmatrix as omx
    zones = pd.read_csv(zones_path)
    with omx.open_file(skim_path, "r") as skims:
        travel_time = np.asarray(skims["travel_time"][:], dtype=float)
        distance = np.asarray(skims["distance"][:], dtype=float)
    internal = (zones["zone_kind"] == "internal").to_numpy(dtype=float)
    workers = zones["worker_residents"].to_numpy(dtype=float)
    households = zones["households"].to_numpy(dtype=float)
    jobs = zones["total_jobs"].to_numpy(dtype=float)
    productions = np.maximum(workers, households * 0.35) * internal
    attractions = np.maximum(jobs, 10) * internal
    work = screening_runtime.gravity_distribute(productions, attractions, travel_time, screening_runtime.HBW_GAMMA)
    area = zones["area_sq_mi"].to_numpy(dtype=float)
    population = zones["est_population"].to_numpy(dtype=float)
    density = np.divide(population, np.maximum(area, 1e-9) * 2.58999, out=np.zeros_like(population), where=area > 0)
    from mode_choice import mode_share_matrices
    auto, _, _ = mode_share_matrices(travel_time, distance / screening_runtime.METERS_PER_MILE, None, density)
    work = work * auto / screening_runtime.VEHICLE_OCCUPANCY["hbw"]
    valid = np.isfinite(travel_time) & (travel_time > 0); np.fill_diagonal(valid, True)
    work = work * valid
    return np.minimum(work, base)


def reconstruct_activitysim_work(trips_path: Path, zone_ids: Sequence[int], base: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    index = {int(zone): pos for pos, zone in enumerate(zone_ids)}
    forward = np.zeros_like(base); reverse = np.zeros_like(base)
    accounting = Counter()
    with trips_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if str(row.get("primary_purpose") or "").lower() != "work":
                continue
            purpose = str(row.get("purpose") or "").lower()
            if purpose not in {"work", "home"}:
                accounting["work_tour_non_commute_person_trips"] += 1
                continue
            occupancy = activitysim_demand_package.occupancy_for_mode(str(row.get("trip_mode") or ""))
            if occupancy is None:
                accounting["unrecognised_mode_person_trips"] += 1; continue
            if occupancy == 0:
                accounting["non_auto_person_trips"] += 1; continue
            try:
                origin, destination = int(float(row["origin"])), int(float(row["destination"]))
            except (TypeError, ValueError, KeyError):
                accounting["unreadable_zone_person_trips"] += 1; continue
            if origin not in index or destination not in index:
                accounting["outside_zone_system_person_trips"] += 1; continue
            target = forward if purpose == "work" else reverse
            target[index[origin], index[destination]] += 1.0 / occupancy
            accounting[f"{purpose}_vehicle_trips"] += 1.0 / occupancy
    combined = np.minimum(forward + reverse, base)
    scale = np.divide(combined, forward + reverse, out=np.zeros_like(combined), where=(forward + reverse) > 0)
    return forward * scale, reverse * scale, dict(accounting)


def distribute_numpy(base: np.ndarray, work: np.ndarray, zone_ids: Sequence[int], access_ids: Sequence[str], pairs: Mapping[tuple[int, int], Sequence[Mapping[str, Any]]]) -> tuple[np.ndarray, dict[str, Any], list[dict[str, Any]]]:
    n = len(zone_ids); matrix = np.zeros((n + len(access_ids), n + len(access_ids)), dtype=np.float64)
    matrix[:n, :n] = base - work
    access_index = {value: index for index, value in enumerate(access_ids)}
    zone_index = {int(value): index for index, value in enumerate(zone_ids)}
    retained: list[dict[str, Any]] = []; states: Counter[str] = Counter(); loaded = 0.0
    for origin in zone_ids:
        for destination in zone_ids:
            i, j = zone_index[int(origin)], zone_index[int(destination)]; value = float(work[i, j])
            if value == 0:
                continue
            records = list(pairs.get((int(origin), int(destination)), ()))
            total_weight = sum(float(item.get("source_weight") or 0) for item in records)
            if not records:
                matrix[i, j] += value; states["inconclusive_missing_pair"] += value
                retained.append({"origin_zone_id": int(origin), "destination_zone_id": int(destination), "demand": value, "state": "inconclusive_missing_pair"})
                continue
            if total_weight == 0:
                matrix[i, j] += value; states["explicit_zero"] += value
                retained.append({"origin_zone_id": int(origin), "destination_zone_id": int(destination), "demand": value, "state": "explicit_zero"})
                continue
            for item in records:
                share = value * float(item.get("source_weight") or 0) / total_weight
                origin_access = str(item.get("origin_access_point_id") or item.get("home_access_point_id") or "")
                destination_access = str(item.get("destination_access_point_id") or item.get("work_access_point_id") or "")
                state = str(item.get("source_state") or "covered")
                if state == "covered" and origin_access in access_index and destination_access in access_index:
                    matrix[n + access_index[origin_access], n + access_index[destination_access]] += share
                    states["covered"] += share; loaded += share
                else:
                    retained_state = state if state != "covered" else "unmapped"
                    matrix[i, j] += share; states[retained_state] += share
                    retained.append({"origin_zone_id": int(origin), "destination_zone_id": int(destination), "origin_access_point_id": origin_access or None, "destination_access_point_id": destination_access or None, "demand": share, "state": retained_state})
    total = float(matrix.sum()); original = float(base.sum()); work_total = float(work.sum()); retained_total = sum(float(row["demand"]) for row in retained)
    accounting = {"original_total": original, "original_work_total": work_total, "non_work_total_unchanged": float((base - work).sum()), "work_loaded_at_access_points": loaded, "work_retained_at_original_centroids": retained_total, "candidate_total": total, "conservation_difference": total - original, "source_state_demand": {state: float(states.get(state, 0)) for state in loading.SOURCE_STATES}}
    if abs(total - original) > max(1e-6, original * 1e-10) or abs(loaded + retained_total - work_total) > max(1e-6, work_total * 1e-10):
        raise StudyRefused("Candidate matrix lost work or total demand")
    return matrix, accounting, retained


def composite(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    payload = loading.canonical_bytes([{key: item[key] for key in ("path", "bytes", "sha256")} for item in records])
    return {"path": "composite", "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


def prepare(registry_path: Path, output_root: Path, work_root: Path, created_at: str, release: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    registry, predecessor, sources = verify_registry(registry_path)
    geography_ids = [str(item["geography_id"]) for item in registry["geographies"]]
    od_rows, active_blocks = lodes.read_county_od([sources["od_main"], sources["od_aux"]], geography_ids)
    crosswalk = lodes.read_crosswalk(sources["crosswalk"], active_blocks)
    rac_coverage = lodes.read_area_coverage(sources["rac"], geography_ids)
    wac_coverage = lodes.read_area_coverage(sources["wac"], geography_ids)
    registry_binding = artifact(registry_path)
    source_files = registry["source_release"]["files"]
    source_bindings = {key: {"path": value["path"], "bytes": value["bytes"], "sha256": value["sha256"]} for key, value in source_files.items()}
    loading_algorithm = composite([
        artifact(ROOT / "workers/aequilibrae_worker/distributed_work_loading.py"),
        artifact(ROOT / "scripts/modeling/us_lodes8_work_loading_adapter.py"),
        artifact(ROOT / "scripts/modeling/run_distributed_work_loading_study.py"),
        artifact(ROOT / "workers/aequilibrae_worker/centroid_geometry.py"),
        artifact(ROOT / "scripts/modeling/screening_runtime.py"),
        artifact(ROOT / "workers/aequilibrae_worker/mode_choice.py"),
        artifact(ROOT / "scripts/modeling/activitysim_demand_package.py"),
    ])
    prepared: dict[tuple[str, str], dict[str, Any]] = {}
    for geography in registry["geographies"]:
        geography_id = str(geography["geography_id"])
        aeq_record = find_method_record(predecessor, geography_id, "aequilibrae")
        asim_record = find_method_record(predecessor, geography_id, "activitysim")
        aeq_artifacts = aeq_record["artifacts"]
        asim_artifacts = asim_record["artifacts"]
        if source_record(aeq_artifacts["network"], f"{geography_id}/aequilibrae/network")["sha256"] != source_record(asim_artifacts["network"], f"{geography_id}/activitysim/network")["sha256"]:
            raise StudyRefused("Methods do not share the exact frozen county network")
        aeq_setup = load_json(stored_path(aeq_artifacts["network_setup_summary"]))
        asim_setup = load_json(stored_path(asim_artifacts["network_setup_summary"]))
        if aeq_setup.get("centroid_map") != asim_setup.get("centroid_map"):
            raise StudyRefused("Methods do not share the exact original centroid map")
        zones_path = stored_path(aeq_artifacts["zone_attributes"])
        zones = pd.read_csv(zones_path)
        zone_by_tract = {str(row.GEOID).split(".")[0].zfill(11): int(row.zone_id) for row in zones.itertuples() if str(row.zone_kind) == "internal"}
        weights = Counter()
        for row in od_rows[geography_id]:
            home = crosswalk[geography_id].get(str(row["home_block"]))
            work = crosswalk[geography_id].get(str(row["work_block"]))
            if (
                str((home or {}).get("tract_id") or "") in zone_by_tract
                and str((work or {}).get("tract_id") or "") in zone_by_tract
            ):
                weights[str(row["home_block"])] += float(row["source_weight"])
                weights[str(row["work_block"])] += float(row["source_weight"])
        network_path = stored_path(aeq_artifacts["network"])
        block_records, node_coordinates = resolve_blocks(network_path, crosswalk[geography_id], weights, zone_by_tract)
        points = loading.aggregate_access_points(block_records)
        access_by_block = {block: point for point in points for block in point["block_ids"]}
        forward_pairs, source_pair_states, source_pair_state_weights = lodes.aggregate_source_pairs(rows=od_rows[geography_id], blocks=crosswalk[geography_id], zone_by_tract=zone_by_tract, access_by_block=access_by_block)
        routable_points = [point for point in points if point["resolution_state"] == "routable"]
        candidate_network = work_root / "networks" / geography_id / "project_database.sqlite"
        access_centroids = build_candidate_network(network_path, candidate_network, routable_points, node_coordinates)
        access_ids = sorted(access_centroids)
        base_centroids = {int(key): int(value) for key, value in aeq_setup["centroid_map"].items()}
        centroid_values = sorted(base_centroids.values()) + [access_centroids[key] for key in access_ids]
        if centroid_values != sorted(centroid_values):
            raise StudyRefused("Candidate centroid order does not match matrix order")
        for method in loading.METHODS:
            method_record = find_method_record(predecessor, geography_id, method)
            artifacts = method_record["artifacts"]
            total_path = stored_path(artifacts["od_matrix"])
            zone_ids, base = read_od_matrix(total_path)
            if zone_ids != [int(value) for value in zones["zone_id"].tolist()]:
                raise StudyRefused("Method total matrix does not share the exact zone order")
            work_sources = geography["work_layer_sources"]
            if method == "aequilibrae":
                work_source_record = work_sources["aequilibrae_skim"]
                work_source_path = ROOT / work_source_record["path"]
                work = reconstruct_aequilibrae_work(zones_path, work_source_path, base)
                pairs = forward_pairs
                work_note = "Frozen gravity HBW layer reconstructed with the exact skim, mode split, and 1.08 occupancy."
                work_accounting = {"forward_vehicle_trips": float(work.sum())}
            else:
                work_source_record = work_sources["activitysim_trips"]
                work_source_path = ROOT / work_source_record["path"]
                forward_work, reverse_work, work_accounting = reconstruct_activitysim_work(work_source_path, zone_ids, base)
                work = forward_work + reverse_work
                reverse_pairs = lodes.reverse_source_pairs(forward_pairs)
                pairs = {key: [*forward_pairs.get(key, ()), *reverse_pairs.get(key, ())] for key in set(forward_pairs) | set(reverse_pairs)}
                work_note = "Exact ActivitySim work-tour home-to-work and work-to-home auto vehicle trips; other work-tour stops remain non-work for this checkpoint."
            candidate, accounting, retained = distribute_numpy(base, work, zone_ids, access_ids, pairs)
            method_work = work_root / "prepared" / geography_id / method
            matrix_record = write_matrix(method_work / "candidate-matrix.npy.gz", candidate)
            source_pair_weights = [
                {"origin_zone_id": origin, "destination_zone_id": destination, **dict(item)}
                for (origin, destination), records in sorted(pairs.items()) for item in records
            ]
            input_value = {
                "schema": loading.INPUT_SCHEMA, "study_id": registry["study_id"], "created_at": created_at,
                "geography": {"geography_id": geography_id, "name": geography["name"], "country": geography["country"]},
                "method": method, "method_aggregation": "separate", "non_work_treatment": "unchanged_not_supported_by_lodes",
                "work_layer_derivation": work_note, "work_layer_accounting": work_accounting,
                "source_release": {key: registry["source_release"][key] for key in ("publisher", "product", "release", "year", "jobs_type", "segment", "block_vintage", "limitations")},
                "source_states": {state: {"records": int(source_pair_states.get(state, 0)), "source_weight": float(source_pair_state_weights.get(state, 0.0)), "modeled_work_demand": accounting["source_state_demand"].get(state, 0.0)} for state in loading.SOURCE_STATES},
                "rac_coverage": rac_coverage[geography_id], "wac_coverage": wac_coverage[geography_id],
                "access_points": routable_points, "retained_unroutable_access_points": [point for point in points if point["resolution_state"] != "routable"],
                "source_pair_weights": source_pair_weights, "retained_work_demand": retained,
                "demand_accounting": accounting, "candidate_matrix": matrix_record,
                "arbitrary_point_cap": None, "arbitrary_gateway_cap": None,
                "limitations": ["LODES supports work endpoint distribution only.", "Missing OD pairs remain inconclusive, not zero or suppressed.", "Unroutable or unmapped demand stays at its original centroid and remains itemized."],
            }
            loading.validate_loading_input(input_value)
            published = output_root / "results" / geography_id / method
            input_record = write_json(published / "distributed-work-loading-input-v1.json", input_value, compress=True)
            raw_work_source_binding = registry_record(work_source_path, work_source_record, f"{geography_id}/{method}/work-layer")
            zone_binding = source_record(artifacts["zone_attributes"], f"{geography_id}/{method}/zones")
            work_source_parts = [raw_work_source_binding]
            if method == "aequilibrae":
                work_source_parts.extend([
                    source_record(artifacts["demand_layers"], f"{geography_id}/{method}/demand-layers"),
                    zone_binding,
                ])
            work_source_binding = composite(work_source_parts)
            bindings = {
                "registry": registry_binding,
                "source_release": source_bindings["version"],
                "source_od": composite([source_bindings["od_main"], source_bindings["od_aux"]]),
                "source_rac": source_bindings["rac"], "source_wac": source_bindings["wac"],
                "source_crosswalk": source_bindings["crosswalk"], "source_documentation": source_bindings["documentation"],
                "source_work_layer": work_source_binding, "zone_attributes": zone_binding,
                "loading_algorithm": loading_algorithm,
                "frozen_total_matrix": source_record(artifacts["od_matrix"], f"{geography_id}/{method}/od"),
                "loading_input": input_record, "candidate_matrix": matrix_record, "candidate_network": assignment_network_artifact(candidate_network),
                "frozen_network": source_record(artifacts["network"], f"{geography_id}/{method}/network"),
                "observation_package": source_record(artifacts["observation_package_v2"], f"{geography_id}/{method}/observations"),
                "match_audit": source_record(artifacts["pre_volume_match_audit_v2"], f"{geography_id}/{method}/matches"),
                "assignment_profile": source_record(artifacts["assignment_profile"], f"{geography_id}/{method}/assignment-profile"),
            }
            audit_value = {
                "schema": loading.AUDIT_SCHEMA, "study_id": registry["study_id"], "created_at": created_at,
                "geography": input_value["geography"], "method": method, "release": dict(release),
                "frozen_before_assignment_output": True, "assignment_output_bytes_read": False,
                "holdout_accessed": False, "methods_averaged": False, "defaults_changed": False, "candidate_promoted": False,
                "bindings": bindings, "access_point_count": len(routable_points), "retained_unroutable_access_point_count": len(points) - len(routable_points),
                "demand_accounting": accounting, "assignment_settings": load_json(stored_path(artifacts["assignment_profile"])),
            }
            loading.validate_pre_output_audit(audit_value)
            audit_record = write_json(published / "pre-output-audit-v1.json", audit_value)
            prepared[(geography_id, method)] = {
                "geography": geography, "method_record": method_record, "audit": audit_value, "audit_record": audit_record,
                "input_record": input_record, "matrix_path": method_work / "candidate-matrix.npy.gz", "matrix_record": matrix_record,
                "candidate_network": candidate_network, "candidate_network_record": bindings["candidate_network"],
                "base_centroids": base_centroids, "access_centroids": access_centroids,
            }
    expected = len(registry["geographies"]) * len(loading.METHODS)
    if len(prepared) != expected:
        raise StudyRefused("Every pre-output audit must freeze before assignment output access")
    for geography in registry["geographies"]:
        audits = [prepared[(str(geography["geography_id"]), method)]["audit"] for method in loading.METHODS]
        if not loading.same_custody_by_method(audits):
            raise StudyRefused(f"Methods do not share exact source/network custody for {geography['geography_id']}")
    return registry, predecessor, prepared


def assign(prepared: Mapping[tuple[str, str], Mapping[str, Any]], work_root: Path, *, resume: bool) -> None:
    for (geography_id, method), item in prepared.items():
        output = work_root / "assignments" / geography_id / method
        volume_path = output / "link_volumes.csv"
        receipt_value = {
            "schema": "openplan.assignment-input-receipt.v1",
            "geography_id": geography_id,
            "method": method,
            "pre_output_audit_sha256": item["audit_record"]["sha256"],
            "candidate_matrix_sha256": item["matrix_record"]["sha256"],
            "candidate_network_sha256": item["candidate_network_record"]["sha256"],
            "assignment_output_bytes_read": False,
        }
        receipt_path = output / "assignment-input-receipt.json"
        summary_path = output / "assignment-summary.json"
        if resume and volume_path.is_file() and receipt_path.is_file() and summary_path.is_file():
            receipt_record = artifact(receipt_path)
            summary_value = load_json(summary_path)
            if (
                load_json(receipt_path) == receipt_value
                and summary_value.get("assignment_input_receipt_sha256") == receipt_record["sha256"]
                and summary_value.get("link_volumes_sha256") == sha256_file(volume_path)
            ):
                continue
        receipt_record = write_json(receipt_path, receipt_value)
        matrix = read_matrix(item["matrix_path"])
        centroid_map = dict(item["base_centroids"])
        next_zone = max(centroid_map) + 1
        for offset, access_id in enumerate(sorted(item["access_centroids"])):
            centroid_map[next_zone + offset] = int(item["access_centroids"][access_id])
        started = time.monotonic()
        summary = screening_runtime.run_assignment(item["candidate_network"].parent, centroid_map, matrix, output, {})
        summary.pop("volumes_by_link", None)
        summary["wall_clock_seconds"] = round(time.monotonic() - started, 2)
        summary["assignment_input_receipt_sha256"] = receipt_record["sha256"]
        summary["link_volumes_sha256"] = sha256_file(volume_path)
        write_json(summary_path, summary)


def classification(match: Mapping[str, Any], volumes: Mapping[str, float]) -> tuple[str, float | str]:
    return diagnosis_v3._classification(match, volumes)


def read_volumes(path: Path) -> dict[str, float]:
    return diagnosis_v3.read_output(path)[0]


def median(values: Sequence[float]) -> float | None:
    return float(np.median(np.asarray(values))) if values else None


def compare(prepared: Mapping[tuple[str, str], Mapping[str, Any]], output_root: Path, work_root: Path, registry: Mapping[str, Any], created_at: str, release: Mapping[str, Any]) -> dict[str, Any]:
    county_rows = []
    for geography in registry["geographies"]:
        geography_id = str(geography["geography_id"]); methods = {}
        custody_same = loading.same_custody_by_method([prepared[(geography_id, method)]["audit"] for method in loading.METHODS])
        for method in loading.METHODS:
            item = prepared[(geography_id, method)]; artifacts = item["method_record"]["artifacts"]
            package = load_json(stored_path(artifacts["observation_package_v2"])); matches = load_json(stored_path(artifacts["pre_volume_match_audit_v2"]))["matches"]
            observations = package["observations"]
            baseline = read_volumes(stored_path(artifacts["model_output"]))
            candidate_path = work_root / "assignments" / geography_id / method / "link_volumes.csv"
            candidate = read_volumes(candidate_path)
            records = []; baseline_counts = Counter(); candidate_counts = Counter(); residuals: dict[str, dict[str, list[float]]] = defaultdict(lambda: {"baseline": [], "candidate": []})
            for observation, match in zip(observations, matches):
                baseline_state, baseline_value = classification(match, baseline); candidate_state, candidate_value = classification(match, candidate)
                center = (observation.get("estimate") or {}).get("center", "unknown")
                numeric_center = float(center) if isinstance(center, (int, float)) else None
                baseline_residual = float(baseline_value) - numeric_center if numeric_center is not None and isinstance(baseline_value, (int, float)) else "unknown"
                candidate_residual = float(candidate_value) - numeric_center if numeric_center is not None and isinstance(candidate_value, (int, float)) else "unknown"
                facility = str((observation.get("facility") or {}).get("class") or "unknown")
                if isinstance(baseline_residual, float): residuals[facility]["baseline"].append(abs(baseline_residual))
                if isinstance(candidate_residual, float): residuals[facility]["candidate"].append(abs(candidate_residual))
                records.append({"observation_id": str(observation["observation_id"]), "facility_class": facility, "observed_center": center, "baseline_classification": baseline_state, "candidate_classification": candidate_state, "baseline_modeled_value": baseline_value, "candidate_modeled_value": candidate_value, "baseline_raw_residual": baseline_residual, "candidate_raw_residual": candidate_residual, "selected_link_ids": list(match.get("selected_link_ids") or [])})
                baseline_counts[baseline_state] += 1; candidate_counts[candidate_state] += 1
            required = ("loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output")
            road_classes = {}
            no_worse = True
            for facility, values in sorted(residuals.items()):
                before, after = median(values["baseline"]), median(values["candidate"])
                worsened = before is not None and after is not None and after > before + 1e-9
                no_worse = no_worse and not worsened
                road_classes[facility] = {"baseline_median_absolute_raw_residual": before, "candidate_median_absolute_raw_residual": after, "worsened": worsened, "comparable_records": min(len(values["baseline"]), len(values["candidate"]))}
            county_baseline = median([value for values in residuals.values() for value in values["baseline"]])
            county_candidate = median([value for values in residuals.values() for value in values["candidate"]])
            county_worsened = county_baseline is not None and county_candidate is not None and county_candidate > county_baseline + 1e-9
            county_stratum = {
                "geography_id": geography_id,
                "baseline_median_absolute_raw_residual": county_baseline,
                "candidate_median_absolute_raw_residual": county_candidate,
                "worsened": county_worsened,
                "comparable_records": sum(len(values["baseline"]) for values in residuals.values()),
            }
            accounting = item["audit"]["demand_accounting"]
            conserved = abs(float(accounting["conservation_difference"])) <= max(1e-6, float(accounting["original_total"]) * 1e-10)
            reach_improved = candidate_counts["loaded"] > baseline_counts["loaded"]
            advanced = conserved and reach_improved and not county_worsened and no_worse and custody_same
            comparison_value = {
                "schema": loading.COMPARISON_SCHEMA, "study_id": registry["study_id"], "created_at": created_at,
                "release": dict(release), "geography": {"geography_id": geography_id, "name": geography["name"], "country": geography["country"]},
                "method": method, "method_aggregation": "separate", "scientific_outcome": "inconclusive", "holdout_accessed": False, "defaults_changed": False,
                "bindings": {"pre_output_audit_sha256": item["audit_record"]["sha256"], "baseline_output": source_record(artifacts["model_output"], f"{geography_id}/{method}/baseline-output"), "candidate_output": artifact(candidate_path)},
                "coverage": {"baseline": {key: int(baseline_counts.get(key, 0)) for key in required}, "candidate": {key: int(candidate_counts.get(key, 0)) for key in required}},
                "records": records, "county_stratum": county_stratum, "road_class_coverage": road_classes,
                "development_gate": {"advanced": advanced, "demand_conserved": conserved, "observed_link_reach_improved": reach_improved, "no_county_stratum_worsened": not county_worsened, "no_road_class_worsened": no_worse, "same_source_network_custody": custody_same, "failed_candidate_published_unchanged_and_retired": not advanced},
                "limitations": ["This is development evidence, not calibration or validation.", "No national aggregate can rescue a failing county.", "A successful development result would still require a new preregistration and untouched geographic holdout."],
            }
            loading.validate_development_comparison(comparison_value)
            record = write_json(output_root / "results" / geography_id / method / "development-comparison-v1.json", comparison_value, compress=True)
            methods[method] = {"input": item["input_record"], "audit": item["audit_record"], "comparison": record, "coverage": comparison_value["coverage"], "development_gate": comparison_value["development_gate"]}
        county_rows.append({"geography_id": geography_id, "name": geography["name"], "methods": methods, "all_methods_advanced": all(methods[m]["development_gate"]["advanced"] for m in loading.METHODS)})
    result = {"schema": STUDY_SCHEMA, "study_id": registry["study_id"], "created_at": created_at, "release": dict(release), "registry": artifact(DEFAULT_REGISTRY), "counties": county_rows, "method_records": len(county_rows) * 2, "method_aggregation": "separate", "scientific_outcome": "inconclusive", "defaults_changed": False, "holdout_accessed": False, "candidate_advanced": all(row["all_methods_advanced"] for row in county_rows), "claim": "No calibration, California completeness, nationwide validation, or v1 readiness claim is made."}
    write_json(output_root / "study-result.json", result)
    report = ["# Distributed work loading development checkpoint", "", f"Date: {created_at[:10]}", f"OpenPlan: `{release['version']}`", f"Release SHA: `{release['sha']}`", "", "## Result", "", "The checkpoint is inconclusive. AequilibraE and ActivitySim remain separate. No default changed, no holdout was opened, and no calibration or validation claim is made.", "", "LODES 8.4 distributes source-covered work endpoints only. Non-work trips retain the frozen centroid loading. Missing, explicit-zero, unmapped, unavailable, suppressed, and unroutable states remain separate.", "", "## County gates", ""]
    for row in county_rows:
        report.append(f"- {row['name']}: " + "; ".join(f"{method} {'advanced' if row['methods'][method]['development_gate']['advanced'] else 'retired'}" for method in loading.METHODS))
    report += ["", "A failed candidate is retained unchanged and retired. A national total cannot rescue it. A development pass would still require a new preregistration and a genuinely untouched geographic holdout.", ""]
    (output_root / "study-report.md").write_text("\n".join(report))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--work-root", type=Path, default=DEFAULT_WORK)
    parser.add_argument("--created-at", default=datetime.now(timezone.utc).isoformat())
    parser.add_argument("--release-sha", default="working-tree")
    parser.add_argument("--app-version", default="0.44.0")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    release = {"version": args.app_version, "sha": args.release_sha}
    registry, _, prepared = prepare(args.registry.resolve(), args.output_root.resolve(), args.work_root.resolve(), args.created_at, release)
    if args.prepare_only:
        print(f"Frozen {len(prepared)} pre-output audits before reading assignment output.")
        return 0
    assign(prepared, args.work_root.resolve(), resume=args.resume)
    result = compare(prepared, args.output_root.resolve(), args.work_root.resolve(), registry, args.created_at, release)
    print(json.dumps({"scientific_outcome": result["scientific_outcome"], "candidate_advanced": result["candidate_advanced"], "method_records": result["method_records"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
