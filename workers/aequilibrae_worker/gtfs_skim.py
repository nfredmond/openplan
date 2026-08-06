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
first-stop departures) and in-vehicle time is read from stop_times. It is a
reproducible screening approximation for a small rural feed. Keep it stdlib so
it is unit-testable with an in-memory fixture, no network, no heavy deps.

FREQUENCY-BASED TRIPS ARE EXCLUDED, NOT THE FEEDS THAT CARRY THEM. This module
used to raise GtfsError the moment `frequencies.txt` existed at all. That
over-refused by a wide margin, and the margin was measured: of 16 sampled US
feeds, 7 ship the file, SIX of those seven ship it with a header row and no data
at all, and the seventh carries 4 rows covering 2 of its 18,150 trips. A blanket
refusal cost that 18,150-trip agency its entire feed over two trips, and cost six
more agencies their feeds over an empty file. OpenPlan's own ingest parser
(`src/lib/gtfs/parse.ts`) never refused them, so the worker was also refusing
feeds a planner had already successfully ingested.

What is actually unskimmable is a TRIP whose stop_times are a template to be
repeated on a published headway band rather than real departures — the headway
estimator reads first-stop departure times, so such a trip would contribute a
fabricated gap. So each trip named in `frequencies.txt` is dropped from the
skim and counted (`TransitLos.frequency_trips_excluded`), and the refusal fires
only when dropping them leaves NO scheduled service on the modeled day — which
is the honest case, and is reported as `GtfsFrequencyOnly` so the caller can say
so specifically.

