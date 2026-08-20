#!/usr/bin/env python3
"""Route FHWA TAF long-distance flows and aggregate county through travel.

Unlike a full route cache, this writes one resumable checkpoint record per
origin county. Each shortest-path tree is computed once, all requested study
areas are classified together, and only the arithmetic needed for the final
evidence result survives. No sampled or straight-line prefilter is used.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
from shapely.geometry import shape

from faf5_routing import (
    FAF5_NETWORK_URL,
    Faf5Router,
    Faf5RoutingError,
    graph_source_fingerprint,
    load_faf5_graph_with_area_masks,
)
from through_trips_taf import (
    TAF_LONG_DISTANCE_MILES,
    normalize_fips,
    read_county_centroids,
    read_taf_rows,
)

EARTH_RADIUS_MILES = 3958.7613
NO_ROUTE_REASONS = ("missing_endpoint", "snap_too_far", "network_unreachable")


def great_circle_miles(start: tuple[float, float], end: tuple[float, float]) -> float:
    """Geodesic endpoint-to-network distance; raw longitude degrees are not a distance."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*start, *end))
    delta_lon, delta_lat = lon2 - lon1, lat2 - lat1
    chord = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(min(1.0, chord)))


def read_endpoint_points(
    gazetteers: Iterable[Path],
    point_csvs: Iterable[Path] = (),
) -> dict[str, tuple[float, float]]:
    """Merge Census vintages and explicit id/lon/lat adapters, with later inputs winning."""
    points: dict[str, tuple[float, float]] = {}
    for path in gazetteers:
        points.update(read_county_centroids(path))
    for path in point_csvs:
        with Path(path).open(newline="") as handle:
            for row in csv.DictReader(handle):
                # Extra provenance columns deliberately survive in the hashed
                # source artifact even though routing consumes only these four.
                points[normalize_fips(row["id"])] = (float(row["lon"]), float(row["lat"]))
    return points


def snap_endpoints(
    router: Faf5Router,
    points: Mapping[str, tuple[float, float]],
    used_fips: Iterable[str],
    max_snap_miles: float,
) -> tuple[dict[str, int], dict[str, str], dict[str, float]]:
    """Snap only executed TAF endpoints and refuse points beyond the disclosed threshold."""
    nodes: dict[str, int] = {}
    statuses: dict[str, str] = {}
    distances: dict[str, float] = {}
    for fips in sorted(set(used_fips)):
        point = points.get(fips)
        if point is None:
            statuses[fips] = "missing_endpoint"
            continue
        node, _ = router.nearest_node(point)
        distance = great_circle_miles(point, tuple(map(float, router.coordinates[node])))
        distances[fips] = distance
        if distance > max_snap_miles:
            statuses[fips] = "snap_too_far"
            continue
        nodes[fips] = node
        statuses[fips] = "accepted"
    return nodes, statuses, distances


def read_positive_flows(paths: Iterable[Path]) -> dict[str, dict[str, float]]:
    """Aggregate repeated TAF tables into one positive OD matrix."""
    flows: dict[str, dict[str, float]] = defaultdict(dict)
    for path in paths:
        for origin, destination, trips in read_taf_rows(path):
            if trips <= 0:
                continue
            origin, destination = normalize_fips(origin), normalize_fips(destination)
            flows[origin][destination] = flows[origin].get(destination, 0.0) + trips
    return dict(flows)


def summarize_origin(
    origin: str,
    destination_trips: Mapping[str, float],
    study_fips: Sequence[str],
    county_nodes: Mapping[str, int],
    endpoint_statuses: Mapping[str, str],
    reachable: np.ndarray | None,
    path_masks: np.ndarray | None,
) -> dict[str, Any]:
    """Aggregate one origin's routed flows for every study county."""
    metrics = {
        fips: {
            "annual_person_trips_through": 0.0,
            "annual_person_trips_ending_here": 0.0,
            "positive_external_flows_without_a_route": 0,
            "annual_person_trips_without_a_route": 0.0,
            **{f"positive_external_flows_{reason}": 0 for reason in NO_ROUTE_REASONS},
            **{f"annual_person_trips_{reason}": 0.0 for reason in NO_ROUTE_REASONS},
        }
        for fips in study_fips
    }
    positive_pairs = 0
    for destination, trips in destination_trips.items():
        if trips <= 0 or destination == origin:
            continue
        positive_pairs += 1
        target = county_nodes.get(destination)
        route_exists = (
            reachable is not None
            and path_masks is not None
            and target is not None
            and bool(reachable[target])
        )
        failure_reason = None
        if endpoint_statuses.get(origin) != "accepted":
            failure_reason = endpoint_statuses.get(origin, "missing_endpoint")
        elif endpoint_statuses.get(destination) != "accepted":
            failure_reason = endpoint_statuses.get(destination, "missing_endpoint")
        elif not route_exists:
            failure_reason = "network_unreachable"
        for bit, fips in enumerate(study_fips):
            result = metrics[fips]
            if origin == fips or destination == fips:
                result["annual_person_trips_ending_here"] += trips
            elif failure_reason is not None:
                result["positive_external_flows_without_a_route"] += 1
                result["annual_person_trips_without_a_route"] += trips
                result[f"positive_external_flows_{failure_reason}"] += 1
                result[f"annual_person_trips_{failure_reason}"] += trips
            elif int(path_masks[target]) & (1 << bit):
                result["annual_person_trips_through"] += trips
    return {
        "origin": origin,
        "positive_od_pairs": positive_pairs,
        "counties": metrics,
    }


