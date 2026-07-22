#!/usr/bin/env python3
"""Screening-grade transit level-of-service from a static GTFS feed.

Parses a GTFS `.zip` (stdlib only — `zipfile` + `csv`, never unzipped to disk)
and builds a headway-based transit skim between zone centroids:

    generalized time = access-walk to nearest served stop
                     + wait (≈ headway/2 per boarding)
                     + scheduled in-vehicle time (from stop_times deltas)
                     + one optional same-stop transfer penalty
                     + egress-walk

A zone pair is transit-AVAILABLE only when both ends are within a walk-access
buffer of a served stop AND a direct-or-one-transfer scheduled itinerary exists
on the modeled service day. Everything else is transit share 0 by construction.

This is NOT a calibrated transit assignment, real-time, or a routing engine —
headways are approximated from the schedule (mean gap between consecutive
first-stop departures) and in-vehicle time is read from stop_times. A
frequencies.txt-based feed is rejected (GtfsError) rather than silently
mis-skimmed. It is a reproducible screening approximation for a small rural
feed. Keep it stdlib so
it is unit-testable with an in-memory fixture, no network, no heavy deps.

Bundled feed + provenance live in ``data/gtfs/``; `refresh_gtfs.py` refreshes it
off the run path. `GTFS_PATH` / `GTFS_URL` env vars override the bundled feed.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import os
import time
import zipfile
from typing import Any

import numpy as np

from resident_vmt import haversine_miles

GTFS_ACCESS_MILES = float(os.getenv("GTFS_ACCESS_MILES", "0.5"))
GTFS_TRANSFER_PENALTY_MIN = float(os.getenv("GTFS_TRANSFER_PENALTY_MIN", "5"))
GTFS_FLAT_FARE = float(os.getenv("GTFS_FLAT_FARE", "1.5"))
WALK_MPH = float(os.getenv("MODE_WALK_MPH", "3.0"))
# Headway to assume for a line with a single scheduled trip (no derivable span).
_SINGLE_TRIP_HEADWAY_MIN = 120.0
_DEFAULT_GTFS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gtfs", "nevada_county_gtfs.zip")


class GtfsError(RuntimeError):
    pass


def _parse_gtfs_time(value: str) -> int | None:
    """GTFS HH:MM:SS (hours may exceed 24) → seconds after midnight."""
    if not value:
        return None
    parts = value.strip().split(":")
    if len(parts) != 3:
        return None
    try:
        h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    return h * 3600 + m * 60 + s


def _read_csv(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    if name not in zf.namelist():
        return []
    with zf.open(name) as fh:
        text = io.TextIOWrapper(fh, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def _service_period(zf: zipfile.ZipFile) -> tuple[str | None, str | None]:
    """Feed service window (min start_date, max end_date) from calendar.txt."""
    starts, ends = [], []
    for row in _read_csv(zf, "calendar.txt"):
        if row.get("start_date"):
            starts.append(row["start_date"])
        if row.get("end_date"):
            ends.append(row["end_date"])
    return (min(starts) if starts else None, max(ends) if ends else None)


def _pick_service_ids(zf: zipfile.ZipFile, trip_counts: dict[str, int] | None = None) -> tuple[set[str], str]:
    """Choose the representative service day (the weekday with the most service).

    Ranks days by scheduled trip VOLUME (via `trip_counts`), falling back to the
    count of distinct service_ids. Prefers calendar.txt; falls back to
    calendar_dates.txt. Returns (active_service_ids, service_day_label).
    """
    weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    trip_counts = trip_counts or {}

    def _volume(services: set[str]) -> int:
        # Rank by scheduled trip VOLUME, not the count of distinct service_ids —
        # a day split across many small service_ids must not out-rank a busy day
        # with one id. Fall back to id-count when no trip counts are available.
        return sum(trip_counts.get(s, 0) for s in services) or len(services)

    calendar = _read_csv(zf, "calendar.txt")
    if calendar:
        best_day = None
        best_services: set[str] = set()
        best_vol = -1
        for day in weekdays + ["saturday", "sunday"]:
            svc = {row["service_id"] for row in calendar if str(row.get(day, "0")).strip() == "1"}
            vol = _volume(svc)
            if svc and (vol > best_vol or best_day is None):
                best_day, best_services, best_vol = day, svc, vol
        if best_services:
            return best_services, best_day or "weekday"
    # Fallback: calendar_dates — pick the date with the most scheduled service.
    cdates = _read_csv(zf, "calendar_dates.txt")
    by_date: dict[str, set[str]] = {}
    for row in cdates:
        if str(row.get("exception_type", "")).strip() == "1":  # service added
            by_date.setdefault(row.get("date", ""), set()).add(row.get("service_id", ""))
    if by_date:
        date_label = max(by_date, key=lambda d: _volume(by_date[d]))
        return by_date[date_label], f"date:{date_label}"
    return set(), "unknown"


class TransitLos:
    """Parsed feed reduced to per-line patterns for the headway skim."""

    def __init__(self) -> None:
        self.stops: dict[str, tuple[float, float]] = {}      # stop_id -> (lon, lat)
        self.lines: dict[tuple[str, str], dict[str, Any]] = {}  # (route_id,dir) -> pattern/cum/headway
        self.stop_lines: dict[str, set[tuple[str, str]]] = {}   # stop_id -> line keys
        self.service_day: str = "unknown"
        self.service_start: str | None = None
        self.service_end: str | None = None
        self.n_routes: int = 0
        self.n_stops: int = 0


def load_feed(path: str | None = None, url: str | None = None) -> TransitLos:
    """Load + reduce a GTFS feed to per-line transit patterns.

    Raises GtfsError on any structural problem so callers fail loudly rather than
    silently degrade to transit=0 while claiming transit is modeled.
    """
    url = url or os.getenv("GTFS_URL")
    path = path or os.getenv("GTFS_PATH") or _DEFAULT_GTFS_PATH

    raw: bytes
    if url:
        import requests  # lazy
        cache_dir = os.getenv("GTFS_CACHE_DIR", os.path.join(os.path.dirname(_DEFAULT_GTFS_PATH), ".gtfs_cache"))
        # Key the cache by URL — a single fixed filename would serve one place's
        # feed for another once per-place discovery is on (correctness bug).
        url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:16]
        cache_path = os.path.join(cache_dir, f"gtfs_feed_{url_hash}.zip")
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
            with open(cache_path, "rb") as fh:
                raw = fh.read()
        else:
            try:
                res = requests.get(url, timeout=120)
            except Exception as exc:
                raise GtfsError(f"GTFS download failed: {exc}") from exc
            if res.status_code != 200:
                raise GtfsError(f"GTFS download failed: HTTP {res.status_code}")
            raw = res.content
            os.makedirs(cache_dir, exist_ok=True)
            with open(cache_path, "wb") as fh:
                fh.write(raw)
    else:
        if not os.path.exists(path):
            raise GtfsError(f"GTFS feed not found at {path}")
        with open(path, "rb") as fh:
            raw = fh.read()

    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise GtfsError(f"GTFS zip is corrupt: {exc}") from exc

    los = TransitLos()
    with zf:
        # Reject frequency-based feeds rather than silently mis-skim them — the
        # headway estimator reads scheduled stop_times, not frequencies windows.
        if _read_csv(zf, "frequencies.txt"):
            raise GtfsError(
                "frequencies.txt-based GTFS is not supported by the headway skim; "
                "supply a stop_times-scheduled feed."
            )

        for row in _read_csv(zf, "stops.txt"):
            try:
                los.stops[row["stop_id"]] = (float(row["stop_lon"]), float(row["stop_lat"]))
            except (KeyError, ValueError, TypeError):
                continue
        if not los.stops:
            raise GtfsError("GTFS feed has no usable stops")

        los.service_start, los.service_end = _service_period(zf)

        # Read trips once: service→trip counts (to rank the service day by
        # volume) and, for the chosen day, trip_id -> (route_id, direction_id).
        all_trips = _read_csv(zf, "trips.txt")
        service_trip_counts: dict[str, int] = {}
        for row in all_trips:
            sid = row.get("service_id", "")
            service_trip_counts[sid] = service_trip_counts.get(sid, 0) + 1
        active_services, los.service_day = _pick_service_ids(zf, service_trip_counts)

        trip_line: dict[str, tuple[str, str]] = {}
        for row in all_trips:
            if active_services and row.get("service_id") not in active_services:
                continue
            route = row.get("route_id", "")
            direction = str(row.get("direction_id", "0") or "0")
            trip_line[row["trip_id"]] = (route, direction)

        # group stop_times by trip (ordered by stop_sequence)
        trip_stops: dict[str, list[tuple[int, str, int]]] = {}  # trip -> [(seq, stop_id, dep_sec)]
        for row in _read_csv(zf, "stop_times.txt"):
            tid = row.get("trip_id")
            if tid not in trip_line:
                continue
            dep = _parse_gtfs_time(row.get("departure_time", "") or row.get("arrival_time", ""))
            if dep is None:
                continue
            try:
                seq = int(row.get("stop_sequence", "0"))
            except (TypeError, ValueError):
                seq = 0
            trip_stops.setdefault(tid, []).append((seq, row.get("stop_id", ""), dep))

        # per line: canonical pattern (longest trip), cum seconds, headway from span/trips
        line_trip_first_last: dict[tuple[str, str], list[tuple[int, int]]] = {}
        line_best_pattern: dict[tuple[str, str], list[tuple[str, int]]] = {}  # ordered [(stop, dep_sec)]
        for tid, stops in trip_stops.items():
            key = trip_line[tid]
            stops = sorted(stops, key=lambda x: x[0])
            if len(stops) < 2:
                continue
            first_dep, last_dep = stops[0][2], stops[-1][2]
            line_trip_first_last.setdefault(key, []).append((first_dep, last_dep))
            pattern = [(sid, dep) for _seq, sid, dep in stops]
            if key not in line_best_pattern or len(pattern) > len(line_best_pattern[key]):
                line_best_pattern[key] = pattern

        for key, pattern in line_best_pattern.items():
            base = pattern[0][1]
            # First occurrence of each stop is its boarding offset. Loop /
            # out-and-back patterns revisit stops; keep the EARLIEST offset so a
            # hub visited at the start isn't collapsed to its later pass-through.
            cum: dict[str, int] = {}
            for sid, dep in pattern:
                if sid not in cum:
                    cum[sid] = dep - base
            # Headway = mean gap between consecutive FIRST-STOP departures
            # (N−1 gaps). NOT span/N, and NOT arrival-inclusive — either would
            # fold one-way run time into the headway and OVER-credit transit.
            first_deps = sorted(x[0] for x in line_trip_first_last.get(key, []))
            n_trips = len(first_deps)
            if n_trips >= 2:
                headway_min = max((first_deps[-1] - first_deps[0]) / 60.0 / (n_trips - 1), 1.0)
            else:
                headway_min = _SINGLE_TRIP_HEADWAY_MIN
            los.lines[key] = {"cum": cum, "headway_min": headway_min, "n_trips": n_trips}
            for sid in cum:
                los.stop_lines.setdefault(sid, set()).add(key)

        los.n_routes = len({k[0] for k in los.lines})
        los.n_stops = len(los.stop_lines)
        if not los.lines:
            raise GtfsError("GTFS feed produced no usable transit lines on the modeled service day")
    return los


# --- Dynamic per-place GTFS discovery (keyless Mobility Database catalog) -----

# MobilityData's published aggregate catalog CSV (keyless, ~3k feeds). Columns
# include data_type, urls.latest / urls.direct_download, and
# location.bounding_box.{minimum,maximum}_{latitude,longitude}.
_MDB_CATALOG_URL = os.getenv("GTFS_CATALOG_URL", "https://bit.ly/catalogs-csv")
_CATALOG_CACHE_TTL_S = int(os.getenv("GTFS_CATALOG_TTL_S", str(7 * 24 * 3600)))


def _load_catalog() -> list[dict[str, Any]]:
    """Fetch + TTL-cache the keyless MobilityDB catalog CSV as a list of rows."""
    cache_dir = os.getenv("GTFS_CACHE_DIR", os.path.join(os.path.dirname(_DEFAULT_GTFS_PATH), ".gtfs_cache"))
    cache_path = os.path.join(cache_dir, "mobilitydb_catalog.csv")

    raw: str | None = None
    if (
        os.path.exists(cache_path)
        and os.path.getsize(cache_path) > 0
        and (time.time() - os.path.getmtime(cache_path)) < _CATALOG_CACHE_TTL_S
    ):
        with open(cache_path, "r", encoding="utf-8") as fh:
            raw = fh.read()

    if raw is None:
        import requests  # lazy
        res = requests.get(_MDB_CATALOG_URL, timeout=60, allow_redirects=True)
        if res.status_code != 200:
            raise GtfsError(f"MobilityDB catalog download failed: HTTP {res.status_code}")
        raw = res.text
        os.makedirs(cache_dir, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as fh:
            fh.write(raw)

    return list(csv.DictReader(io.StringIO(raw)))


def select_feed_from_catalog(
    rows: list[dict[str, Any]], bbox: tuple[float, float, float, float]
) -> str | None:
    """Pure feed selection: among scheduled GTFS feeds whose bbox intersects the
    study-area bbox, prefer the smallest (most local) then closest, and return
    its URL (MobilityData-hosted `urls.latest` preferred over the producer's
    `urls.direct_download`). Returns None when nothing covers the area."""
    min_lon, min_lat, max_lon, max_lat = bbox
    s_cx, s_cy = (min_lon + max_lon) / 2.0, (min_lat + max_lat) / 2.0

    candidates: list[tuple[float, float, str]] = []
    for row in rows:
        if (row.get("data_type") or "").strip().lower() != "gtfs":
            continue
        # OpenPlan is US-focused; skip feeds with a known non-US country.
        country = (row.get("location.country_code") or "").strip().upper()
        if country and country != "US":
            continue
        try:
            f_min_lat = float(row["location.bounding_box.minimum_latitude"])
            f_max_lat = float(row["location.bounding_box.maximum_latitude"])
            f_min_lon = float(row["location.bounding_box.minimum_longitude"])
            f_max_lon = float(row["location.bounding_box.maximum_longitude"])
        except (KeyError, ValueError, TypeError):
            continue
        # Reject corrupt near-worldwide bboxes (some upstream catalog rows span
        # most of the globe) — no real transit feed spans >100° in a dimension.
        if (f_max_lon - f_min_lon) > 100.0 or (f_max_lat - f_min_lat) > 100.0:
            continue
        # Reject non-overlapping bboxes.
        if f_min_lon > max_lon or f_max_lon < min_lon or f_min_lat > max_lat or f_max_lat < min_lat:
            continue
        url = ((row.get("urls.latest") or row.get("urls.direct_download")) or "").strip()
        if not url:
            continue
        area = max(0.0, (f_max_lon - f_min_lon)) * max(0.0, (f_max_lat - f_min_lat))
        f_cx, f_cy = (f_min_lon + f_max_lon) / 2.0, (f_min_lat + f_max_lat) / 2.0
        dist2 = (f_cx - s_cx) ** 2 + (f_cy - s_cy) ** 2
        candidates.append((area, dist2, url))

    if not candidates:
        return None
    candidates.sort(key=lambda c: (c[0], c[1]))  # smallest bbox, then closest centroid
    return candidates[0][2]


def discover_feed(bbox: tuple[float, float, float, float]) -> str | None:
    """Discover a scheduled GTFS feed URL covering the study-area bbox from the
    keyless MobilityDB catalog, or None. Best-effort: any failure → None so the
    caller degrades to the honest no_local_feed state."""
    try:
        rows = _load_catalog()
    except Exception:
        return None
    return select_feed_from_catalog(rows, bbox)


def feed_covers(los: TransitLos, lons, lats, buffer_miles: float | None = None) -> bool:
    """True if any served stop lies within the study-area extent (the bbox of the
    zone centroids, padded by the walk-access buffer).

    Guards against skimming a bundled feed that does not cover the study area:
    a Nevada-County feed used for, say, a Texas run would find no served stops and
    return a 0 transit share — but with a misleading transit_status of "modeled".
    When this returns False the caller reports transit as not modeled ("no_local_feed")
    instead of pretending a covering feed was applied.
    """
    if not los.stops or len(lons) == 0 or len(lats) == 0:
        return False

    buf = GTFS_ACCESS_MILES if buffer_miles is None else buffer_miles
    min_lon, max_lon = float(min(lons)), float(max(lons))
    min_lat, max_lat = float(min(lats)), float(max(lats))
    mid_lat = (min_lat + max_lat) / 2.0

    # Degree padding for the access buffer: ~69 mi per degree of latitude,
    # scaled by cos(latitude) for longitude.
    pad_lat = buf / 69.0
    pad_lon = buf / max(69.0 * math.cos(math.radians(mid_lat)), 1e-6)
    lo_lon, hi_lon = min_lon - pad_lon, max_lon + pad_lon
    lo_lat, hi_lat = min_lat - pad_lat, max_lat + pad_lat

    for slon, slat in los.stops.values():
        if lo_lon <= slon <= hi_lon and lo_lat <= slat <= hi_lat:
            return True
    return False


def _access_stops(lon: float, lat: float, los: TransitLos) -> list[tuple[str, float]]:
    """Served stops within the walk-access buffer, as (stop_id, walk_minutes)."""
    out = []
    for sid in los.stop_lines:
        slon, slat = los.stops[sid]
        d = haversine_miles(lon, lat, slon, slat)
        if d <= GTFS_ACCESS_MILES:
            out.append((sid, d / WALK_MPH * 60.0))
    return out


def transit_skim(los: TransitLos, lons: np.ndarray, lats: np.ndarray) -> dict[str, np.ndarray]:
    """Per-OD transit LOS matrices from the reduced feed.

    Returns {ivtt, wait, walk, fare, available} (n×n). `available` is False for
    any pair without a walk-access served stop at both ends and a direct or
    one-(same-stop)-transfer scheduled itinerary — those pairs are transit 0.
    """
    n = len(lons)
    ivtt = np.zeros((n, n))
    wait = np.zeros((n, n))
    walk = np.zeros((n, n))
    fare = np.zeros((n, n))
    available = np.zeros((n, n), dtype=bool)

    access = [_access_stops(float(lons[i]), float(lats[i]), los) for i in range(n)]
    lines = los.lines

    for i in range(n):
        if not access[i]:
            continue
        for j in range(n):
            if i == j or not access[j]:
                continue  # intrazonal transit unavailable (conservative)
            best = None  # (cost, ivtt, wait, walk)
            for a_sid, a_walk in access[i]:
                a_lines = los.stop_lines.get(a_sid, ())
                for b_sid, b_walk in access[j]:
                    b_lines = los.stop_lines.get(b_sid, ())
                    # DIRECT: a line serving a (before) b
                    for lk in a_lines & b_lines:
                        cum = lines[lk]["cum"]
                        if cum[b_sid] > cum[a_sid]:
                            iv = (cum[b_sid] - cum[a_sid]) / 60.0
                            wt = lines[lk]["headway_min"] / 2.0
                            cost = a_walk + wt + iv + b_walk
                            if best is None or cost < best[0]:
                                best = (cost, iv, wt, a_walk + b_walk)
                    # ONE TRANSFER (same stop t on lineA and lineB)
                    for la in a_lines:
                        cum_a = lines[la]["cum"]
                        if a_sid not in cum_a:
                            continue
                        for t_sid in cum_a:
                            if cum_a[t_sid] <= cum_a[a_sid]:
                                continue
                            for lb in los.stop_lines.get(t_sid, ()):
                                if lb == la or b_sid not in lines[lb]["cum"]:
                                    continue
                                cum_b = lines[lb]["cum"]
                                if t_sid not in cum_b or cum_b[b_sid] <= cum_b[t_sid]:
                                    continue
                                iv = (cum_a[t_sid] - cum_a[a_sid]) / 60.0 + (cum_b[b_sid] - cum_b[t_sid]) / 60.0
                                wt = lines[la]["headway_min"] / 2.0 + lines[lb]["headway_min"] / 2.0
                                cost = a_walk + wt + iv + GTFS_TRANSFER_PENALTY_MIN + b_walk
                                if best is None or cost < best[0]:
                                    best = (cost, iv, wt, a_walk + b_walk)
            if best is not None:
                available[i, j] = True
                ivtt[i, j] = best[1]
                wait[i, j] = best[2]
                walk[i, j] = best[3]
                fare[i, j] = GTFS_FLAT_FARE
    return {"ivtt": ivtt, "wait": wait, "walk": walk, "fare": fare, "available": available}