Bundled feed + provenance live in ``data/gtfs/``; `refresh_gtfs.py` refreshes it
off the run path. A per-run WORKSPACE FEED SELECTION outranks everything (see
`plan_feed`), `GTFS_PATH` / `GTFS_URL` env vars override the bundled feed,
`GTFS_DISCOVER` switches per-place discovery off (see `discovery_enabled`), and
`GTFS_STAGE_BUDGET_S` bounds the transit stage — cooperatively, at the checkpoints
`check_deadline` is called from (per zone inside `transit_skim`, and once the feed
has been read). A stalled HTTP transfer is bounded by `requests`' own per-read
timeout, not by this budget, so a server dripping bytes can still outlast it; the
budget then aborts at the next checkpoint rather than at the moment it expires.
"""
from __future__ import annotations

import csv
import datetime
import hashlib
import io
import math
import os
import re
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

# Wall-clock budget for the transit stage — feed download plus skim — in seconds.
# NOT a size threshold: nothing here inspects how big a feed is or refuses one for
# being large. It is a bound on how long a single run may spend before it gives up
# and says so. The worker runs its stages serially inside one queued job, so an
# unbounded transit stage (a slow-drip download, or a dense multi-operator feed
# skimmed against thousands of zones) does not merely delay its own run — it stalls
# every run queued behind it, with nothing anywhere saying why. Exceeding the budget
# abandons transit under a named reason that reaches the evidence panel; it never
# yields a partial skim, because a skim cut off part-way would understate transit
# for whichever zones happened to come last.
#
# It is COOPERATIVE, not pre-emptive: it can only stop the stage where
# `check_deadline` is called. The skim is checked per zone, so that part is bounded
# tightly; a download is only checked once it has finished, so a slow-drip transfer
# is bounded by `requests`' per-read timeout instead, and can overrun this budget.
# Do not read the default below as a guaranteed ceiling on stage duration.
_DEFAULT_STAGE_BUDGET_S = 600.0


def _stage_budget_seconds() -> float:
    """Operator budget for the transit stage; <= 0 means no bound at all.

    An unparseable value falls back to the default rather than killing the run —
    a typo in one optional env var must not cost a planner their whole model run,
    and the default is the conservative choice (bounded, not unbounded).
    """
    raw = (os.getenv("GTFS_STAGE_BUDGET_S") or "").strip()
    if not raw:
        return _DEFAULT_STAGE_BUDGET_S
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_STAGE_BUDGET_S


GTFS_STAGE_BUDGET_S = _stage_budget_seconds()


class GtfsError(RuntimeError):
    pass


class GtfsFrequencyOnly(GtfsError):
    """Every trip on the modeled service day is frequency-based, so nothing is skimmable.

    A distinct type because it is the ONE frequencies outcome that is a real
    refusal. A feed that merely CONTAINS `frequencies.txt` is skimmed from its
    scheduled trips with the frequency-based ones excluded and counted; this
    fires only when that leaves nothing at all. The caller needs to tell the two
    apart, because "your agency publishes headway bands instead of timetables"
    and "your feed could not be read" send a planner to different places.
    """


class SelectedFeedError(GtfsError):
    """The workspace transit feed this run NAMED could not be used.

    Carries the machine-readable `no_feed_reason` the evidence panel prints, so
    the specific cause — no such version, not ready, bytes never stored, checksum
    mismatch, no stops in the study area — survives the generic
    `except GtfsError` in the worker instead of being flattened into
    "feed_load_failed".

    IT MUST NEVER TRIGGER A FALLBACK. A run whose planner picked a feed and got
    some OTHER feed skimmed would carry a KPI provenance sentence naming the feed
    they picked while the numbers came from a different one — the one failure mode
    worse than having no transit at all, because it manufactures corroboration.
    """

    def __init__(self, no_feed_reason: str, message: str) -> None:
        super().__init__(message)
        self.no_feed_reason = no_feed_reason


class GtfsTimeout(GtfsError):
    """The transit stage exceeded its wall-clock budget and was abandoned.

    A subclass of GtfsError so every existing `except GtfsError` still degrades to
    "transit not modeled" rather than killing the run — but a distinct type so the
    caller can report the REAL reason. "We ran out of time" and "your feed could not
    be read" send a planner to entirely different places, and only one of them is
    something their transit agency can fix.
    """


def stage_deadline(budget_s: float | None = None) -> float | None:
    """Monotonic instant after which the transit stage gives up, or None for unbounded.

    Monotonic rather than wall-clock time so a clock adjustment mid-run cannot
    hand a run an accidental extension — or abort one that had time left.
    """
    budget = GTFS_STAGE_BUDGET_S if budget_s is None else budget_s
    if budget <= 0:
        return None
    return time.monotonic() + budget


def check_deadline(deadline: float | None, phase: str) -> None:
    """Abandon the transit stage if its budget is gone. `phase` names what was
    running, so the refusal states what actually ran long instead of a bare
    "timed out"."""
    if deadline is not None and time.monotonic() > deadline:
        raise GtfsTimeout(f"the transit stage ran out of its wall-clock budget while {phase}")


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
        # How the modeled day's trips were EXPRESSED in the source. Mirrors the
        # `frequency_trip_count` / `scheduled_trip_count` columns the app's own
        # ingest records, and exists for the same reason: a headway derived from a
        # published frequency BAND and one measured between real departures are
        # different kinds of number, and a surface that cannot tell them apart
        # will present them identically. Frequency-based trips are excluded from
        # the skim, so this is a count of what was LEFT OUT, not of what was used.
        self.frequency_trips_excluded: int = 0
        self.scheduled_trips_used: int = 0
        # WHICH feed this is. The loader is the only place that knows whether the
        # bytes came off the network or off disk, so it records that here rather
        # than leaving every caller to re-derive it from the env vars it passed
        # in. A planner defending a VMT number has to be able to name the feed;
        # exactly one of these is set on a successfully loaded feed.
        self.source_url: str | None = None   # remote feed URL, when fetched
        self.source_name: str | None = None  # feed file name, when read from disk


def load_feed(
    path: str | None = None,
    url: str | None = None,
    *,
    raw: bytes | None = None,
    source_url: str | None = None,
    source_name: str | None = None,
) -> TransitLos:
    """Load + reduce a GTFS feed to per-line transit patterns.

    Raises GtfsError on any structural problem so callers fail loudly rather than
    silently degrade to transit=0 while claiming transit is modeled.

    `raw` hands over BYTES THAT HAVE ALREADY BEEN OBTAINED, which is how a run
    that named a workspace feed version is skimmed: the caller reads the exact
    archive OpenPlan parsed out of private storage and verifies its checksum
    before calling here, so this function does no network work and cannot reach
    for a different copy. `source_url` / `source_name` then carry the provenance,
    because bytes in hand know nothing about where they came from. Neither the
    `url` cache nor `GTFS_URL` / `GTFS_PATH` is consulted on that path — a
    refetch of `source_url` could return bytes the operator republished since,
    and the run would cite a URL for numbers those bytes never produced.
    """
    supplied_bytes = raw is not None
    if not supplied_bytes:
        url = url or os.getenv("GTFS_URL")
        path = path or os.getenv("GTFS_PATH") or _DEFAULT_GTFS_PATH

    if supplied_bytes:
        # Nothing to fetch and nothing to resolve. Deliberately not a `url`
        # branch: routing supplied bytes through the URL cache would key them by
        # a URL nobody downloaded, and the next run for that URL would be served
        # one workspace's stored archive.
        pass
    elif url:
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
    # Record the feed's identity before parsing so the caller can name it in the
    # evidence packet. Only the file NAME of a local feed is kept — the absolute
    # path is the operator's server layout, not planning provenance.
    if supplied_bytes:
        los.source_url = source_url
        los.source_name = source_name
    elif url:
        los.source_url = url
    else:
        los.source_name = os.path.basename(path)
    with zf:
        # Trips whose stop_times are a TEMPLATE for a published headway band
        # rather than real departures. They are dropped from the skim below (the
        # headway estimator reads first-stop departure times, which such a trip
        # does not have), but their presence is NOT a reason to refuse the feed —
        # see the module docstring for the measurement that settled that.
        frequency_trip_ids = {
            (row.get("trip_id") or "").strip()
            for row in _read_csv(zf, "frequencies.txt")
            if (row.get("trip_id") or "").strip()
        }

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
            # Frequency-based trips are excluded from the VOLUME ranking too, not
            # only from the skim. Counting them would let a day whose service is
            # published as headway bands out-rank a day with real timetabled
            # departures, and the winner would then contribute nothing — a feed
            # with usable service on Tuesday reporting no lines at all because
            # Monday had more frequency entries.
            if (row.get("trip_id") or "").strip() in frequency_trip_ids:
                continue
            sid = row.get("service_id", "")
            service_trip_counts[sid] = service_trip_counts.get(sid, 0) + 1
        active_services, los.service_day = _pick_service_ids(zf, service_trip_counts)

        trip_line: dict[str, tuple[str, str]] = {}
        for row in all_trips:
            if active_services and row.get("service_id") not in active_services:
                continue
            if (row.get("trip_id") or "").strip() in frequency_trip_ids:
                los.frequency_trips_excluded += 1
                continue
            route = row.get("route_id", "")
            direction = str(row.get("direction_id", "0") or "0")
            trip_line[row["trip_id"]] = (route, direction)
        los.scheduled_trips_used = len(trip_line)

        # The ONE honest frequencies refusal: dropping the frequency-based trips
        # left nothing to skim on the modeled day. Raised as its own type so the
        # worker can say "this agency publishes headway bands, not a timetable"
        # instead of the generic "your feed could not be read" — different
        # sentences, and only one of them is something the agency can act on.
        if not trip_line and los.frequency_trips_excluded:
            raise GtfsFrequencyOnly(
                "every trip on this feed's modeled service day is defined by frequencies.txt "
                f"({los.frequency_trips_excluded} trip(s)), so it publishes headway bands rather "
                "than scheduled departure times. The headway skim reads scheduled stop_times and "
                "has nothing to measure here."
            )

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

        # A stop_id can be referenced by stop_times.txt while stops.txt never
        # defines it, or defines it with unparseable coordinates. Such a stop
        # cannot be boarded or alighted at — we do not know where it is — so it
        # is not a SERVED stop. It stays in each line's `cum` (it is still a
        # timing point along the pattern, and the in-vehicle times either side of
        # it are correct), but it leaves `stop_lines`. Before this, the walk-access
        # search looked its coordinates up and raised a bare KeyError, which the
        # worker caught as "the feed could not be read" and the run lost its
        # transit share entirely — for a feed that was otherwise perfectly usable.
        # Dangling references are common enough in published feeds that this is
        # the ordinary case, not a pathological one.
        for sid in [s for s in los.stop_lines if s not in los.stops]:
            del los.stop_lines[sid]

        los.n_routes = len({k[0] for k in los.lines})
        los.n_stops = len(los.stop_lines)
        if not los.lines:
            raise GtfsError("GTFS feed produced no usable transit lines on the modeled service day")
    return los


# --- Dynamic per-place GTFS discovery (keyless Mobility Database catalog) -----

# MobilityData's published aggregate catalog CSV (keyless, ~3.4k rows). Columns
# include data_type, status, redirect.id, urls.latest / urls.direct_download, and
# location.bounding_box.{minimum,maximum}_{latitude,longitude}.
#
# THE CANONICAL ADDRESS, PINNED — NOT the `https://bit.ly/catalogs-csv` shortlink
# this used to carry. A shortlink is a third party who can silently repoint every
# deployment's feed catalog at once, and the first thing any deployment does with
# the result is FETCH THE URLS IN IT. That is not an acceptable dependency for a
# file whose contents become outbound requests. The redirect target is the same
# Google Cloud Storage object named here; pinning it removes the middleman
# without changing what is downloaded. (Verified live 2026-08-05: HTTP 200,
# 1,154,557 bytes, 3,434 rows.) `src/lib/gtfs/catalog.ts` pins the same address
# for the same reason.
_MDB_CATALOG_URL = os.getenv(
    "GTFS_CATALOG_URL",
    "https://storage.googleapis.com/storage/v1/b/mdb-csv/o/sources.csv?alt=media",
)
_CATALOG_CACHE_TTL_S = int(os.getenv("GTFS_CATALOG_TTL_S", str(7 * 24 * 3600)))

# Values an operator may plausibly write to mean "off". Matched case-insensitively
# because this is the documented escape hatch: silently ignoring `GTFS_DISCOVER=FALSE`
# would keep making outbound catalog requests from a deployment that asked us to stop.
#
# An EMPTY value is deliberately NOT in this list. Several hosting platforms
# materialize a variable that was never given a value as an empty string, so
# treating "" as "off" would let a deployment that made no choice at all silently
# lose per-place discovery — reinstating exactly the defect this default fixes —
# and the evidence panel would then present it as a deliberate operator decision.
# Empty or whitespace-only means UNSET; only an explicit falsy word turns it off.
_OFF_VALUES = ("0", "false", "no", "off")


def discovery_enabled(env_value: str | None = None) -> bool:
    """Whether per-place feed discovery runs for a study area. DEFAULT: ON.

    Pass the raw `GTFS_DISCOVER` value (`None` when the variable is unset) — the
    rule is a pure function of that string so the default can be pinned by a test
    without mutating the process environment.

    Why on by default: the feed bundled in ``data/gtfs/`` covers exactly one
    county, so with discovery off every OTHER study area loaded that feed, failed
    `feed_covers()`, and reported a transit share of exactly 0. That is not a
    harmless omission — ``mode_choice`` documents that leaving transit out
    OVERSTATES the auto share and INFLATES VMT, which is the number a planner
    defends. Looking for the local feed makes screening VMT more defensible
    everywhere, not merely richer.

    Why an OFF switch still exists: a deployment with no outbound network (or an
    operator who wants byte-identical reruns against a pinned feed) needs a way
    to stop the catalog fetch. Turning it off only removes a chance to find real
    service — discovery is already best-effort, and neither of its two failure
    modes invents a fact: a catalog that answered and listed nothing covering the
    area degrades to `no_local_feed`, a catalog we could not read falls back to
    the bundled feed under `feed_covers()` and reports the discovery failure, and
    neither skims an unrelated feed.

    Why empty is not off: an operator who wants discovery off has to SAY so. See
    `_OFF_VALUES` — a hosting platform handing us an empty string for a variable
    nobody set is not a decision, and must not be recorded as one.
    """
    if env_value is None or not env_value.strip():
        return True
    return env_value.strip().lower() not in _OFF_VALUES


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


# Catalog `status` values meaning "this entry has been withdrawn". A DENY-LIST,
# and that direction is load-bearing: measured against the live catalog on
# 2026-08-05, only **54 of 1,177** US rows carry `status = 'active'` while 770
# are BLANK. An allow-list on "active" would therefore discard 93.5% of the
# usable US feeds — including Roseville and Yolobus, which are perfectly good
# published feeds that simply do not set the column. Blank means USABLE.
#
# A status nobody has seen yet also falls through to USABLE, which is the
# direction this has to fail in: showing a planner a feed that turns out to be
# odd is recoverable, silently hiding their own operator is not.
_WITHDRAWN_CATALOG_STATUSES = frozenset({"deprecated", "inactive"})

# How many `redirect.id` hops to follow before giving up. Chains genuinely exist
# upstream: 20 of the 244 US rows carrying a redirect point at a row that itself
# redirects.
#
# TWO INDEPENDENT STOPS, and the honest note is that only ONE of them is proven
# by a test. This cap is what `test_a_redirect_cycle_terminates_instead_of_
# hanging` actually exercises — with the visited-set removed, a two-row cycle
# still terminates here after eight hops and returns the same answer, so that
# test does NOT distinguish the two mechanisms. It was written believing it did;
# a mutation showed otherwise.
#
# The visited-set is kept anyway, as defence in depth rather than as decoration:
# it bounds the walk by the CYCLE's length instead of by this constant, so a
# future maintainer who raises the cap — or drops it, thinking the set covers
# termination — does not turn a cycle into real work. Neither is load-bearing
# alone; the set is the one that stays correct when the cap changes.
_MAX_CATALOG_REDIRECT_HOPS = 8


def _is_withdrawn(row: dict[str, Any]) -> bool:
    return (row.get("status") or "").strip().lower() in _WITHDRAWN_CATALOG_STATUSES


def select_feed_from_catalog(
    rows: list[dict[str, Any]], bbox: tuple[float, float, float, float]
) -> str | None:
    """Pure feed selection: among scheduled GTFS feeds whose bbox intersects the
    study-area bbox, prefer the smallest (most local) then closest, and return
    its URL (MobilityData-hosted `urls.latest` preferred over the producer's
    `urls.direct_download`). Returns None when nothing covers the area.

    WITHDRAWN ENTRIES ARE EXCLUDED, and this is not a refinement — it was a
    defect with a mechanism. This function prefers the SMALLEST bounding box,
    which is exactly the shape of a superseded single-agency row: when an
    agency's feed is replaced, the old narrow entry stays in the catalog marked
    `deprecated` beside its broader replacement, so "smallest wins" actively
    SELECTS FOR the dead one. Measured on the live catalog: 344 of 1,177 US
    rows (29.3%) are deprecated or inactive.

    A withdrawn entry usually names its successor in `redirect.id`, so rather
    than dropping it this follows the pointer — that is how a study area whose
    only local feed was replaced still gets an answer instead of a false
    `no_covering_feed`. The walk is bounded and cycle-checked: of 244 US rows
    carrying a redirect, 41 point at an id that is not in the catalog at all and
    20 point at a row that itself redirects.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    s_cx, s_cy = (min_lon + max_lon) / 2.0, (min_lat + max_lat) / 2.0

    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_id = (row.get("mdb_source_id") or "").strip()
        if row_id:
            by_id[row_id] = row

    candidates: list[tuple[float, float, str]] = []
    for row in rows:
        if (row.get("data_type") or "").strip().lower() != "gtfs":
            continue

        # Follow a withdrawn entry to its replacement rather than dropping it.
        # The GEOGRAPHY is still tested against the ORIGINAL row's bbox below:
        # the withdrawn entry is what the catalog says covers this area, and a
        # successor may legitimately be drawn wider (a regional authority taking
        # over a city's feed). Testing the successor's box instead would lose
        # exactly the local match this walk exists to preserve.
        if _is_withdrawn(row):
            seen = {(row.get("mdb_source_id") or "").strip()}
            successor = row
            for _ in range(_MAX_CATALOG_REDIRECT_HOPS):
                next_id = (successor.get("redirect.id") or "").strip()
                if not next_id or next_id in seen:
                    successor = None
                    break
                seen.add(next_id)
                successor = by_id.get(next_id)
                if successor is None:
                    break
                if not _is_withdrawn(successor):
                    break
            else:
                successor = None
            if successor is None or _is_withdrawn(successor):
                continue
            # Take the successor's URL, the original's footprint.
            row = {**row, "urls.latest": successor.get("urls.latest", ""),
                   "urls.direct_download": successor.get("urls.direct_download", "")}
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


