#!/usr/bin/env python3
"""Shortest paths on FHWA's free, national FAF5 model highway network.

This module deliberately does not download the network.  The 214 MB archive is
an operator-provided evidence input, just like a TAF trip table, and callers
must record the file they used.  The supported input is the ``FAF5Network.gdb``
from FHWA's published *FAF5 Model Highway Network* archive.

FAF5 is a strategic highway network, not a street router.  It is appropriate
for testing which counties a 100-plus-mile TAF flow traverses; it must not be
used to claim a local route or turn-by-turn path.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import geopandas as gpd
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import LineString

FAF5_NETWORK_URL = (
    "https://ops.fhwa.dot.gov/freight/freight_analysis/faf/"
    "faf_highway_assignment_results/FAF5_Model_Highway_Network.zip"
)
FAF5_LINK_LAYER = "FAF5_Links"
NO_PREDECESSOR = -9999


class Faf5RoutingError(RuntimeError):
    """The national route cannot be computed, with a reason fit to disclose."""


def _line_endpoints(geometry: Any) -> tuple[tuple[float, float], tuple[float, float]]:
    """Return the first and last coordinate of a FAF LineString/MultiLineString."""
    if geometry is None or geometry.is_empty:
        raise Faf5RoutingError("FAF5 contains an empty link geometry")
    parts = list(geometry.geoms) if geometry.geom_type == "MultiLineString" else [geometry]
    return tuple(parts[0].coords[0]), tuple(parts[-1].coords[-1])


def build_directed_graph(
    links: Iterable[Mapping[str, Any]],
) -> tuple[csr_matrix, np.ndarray, dict[tuple[float, float], int]]:
    """Build a time-weighted graph from FAF link records.

    ``DIR=1`` is AB-only; ``DIR=0`` is two-way.  A two-way link uses its BA
    free-flow time in the reverse direction rather than copying AB.  That
    distinction is small on most links and consequential at borders, where the
    data dictionary says direction-specific delay may be included.
    """
    node_ids: dict[tuple[float, float], int] = {}
    coordinates: list[tuple[float, float]] = []
    edges: dict[tuple[int, int], float] = {}

    def node_id(coordinate: tuple[float, float]) -> int:
        key = (float(coordinate[0]), float(coordinate[1]))
        if key not in node_ids:
            node_ids[key] = len(coordinates)
            coordinates.append(key)
        return node_ids[key]

    for link in links:
        start, end = _line_endpoints(link["geometry"])
        a, b = node_id(start), node_id(end)
        try:
            direction = int(link["DIR"])
        except (KeyError, TypeError, ValueError) as error:
            raise Faf5RoutingError("FAF5 link lacks a numeric DIR") from error
        if direction in (0, 1):
            try:
                ab_time = float(link["AB_FreeFlowTime"])
            except (KeyError, TypeError, ValueError) as error:
                raise Faf5RoutingError("AB-traversable FAF5 link lacks a numeric AB_FreeFlowTime") from error
            if not np.isfinite(ab_time) or ab_time <= 0:
                raise Faf5RoutingError("AB-traversable FAF5 link has a non-positive AB free-flow time")
            edges[(a, b)] = min(edges.get((a, b), float("inf")), ab_time)
        if direction in (0, -1):
            try:
                ba_time = float(link["BA_FreeFlowTime"])
            except (KeyError, TypeError, ValueError) as error:
                raise Faf5RoutingError("Two-way FAF5 link lacks a numeric BA_FreeFlowTime") from error
            if not np.isfinite(ba_time) or ba_time <= 0:
                raise Faf5RoutingError("BA-traversable FAF5 link has a non-positive BA free-flow time")
            edges[(b, a)] = min(edges.get((b, a), float("inf")), ba_time)
        if direction not in (-1, 0, 1):
            raise Faf5RoutingError(f"Unknown FAF5 permitted-direction code: {direction}")

    if not coordinates:
        raise Faf5RoutingError("FAF5 network contains no routable links")
    edge_items = list(edges.items())
    rows = np.fromiter((edge[0][0] for edge in edge_items), dtype=np.int64)
    cols = np.fromiter((edge[0][1] for edge in edge_items), dtype=np.int64)
    weights = np.fromiter((edge[1] for edge in edge_items), dtype=np.float64)
    graph = csr_matrix((weights, (rows, cols)), shape=(len(coordinates), len(coordinates)))
    return graph, np.asarray(coordinates, dtype=np.float64), node_ids


def _read_routable_faf5_links(gdb_path: Path):
    """Read FAF5 once and disclose every published link omitted from routing."""
    path = Path(gdb_path)
    if not path.exists():
        raise Faf5RoutingError(f"FAF5 geodatabase does not exist: {path}")
    links = gpd.read_file(
        path,
        layer=FAF5_LINK_LAYER,
        columns=["DIR", "AB_FreeFlowTime", "BA_FreeFlowTime"],
    )
    if links.crs is None or links.crs.to_epsg() != 4269:
        raise Faf5RoutingError(f"FAF5 link layer must use EPSG:4269, found {links.crs}")
    direction = links["DIR"]
    valid_ab = links["AB_FreeFlowTime"].notna() & (links["AB_FreeFlowTime"] > 0)
    valid_ba = links["BA_FreeFlowTime"].notna() & (links["BA_FreeFlowTime"] > 0)
    routable = direction.isin([0, 1]) & valid_ab | direction.eq(-1) & valid_ba
    routable &= ~direction.eq(0) | valid_ba
    report = {
        "links_published": int(len(links)),
        "links_routed": int(routable.sum()),
        "links_excluded_missing_free_flow_time": int((~routable).sum()),
        # The 2022 FAF5 dictionary says only 0/1. The file itself contains -1,
        # conventional reverse-only direction coding. Naming it prevents this
        # measured schema discrepancy from disappearing into implementation.
        "reverse_only_links_undocumented_in_data_dictionary": int(direction.eq(-1).sum()),
    }
    return links.loc[routable].copy(), report


def load_faf5_graph(gdb_path: Path) -> tuple[csr_matrix, np.ndarray, dict[str, Any]]:
    """Read the published FAF5 link layer and return its directed graph."""
    links, report = _read_routable_faf5_links(gdb_path)
    graph, coordinates, _ = build_directed_graph(links.to_dict("records"))
    return graph, coordinates, report


def load_faf5_graph_with_area_masks(
    gdb_path: Path,
    areas: Sequence[Any],
) -> tuple[csr_matrix, np.ndarray, csr_matrix, dict[str, Any]]:
    """Load FAF5 plus a bitmask naming every study area each directed link touches.

    The mask is derived from the published link geometry, not merely its end
    nodes. A long or curved link may cross a study area while both endpoints
    remain outside it; endpoint-only classification would silently miss that
    through flow.
    """
    if len(areas) > 63:
        raise Faf5RoutingError("At most 63 study areas fit in one routed bitmask")
    links, report = _read_routable_faf5_links(gdb_path)
    records = links.to_dict("records")
    graph, coordinates, node_ids = build_directed_graph(records)
    geometry_masks = np.zeros(len(links), dtype=np.uint64)
    for index, area in enumerate(areas):
        geometry_masks[links.geometry.intersects(area).to_numpy()] |= np.uint64(1 << index)

    edge_masks: dict[tuple[int, int], int] = {}
    for record, mask in zip(records, geometry_masks, strict=True):
        if not mask:
            continue
        start, end = _line_endpoints(record["geometry"])
        a = node_ids[(float(start[0]), float(start[1]))]
        b = node_ids[(float(end[0]), float(end[1]))]
        direction = int(record["DIR"])
        if direction in (0, 1):
            edge_masks[(a, b)] = edge_masks.get((a, b), 0) | int(mask)
        if direction in (0, -1):
            edge_masks[(b, a)] = edge_masks.get((b, a), 0) | int(mask)
    items = list(edge_masks.items())
    rows = np.fromiter((item[0][0] for item in items), dtype=np.int64)
    cols = np.fromiter((item[0][1] for item in items), dtype=np.int64)
    masks = np.fromiter((item[1] for item in items), dtype=np.uint64)
    area_mask_graph = csr_matrix((masks, (rows, cols)), shape=graph.shape, dtype=np.uint64)
    report["study_area_count"] = len(areas)
    report["directed_links_touching_a_study_area"] = len(items)
    return graph, coordinates, area_mask_graph, report


@dataclass(frozen=True)
class RoutedPath:
    origin: str
    destination: str
    status: str
    snap_distance_degrees_origin: float | None
    snap_distance_degrees_destination: float | None
    free_flow_minutes: float | None
    coordinates: tuple[tuple[float, float], ...]


class Faf5Router:
    """Route county points on one loaded FAF5 graph, caching one source tree."""

    def __init__(self, graph: csr_matrix, coordinates: np.ndarray):
        if graph.shape != (len(coordinates), len(coordinates)):
            raise Faf5RoutingError("FAF5 graph and coordinate arrays have different node counts")
        self.graph = graph
        self.coordinates = coordinates
        self.tree = cKDTree(coordinates)
        self._source: int | None = None
        self._distances: np.ndarray | None = None
        self._predecessors: np.ndarray | None = None

    def nearest_node(self, point: tuple[float, float]) -> tuple[int, float]:
        distance, index = self.tree.query(np.asarray(point, dtype=np.float64), k=1)
        return int(index), float(distance)

    def route(
        self,
        origin: str,
        destination: str,
        points: Mapping[str, tuple[float, float]],
    ) -> RoutedPath:
        if origin not in points or destination not in points:
            return RoutedPath(origin, destination, "missing_endpoint", None, None, None, ())
        source, source_snap = self.nearest_node(points[origin])
        target, target_snap = self.nearest_node(points[destination])
        if source != self._source:
            distances, predecessors = dijkstra(
                self.graph,
                directed=True,
                indices=source,
                return_predecessors=True,
            )
            self._source = source
            self._distances = distances
            self._predecessors = predecessors
        assert self._distances is not None and self._predecessors is not None
        if not np.isfinite(self._distances[target]):
            return RoutedPath(origin, destination, "unreachable", source_snap, target_snap, None, ())

        node_path = [target]
        cursor = target
        while cursor != source:
            cursor = int(self._predecessors[cursor])
            if cursor == NO_PREDECESSOR:
                raise Faf5RoutingError("Finite FAF5 route has no predecessor chain")
            node_path.append(cursor)
            if len(node_path) > self.graph.shape[0]:
                raise Faf5RoutingError("FAF5 predecessor chain contains a cycle")
        node_path.reverse()
        coordinates = tuple(tuple(map(float, self.coordinates[node])) for node in node_path)
        return RoutedPath(
            origin,
            destination,
            "routed",
            source_snap,
            target_snap,
            float(self._distances[target]),
            coordinates,
        )

    def routed_area_masks(
        self,
        origin_point: tuple[float, float],
        edge_area_masks: csr_matrix,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return reachability and accumulated study-area masks from one origin.

        SciPy supplies a predecessor tree. Pointer jumping then ORs each link's
        area mask with its ancestors in logarithmic passes, so every national
        destination is classified without reconstructing millions of paths.
        """
        if edge_area_masks.shape != self.graph.shape:
            raise Faf5RoutingError("FAF5 area-mask graph has the wrong node count")
        source, _ = self.nearest_node(origin_point)
        distances, predecessors = dijkstra(
            self.graph,
            directed=True,
            indices=source,
            return_predecessors=True,
        )
        nodes = np.arange(self.graph.shape[0], dtype=np.int64)
        parents = predecessors.astype(np.int64)
        unreachable = parents == NO_PREDECESSOR
        parents[unreachable] = nodes[unreachable]
        path_masks = np.zeros(self.graph.shape[0], dtype=np.uint64)
        reachable_non_source = np.isfinite(distances) & (nodes != source)
        path_masks[reachable_non_source] = np.asarray(
            edge_area_masks[parents[reachable_non_source], nodes[reachable_non_source]]
        ).reshape(-1)
        # A predecessor tree cannot be deeper than its node count. Doubling the
        # ancestor distance each pass therefore needs at most ceil(log2(n))+1.
        for _ in range(max(1, int(np.ceil(np.log2(max(1, self.graph.shape[0])))) + 1)):
            combined = path_masks | path_masks[parents]
            if np.array_equal(combined, path_masks):
                break
            path_masks = combined
            parents = parents[parents]
        else:
            raise Faf5RoutingError("FAF5 predecessor masks did not converge")
        return np.isfinite(distances), path_masks