def combine_origin_summaries(
    records: Iterable[Mapping[str, Any]],
    study_fips: Sequence[str],
) -> dict[str, Any]:
    """Reduce checkpoint records into the published county totals."""
    totals = {
        fips: {
            "annual_person_trips_through": 0.0,
            "annual_person_trips_ending_here": 0.0,
            "positive_external_flows_without_a_route": 0,
            "annual_person_trips_without_a_route": 0.0,
            **{f"positive_external_flows_{reason}": 0 for reason in NO_ROUTE_REASONS},
            **{f"annual_person_trips_{reason}": 0.0 for reason in NO_ROUTE_REASONS},
        }
        for fips in study_fips
    }
    origins = pairs = 0
    for record in records:
        origins += 1
        pairs += int(record["positive_od_pairs"])
        for fips in study_fips:
            for key, value in record["counties"][fips].items():
                totals[fips][key] += value
    counties: dict[str, Any] = {}
    for fips, result in totals.items():
        through = result["annual_person_trips_through"]
        ending = result["annual_person_trips_ending_here"]
        denominator = through + ending
        counties[fips] = {
            "county_fips": fips,
            **{key: round(value, 1) if isinstance(value, float) else value for key, value in result.items()},
            "daily_person_trips_through": round(through / 365.0, 1),
            "daily_person_trips_ending_here": round(ending / 365.0, 1),
            "through_share_of_long_distance_travel": round(through / denominator, 4) if denominator else None,
            "path_method": "FHWA FAF5 free-flow shortest path",
        }
    return {"origins_completed": origins, "positive_od_pairs": pairs, "counties": counties}