class FeedDiscovery:
    """Outcome of one per-place discovery attempt.

    `url is None` has two very different meanings and they must never collapse
    into one: a catalog that ANSWERED and listed nothing covering this study area
    is a coverage FACT, while a catalog we could not read is an UNKNOWN.
    Reporting the second as the first would tell a planner their area has no
    transit service when all that actually happened is that a download failed —
    and that claim would then sit under a VMT number they have to defend.
    """

    __slots__ = ("url", "reason", "detail")

    def __init__(self, url: str | None, reason: str, detail: str | None = None) -> None:
        self.url = url
        #: "selected" | "no_covering_feed" | "catalog_unavailable"
        self.reason = reason
        #: The failure text, when the catalog could not be consulted.
        self.detail = detail


def discover_feed(bbox: tuple[float, float, float, float]) -> FeedDiscovery:
    """Discover a scheduled GTFS feed covering the study-area bbox from the
    keyless MobilityDB catalog.

    Never raises: a run must not die because a catalog download failed. The
    caller still degrades to the CORRECT state, though, because the reason comes
    back attached to the result instead of being flattened into a bare None.
    """
    try:
        rows = _load_catalog()
    except Exception as exc:
        return FeedDiscovery(None, "catalog_unavailable", str(exc))
    try:
        url = select_feed_from_catalog(rows, bbox)
    except Exception as exc:
        # A catalog we cannot parse is a catalog we could not consult; it is not
        # evidence that this study area has no transit.
        return FeedDiscovery(None, "catalog_unavailable", str(exc))
    return FeedDiscovery(url, "selected" if url else "no_covering_feed")


