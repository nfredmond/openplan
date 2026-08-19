"""Insert virtual centroids without colliding with physical network nodes."""

from __future__ import annotations

import math
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from typing import Any, TypeVar


class CentroidGeometryError(RuntimeError):
    pass


Candidate = TypeVar("Candidate", bound=Sequence[Any])


def candidates_on_routable_component(
    nearby_candidates: Iterable[Candidate],
    routable_node_ids: set[int],
    load_nearest_routable: Callable[[], list[Candidate]],
) -> tuple[list[Candidate], bool]:
    """Return nearby nodes on the routable component, searching it directly if needed.

    A fixed nearest-node pool is only a performance shortcut. In sparse or
    fragmented road networks, every node in that pool can belong to a small
    island even though the main routable component exists farther away. Falling
    back to the island produces a centroid that cannot skim to any other zone.

    The boolean records whether the direct component search was required so the
    resulting connector distance remains visible in run diagnostics.
    """
    eligible = [candidate for candidate in nearby_candidates if int(candidate[0]) in routable_node_ids]
    if eligible:
        return eligible, False
    return load_nearest_routable(), True


def insert_distinct_centroid(
    conn: Any,
    node_id: int,
    longitude: float,
    latitude: float,
) -> tuple[float, float, float]:
    """Insert a centroid, moving only its virtual node when a node occupies the point.

    AequilibraE's spatial trigger refuses two nodes at identical coordinates. Census
    representative points can legitimately coincide with an OSM node, so retry at a
    deterministic sub-metre offset. The zone's source coordinates remain unchanged;
    callers use the returned coordinates only for the virtual connector geometry.
    """
    candidates = [(longitude, latitude, 0.0)]
    cosine = max(abs(math.cos(math.radians(latitude))), 0.01)
    direction = (int(node_id) * 137.50776405003785) % 360
    for distance_m in (0.1, 0.5, 1.0, 5.0):
        angle = math.radians(direction + distance_m * 37)
        candidates.append((
            longitude + math.cos(angle) * distance_m / (111_320 * cosine),
            latitude + math.sin(angle) * distance_m / 110_574,
            distance_m,
        ))

    last_error: sqlite3.IntegrityError | None = None
    for lon, lat, distance_m in candidates:
        try:
            conn.execute(
                "INSERT INTO nodes (node_id, is_centroid, geometry) "
                "VALUES (?, 1, MakePoint(?, ?, 4326))",
                (node_id, lon, lat),
            )
            return lon, lat, distance_m
        except sqlite3.IntegrityError as exc:
            if "on-top of other node" not in str(exc):
                raise
            last_error = exc
    raise CentroidGeometryError(
        f"Could not place virtual centroid node {node_id} within 5 metres of its source point"
    ) from last_error
