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


def vmt_by_road_class(
    flows_by_class: Mapping[str, Mapping[int, float]],
    links: Iterable[Sequence[Any]],
    excluded_link_types: Sequence[str] = EXCLUDED_LINK_TYPES,
) -> dict[str, float]:
    """``{road class: vehicle-miles}`` over ``links`` = (link_id, link_type, distance_m).

    ================================================== WHY THIS IS WORTH HAVING

    Measured across 24 counties on 2026-08-17, the model puts **37% of its
    vehicle miles on principal arterials where FHWA's published figure is 21%,
    and 26% on freeways where the real share is 45%**. That comparison explains
    the road-class error pattern the count stations show, and it needs no counts
    at all — FHWA publishes VMT by functional system for every state, every
    year, so a study area anywhere in the country can be checked against it.

    Distinct from ``per_class_vmt`` above, which splits by TRAFFIC class
    (resident against external). This splits the same vehicle-miles by the kind
    of ROAD they were driven on, which is a different question with a different
    published benchmark.

    Centroid connectors are excluded for the same reason as everywhere else:
    they are modelling artifacts, not roads anybody drives on, and they carried
    8.3% of modelled vehicle-miles in the study counties.
    """
    excluded = set(excluded_link_types)
    totals: dict[str, float] = {}

    for link_id, link_type, distance in links:
        road_class = str(link_type or "").strip().lower()
        if not road_class or road_class in excluded:
            continue
        try:
            lid = int(link_id)
        except (TypeError, ValueError):
            continue
        distance_m = float(distance) if distance is not None else 0.0
        if distance_m <= 0:
            continue
        miles = distance_m / METERS_PER_MILE
        volume = 0.0
        for flows in flows_by_class.values():
            volume += float(flows.get(lid, 0.0) or 0.0)
        if volume <= 0:
            continue
        totals[road_class] = totals.get(road_class, 0.0) + volume * miles

    return totals


#: Road classes a screening model is not expected to load, and whose emptiness
#: is therefore not news. Everything else that carries nothing is a road the run
#: has no opinion about, and a planner is entitled to know how many there are.
UNSURPRISING_WHEN_EMPTY = ("service", "track", "path", "footway", "cycleway",
                           "steps", "pedestrian", "bridleway", "construction")


def network_coverage(
    volumes_by_link: Mapping[int, float],
    links: Iterable[Sequence[Any]],
    excluded_link_types: Sequence[str] = EXCLUDED_LINK_TYPES,
) -> dict[str, Any]:
    """How much of the road network this run actually put traffic on.

    ``links`` are (link_id, link_type, inside_fraction) — the caller does the
    geometry, so this stays pure arithmetic and testable without spatialite. A
    link is counted when any part of it lies inside the study area.

    ============================================ WHY A PLANNER NEEDS THIS

    Measured 2026-08-20 across eleven counties in four states: **77-85% of the
    links inside a study boundary carry no assigned traffic at all** — 3-7% of
    motorway and primary, 34-69% of collectors, 96-100% of residential and
    local streets (`docs/modeling/UNLOADED_LINK_COVERAGE_2026-08-20.md`).

    Travel moves centroid to centroid, so a connector loads a PATH rather than
    an area: even within a tenth of a mile of one, only 18.7% of minor links
    carry anything. Adding connectors does not fix it — tripling them with
    block-group zones bought 1.5 points.

    So this is a CLAIM BOUNDARY, not a defect. A road that received no traffic
    has no estimate, which is a different thing from a low estimate, and the
    product must not let a planner read the second when the first is true.

    Centroid connectors are excluded because they are not roads.
    """
    excluded = set(excluded_link_types)
    loaded: dict[str, int] = {}
    total: dict[str, int] = {}
    inside_links = 0
    inside_loaded = 0
    for link_id, link_type, inside_fraction in links:
        road_class = str(link_type or "").strip().lower()
        if not road_class or road_class in excluded:
            continue
        try:
            fraction = float(inside_fraction)
        except (TypeError, ValueError):
            continue
        if fraction <= 0:
            continue
        inside_links += 1
        total[road_class] = total.get(road_class, 0) + 1
        try:
            volume = float(volumes_by_link.get(int(link_id), 0.0) or 0.0)
        except (TypeError, ValueError):
            volume = 0.0
        if volume > 0:
            inside_loaded += 1
            loaded[road_class] = loaded.get(road_class, 0) + 1
    if not inside_links:
        return {"links_inside_study_area": 0, "measured": False}
    by_class = {
        road_class: {
            "links": count,
            "carrying_traffic": loaded.get(road_class, 0),
            "share_empty": round(1.0 - (loaded.get(road_class, 0) / count), 4),
        }
        for road_class, count in sorted(total.items())
    }
    notable = {
        road_class: stats for road_class, stats in by_class.items()
        if road_class not in UNSURPRISING_WHEN_EMPTY
    }
    return {
        "measured": True,
        "links_inside_study_area": inside_links,
        "links_carrying_traffic": inside_loaded,
        "share_carrying_traffic": round(inside_loaded / inside_links, 4),
        "share_empty": round(1.0 - (inside_loaded / inside_links), 4),
        "by_road_class": by_class,
        "worst_class_a_planner_would_ask_about": (
            max(notable.items(), key=lambda kv: kv[1]["share_empty"])[0] if notable else None
        ),
        "means": (
            "A road this run assigned no traffic to has NO estimate, which is not the same as a "
            "low one. The model puts travel on the paths between zone centroids, so most minor "
            "roads never receive any and no volume for them should be read off this run."
        ),
    }