# --- The app's per-run transit feed selection ---------------------------------

#: The handoff format this worker understands. The app stamps it into
#: `model_runs.input_snapshot_json.transitFeed.version`. A stamp carrying ANY
#: other value is refused rather than ignored — see `parse_feed_selection`.
TRANSIT_FEED_STAMP_VERSION = "transit-feed-v1"

#: The stamp statuses the APP may report, and the machine reason each becomes.
#: `selected` and `not_selected` are handled separately because they are the two
#: that are not refusals.
_STAMP_REFUSAL_REASONS = {
    "unavailable": "selected_feed_unavailable",
    "unsupported_by_skim": "selected_feed_uses_frequencies",
    "handoff_failed": "selected_feed_handoff_failed",
}

# A uuid, and nothing else, may reach the PostgREST query the worker builds from
# this value. `input_snapshot_json` is WRITABLE BY ANY WORKSPACE MEMBER and the
# worker reads the database with the service-role key, so an unvalidated string
# here is a filter-injection surface into a client that has no RLS above it.
# The tenancy filter the worker adds is only load-bearing if it cannot be
# escaped from inside the id.
_UUID_RE = re.compile(r"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z")


def is_uuid(value: Any) -> bool:
    """Whether a value is safe to interpolate into a PostgREST filter as an id.

    Public because `main.py` needs the same rule for every id it takes from a
    row and puts back into a query, and two copies of a validation rule is one
    copy that will be forgotten."""
    return isinstance(value, str) and bool(_UUID_RE.match(value.strip()))


