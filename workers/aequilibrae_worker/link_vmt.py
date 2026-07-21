#!/usr/bin/env python3
"""Per-class network VMT from an assignment's link_volumes.csv (M7, roadmap E).

The assignment runs two traffic classes — ``resident`` (internal auto demand)
and ``external`` (cordon-injected boundary trips + routed pass-through) — so
each class leaves its own flow columns on the loaded network. Summing
``flow × link length`` per class yields network-routed VMT with real routed
distances, which lets the worker report resident VMT separately from
through-traffic without the great-circle × circuity approximation.

Screening-grade: the resident/external split is exactly as good as the cordon
gateway assumptions that feed the external class. Centroid connectors are not
real roadway and are excluded, matching ``compute_daily_vmt``.

Stdlib-only on purpose so it is unit-testable without the geo/modeling stack.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

METERS_PER_MILE = 1609.34

EXCLUDED_LINK_TYPES = ("centroid_connector",)


def parse_link_flows(
    rows: Iterable[Mapping[str, Any]],
    flow_columns: Mapping[str, str],
) -> dict[str, dict[int, float]]:
    """Per-class ``{link_id: flow}`` from ``csv.DictReader`` rows.

    ``flow_columns`` maps a class name to its AequilibraE result column (e.g.
    ``{"resident": "resident_tot"}``). A class whose column is absent from the
    CSV is dropped from the result entirely — the caller can then tell "column
    missing" (older single-class run) apart from "all flows zero". Unparseable
    link ids or flow values are skipped, mirroring ``compute_daily_vmt``.
    """
    flows: dict[str, dict[int, float]] = {}
    seen_columns: set[str] = set()

    for row in rows:
        raw_id = row.get("link_id") or row.get("") or ""
        try:
            link_id = int(float(raw_id))
        except (TypeError, ValueError):
            continue
        for class_name, column in flow_columns.items():
            if column not in row:
                continue
            seen_columns.add(column)
            try:
                flow = float(row.get(column) or 0.0)
            except (TypeError, ValueError):
                continue
            if flow:
                flows.setdefault(class_name, {})[link_id] = flow

    # Classes whose column appeared (even if every value was 0) report {}.
    for class_name, column in flow_columns.items():
        if column in seen_columns:
            flows.setdefault(class_name, {})
    return flows


def per_class_vmt(
    flows_by_class: Mapping[str, Mapping[int, float]],
    links: Iterable[Sequence[Any]],
    excluded_link_types: Sequence[str] = EXCLUDED_LINK_TYPES,
) -> dict[str, float]:
    """``{class: vehicle-miles}`` over ``links`` = (link_id, link_type, distance_m).

    Links with excluded types (virtual centroid connectors) contribute nothing.
    A class present in ``flows_by_class`` always appears in the result, so an
    all-zero class reports ``0.0`` rather than vanishing.
    """
    excluded = set(excluded_link_types)
    vmt: dict[str, float] = {name: 0.0 for name in flows_by_class}

    for link_id, link_type, distance in links:
        if link_type in excluded:
            continue
        try:
            lid = int(link_id)
        except (TypeError, ValueError):
            continue
        distance_m = float(distance) if distance is not None else 0.0
        if distance_m <= 0:
            continue
        for class_name, class_flows in flows_by_class.items():
            flow = class_flows.get(lid)
            if flow:
                vmt[class_name] += flow * (distance_m / METERS_PER_MILE)
    return vmt