def route_intersects(path: RoutedPath, area: Any) -> bool:
    """Whether a successfully routed path touches an area; never guess on failure."""
    if path.status != "routed" or len(path.coordinates) < 2:
        return False
    return LineString(path.coordinates).intersects(area)


def graph_source_fingerprint(path: Path) -> str:
    """Hash every geodatabase table byte so a route names its exact network."""
    root = Path(path)
    digest = hashlib.sha256()
    files = sorted(root.glob("*.gdbtable")) + sorted(root.glob("*.gdbtablx"))
    if not files:
        raise Faf5RoutingError(f"No geodatabase tables found under {root}")
    for file in files:
        digest.update(file.name.encode())
        with file.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--network-gdb", required=True)
    parser.add_argument("--points-csv", required=True, help="CSV with id,lon,lat columns")
    parser.add_argument("--od-csv", required=True, help="CSV with origin,destination columns, grouped by origin for speed")
    parser.add_argument("--output", required=True, help="Resumable JSONL route cache")
    args = parser.parse_args()

    points: dict[str, tuple[float, float]] = {}
    with Path(args.points_csv).open() as handle:
        for row in csv.DictReader(handle):
            points[str(row["id"])] = (float(row["lon"]), float(row["lat"]))
    graph, coordinates, graph_report = load_faf5_graph(Path(args.network_gdb))
    router = Faf5Router(graph, coordinates)
    network_fingerprint = graph_source_fingerprint(Path(args.network_gdb))
    output = Path(args.output)
    completed: set[tuple[str, str]] = set()
    if output.exists():
        with output.open() as handle:
            for line in handle:
                record = json.loads(line)
                completed.add((record["origin"], record["destination"]))
    with Path(args.od_csv).open() as source, output.open("a") as sink:
        for row in csv.DictReader(source):
            key = (str(row["origin"]), str(row["destination"]))
            if key in completed:
                continue
            path = router.route(*key, points)
            sink.write(json.dumps({
                **path.__dict__,
                "coordinates": path.coordinates,
                "network_source": FAF5_NETWORK_URL,
                "network_fingerprint": network_fingerprint,
                "network_build": graph_report,
            }, separators=(",", ":")) + "\n")
            sink.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