class FeedSelection:
    """A run's binding instruction about WHICH ingested feed to skim.

    Produced only from a stamp that means something; `parse_feed_selection`
    returns None for "no stamp" and for "the planner left discovery on", so a
    None selection is exactly today's behaviour and nothing downstream has to
    know the difference.

    Every field here is either a status the worker interprets or a sentence it
    repeats. NOTHING DISPLAYED COMES FROM THE STAMP: the agency name, the source
    URL, the checksum and the service window are all read off the database by the
    worker itself, because a member can write the snapshot and a forged
    provenance line in an evidence packet is worse than a missing one.
    """

    __slots__ = ("status", "feed_version_id", "reason", "no_feed_reason")

    def __init__(
        self,
        *,
        status: str,
        feed_version_id: str | None = None,
        reason: str | None = None,
        no_feed_reason: str | None = None,
    ) -> None:
        #: "selected" — skim this feed version and nothing else. Anything else is
        #: a binding refusal that must NOT fall back to another feed.
        self.status = status
        self.feed_version_id = feed_version_id
        #: A sentence for a planner, from the app when it had one.
        self.reason = reason
        #: The machine value the evidence panel keys off.
        self.no_feed_reason = no_feed_reason


def parse_feed_selection(run_row: dict | None) -> FeedSelection | None:
    """Read the app's transit-feed stamp off a model-run row. Pure — no network.

    Returns None when the run says nothing about transit (an older launch path, a
    non-worker engine) or when the planner explicitly left automatic discovery
    on. Both mean "behave exactly as before this feature existed", and collapsing
    them into one None is what makes that guarantee structural rather than a
    promise: there is no code path where an absent stamp reaches a new branch.

    EVERY OTHER OUTCOME IS BINDING, INCLUDING THE ONES WE DO NOT RECOGNISE. A
    stamp written in a format this worker does not understand, or carrying a
    status nobody has seen, is refused — not ignored. Ignoring it would fall
    through to discovery and skim whatever the catalog offers, while the app's
    own surfaces still name the feed the planner chose. That is not a missing
    answer; it is two surfaces agreeing on a feed that produced none of the
    numbers, which is the one outcome worse than reporting no transit at all.
    """
    snapshot = (run_row or {}).get("input_snapshot_json") or {}
    if not isinstance(snapshot, dict):
        return None
    stamp = snapshot.get("transitFeed")
    if not isinstance(stamp, dict):
        return None

    version = stamp.get("version")
    if version != TRANSIT_FEED_STAMP_VERSION:
        return FeedSelection(
            status="stamp_version_unsupported",
            no_feed_reason="selected_feed_stamp_version_unsupported",
            reason=(
                "This run names a transit feed using handoff format "
                f"{str(version)[:60]!r}, which this worker does not understand. The worker is "
                f"older than the app that launched the run (it speaks {TRANSIT_FEED_STAMP_VERSION}); "
                "upgrade the worker and relaunch. No feed was skimmed, because guessing which one "
                "was meant would put a feed nobody chose underneath this run's numbers."
            ),
        )

    status = stamp.get("status")
    if status == "not_selected":
        return None

    if status == "selected":
        feed_version_id = stamp.get("feedVersionId")
        if is_uuid(feed_version_id):
            return FeedSelection(status="selected", feed_version_id=feed_version_id.strip())
        return FeedSelection(
            status="handoff_failed",
            no_feed_reason="selected_feed_handoff_failed",
            reason=(
                "This run was stamped with a transit feed selection that names no usable feed "
                "version id, so no feed was read. Relaunch the run and pick the feed again."
            ),
        )

    if isinstance(status, str) and status in _STAMP_REFUSAL_REASONS:
        stated = stamp.get("reason")
        return FeedSelection(
            status=status,
            no_feed_reason=_STAMP_REFUSAL_REASONS[status],
            # The app knows the real cause; repeating it verbatim is the only way
            # the worker's refusal names something the planner can act on.
            # Truncated so an unexpectedly long message cannot bloat the packet.
            reason=(str(stated)[:300] if isinstance(stated, str) and stated.strip() else
                    "The app declined to hand this run's chosen transit feed to the model and "
                    "gave no reason."),
        )

    return FeedSelection(
        status="handoff_failed",
        no_feed_reason="selected_feed_handoff_failed",
        reason=(
            f"This run's transit feed selection carries a status ({str(status)[:60]!r}) this "
            "worker does not recognise, so no feed was skimmed rather than a different one."
        ),
    )


