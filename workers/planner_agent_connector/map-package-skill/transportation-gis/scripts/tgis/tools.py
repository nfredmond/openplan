"""Helpers for the steps before project.yaml exists: build a corridor line, look inside a data source."""
from __future__ import annotations

import heapq
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from . import fetch, vec


def _dist_m(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * math.cos(lat), a[1] - b[1]) * 111320.0


def _dijkstra(graph, start):
    dist, prev = {start: 0.0}, {}
    heap = [(0.0, start)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue
        for v, w in graph[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v], prev[v] = nd, u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def corridor(street, place, out_path, cache_dir, log=print):
    """One line along a named street inside a place, from OpenStreetMap, written as GeoJSON.

    Street segments in any road dataset are split at intersections and doubled where the
    street is divided. This walks the segment network and keeps the longest end-to-end
    path, so the result is a single line down one carriageway. Check it on a map before
    using it: it is a study-limits line for mapping, not a surveyed centreline.
    """
    cache = fetch.Cache(cache_dir)
    boundary = fetch.place_boundary(place, cache)
    w, s, e, n = vec.extent(boundary)
    dx, dy = (e - w) * 0.05, (n - s) * 0.05
    bbox = f"({s - dy:.5f},{w - dx:.5f},{n + dy:.5f},{e + dx:.5f})"
    safe = street.replace('"', "")
    query = f'[out:json][timeout:90];way["highway"]["name"="{safe}"]{bbox};out geom;'
    last = None
    for url in fetch.OVERPASS:
        try:
            js = fetch._get(url, data={"data": query}, timeout=120, tries=2).json()
            break
        except Exception as err:   # noqa: BLE001
            last = err
    else:
        raise RuntimeError(f"Overpass failed: {last}")
    ways = [el for el in js.get("elements", []) if el.get("type") == "way" and el.get("geometry")]
    if not ways:
        raise RuntimeError(f"OpenStreetMap has no street named {street!r} in {place}. Check the exact name (for example 'Main Street', not 'Main St').")
    graph = defaultdict(list)
    for wy in ways:
        pts = [(round(p["lon"], 7), round(p["lat"], 7)) for p in wy["geometry"]]
        for a, b in zip(pts, pts[1:]):
            d = _dist_m(a, b)
            graph[a].append((b, d))
            graph[b].append((a, d))
    # Largest connected piece: a second street of the same name elsewhere in town is dropped.
    seen, comps = set(), []
    for node in list(graph):
        if node in seen:
            continue
        comp, stack = [], [node]
        seen.add(node)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _ in graph[u]:
                if v not in seen:
                    seen.add(v); stack.append(v)
        comps.append(comp)
    comp = max(comps, key=lambda c: sum(d for u in c for _, d in graph[u]))
    # Two sweeps find the two ends that are farthest apart along the network.
    d0, _ = _dijkstra(graph, comp[0])
    a = max(comp, key=lambda u: d0.get(u, -1))
    d1, prev = _dijkstra(graph, a)
    b = max(comp, key=lambda u: d1.get(u, -1))
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    path.reverse()
    miles = d1[b] / 1609.344
    total = sum(d for u in comp for _, d in graph[u]) / 2 / 1609.344
    fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
        "name": street, "length_mi": round(miles, 2), "source": "OpenStreetMap contributors, line assembled by tgis corridor"},
        "geometry": {"type": "LineString", "coordinates": [list(p) for p in path]}}]}
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(fc), encoding="utf-8")
    log(f"Wrote {out_path}: {street}, {miles:.2f} miles, {len(path)} vertices, from {len(ways)} OpenStreetMap segments.")
    if total > miles * 1.25:
        log(f"Note: the segments total {total:.2f} miles, so parts of the street are divided or branch. The line follows one carriageway.")
    if len(comps) > 1:
        log(f"Note: {len(comps) - 1} disconnected piece(s) with the same name were left out.")
    log("Look at it on a map before relying on it. Trim it to the study limits if they are shorter than the whole street.")
    return out_path


def inspect(source, place=None, cache_dir=".", limit=2000, log=print):
    """Print what a file or ArcGIS REST layer holds: count, geometry, fields, and the values of likely class fields."""
    cache = fetch.Cache(cache_dir)
    if str(source).startswith("http"):
        bbox = None
        if place:
            bbox = list(vec.extent(fetch.place_boundary(place, cache)))
        feats, meta = fetch.arcgis_layer(source, cache, bbox4326=bbox, max_features=limit, name="inspect")
        log(f"Service layer: {meta.get('name')}  ({meta.get('geometryType')})")
        if meta.get("copyrightText"):
            log("Copyright text: " + " ".join(meta["copyrightText"].split())[:200])
        log(f"Features {'in ' + place if place else 'returned'}: {len(feats)}" + (" (stopped at the limit)" if len(feats) >= limit else ""))
    else:
        feats, epsg, _ = vec.read(source)
        log(f"File: {source}  CRS: {epsg}  features: {len(feats)}")
    if not feats:
        log("No features. Check the place, the URL and the layer number.")
        return
    kinds = Counter(vec.kind_of(g) for g, _ in feats)
    log("Geometry: " + ", ".join(f"{k} ({n})" for k, n in kinds.items()))
    fields = defaultdict(Counter)
    for _, p in feats:
        for k, v in p.items():
            fields[k][v] += 1
    log("")
    log(f"{'field':28} {'filled':>7}  values")
    for k, c in fields.items():
        filled = sum(n for v, n in c.items() if v not in (None, ""))
        distinct = [v for v in c if v not in (None, "")]
        if len(distinct) <= 12:
            vals = ", ".join(f"{v!r} ({c[v]})" for v in sorted(distinct, key=str))
        else:
            nums = [v for v in distinct if isinstance(v, (int, float))]
            vals = f"{len(distinct)} distinct" + (f", {min(nums):g} to {max(nums):g}" if len(nums) == len(distinct) else f", e.g. {str(distinct[0])[:40]!r}")
        log(f"{k[:28]:28} {filled:>7}  {vals[:150]}")