def hash_inputs(paths: Iterable[Path], network_fingerprint: str) -> str:
    """Hash every executed evidence input so a checkpoint cannot mix reruns."""
    digest = hashlib.sha256(network_fingerprint.encode())
    for path in sorted((Path(path) for path in paths), key=lambda item: str(item)):
        digest.update(str(path).encode())
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def read_checkpoint(path: Path, input_fingerprint: str) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return records
    with path.open() as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            if record.get("input_fingerprint") != input_fingerprint:
                raise Faf5RoutingError(
                    f"Checkpoint {path}:{line_number} belongs to different network, boundaries, or TAF tables"
                )
            origin = str(record["origin"])
            if origin in records:
                raise Faf5RoutingError(f"Checkpoint repeats origin {origin} at {path}:{line_number}")
            records[origin] = record
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--network-gdb", required=True)
    parser.add_argument("--gazetteer", action="append", required=True, help="Census county Gazetteer; repeat from oldest to newest")
    parser.add_argument("--points-csv", action="append", default=[], help="Optional id,lon,lat endpoint adapter; later inputs win")
    parser.add_argument("--max-snap-miles", required=True, type=float, help="Refuse county points farther from the strategic network")
    parser.add_argument("--taf-csv", action="append", required=True)
    parser.add_argument("--boundary", action="append", required=True, metavar="FIPS=PATH")
    parser.add_argument("--checkpoint", required=True, help="Resumable per-origin JSONL")
    parser.add_argument("--output", required=True)
    # Provenance travels with the flow table, not with this script. The defaults
    # describe TAF because that is what it was written for; a run over any other
    # table MUST override them, or the result file will name a source it never
    # read. See the note on the payload below.
    parser.add_argument(
        "--source-label",
        default="FHWA Traveler Analysis Framework, 2008 county-to-county long-distance person trips",
        help="What the flow tables actually are. Override for any non-TAF input.",
    )
    parser.add_argument(
        "--source-url",
        default="https://www.fhwa.dot.gov/policyinformation/analysisframework/01.cfm",
        help="Where that source is published.",
    )
    parser.add_argument(
        "--flow-unit",
        default="annual person trips",
        help="What one unit of the flow column counts. TAF publishes annual person trips; "
             "LODES publishes workers. The per-county fields are named for TAF's unit, so a "
             "different input needs this to be readable.",
    )
    parser.add_argument(
        "--what-this-is-not",
        default="",
        help="Replaces the TAF limitation sentence when the input is not TAF.",
    )
    args = parser.parse_args()

    boundary_paths: dict[str, Path] = {}
    areas = []
    for pair in args.boundary:
        fips, separator, raw_path = pair.partition("=")
        if not separator:
            raise Faf5RoutingError(f"Boundary must be FIPS=PATH, found {pair}")
        fips = normalize_fips(fips)
        path = Path(raw_path)
        payload = json.loads(path.read_text())
        boundary_paths[fips] = path
        areas.append(shape(payload["features"][0]["geometry"]))
    study_fips = list(boundary_paths)

    network_path = Path(args.network_gdb)
    network_fingerprint = graph_source_fingerprint(network_path)
    taf_paths = [Path(path) for path in args.taf_csv]
    if not math.isfinite(args.max_snap_miles) or args.max_snap_miles <= 0:
        raise Faf5RoutingError("--max-snap-miles must be a positive finite distance")
    gazetteer_paths = [Path(path) for path in args.gazetteer]
    point_csv_paths = [Path(path) for path in args.points_csv]
    fingerprint = hash_inputs(
        [*gazetteer_paths, *point_csv_paths, *taf_paths, *boundary_paths.values()],
        network_fingerprint,
    )
    fingerprint = hashlib.sha256(f"{fingerprint}|max_snap_miles={args.max_snap_miles}".encode()).hexdigest()
    graph, coordinates, edge_masks, graph_report = load_faf5_graph_with_area_masks(
        network_path, areas
    )
    router = Faf5Router(graph, coordinates)
    centroids = read_endpoint_points(gazetteer_paths, point_csv_paths)
    if not centroids:
        raise Faf5RoutingError(f"No county points read from {args.gazetteer}")
    flows = read_positive_flows(taf_paths)
    used_fips = set(flows)
    used_fips.update(destination for destinations in flows.values() for destination in destinations)
    county_nodes, endpoint_statuses, snap_distances_by_fips = snap_endpoints(
        router, centroids, used_fips, args.max_snap_miles
    )
    checkpoint = Path(args.checkpoint)
    records = read_checkpoint(checkpoint, fingerprint)
    with checkpoint.open("a") as sink:
        for position, origin in enumerate(sorted(flows), 1):
            if origin in records:
                continue
            if endpoint_statuses.get(origin) == "accepted":
                reachable, path_masks = router.routed_area_masks(centroids[origin], edge_masks)
            else:
                reachable = path_masks = None
            record = summarize_origin(
                origin, flows[origin], study_fips, county_nodes, endpoint_statuses, reachable, path_masks
            )
            record["input_fingerprint"] = fingerprint
            sink.write(json.dumps(record, separators=(",", ":")) + "\n")
            sink.flush()
            records[origin] = record
            if position % 100 == 0:
                print(f"routed {position}/{len(flows)} origins", flush=True)

    combined = combine_origin_summaries(records.values(), study_fips)
    payload = {
        "schema_version": "openplan.routed_taf_through_trips.v1",
        # WHY THIS IS NOT A CONSTANT ANY MORE. The router does not care what its
        # three-column origin,destination,flow table describes, so on 2026-08-20
        # it was fed LEHD LODES commute flows — and stamped the result "FHWA
        # Traveler Analysis Framework, 2008 long-distance person trips" and
        # "annual person trips" on every field. A file that names the wrong
        # source and the wrong unit is worse than no file: the numbers are
        # right, the record of where they came from is a forgery, and nothing
        # downstream can tell. So a run over anything other than TAF must say
        # what it read.
        "source": args.source_label,
        "source_url": args.source_url,
        "flow_unit": args.flow_unit,
        "flow_tables": [str(Path(path)) for path in args.taf_csv],
        "network_source": FAF5_NETWORK_URL,
        "network_fingerprint": network_fingerprint,
        "input_fingerprint": fingerprint,
        "network_build": graph_report,
        "endpoint_sources": [str(path) for path in [*gazetteer_paths, *point_csv_paths]],
        "endpoint_status_counts": {
            status: sum(value == status for value in endpoint_statuses.values())
            for status in ("accepted", *NO_ROUTE_REASONS[:-1])
        },
        "county_point_snap_distance_miles": {
            "maximum_allowed": args.max_snap_miles,
            "median_observed": round(float(np.median(list(snap_distances_by_fips.values()))), 3),
            "maximum_observed": round(float(np.max(list(snap_distances_by_fips.values()))), 3),
        },
        "what_this_is_not": args.what_this_is_not or (
            f"Only TAF long-distance travel (FHWA threshold {TAF_LONG_DISTANCE_MILES} miles), "
            "from 2008 person-trip estimates routed on FHWA's strategic FAF5 network. It is not "
            "the share of all vehicles at a boundary crossing and does not observe short-distance through travel."
        ),
        **combined,
    }
    text = json.dumps(payload, indent=2)
    Path(args.output).write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