def iso_service_date(value: str | None) -> str | None:
    """A GTFS calendar date as ISO ``YYYY-MM-DD``, or None when it is not a date.

    calendar.txt writes dates COMPACTLY (`20261231`) while `gtfs_feed_versions`
    records them as ISO. `schedule_expired` compares ISO strings lexically and
    returns None for anything else — so feeding it a parser-derived date without
    this conversion answers "unknown" for every feed the worker read itself,
    which reads on screen as reassurance rather than as the silence it is. That
    is exactly how the bundled/operator/discovered feeds ended up with no expiry
    statement anywhere while `schedule_expired` looked wired up.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if re.match(r"\A\d{4}-\d{2}-\d{2}", text):
        return text[:10]
    if re.match(r"\A\d{8}\Z", text):
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    return None


def schedule_expired(service_end_date: str | None, today: str | None = None) -> bool | None:
    """Whether a feed's SERVICE window has already ended. None when unknown.

    Three of four real Sacramento-area feeds are expired — SacRT's schedule ended
    2025-04-05 — so this is the ordinary case and not a pathology. An expired feed
    is usually the last schedule the agency published and is often the right thing
    to model with; what must not happen is modelling it SILENTLY, because a skim
    built from a 16-month-old timetable is a different claim than one built from
    the timetable in force.

    A missing end date returns None rather than False. "This feed does not say
    when its service ends" and "this feed's service has not ended" are different
    facts, and a boolean that collapses them would let an unknown render as a
    reassurance. Dates are ISO ``YYYY-MM-DD``, where lexical order IS chronological
    order; anything else is unknown rather than guessed at.
    """
    if not isinstance(service_end_date, str) or not service_end_date.strip():
        return None
    end = service_end_date.strip()[:10]
    if not re.match(r"\A\d{4}-\d{2}-\d{2}\Z", end):
        return None
    now = (today or datetime.date.today().isoformat()).strip()[:10]
    return end < now


class FeedPlan:
    """WHICH feed a run should try, and what it may honestly say when it has none.

    This is policy about what a run is allowed to claim, so it lives here beside
    `discovery_enabled` and `discover_feed` rather than inline in the worker.
    `main.py` cannot be imported by these stdlib test suites — it pulls in
    aequilibrae, pandas and shapely — so a decision left inline there is a decision
    no test can reach, which is how the off-by-default regression survived in the
    first place.
    """

    __slots__ = (
        "url",
        "origin",
        "load",
        "status",
        "no_feed_reason",
        "discovery_error",
        "fallback_after_catalog_failure",
        "feed_version_id",
        "selection_reason",
        "operator_env_overridden",
    )

    def __init__(
        self,
        *,
        url: str | None = None,
        origin: str,
        load: bool = True,
        status: str | None = None,
        no_feed_reason: str | None = None,
        discovery_error: str | None = None,
        fallback_after_catalog_failure: bool = False,
        feed_version_id: str | None = None,
        selection_reason: str | None = None,
        operator_env_overridden: bool = False,
    ) -> None:
        #: Feed URL to hand `load_feed`; None means "resolve from GTFS_URL /
        #: GTFS_PATH / the bundled feed", which `load_feed` already does.
        self.url = url
        #: How this run chose a feed, or that it chose none — the evidence panel
        #: prints this verbatim through its own label table.
        self.origin = origin
        #: False when no feed may be tried at all; `status` and `no_feed_reason`
        #: then carry what the run is allowed to say.
        self.load = load
        self.status = status
        self.no_feed_reason = no_feed_reason
        #: Why discovery did not produce a feed, when a fallback is being used
        #: anyway. Carried even onto a SUCCESSFUL run: a fallback that reads as a
        #: successful discovery is worse than no fallback, because it lets a
        #: planner believe the catalog was consulted for their area when it never
        #: answered.
        self.discovery_error = discovery_error
        #: True when the bundled feed is standing in for a catalog we could not
        #: read. It changes what a coverage MISS means: normally a feed with no
        #: stops in the study area is evidence there is no local feed, but here it
        #: is only evidence that the bundled feed is the wrong one — nothing was
        #: ever established about this area.
        self.fallback_after_catalog_failure = fallback_after_catalog_failure
        #: The `gtfs_feed_versions.id` this run must skim, when a planner chose
        #: one. The worker resolves the storage path, checksum and display
        #: identity from the DATABASE using this id; the run's snapshot supplies
        #: the id and nothing else.
        self.feed_version_id = feed_version_id
        #: The app's own sentence about why a chosen feed cannot be used, carried
        #: through so the refusal names something the planner can act on.
        self.selection_reason = selection_reason
        #: True when a per-run selection displaced a deployment-wide GTFS_URL /
        #: GTFS_PATH. Disclosed rather than assumed: an operator who pinned a feed
        #: and finds a run skimmed a different one is owed the reason, and this is
        #: the only place that knows both facts at once.
        self.operator_env_overridden = operator_env_overridden


def plan_feed(
    discovery: FeedDiscovery | None,
    *,
    discovering: bool,
    env_url: str | None = None,
    env_path: str | None = None,
    selection: FeedSelection | None = None,
) -> FeedPlan:
    """Decide which feed a run tries, given the discovery outcome.

    PRECEDENCE, HIGHEST FIRST — and the top entry REVERSES what this docstring
    said before, deliberately:

      1. the run's own workspace feed selection (`selection`),
      2. an operator-named feed (`GTFS_URL` / `GTFS_PATH`),
      3. a feed discovery found in the catalog,
      4. the bundled feed, when the catalog could not be read,
      5. the bundled feed, when discovery is switched off.

    WHY A SELECTION OUTRANKS AN OPERATOR ENV FEED. `GTFS_URL` / `GTFS_PATH` are
    deployment-wide DEFAULTS — one operator's answer for every run that names
    nothing. A selection is an explicit human act on one specific run: a planner
    picked, from their own ingested feeds, the feed this analysis is about. A
    default that silently beat a per-run choice would make the picker in the
    launch form a control that does nothing, on the deployments most likely to
    have one set. The displacement is never silent: `operator_env_overridden`
    carries it onto the run, and the evidence panel prints it.

    A SELECTION NEVER FALLS BACK, WHICHEVER WAY IT FAILS. `load=False` here is
    terminal: no discovery, no env feed, no bundled feed. A run that skimmed some
    other feed after the chosen one failed would carry a KPI provenance sentence
    naming the feed the planner picked over numbers that came from a different
    one — corroboration manufactured out of a failure, which is worse than the
    failure.

    Beyond the selection, an operator-named feed outranks discovery. Beyond THAT
    the interesting case is a catalog we could not READ: it establishes nothing
    about the study area, so
    the run still loads the BUNDLED feed and lets `feed_covers()` decide. That is
    safe in any study area by construction — a feed whose stops fall outside the
    area is rejected, never skimmed — and it is the only thing that keeps an
    offline or network-blocked deployment working for the area its bundled feed
    genuinely covers. Skipping the fallback lost that area's transit and gained
    nothing anywhere else.

    The one case that must NOT fall back is a catalog that answered and listed
    nothing covering the area. There, "no local feed" is a checked fact, and
    reaching for a single-county bundled feed in an arbitrary place would only
    invite a coverage miss dressed up as an answer.
    """
    if selection is not None:
        # Checked before everything, including the operator env feed. See the
        # precedence table above; `operator_env_overridden` is what keeps the
        # reversal disclosed rather than silent.
        overridden = bool(env_url or env_path)
        if selection.status == "selected":
            return FeedPlan(
                origin="workspace_feed_version",
                feed_version_id=selection.feed_version_id,
                operator_env_overridden=overridden,
            )
        # Every other selection status is a terminal refusal. `feed_unavailable`,
        # never `no_local_feed`: "the feed you chose could not be used" is a fact
        # about that feed, and establishes nothing about whether the study area
        # has transit service. Claiming otherwise would put an unchecked coverage
        # assertion under a VMT number.
        return FeedPlan(
            origin="workspace_feed_version",
            load=False,
            status="feed_unavailable",
            no_feed_reason=selection.no_feed_reason or "selected_feed_handoff_failed",
            selection_reason=selection.reason,
            operator_env_overridden=overridden,
        )

    if discovering and discovery is None:
        # Told to discover but handed no result: we have no catalog answer, which
        # is an unknown and not a coverage fact. Treated as an unreachable catalog
        # so the run degrades the same honest way.
        discovery = FeedDiscovery(None, "catalog_unavailable", "discovery produced no result")

    # Operator-named feeds are checked FIRST so the code says what the docstring
    # says. `main.py` never discovers while one is set, so this changes nothing
    # today — but a policy function whose order contradicts its own contract is a
    # trap for the next caller, and the trap it sets is overriding a feed an
    # operator deliberately pinned.
    if env_url:
        return FeedPlan(origin="operator_url")
    if env_path:
        return FeedPlan(origin="operator_path")
    if discovering and discovery is not None and discovery.url:
        return FeedPlan(url=discovery.url, origin="discovered_catalog")
    if discovering and discovery is not None and discovery.reason == "catalog_unavailable":
        return FeedPlan(
            origin="bundled_after_catalog_unavailable",
            discovery_error=discovery.detail,
            fallback_after_catalog_failure=True,
        )
    if discovering:
        return FeedPlan(
            origin="none",
            load=False,
            status="no_local_feed",
            no_feed_reason="discovery_found_no_covering_feed",
        )
    return FeedPlan(origin="bundled_default")


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


def transit_skim(
    los: TransitLos, lons: np.ndarray, lats: np.ndarray, deadline: float | None = None
) -> dict[str, np.ndarray]:
    """Per-OD transit LOS matrices from the reduced feed.

    Returns {ivtt, wait, walk, fare, available} (n×n). `available` is False for
    any pair without a walk-access served stop at both ends and a direct or
    one-(same-stop)-transfer scheduled itinerary — those pairs are transit 0.

    `deadline` (a `stage_deadline()` instant) bounds how long this may run. Both
    phases below scale with zones × stops and a dense multi-operator feed against
    a large zone system can run for a very long time; the worker's stages are
    serial, so that stalls every queued run behind it. Exceeding the deadline
    raises `GtfsTimeout` and returns NOTHING — a half-filled matrix would quietly
    zero out transit for whichever zones came last, which is a wrong number rather
    than a missing one.
    """
    n = len(lons)
    ivtt = np.zeros((n, n))
    wait = np.zeros((n, n))
    walk = np.zeros((n, n))
    fare = np.zeros((n, n))
    available = np.zeros((n, n), dtype=bool)

    # Checked per zone rather than once up front: each phase is O(zones × stops)
    # or worse, so a budget that is only consulted between phases is no budget at
    # all on the input that actually stalls.
    access = []
    for i in range(n):
        check_deadline(deadline, "matching zone centroids to walk-accessible stops")
        access.append(_access_stops(float(lons[i]), float(lats[i]), los))
    lines = los.lines

    for i in range(n):
        check_deadline(deadline, "skimming zone-to-zone transit itineraries")
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
