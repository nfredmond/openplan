#!/usr/bin/env python3
"""
AequilibraE Worker — polls Supabase for queued model_run_stages and executes
real traffic assignment using the proven OSM + AequilibraE pipeline.

Stage pipeline:
  1. AequilibraE Setup     — download OSM network, add centroids, renumber nodes
  2. Network Assignment    — build graph, run skims, load demand, run BFW
  3. Artifact Extraction   — export evidence packet, link volumes, skim matrix
"""
import os
import sys
import time
import json
import shutil
import sqlite3
import string
import hashlib
import re
import tempfile
import urllib.parse
from collections import deque
from datetime import datetime, timezone
from typing import Tuple

import requests
import numpy as np
import pandas as pd
from shapely.geometry import box, shape
from dotenv import load_dotenv

from data_pipeline import (
    DataPipelineError,
    generate_package,
    normalize_zone_geography,
    package_geography_mismatch,
)
from resident_vmt import compute_internal_resident_vmt, haversine_miles, intrazonal_miles
import convergence
import link_vmt
import select_link
import calibration
from gateways import (
    detect_external_gateways,
    build_cordon_injections,
    resolve_exterior_node,
    pair_passthrough_cordons,
    GATEWAY_PASSTHROUGH_SHARE,
)
import mode_choice
import gtfs_skim
import count_validation
import emissions
import equity

# Provenance stamp for the ACTUAL installed engine version — a hardcoded
# string drifts silently under the >=1.6.0 pin (it already had, to "1.6.1").
try:
    from importlib.metadata import version as _pkg_version
    ENGINE_STAMP = f"AequilibraE {_pkg_version('aequilibrae')}"
except Exception:
    ENGINE_STAMP = "AequilibraE (version unknown)"

# Load env: locally from .env, in Docker from environment variables.
# Resolve the app's .env.local by ABSOLUTE path from this file so creds load no
# matter the launch cwd (repo root vs. the worker dir) — a relative path silently
# no-ops when launched from the repo root. override=False so real env vars (Docker/
# Fly secrets) always win.
load_dotenv()  # will read .env in the cwd if present
_ENV_LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "openplan", ".env.local")
load_dotenv(_ENV_LOCAL, override=False)

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Skim/assignment parallelism. AequilibraE defaults to every core, which
# multiplies graph copies across multiprocessing workers — on shared/dev boxes
# that risks OOM kills mid-run. Default to 1; raise via env on big machines.
AEQ_CORES = max(1, int(os.getenv("AEQ_CORES", "1")))

# Fail-fast guardrail on study-area size. The per-cell OD/skim/VMT glue is still
# O(zones²) Python (metro-scale vectorization is a Wave 3 job), so a pathological
# multi-metro draw would run for hours or OOM. Above this many active zones the
# setup stage errors honestly ("narrow the area") instead of hanging until the
# reaper kills it. Generous by default (a large single metro at tract geography
# is well under it); raise via env on a big box. A run's own zoneGeography still
# governs tract vs block-group resolution.
AEQ_MAX_ZONES = max(1, int(os.getenv("AEQ_MAX_ZONES", "4000")))


def check_zone_budget(zone_count: int, max_zones: int = AEQ_MAX_ZONES) -> None:
    """Raise an honest, actionable error when a study area is too large for the
    screening worker to model in a reasonable time. Called once in the setup
    stage after zones are resolved, before the expensive connector/assignment
    work."""
    if zone_count > max_zones:
        raise RuntimeError(
            f"Study area resolves to {zone_count} zones, above the screening worker's "
            f"supported maximum of {max_zones}. Narrow the study area (or split it into "
            f"sub-areas) and re-launch; a metro at tract geography usually fits. "
            f"(Operators can raise AEQ_MAX_ZONES on a larger machine.)"
        )

# Degrees to expand the OSM download beyond the study-area boundary so that
# highways crossing the cordon physically extend outside it and can be detected
# as external gateways (≈2 mi at these latitudes). Zone/centroid selection stays
# on the un-buffered study area.
GATEWAY_BUFFER_DEG = max(0.0, float(os.getenv("AEQ_GATEWAY_BUFFER_DEG", "0.03")))

# Split internal person-trips into auto vs active (walk+bike) and assign only
# the auto matrix. Default on; set to 0 for the old all-auto behaviour.
MODE_SPLIT_ENABLED = os.getenv("MODE_SPLIT_ENABLED", "1") not in ("0", "false", "False", "")

# Dynamic per-place GTFS discovery (keyless Mobility Database catalog). Default
# OFF so the Nevada County pilot stays byte-identical; when ON (and no explicit
# GTFS_PATH/GTFS_URL is set) the worker resolves a feed covering the study area,
# and a discovery miss degrades to the honest no_local_feed state instead of
# skimming the bundled Nevada feed against an arbitrary place.
GTFS_DISCOVER = os.getenv("GTFS_DISCOVER", "0") in ("1", "true", "True")

# Fixed share of each boundary-crossing highway's daily volume routed as
# pass-through (cordon→same-route cordon) so interior mainlines load, rather than
# terminating at internal zones. Uncalibrated screening assumption; the env
# override is for what-if sweeps only, never to fit observed counts.
try:
    PASSTHROUGH_SHARE = float(os.getenv("GATEWAY_PASSTHROUGH_SHARE", str(GATEWAY_PASSTHROUGH_SHARE)))
except ValueError:
    PASSTHROUGH_SHARE = GATEWAY_PASSTHROUGH_SHARE
PASSTHROUGH_SHARE = min(max(PASSTHROUGH_SHARE, 0.0), 0.9)

# Observed-count validation: match assigned link volumes to published traffic
# counts and report screening-grade fit metrics + a gate. Default counts cover
# the Nevada County pilot; VALIDATION_COUNTS_PATH overrides. Set to 0 to disable.
COUNT_VALIDATION_ENABLED = os.getenv("COUNT_VALIDATION_ENABLED", "1") not in ("0", "false", "False", "")
VALIDATION_COUNTS_PATH = os.getenv(
    "VALIDATION_COUNTS_PATH",
    os.path.join(os.path.dirname(__file__), "data", "validation", "nevada_county_priority_counts.csv"),
)

# Auto-ingest local DOT AADT counts for the study area (keyless Caltrans / state
# FeatureServers via scripts/modeling/count_sources.py). Default OFF so the
# Nevada pilot + CI stay byte-identical on the curated priority file; a real
# deployment sets COUNT_AUTO_INGEST=1 to auto-fetch local counts for any run in
# a registered region. Best-effort: any failure keeps the default counts.
COUNT_AUTO_INGEST = os.getenv("COUNT_AUTO_INGEST", "0") in ("1", "true", "True")

# Run-local counts path: stage_assignment sets this from auto-ingest (or the
# module default) at the top of each run; the validation/calibration helpers
# read it. Safe as a module global because the worker processes one stage per
# process at a time.
_active_counts_path = VALIDATION_COUNTS_PATH

# Rough bounds per registered count-source region (only registered regions can
# auto-ingest). Each maps to a state-DOT AADT source in
# scripts/modeling/count_sources.py::COUNT_SOURCES (CA=Caltrans, WA=WSDOT,
# CO=CDOT, OR=ODOT). Bbox detection is coarse: a study bbox straddling a state
# line resolves to the first registered region it intersects; where the fetched
# counts don't match the network, calibration finds nothing and stays screening.
_REGION_BOUNDS = {
    "CA": (-124.6, 32.4, -114.0, 42.1),
    "OR": (-124.57, 41.99, -116.46, 46.29),
    "WA": (-124.85, 45.54, -116.92, 49.0),
    "CO": (-109.06, 36.99, -102.04, 41.0),
}


def _region_for_bbox(bbox: tuple) -> str | None:
    """Registered count-source region whose bounds intersect the study bbox."""
    min_lon, min_lat, max_lon, max_lat = bbox
    for region, (r0, r1, r2, r3) in _REGION_BOUNDS.items():
        if not (r0 > max_lon or r2 < min_lon or r1 > max_lat or r3 < min_lat):
            return region
    return None


def auto_ingest_counts(bbox, proj_dir: str, out_dir: str, calibrate_requested: bool = False) -> str | None:
    """Best-effort: fetch local DOT AADT for the study bbox and build a per-run
    validation CSV, returning its path (or None). Shells out to the existing
    scripts/modeling/build_expanded_aadt_counts.py. Runs when either the
    deployment enables COUNT_AUTO_INGEST OR this run opted into calibration
    (calibrate_requested) — a per-run opt-in must be able to fetch its own count
    set even where the deployment default is off, so the toggle works standalone
    (esp. hosted). Skipped when VALIDATION_COUNTS_PATH is explicitly overridden."""
    if (not COUNT_AUTO_INGEST and not calibrate_requested) or "VALIDATION_COUNTS_PATH" in os.environ:
        return None
    if not bbox or len(bbox) != 4:
        return None
    region = _region_for_bbox(tuple(bbox))
    if not region:
        return None
    db_path = os.path.join(proj_dir, "project_database.sqlite")
    script = os.path.normpath(
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "..", "scripts", "modeling", "build_expanded_aadt_counts.py",
        )
    )
    if not os.path.exists(db_path) or not os.path.exists(script):
        return None
    out_csv = os.path.join(out_dir, "auto_aadt_counts.csv")
    try:
        import subprocess
        res = subprocess.run(
            [
                sys.executable, script,
                # `--opt=value` (not `--opt value`) so argparse doesn't mistake a
                # negative-longitude bbox (every real US location) for an option
                # flag — `--fetch-bbox -121.8,...` fails with "expected one argument"
                # and silently disabled auto-ingest (→ calibration always skipped).
                f"--fetch-bbox={bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
                "--region", region, "--db", db_path, "--out", out_csv,
            ],
            capture_output=True, text=True, timeout=180,
        )
        if res.returncode != 0 or not os.path.exists(out_csv):
            return None
        with open(out_csv) as fh:
            rows = sum(1 for _ in fh)
        return out_csv if rows >= 2 else None
    except Exception:
        return None

# OPT-IN count-based calibration (OFF by default — the product ships an
# UNCALIBRATED screening model). When enabled, after the baseline assignment the
# worker tunes per-road-class free-flow speed/capacity toward observed counts,
# re-running equilibrium assignment and keeping a step only if it improves a
# held-out count set (see calibration.py). Produces the distinct
# 'calibrated_to_counts' claim tier + calibrated KPIs under DISTINCT names; the
# OD-based resident_vmt (CEQA input) is never touched. A larger count set than
# the 3-station priority file is strongly recommended (VALIDATION_COUNTS_PATH).
CALIBRATION_ENABLED = os.getenv("AEQ_CALIBRATE", "0") in ("1", "true", "True")
CALIBRATION_MAX_ITER = int(os.getenv("AEQ_CALIBRATE_MAX_ITER", "12"))
# Minimum held-out objective improvement to accept a step (one objective ULP —
# the objective is rounded to 1e-4). A step that only ties the holdout is a
# no-op and must not promote the run to the calibrated tier.
CALIBRATION_MIN_IMPROVEMENT = float(os.getenv("AEQ_CALIBRATE_MIN_IMPROVEMENT", "1e-4"))
# Stage 2 of the staged method: a light, select-link-guided demand nudge on top
# of the stage-1 capacity/speed calibration. On by default when calibration is
# on (Nathaniel chose "both, staged"); AEQ_CALIBRATE_DEMAND=0 disables it.
CALIBRATION_DEMAND_ENABLED = os.getenv("AEQ_CALIBRATE_DEMAND", "1") in ("1", "true", "True")
CALIBRATION_DEMAND_MAX_ITER = int(os.getenv("AEQ_CALIBRATE_DEMAND_MAX_ITER", "6"))

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials in environment.")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

SPATIALITE_PATH = os.getenv("SPATIALITE_LIBRARY_PATH", "/usr/lib/x86_64-linux-gnu/mod_spatialite.so")
os.environ["SPATIALITE_LIBRARY_PATH"] = SPATIALITE_PATH

# ─── OSM Builder patch (link-type ID collision fix for AequilibraE 1.6.x) ──
from aequilibrae.project.network.osm.osm_builder import OSMBuilder

def _patched_define_link_type(self, link_type: str) -> Tuple[str, str]:
    proj_link_types = self.project.network.link_types
    original = link_type
    link_type = "".join([x for x in link_type if x in string.ascii_letters + "_"]).lower()
    split = link_type.split("_")
    for i, piece in enumerate(split[1:]):
        if piece in ["link", "segment", "stretch"]:
            link_type = "_".join(split[: i + 1])
    if self._OSMBuilder__all_ltp.shape[0] >= 51:
        link_type = "aggregate_link_type"
    if len(link_type) == 0:
        link_type = "empty"
    if link_type in self._OSMBuilder__all_ltp.link_type.values:
        lt = proj_link_types.get_by_name(link_type)
        if lt is not None:
            if original not in lt.description:
                lt.description += f", {original}"
                lt.save()
            return [lt.link_type_id, link_type]
    letter = link_type[0]
    if letter in self._OSMBuilder__all_ltp.link_type_id.values:
        letter = letter.upper()
        if letter in self._OSMBuilder__all_ltp.link_type_id.values:
            for letter in string.ascii_letters:
                if letter not in self._OSMBuilder__all_ltp.link_type_id.values:
                    break
    try:
        lt = proj_link_types.new(letter)
        lt.link_type = link_type
        lt.description = f"OSM: {original}"
        lt.save()
    except Exception:
        lt = proj_link_types.get(letter)
        if lt is not None:
            lt.link_type = link_type
            lt.description = f"OSM: {original}"
            lt.save()
    return [letter, link_type]

OSMBuilder._OSMBuilder__define_link_type = _patched_define_link_type

# ─── Default speed/capacity by link type ────────────────────────────────
LINK_DEFAULTS = {
    "motorway": (65, 2000, 2),
    "trunk": (55, 1800, 2),
    "primary": (45, 1200, 1),
    "secondary": (35, 900, 1),
    "tertiary": (30, 600, 1),
    "residential": (25, 400, 1),
    "unclassified": (25, 400, 1),
    "service": (15, 200, 1),
    "pedestrian": (5, 100, 1),
    "services": (15, 200, 1),
    "centroid_connector": (50, 99999, 1),
}


# OSM `maxspeed` units expressed as a multiplier into this worker's internal mph
# (assignment converts with 1609.34 m/mi below). The EMPTY key is the load-bearing
# one: https://wiki.openstreetmap.org/wiki/Key:maxspeed specifies km/h as the
# implicit unit, so an unqualified tag is metric even in an imperial-signing
# country. Reading "80" as 80 mph rather than 80 km/h (50 mph) inflated speeds by
# 60%, which propagates through travel times into assignment and VMT.
#
# Deliberately duplicated from scripts/modeling/screening_runtime.py rather than
# imported: the worker is a separate deploy unit (its own container) and cannot
# import from scripts/. Keep the two in sync.
_KMH_TO_MPH = 1.0 / 1.609344
_KNOTS_TO_MPH = 1.150779
_SPEED_UNIT_TO_MPH = {
    "": _KMH_TO_MPH,
    "kmh": _KMH_TO_MPH,
    "km/h": _KMH_TO_MPH,
    "kph": _KMH_TO_MPH,
    "kmph": _KMH_TO_MPH,
    "mph": 1.0,
    "knots": _KNOTS_TO_MPH,
    "knot": _KNOTS_TO_MPH,
}
# Whole-token match only: "50", "50 mph", "30 km/h" are speeds; "DE:zone30" and
# "walk" are not, and must not be mined for a digit inside a scheme name.
_SPEED_TAG_RE = re.compile(r"^(?P<magnitude>\d+(?:\.\d+)?)\s*(?P<unit>[a-z/]*)$")


def _parse_speed(val):
    """Normalize an OSM maxspeed tag to mph, or None when it is not a speed."""
    if val is None:
        return None
    match = _SPEED_TAG_RE.match(str(val).strip().lower())
    if not match:
        return None
    factor = _SPEED_UNIT_TO_MPH.get(match.group("unit"))
    if factor is None:
        return None
    mph = float(match.group("magnitude")) * factor
    # A zero or negative posted speed is not usable; let the caller fall back to
    # its class default rather than dividing by zero downstream.
    return mph if mph > 0 else None


# ─── Supabase helpers ───────────────────────────────────────────────────
def sb_patch_stage(stage_id: str, payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_run_stages?id=eq.{stage_id}"
    requests.patch(url, headers=HEADERS, json=payload)


def sb_claim_stage(stage_id: str, payload: dict) -> bool:
    """Atomically claim a queued stage.

    Transitions status queued -> running only if the row is still queued. Using
    a conditional PATCH (id=eq.X & status=eq.queued) with return=representation
    means a second worker that lost the race gets an empty result set and skips,
    so two replicas never double-process the same stage.
    """
    url = f"{SUPABASE_URL}/rest/v1/model_run_stages?id=eq.{stage_id}&status=eq.queued"
    res = requests.patch(url, headers=HEADERS, json=payload)
    if res.status_code not in (200, 201, 204):
        print(f"  Claim PATCH returned {res.status_code}: {res.text[:200]}")
        return False
    try:
        rows = res.json()
    except ValueError:
        rows = []
    return bool(rows)


def sb_patch_run(run_id: str, payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_runs?id=eq.{run_id}"
    requests.patch(url, headers=HEADERS, json=payload)


def sb_post_artifact(payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_run_artifacts"
    requests.post(url, headers=HEADERS, json=payload)


def sb_post_kpi(payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_run_kpis"
    requests.post(url, headers=HEADERS, json=payload)


def write_model_run_modeling_evidence(run_id: str, workspace_id: str | None, validation: dict | None,
                                      calibration: dict | None = None) -> None:
    """Write the shared modeling claim-grade spine for THIS model run — the same
    tables the county lane populates (modeling_validation_results +
    modeling_claim_decisions) so reports read one consistent claim grade. Derived
    from the observed-count gate. NEVER 'claim_grade_passed' (that needs the
    county-lane validation-threshold pass). When count calibration ran and
    improved a held-out set, the tier is 'calibrated_to_counts' with the
    out-of-sample holdout accuracy. Best-effort; never fails a run."""
    if not workspace_id:
        return
    try:
        matched = int((validation or {}).get("stations_matched", 0) or 0)
        median_ape = (validation or {}).get("median_ape")
        max_ape = (validation or {}).get("max_ape")
        gate = (validation or {}).get("screening_gate")
        if calibration:
            # Calibrated tier: the honest accuracy is the HELD-OUT median APE.
            hold = (calibration.get("calibrated") or {}).get("holdout") or {}
            base_hold = (calibration.get("baseline") or {}).get("holdout") or {}
            claim_status, reason = "calibrated_to_counts", (
                f"Model calibrated to observed counts ({calibration.get('fit_station_count')} fit / "
                f"{calibration.get('holdout_station_count')} holdout stations, "
                f"{calibration.get('accepted_iterations')} accepted step(s)). Held-out median APE "
                f"{base_hold.get('median_ape')}% -> {hold.get('median_ape')}%. Calibrated VMT is "
                f"published under distinct KPI names and is not the CEQA screening input."
            )
        elif gate == "bounded screening-ready":
            claim_status, reason = "screening_grade", (
                f"Observed-count validation passed the screening gate ({matched} stations, "
                f"median APE {median_ape}%)."
            )
        elif validation and matched > 0:
            claim_status, reason = "prototype_only", (
                f"Observed-count validation did not meet the screening gate ({matched} stations, "
                f"median APE {median_ape}%)."
            )
        else:
            claim_status, reason = "prototype_only", (
                "No observed-count validation for this study area; screening-grade claims require a "
                "validation pass."
            )
        upsert_headers = dict(HEADERS)
        upsert_headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        requests.post(
            f"{SUPABASE_URL}/rest/v1/modeling_claim_decisions?on_conflict=model_run_id,track",
            headers=upsert_headers,
            json={
                "workspace_id": workspace_id, "model_run_id": run_id, "track": "assignment",
                "claim_status": claim_status, "status_reason": reason,
                "validation_summary_json": {**(validation or {}),
                                            **({"calibration": calibration} if calibration else {})},
            }, timeout=20,
        )
        # Refresh the per-metric validation rows for this run/track.
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/modeling_validation_results?model_run_id=eq.{run_id}&track=eq.assignment",
            headers=HEADERS, timeout=20,
        )
        if validation and matched > 0:
            status, detail = count_validation.metric_status_for_gate(median_ape, max_ape, matched)
            rows = [{
                "workspace_id": workspace_id, "model_run_id": run_id, "track": "assignment",
                "metric_key": "count_median_ape", "metric_label": "Median APE vs observed counts",
                "threshold_comparator": "lte", "status": status, "blocks_claim_grade": True,
                "detail": detail,
                "metadata_json": {
                    "median_ape": median_ape, "max_ape": max_ape,
                    "percent_rmse": (validation or {}).get("percent_rmse"),
                    "geh_mean": ((validation or {}).get("geh") or {}).get("mean"),
                    "spearman_rho": (validation or {}).get("spearman_rho"),
                },
            }, {
                "workspace_id": workspace_id, "model_run_id": run_id, "track": "assignment",
                "metric_key": "count_stations_matched", "metric_label": "Matched count stations",
                "threshold_comparator": "gte", "status": "pass" if matched >= 3 else "fail",
                "blocks_claim_grade": True,
                "detail": f"{matched} station(s) matched; >=3 required for a screening claim.",
                "metadata_json": {"stations_matched": matched},
            }]
            requests.post(f"{SUPABASE_URL}/rest/v1/modeling_validation_results", headers=HEADERS, json=rows, timeout=20)
    except Exception:
        pass  # evidence spine is best-effort; never fail the run over it


def sb_get_run(run_id: str) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/model_runs?id=eq.{run_id}&select=id,workspace_id,corridor_geojson,query_text,engine_key,run_title,input_snapshot_json"
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Failed to load model run {run_id}: {res.status_code} {res.text[:200]}")
    rows = res.json()
    if not rows:
        raise RuntimeError(f"Model run {run_id} not found")
    return rows[0]


def resolve_run_study_area(run_row: dict) -> tuple[dict, tuple]:
    """Resolve the run's study area to (corridor_geojson, bbox).

    A study area is REQUIRED. The worker never falls back to a default region:
    silently modeling some other place is worse than a clear failure. Set a study
    area in the launch form (search a place, draw an area, or paste GeoJSON) and
    relaunch.
    """
    corridor_geojson = run_row.get("corridor_geojson")
    if not corridor_geojson:
        raise RuntimeError(
            "This run has no study area. Set a study area in the launch form "
            "(search or draw any US place, or paste corridor GeoJSON) and relaunch. "
            "The worker does not fall back to a default region."
        )
    geom = shape(corridor_geojson)
    if geom.is_empty:
        raise RuntimeError("The study area geometry (corridor_geojson) is empty; set a valid area and relaunch.")
    min_lon, min_lat, max_lon, max_lat = geom.bounds
    return corridor_geojson, (float(min_lon), float(min_lat), float(max_lon), float(max_lat))


def resolve_zone_geography(run_row: dict | None) -> str:
    """Per-run zone geography: launch option > AEQ_ZONE_GEOGRAPHY env > tract.

    The launch route stamps the option into input_snapshot_json.zoneGeography;
    the env var remains as an ops-level fallback for pre-option runs.
    """
    snapshot = (run_row or {}).get("input_snapshot_json") or {}
    requested = snapshot.get("zoneGeography") or snapshot.get("zone_geography")
    if not requested:
        requested = os.getenv("AEQ_ZONE_GEOGRAPHY", "tract")
    return normalize_zone_geography(requested)


def resolve_calibration_enabled(run_row: dict | None) -> bool:
    """Per-run count calibration: launch option > AEQ_CALIBRATE env > off.

    The launch route stamps the per-run choice into input_snapshot_json.calibrate
    (a bool); the env var remains an ops-level fallback for runs launched without
    the option (e.g. the `modeling:local --calibrate` CLI). An explicit per-run
    value wins over the env — unchecking the box turns calibration off even when a
    deployment defaults it on. Default OFF: OpenPlan ships an uncalibrated
    screening model. Mirrors resolve_zone_geography exactly.
    """
    snapshot = (run_row or {}).get("input_snapshot_json") or {}
    requested = snapshot.get("calibrate")
    if requested is None:
        return CALIBRATION_ENABLED
    return bool(requested)


def should_run_calibration(calibrate_requested: bool, counts_path: str) -> bool:
    """Whether stage_assignment actually runs count calibration: the run opted in
    (per-run flag / env), count validation is enabled, and a count set exists on
    disk. Extracted from the stage gate so the decision is unit-testable without a
    full AequilibraE assignment. Where no counts match, calibration is skipped and
    the run honestly stays screening-grade."""
    return bool(calibrate_requested) and COUNT_VALIDATION_ENABLED and os.path.exists(counts_path)


def ensure_dynamic_package(run_id: str, work_dir: str, run_row: dict | None = None) -> dict:
    run_row = run_row or sb_get_run(run_id)
    corridor_geojson, bbox = resolve_run_study_area(run_row)
    pkg_dir = os.path.join(work_dir, "package")
    manifest_path = os.path.join(pkg_dir, "manifest.json")

    # "block_group" builds ~3x finer sub-tract TAZs than "tract" (lower
    # intrazonal share, more accurate trip lengths/VMT).
    zone_geography = resolve_zone_geography(run_row)

    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
        # A relaunch may change the requested geography; a dynamic package
        # cached at the old resolution must not silently satisfy it. Pre-staged
        # pilot/builder packages (non-dynamic-v1) always reuse verbatim.
        rebuild_reason = None
        if package_geography_mismatch(manifest, zone_geography):
            rebuild_reason = (
                f"is {manifest.get('zone_geography') or 'unstamped (pre-BG, tract-built)'} "
                f"but the run requests {zone_geography}"
            )
        elif manifest.get("version") == "dynamic-v1":
            # Self-heal a torn cache: a crash between file writes can leave a
            # manifest over missing CSVs, which would fail stage 1 forever.
            expected = list((manifest.get("files") or {}).values()) or [
                "zone_attributes.csv", "od_trip_matrix.csv",
            ]
            missing = [f for f in expected if not os.path.exists(os.path.join(pkg_dir, f))]
            if missing:
                rebuild_reason = f"is missing {', '.join(missing)}"
        if rebuild_reason:
            print(f"Cached package {rebuild_reason}; rebuilding the dynamic package.")
            # Remove the manifest FIRST — generate_package writes it last, so
            # no crash window may leave a manifest standing over missing CSVs.
            os.remove(manifest_path)
            shutil.rmtree(pkg_dir)
        else:
            manifest["package_dir"] = pkg_dir
            manifest["bbox"] = manifest.get("bbox") or list(bbox)
            return manifest

    try:
        manifest = generate_package(
            output_dir=pkg_dir, bbox=bbox, corridor_geojson=corridor_geojson,
            zone_geography=zone_geography,
        )
    except DataPipelineError as exc:
        raise RuntimeError(f"Dynamic package generation failed: {exc}") from exc

    manifest["package_dir"] = pkg_dir
    return manifest


# ─── Stage 1: AequilibraE Setup ────────────────────────────────────────
def stage_setup(run_id: str, stage_id: str, work_dir: str, bbox: tuple, pkg_dir: str) -> dict:
    """Download OSM, add centroids + connectors, renumber, populate attrs."""
    from aequilibrae import Project

    proj_dir = os.path.join(work_dir, "aeq_project")

    log = "Creating AequilibraE project from OSM...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    if os.path.exists(proj_dir):
        shutil.rmtree(proj_dir)

    project = Project()
    project.new(proj_dir)
    # Download OSM for a buffered bbox so boundary-crossing highways extend past
    # the study area and can be detected as external gateways below. Zone
    # selection stays on the un-buffered bbox.
    b = GATEWAY_BUFFER_DEG
    buffered_bbox = (bbox[0] - b, bbox[1] - b, bbox[2] + b, bbox[3] + b)
    model_area = box(*buffered_bbox)
    project.network.create_from_osm(model_area=model_area, modes=["car"], clean=True)
    project.close()

    log += "OSM download complete.\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # --- Add centroids and connectors ---
    db_path = os.path.join(proj_dir, "project_database.sqlite")
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    conn.load_extension(SPATIALITE_PATH)

    # Connectivity analysis
    nodes_all = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
    links_raw = conn.execute("SELECT a_node, b_node FROM links").fetchall()
    adj = {}
    for a, b in links_raw:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)

    visited_global = set()
    components = []
    for node in nodes_all:
        if node in visited_global:
            continue
        comp = set()
        queue = deque([node])
        comp.add(node)
        while queue:
            # deque.popleft() is O(1); a plain list's pop(0) is O(N), which made
            # this BFS O(N²) on a metro-scale OSM network (10^5–10^6 nodes) and
            # was the setup stage's first wall. Component membership is
            # order-independent, so this is a pure perf fix.
            n = queue.popleft()
            for nb in adj.get(n, []):
                if nb not in comp:
                    comp.add(nb)
                    queue.append(nb)
        visited_global |= comp
        components.append(comp)
    components.sort(key=len, reverse=True)
    largest = components[0]

    log += f"Network: {len(nodes_all)} nodes, {len(links_raw)} links, {len(components)} components\n"
    log += f"Largest component: {len(largest)} nodes ({100*len(largest)/len(nodes_all):.1f}%)\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # Ensure centroid_connector link type
    if not conn.execute("SELECT 1 FROM link_types WHERE link_type='centroid_connector'").fetchone():
        conn.execute(
            "INSERT INTO link_types (link_type, link_type_id, description, lanes, lane_capacity) "
            "VALUES ('centroid_connector', 'z', 'Virtual centroid connectors', 10, 10000)"
        )
        conn.commit()

    zones = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"))
    active_zones = zones[
        (zones["centroid_lon"] >= bbox[0]) & (zones["centroid_lon"] <= bbox[2]) &
        (zones["centroid_lat"] >= bbox[1]) & (zones["centroid_lat"] <= bbox[3])
    ].reset_index(drop=True)

    # Fail fast + honest if the study area is too large to model in reasonable
    # time, instead of hanging until the stale-run reaper kills it.
    check_zone_budget(len(active_zones))

    max_node = max(nodes_all)
    max_link = conn.execute("SELECT MAX(link_id) FROM links").fetchone()[0]
    next_node = max_node + 1
    next_link = max_link + 1
    centroid_map = {}
    disconnected_zones = []

    for _, z in active_zones.iterrows():
        zid = int(z["zone_id"])
        clon, clat = z["centroid_lon"], z["centroid_lat"]
        centroid_nid = next_node
        next_node += 1

        conn.execute(
            "INSERT INTO nodes (node_id, is_centroid, geometry) VALUES (?, 1, MakePoint(?, ?, 4326))",
            (centroid_nid, clon, clat),
        )

        nearest = conn.execute(
            "SELECT node_id, (X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
            "FROM nodes WHERE is_centroid=0 AND node_id!=? ORDER BY d2 ASC LIMIT 50",
            (clon, clon, clat, clat, centroid_nid),
        ).fetchall()

        nearest_in_comp = [(nid, d) for nid, d in nearest if nid in largest][:3]
        if not nearest_in_comp:
            # None of the 50 nearest network nodes belong to the largest
            # connected component — the zone sits on a disconnected subnetwork
            # of this OSM snapshot (or beyond the search radius). A centroid
            # registered without connectors is absent from the routing graph
            # and hard-crashes AequilibraE's skimming, so exclude the zone
            # honestly instead.
            conn.execute("DELETE FROM nodes WHERE node_id=?", (centroid_nid,))
            disconnected_zones.append(zid)
            continue
        for near_nid, dist2 in nearest_in_comp:
            nx, ny = conn.execute("SELECT X(geometry),Y(geometry) FROM nodes WHERE node_id=?", (near_nid,)).fetchone()
            line_wkt = f"LINESTRING({clon} {clat}, {nx} {ny})"
            length_m = max((dist2**0.5) * 111000, 10)
            conn.execute(
                "INSERT INTO links (link_id,a_node,b_node,direction,distance,modes,link_type,name,"
                "speed_ab,speed_ba,capacity_ab,capacity_ba,geometry) "
                "VALUES (?,?,?,0,?,'c','centroid_connector','connector',50,50,99999,99999,GeomFromText(?,4326))",
                (next_link, centroid_nid, near_nid, length_m, line_wkt),
            )
            next_link += 1
        centroid_map[zid] = centroid_nid
    conn.commit()

    log += f"Added {len(centroid_map)} centroids with connectors.\n"
    if disconnected_zones:
        log += (
            f"Excluded {len(disconnected_zones)} zone(s) with no connection to the "
            f"main network on this OSM snapshot: {disconnected_zones}. Their demand "
            "is omitted from skims and assignment (screening-grade caveat).\n"
        )

    # --- External gateways + cordon centroids (BEFORE renumber; conn open) ---
    # Create a cordon centroid at each boundary highway crossing, connected to
    # the crossing link's EXTERIOR endpoint, so external through-traffic is
    # forced ACROSS the boundary highway link instead of dumping onto local
    # roads at an interior tract connector (the routing defect count validation
    # exposed). Cordon zones use a reserved id namespace (>= 9_000_000), never
    # appear in zone_attributes, and never touch mode choice or resident VMT.
    gateways = []
    cordon_map: dict[int, int] = {}
    try:
        boundary = box(*bbox)
        connected_ids = {int(z) for z in centroid_map.keys()}
        connected_zones = active_zones[active_zones["zone_id"].astype(int).isin(connected_ids)]
        gateways = detect_external_gateways(db_path, boundary, connected_zones, SPATIALITE_PATH)
        dropped = 0
        for idx, gw in enumerate(gateways, start=1):
            ext_node = resolve_exterior_node(conn, gw["link_id"], boundary)
            if ext_node is None or ext_node not in largest:
                dropped += 1
                gw["cordon_zone_id"] = None
                continue
            cordon_zid = 9_000_000 + idx
            cordon_nid = next_node
            next_node += 1
            clon, clat = gw["boundary_lon"], gw["boundary_lat"]
            conn.execute(
                "INSERT INTO nodes (node_id, is_centroid, geometry) VALUES (?, 1, MakePoint(?, ?, 4326))",
                (cordon_nid, clon, clat),
            )
            nx, ny = conn.execute("SELECT X(geometry),Y(geometry) FROM nodes WHERE node_id=?", (ext_node,)).fetchone()
            line_wkt = f"LINESTRING({clon} {clat}, {nx} {ny})"
            length_m = max(((clon - nx) ** 2 + (clat - ny) ** 2) ** 0.5 * 111000, 10)
            conn.execute(
                "INSERT INTO links (link_id,a_node,b_node,direction,distance,modes,link_type,name,"
                "speed_ab,speed_ba,capacity_ab,capacity_ba,geometry) "
                "VALUES (?,?,?,0,?,'c','centroid_connector','cordon_connector',50,50,99999,99999,GeomFromText(?,4326))",
                (next_link, cordon_nid, ext_node, length_m, line_wkt),
            )
            next_link += 1
            cordon_map[cordon_zid] = cordon_nid
            gw["cordon_zone_id"] = cordon_zid
        conn.commit()
        if gateways:
            log += (
                f"Detected {len(gateways)} external gateway(s); built {len(cordon_map)} cordon "
                "centroid(s) on boundary highways"
                + (f" ({dropped} dropped — exterior endpoint off the main network)" if dropped else "")
                + ".\n"
            )
        else:
            log += "No external gateways detected (closed-boundary study area).\n"
    except Exception as e:
        log += f"Gateway/cordon setup warning: {e}\n"

    # --- Renumber to contiguous 1..N (sweeps internal + cordon centroids) ---
    old_ids = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
    remap = {old: new for new, old in enumerate(old_ids, 1)}
    for old, new in remap.items():
        if old != new:
            conn.execute("UPDATE nodes SET node_id=? WHERE node_id=?", (-new, old))
    conn.execute("UPDATE nodes SET node_id=-node_id WHERE node_id<0")
    for old, new in remap.items():
        if old != new:
            conn.execute("UPDATE links SET a_node=? WHERE a_node=?", (new, old))
            conn.execute("UPDATE links SET b_node=? WHERE b_node=?", (new, old))
    conn.commit()

    centroid_map = {z: remap[n] for z, n in centroid_map.items()}
    cordon_map = {z: remap[n] for z, n in cordon_map.items()}
    log += f"Renumbered to contiguous IDs (max={max(remap.values())})\n"

    # --- Populate speed/capacity from link types ---
    links_data = conn.execute(
        "SELECT link_id, link_type, speed_ab, speed_ba, distance, lanes_ab, lanes_ba FROM links"
    ).fetchall()
    updates = []
    for lid, lt, sp_ab, sp_ba, dist, ln_ab, ln_ba in links_data:
        def_speed, cap_per_lane, def_lanes = LINK_DEFAULTS.get(lt, (25, 400, 1))
        speed_ab = _parse_speed(sp_ab) or def_speed
        speed_ba = _parse_speed(sp_ba) or speed_ab
        tt_ab = (dist / (speed_ab * 1609.34 / 60)) if dist > 0 else 0.01
        tt_ba = (dist / (speed_ba * 1609.34 / 60)) if dist > 0 else 0.01
        cap_ab = cap_per_lane * (ln_ab or def_lanes)
        cap_ba = cap_per_lane * (ln_ba or def_lanes)
        updates.append((speed_ab, speed_ba, tt_ab, tt_ba, cap_ab, cap_ba, lid))
    conn.executemany(
        "UPDATE links SET speed_ab=?,speed_ba=?,travel_time_ab=?,travel_time_ba=?,capacity_ab=?,capacity_ba=? WHERE link_id=?",
        updates,
    )
    conn.commit()
    conn.close()

    log += f"Populated speed/capacity for {len(updates)} links.\nSetup complete.\n"

    return {
        "centroid_map": centroid_map,
        "cordon_map": cordon_map,
        "bbox": bbox,
        "n_zones": len(centroid_map),
        "n_nodes": len(old_ids),
        "n_links": len(links_data),
        "largest_component_pct": round(100 * len(largest) / len(nodes_all), 1),
        "disconnected_zones": disconnected_zones,
        "gateways": gateways,
        "log": log,
    }


def _write_auto_od_matrix(path: str, auto_int: np.ndarray, ordered_zone_ids: list, od_full: pd.DataFrame) -> None:
    """Write the auto-only OD (zone_id-indexed, same layout as od_trip_matrix.csv).

    Starts from the full person-trip OD and overwrites each connected cell with
    its auto integer count; disconnected/omitted zones keep their original
    (person) value and are treated as auto — a screening-grade approximation.
    """
    auto_df = od_full.copy()
    for i, zi in enumerate(ordered_zone_ids):
        if zi not in auto_df.index:
            continue
        for j, zj in enumerate(ordered_zone_ids):
            col = str(zj)
            if col in auto_df.columns:
                auto_df.loc[zi, col] = int(auto_int[i, j])
    auto_df.to_csv(path)


def _volumes_by_link(results_df) -> dict[int, float]:
    """{link_id: PCE_tot} from an assignment results frame (indexed by link_id)."""
    if "PCE_tot" not in results_df.columns:
        return {}
    out: dict[int, float] = {}
    for lid, v in results_df["PCE_tot"].items():
        try:
            out[int(lid)] = float(v or 0.0)
        except (TypeError, ValueError):
            continue
    return out


def _match_counts(stations, link_attrs, vol_by_id):
    """Match each station to a modeled link at the given volumes; return the
    matched dicts (observed_volume + modeled_daily_pce + matched_link_type)."""
    modeled = [
        {"link_id": la[0], "name": la[1], "link_type": la[2], "lon": la[3], "lat": la[4],
         "volume": vol_by_id.get(la[0], 0.0)}
        for la in link_attrs
    ]
    out = []
    for st in stations:
        best = count_validation.match_station(st, modeled)
        if best:
            out.append({**st, "modeled_daily_pce": best["modeled_daily_pce"],
                        "matched_link_type": best["matched_link_type"],
                        "matched_link_id": int(best["link_id"])})
    return out


def _run_demand_nudge(assign_once, make_resident_mat, resident_od, ii_arr, n_assign,
                      fit_stations, holdout_stations, link_attrs, graph,
                      best_df, best_hold_obj, best_fit_ev, best_hold_ev, log):
    """Stage 2: light select-link-guided demand nudge on the resident internal
    OD, on top of the stage-1-calibrated network. Each iteration sets select-link
    on the fit-station links, assigns, reads the resident SL-OD (the Jacobian
    — which OD cells feed each counted link) + modeled volumes, nudges the
    internal OD toward counts (sparse + damped + clipped), re-assigns, and keeps
    the step only on a strict held-out improvement. Returns the updated best
    state + log. The OD-based resident_vmt / screening result are untouched."""
    import numpy as np
    n_zones = len(ii_arr)
    graph_link_ids = {int(x) for x in graph.graph["link_id"].values}
    internal = np.ix_(ii_arr, ii_arr)
    cur_od = np.array(resident_od, dtype=float)   # full n_assign × n_assign
    accepted = 0
    for it in range(CALIBRATION_DEMAND_MAX_ITER):
        fit_matched = _match_counts(fit_stations, link_attrs, _volumes_by_link(best_df))
        sl_sets, meta = {}, {}
        for m in fit_matched:
            lid, obs = m.get("matched_link_id"), float(m.get("observed_volume") or 0.0)
            if lid is None or obs <= 0 or int(lid) not in graph_link_ids:
                continue
            # Sanitize the select-link set NAME exactly as set_select_links does
            # (collapse whitespace) + bound to the 50-char matrix-core limit +
            # keep distinct stations distinct, or the SL-OD is stored under one
            # key and read under another (KeyError) / create_empty raises.
            raw = "_".join(str(m.get("station_id") or "").split())
            name = f"cal_{raw}"[:50]
            while name in sl_sets:
                name = f"cal_{len(sl_sets)}_{raw}"[:50]
            sl_sets[name] = [(int(lid), 0)]
            meta[name] = (int(lid), obs)
        if not sl_sets:
            break
        # Assign the current OD WITH select-link to get the Jacobian + volumes.
        cur_df, rc = assign_once(resident_matrix=make_resident_mat(cur_od), select_links=sl_sets)
        cur_vol = _volumes_by_link(cur_df)
        sl_od_by, ratio_by = {}, {}
        for name, (lid, obs) in meta.items():
            modeled = cur_vol.get(lid, 0.0)
            if modeled <= 0:
                continue
            try:
                arr = np.asarray(rc.results.select_link_od.matrix[name])
                sl = arr[:, :, 0] if arr.ndim == 3 else arr
                sl_od_by[name] = sl[internal]        # resident SL-OD, internal block
                ratio_by[name] = obs / modeled
            except Exception:
                continue
        if not sl_od_by:
            break
        mult = calibration.demand_nudge_multipliers(sl_od_by, ratio_by, n_zones)
        trial_od = cur_od.copy()
        trial_od[internal] = cur_od[internal] * mult
        trial_df, _ = assign_once(resident_matrix=make_resident_mat(trial_od))
        trial_vol = _volumes_by_link(trial_df)
        trial_hold = calibration.evaluate(_match_counts(holdout_stations, link_attrs, trial_vol))
        trial_obj = trial_hold["objective"]
        if trial_obj is not None and calibration.accept_step(
            best_hold_obj, trial_obj, tol=-CALIBRATION_MIN_IMPROVEMENT
        ):
            cur_od, best_df, best_hold_obj, best_hold_ev = trial_od, trial_df, trial_obj, trial_hold
            best_fit_ev = calibration.evaluate(_match_counts(fit_stations, link_attrs, trial_vol))
            accepted += 1
            log += f"  demand iter {it + 1}: accepted (holdout median APE {trial_hold['median_ape']}%).\n"
        else:
            log += f"  demand iter {it + 1}: rejected (no strict holdout improvement); stopping.\n"
            break
    # final_internal_od = the accepted nudged resident internal OD (ordered as
    # ii → ordered_zone_ids); None if no step was accepted. Used to write a
    # calibrated auto-OD for the (opt-in, distinct-name) calibrated resident VMT.
    final_internal_od = cur_od[internal].copy() if accepted else None
    return accepted, best_df, best_hold_obj, best_fit_ev, best_hold_ev, log, final_internal_od


def _run_calibration(proj_dir, out_dir, graph, resident_mat, external_mat, baseline_df, log,
                     *, resident_od=None, ii=None, assignment_centroids=None, make_resident_mat=None,
                     pkg_dir=None, ordered_zone_ids=None):
    """Staged count calibration outer loop. Returns (calibration_result_or_None,
    log). Reuses the prepared graph. Stage 1 (always): mutate per-road-class
    free-flow travel_time + capacity and re-run a fresh BFW assignment. Stage 2
    (when the resident_od/ii/assignment_centroids/make_resident_mat context is
    provided and enabled): a select-link-guided demand nudge on the resident
    internal OD. Every step is kept only if it improves the HELD-OUT count
    objective. Never mutates the OD-based resident_vmt or the screening result."""
    import csv as _csv
    import numpy as _np
    from aequilibrae.paths import TrafficAssignment, TrafficClass

    with open(_active_counts_path) as _cf:
        stations = list(_csv.DictReader(_cf))
    # Link attributes + link_id->class map, from the project DB (once).
    db = sqlite3.connect(os.path.join(proj_dir, "project_database.sqlite"))
    db.enable_load_extension(True)
    db.load_extension(SPATIALITE_PATH)
    try:
        rows = db.execute(
            "SELECT link_id, COALESCE(name,''), COALESCE(link_type,''), "
            "X(Centroid(geometry)), Y(Centroid(geometry)) FROM links "
            "WHERE name IS NOT NULL AND name != '' AND link_type != 'centroid_connector'"
        ).fetchall()
        type_by_id = {int(r[0]): r[1] for r in db.execute("SELECT link_id, link_type FROM links")}
    finally:
        db.close()
    link_attrs = [(int(l), n, t, float(x) if x is not None else None,
                   float(y) if y is not None else None) for l, n, t, x, y in rows]

    # Fit / holdout split — a 'calibrated' claim requires an out-of-sample holdout.
    all_matched = _match_counts(stations, link_attrs, _volumes_by_link(baseline_df))
    fit_stations, holdout_stations = calibration.split_holdout(all_matched)
    if not fit_stations or not holdout_stations:
        log += ("Calibration skipped: need matched counts in BOTH a fit and a holdout set "
                f"(matched {len(all_matched)}, fit {len(fit_stations)}, holdout {len(holdout_stations)}).\n")
        return None, log

    base_fit = calibration.evaluate(_match_counts(fit_stations, link_attrs, _volumes_by_link(baseline_df)))
    base_hold = calibration.evaluate(_match_counts(holdout_stations, link_attrs, _volumes_by_link(baseline_df)))
    log += (f"Calibration: {len(fit_stations)} fit / {len(holdout_stations)} holdout counts; "
            f"baseline fit median APE {base_fit['median_ape']}%, holdout {base_hold['median_ape']}%.\n")

    # Baseline graph fields to reset-then-apply-cumulative each iteration (so a
    # per-class factor can't compound incorrectly across iterations).
    base_tt = graph.graph["travel_time"].to_numpy(dtype=float).copy()
    base_cap = graph.graph["capacity"].to_numpy(dtype=float).copy()
    link_class = graph.graph["link_id"].map(type_by_id)

    def _assign_once(resident_matrix=None, select_links=None):
        """Run one BFW assignment. resident_matrix overrides the resident demand
        (stage-2 nudge); select_links attaches select-link to the resident class
        (dict name->[(link_id,dir)]). Returns (results_df, resident_class)."""
        rc = TrafficClass(name="resident", graph=graph, matrix=resident_matrix or resident_mat)
        ec = TrafficClass(name="external", graph=graph, matrix=external_mat)
        a = TrafficAssignment()
        for tc in (rc, ec):
            tc.set_pce(1.0)
            a.add_class(tc)
        if select_links:
            rc.set_select_links(select_links)
        a.set_cores(AEQ_CORES)
        a.set_vdf("BPR")
        a.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
        a.set_capacity_field("capacity")
        a.set_time_field("travel_time")
        a.max_iter = 50
        a.rgap_target = 0.01
        a.set_algorithm("bfw")
        a.execute()
        return a.results(), rc

    def _apply(cum):
        # factor>1 (under-assigned class) -> faster (tt down) + more capacity, so
        # the class attracts more equilibrium flow. Reset from baseline first.
        tt = base_tt.copy()
        cap = base_cap.copy()
        for cls, f in cum.items():
            m = (link_class == cls).to_numpy()
            tt[m] = base_tt[m] / f
            cap[m] = base_cap[m] * f
        graph.graph["travel_time"] = tt
        graph.graph["capacity"] = cap
        graph.set_graph("travel_time")

    base_hold_obj = base_hold["objective"]
    if base_hold_obj is None:
        log += "Calibration skipped: holdout objective is undefined (no usable holdout counts).\n"
        return None, log
    cum: dict[str, float] = {}
    best_df = baseline_df
    best_hold_obj = base_hold_obj
    best_fit_ev, best_hold_ev = base_fit, base_hold
    accepted = 0
    for it in range(CALIBRATION_MAX_ITER):
        fit_matched = _match_counts(fit_stations, link_attrs, _volumes_by_link(best_df))
        new_f = calibration.class_adjustment_factors(fit_matched)
        if not new_f:
            break
        trial_cum = calibration.compose_factors(cum, new_f)
        if trial_cum == cum:
            break  # nothing left to adjust
        _apply(trial_cum)
        trial_df, _ = _assign_once()
        trial_vol = _volumes_by_link(trial_df)
        trial_hold = calibration.evaluate(_match_counts(holdout_stations, link_attrs, trial_vol))
        trial_obj = trial_hold["objective"]
        # Accept ONLY on a STRICT held-out improvement — an equal-objective step
        # is a no-op and must never promote the run to the calibrated tier. A
        # negative tol makes accept_step require improvement by at least one
        # objective ULP (the objective is rounded to 1e-4).
        if trial_obj is not None and calibration.accept_step(
            best_hold_obj, trial_obj, tol=-CALIBRATION_MIN_IMPROVEMENT
        ):
            cum = trial_cum
            best_df = trial_df
            best_hold_obj = trial_obj
            best_fit_ev = calibration.evaluate(_match_counts(fit_stations, link_attrs, trial_vol))
            best_hold_ev = trial_hold
            accepted += 1
            log += (f"  iter {it + 1}: accepted (holdout median APE {trial_hold['median_ape']}%, "
                    f"factors { {k: round(v, 3) for k, v in cum.items()} }).\n")
        else:
            log += f"  iter {it + 1}: rejected (no strict holdout improvement); stopping.\n"
            break

    # Set the graph to the ACCEPTED stage-1 state (cum may be {} -> baseline) so
    # stage 2 nudges demand on the stage-1-calibrated network, not a rejected trial.
    _apply(cum)

    # ── Stage 2: select-link-guided demand nudge (ODME-lite) ──────────────
    # A stage-2 failure must NOT discard a valid stage-1 calibration — the
    # raise aborts the tuple-unpack, so best_* keep their stage-1 values.
    stage2_accepted = 0
    nudged_internal_od = None
    if (CALIBRATION_DEMAND_ENABLED and resident_od is not None and ii is not None
            and assignment_centroids is not None and make_resident_mat is not None):
        try:
            (stage2_accepted, best_df, best_hold_obj, best_fit_ev, best_hold_ev, log,
             nudged_internal_od) = _run_demand_nudge(
                _assign_once, make_resident_mat, resident_od, _np.asarray(ii), len(assignment_centroids),
                fit_stations, holdout_stations, link_attrs, graph, best_df, best_hold_obj,
                best_fit_ev, best_hold_ev, log,
            )
        except Exception as e:
            log += f"  stage-2 demand nudge failed ({e}); keeping the stage-1 calibrated result.\n"

    # Only claim the calibrated tier when the holdout GENUINELY improved.
    if (accepted + stage2_accepted) == 0 or best_hold_obj >= base_hold_obj:
        log += "Calibration: no step improved the holdout; keeping the uncalibrated screening result.\n"
        return None, log

    # Persist the calibrated link volumes (distinct artifact; the screening
    # link_volumes.csv is untouched).
    cal_csv = os.path.join(out_dir, "link_volumes_calibrated.csv")
    best_df.to_csv(cal_csv)

    # If the demand nudge changed the resident OD, write a CALIBRATED auto-OD
    # (opt-in calibrated resident VMT input) — the SCREENING od_auto_matrix.csv
    # with only the connected-internal cells overwritten by the nudged values,
    # so its zone COVERAGE matches the screening OD exactly (a determination
    # can't shift just from missing disconnected zones). Distinct file; the
    # screening od_auto_matrix.csv is untouched. None unless stage 2 accepted.
    calibrated_auto_od = None
    if nudged_internal_od is not None and pkg_dir and ordered_zone_ids is not None:
        try:
            src = os.path.join(pkg_dir, "od_auto_matrix.csv")
            if os.path.exists(src):
                # float dtype so the nudge's fractional trip values fit (the
                # screening auto OD is integer counts); the resident-VMT
                # estimator is float-safe.
                cal_od_df = pd.read_csv(src, index_col=0).astype(float)
                for i, zi in enumerate(ordered_zone_ids):
                    if zi not in cal_od_df.index:
                        continue
                    for j, zj in enumerate(ordered_zone_ids):
                        col = str(zj)
                        # Only overwrite cells the nudge actually carries flow for.
                        # The nudge OD had network-unreachable pairs zeroed for the
                        # assignment; leaving those at their screening value keeps
                        # the calibrated-vs-screening delta PURELY the count nudge
                        # (not an unreachable-trip removal) on network-island areas.
                        v = float(nudged_internal_od[i, j])
                        if col in cal_od_df.columns and v > 0:
                            cal_od_df.loc[zi, col] = v
                cal_od_path = os.path.join(pkg_dir, "od_auto_matrix_calibrated.csv")
                cal_od_df.to_csv(cal_od_path)
                calibrated_auto_od = os.path.basename(cal_od_path)
                log += "Wrote calibrated auto-OD (od_auto_matrix_calibrated.csv) for the opt-in calibrated resident VMT.\n"
        except Exception as e:
            log += f"Calibrated auto-OD write warning ({e}); the opt-in calibrated VMT will be absent.\n"
    log += (f"Calibration complete: stage-1 {accepted} + stage-2 (demand) {stage2_accepted} "
            f"accepted step(s). Holdout median APE {base_hold['median_ape']}% -> "
            f"{best_hold_ev['median_ape']}%.\n")
    return {
        "method": (
            "Staged count calibration. Stage 1: per-road-class free-flow speed + capacity tuned "
            "toward observed AADT. Stage 2: a light select-link-guided demand nudge on the "
            "resident internal OD (sparse, damped, clipped) for the residual. Each step re-runs "
            "BFW equilibrium and is kept only if it improves a held-out (never-fit) count set. "
            "Screening-grade calibrated result — the OD-based resident_vmt (CEQA input) is unchanged."
        ),
        "accepted_iterations": accepted,
        "demand_nudge_iterations": stage2_accepted,
        "applied_class_factors": {k: round(v, 4) for k, v in cum.items()},
        "holdout_station_count": len(holdout_stations),
        "fit_station_count": len(fit_stations),
        "baseline": {"fit": base_fit, "holdout": base_hold},
        "calibrated": {"fit": best_fit_ev, "holdout": best_hold_ev},
        "holdout_station_ids": sorted(str(s.get("station_id")) for s in holdout_stations),
        "calibrated_link_volumes": os.path.basename(cal_csv),
        "calibrated_auto_od": calibrated_auto_od,
    }, log


# ─── Stage 2: Network Assignment ───────────────────────────────────────
def stage_assignment(run_id: str, stage_id: str, work_dir: str, setup_result: dict, pkg_dir: str) -> dict:
    from aequilibrae import Project
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

    proj_dir = os.path.join(work_dir, "aeq_project")
    out_dir = os.path.join(work_dir, "run_output")
    os.makedirs(out_dir, exist_ok=True)

    centroid_map = setup_result["centroid_map"]
    # Keys might be strings after JSON round-trip
    centroid_map = {int(k): int(v) for k, v in centroid_map.items()}
    cordon_map = {int(k): int(v) for k, v in (setup_result.get("cordon_map") or {}).items()}
    centroids_sorted = sorted(centroid_map.values())          # INTERNAL zones only
    n_zones = len(centroids_sorted)
    # The assignment graph carries internal + external cordon centroids; cordons
    # only ever appear in the assembled assignment matrix — internal logic (mode
    # choice, resident VMT, od_array) stays on the internal sub-block.
    assignment_centroids = sorted(set(centroids_sorted) | set(cordon_map.values()))
    n_assign = len(assignment_centroids)
    _pos = {node: k for k, node in enumerate(assignment_centroids)}
    ii = np.array([_pos[c] for c in centroids_sorted])        # internal positions in the full matrix

    log = "Building graph...\n"

    # Per-run count calibration (launch option > AEQ_CALIBRATE env > off). Resolved
    # here from the run row (a fresh read — the assignment stage runs in its own
    # process, so setup's run_row isn't in memory) so it can BOTH gate calibration
    # below AND drive count auto-ingest for this run: calibration needs a count
    # set, so a per-run opt-in must fetch one even when the deployment-level
    # COUNT_AUTO_INGEST is off.
    run_row = sb_get_run(run_id)
    calibrate_requested = resolve_calibration_enabled(run_row)

    # Resolve the counts used for validation/calibration for THIS run: auto-fetch
    # local DOT AADT for the study area when count auto-ingest is on (deployment
    # env OR this run's calibrate opt-in) and the area is in a registered region,
    # else the module default. Off-Nevada CA runs get count-backed validation
    # against local Caltrans counts instead of matching nothing against the Nevada
    # priority file.
    global _active_counts_path
    _active_counts_path = (
        auto_ingest_counts(setup_result.get("bbox"), proj_dir, out_dir,
                           calibrate_requested=calibrate_requested)
        or VALIDATION_COUNTS_PATH
    )
    if _active_counts_path != VALIDATION_COUNTS_PATH:
        log += f"Auto-ingested local DOT AADT counts for validation ({os.path.basename(_active_counts_path)}).\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    project = Project()
    project.open(proj_dir)
    project.network.build_graphs(modes=["c"])
    graph = project.network.graphs["c"]
    # distance_net zeroes virtual centroid connectors so the routed-distance
    # skim shares resident_vmt_network's connector-excluded basis (the
    # convergence diagnostic compares like with like; connectors are modeling
    # artifacts, counted by neither VMT estimator). graph.network carries no
    # link_type column, so connector ids come from the project DB. Added
    # BEFORE prepare_graph so the field is carried into the compressed graph.
    # Diagnostic-only plumbing: any failure here must degrade to the plain
    # travel-time skim (diagnostic silently absent), never fail the stage.
    skim_fields = ["travel_time"]
    try:
        _conn_db = sqlite3.connect(os.path.join(proj_dir, "project_database.sqlite"))
        try:
            connector_ids = {
                int(r[0]) for r in _conn_db.execute(
                    "SELECT link_id FROM links WHERE link_type = 'centroid_connector'"
                )
            }
        finally:
            _conn_db.close()
        graph.network["distance_net"] = np.where(
            graph.network["link_id"].isin(connector_ids), 0.0, graph.network["distance"]
        )
        skim_fields = ["travel_time", "distance", "distance_net"]
    except Exception as e:
        log += f"Convergence skim setup warning ({e}); routed-circuity diagnostic disabled.\n"
    graph.set_graph("travel_time")
    graph.prepare_graph(np.array(assignment_centroids))
    graph.set_blocked_centroid_flows(True)
    # "distance"/"distance_net" ride along so the assignment classes carry
    # blended, flow-consistent routed-distance skims (diagnostic inputs).
    graph.set_skimming(skim_fields)

    log += f"Graph: {graph.num_links} links, {graph.num_nodes} nodes\n"
    log += "Running skims...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    skimming = NetworkSkimming(graph)
    skimming.set_cores(AEQ_CORES)
    skimming.execute()
    skim_mat = skimming.results.skims
    time_skim_full = skim_mat.matrix["travel_time"]          # (n_assign × n_assign)
    time_skim = time_skim_full[np.ix_(ii, ii)]               # internal sub-block

    finite = np.isfinite(time_skim) & (time_skim > 0)
    np.fill_diagonal(finite, False)
    n_reachable = int(finite.sum())
    n_pairs = n_zones * (n_zones - 1)

    avg_time = float(np.mean(time_skim[finite])) if n_reachable > 0 else None
    max_time = float(np.max(time_skim[finite])) if n_reachable > 0 else None

    skim_mat.export(os.path.join(out_dir, "travel_time_skims.omx"))
    log += f"Reachable OD pairs: {n_reachable}/{n_pairs}\n"

    # Load demand
    log += "Loading demand...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    od_full = pd.read_csv(os.path.join(pkg_dir, "od_trip_matrix.csv"), index_col=0)
    remap_inv = {v: k for k, v in centroid_map.items()}
    ordered_zone_ids = [int(remap_inv[c]) for c in centroids_sorted]
    od_array = np.zeros((n_zones, n_zones))
    for i, ci in enumerate(centroids_sorted):
        for j, cj in enumerate(centroids_sorted):
            try:
                od_array[i, j] = od_full.loc[remap_inv[ci], str(remap_inv[cj])]
            except KeyError:
                pass

    internal_person_trips = float(od_array.sum())

    # --- Mode choice: split internal person-trips into auto / transit / active;
    # only the auto matrix is assigned. Transit LOS comes from the bundled GTFS
    # (gtfs_skim); transit share is 0 where no service. Through-traffic (gateways,
    # below) stays 100% auto. ---
    # A stale od_auto_matrix.csv from a prior in-place run of the same run_id
    # must never outlive a disabled/failed split, or stage_artifacts would
    # mislabel the resident VMT basis. Remove it unless THIS invocation writes
    # a fresh one below.
    auto_od_path = os.path.join(pkg_dir, "od_auto_matrix.csv")

    def _clear_stale_auto_od():
        if os.path.exists(auto_od_path):
            try:
                os.remove(auto_od_path)
            except OSError:
                pass

    mode_split = None
    if MODE_SPLIT_ENABLED:
        try:
            zattr_mc = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"))
            zattr_mc["zone_id"] = zattr_mc["zone_id"].astype(int)
            zattr_mc = zattr_mc.set_index("zone_id", drop=False)
            zc = zattr_mc.loc[ordered_zone_ids, ["centroid_lon", "centroid_lat", "area_sq_mi"]]
            lons = zc["centroid_lon"].to_numpy(dtype=float)
            lats = zc["centroid_lat"].to_numpy(dtype=float)
            areas = zc["area_sq_mi"].to_numpy(dtype=float)
            dist_miles = np.zeros((n_zones, n_zones))
            for i in range(n_zones):
                for j in range(n_zones):
                    dist_miles[i, j] = (
                        intrazonal_miles(areas[i]) if i == j
                        else haversine_miles(lons[i], lats[i], lons[j], lats[j])
                    )

            # Transit LOS from the bundled GTFS. A feed failure falls back to the
            # auto/active split, but records transit_status so a 0 transit share
            # is never mistaken for "no transit demand".
            transit_skim = None
            transit_status = "modeled"
            transit_los_meta = {}
            try:
                discovered_url = None
                explicit_feed = bool(os.getenv("GTFS_PATH") or os.getenv("GTFS_URL"))
                discovering = GTFS_DISCOVER and not explicit_feed
                if discovering:
                    study_bbox = (float(lons.min()), float(lats.min()), float(lons.max()), float(lats.max()))
                    discovered_url = gtfs_skim.discover_feed(study_bbox)
                    if discovered_url:
                        log += f"GTFS discovery selected a feed covering this study area: {discovered_url}\n"

                if discovering and not discovered_url:
                    # Discovery on, but the catalog has no scheduled feed covering
                    # this area — do NOT fall back to the bundled Nevada feed.
                    transit_status = "no_local_feed"
                    log += (
                        "GTFS discovery found no scheduled feed covering this study area; "
                        "transit not modeled (transit share 0 — NOT 'no transit demand').\n"
                    )
                else:
                    los = gtfs_skim.load_feed(url=discovered_url)
                    if not gtfs_skim.feed_covers(los, lons, lats):
                        # The feed loaded but none of its stops fall within the study
                        # area — skimming it would report a misleading transit_status
                        # of "modeled" with a 0 share. Be honest: no local feed here.
                        transit_status = "no_local_feed"
                        log += (
                            "No GTFS feed covers this study area; transit not modeled "
                            "(transit share 0 — NOT 'no transit demand'). Provide a local feed "
                            "via GTFS_PATH/GTFS_URL to model transit for this area.\n"
                        )
                    else:
                        transit_skim = gtfs_skim.transit_skim(los, lons, lats)
                        transit_los_meta = {
                            "service_day": los.service_day,
                            "service_period": f"{los.service_start}..{los.service_end}",
                            "n_routes": los.n_routes,
                            "n_served_stops": los.n_stops,
                            "n_lines": len(los.lines),
                            "access_buffer_miles": gtfs_skim.GTFS_ACCESS_MILES,
                            "flat_fare_usd": gtfs_skim.GTFS_FLAT_FARE,
                            "source_url": discovered_url or "bundled_or_env",
                        }
            except Exception as te:
                transit_status = "feed_unavailable"
                log += f"Transit LOS unavailable ({te}); transit reported as 0 (feed_unavailable).\n"

            auto_float, auto_int, transit_int, active_int, mm = mode_choice.split_matrix(
                od_array, time_skim, dist_miles, transit=transit_skim
            )
            _write_auto_od_matrix(auto_od_path, auto_int, ordered_zone_ids, od_full)
            od_array = auto_float
            # Shares from the INTEGER trip counts so the percent KPIs agree with
            # the *_person_trips count KPIs (active is the residual → sums to 100).
            total_int = mm["auto_trips"] + mm["transit_trips"] + mm["active_trips"]
            if total_int > 0:
                share_auto = round(100.0 * mm["auto_trips"] / total_int, 2)
                share_transit = round(100.0 * mm["transit_trips"] / total_int, 2)
                shares = {
                    "auto": share_auto,
                    "transit": share_transit,
                    "active": round(max(100.0 - share_auto - share_transit, 0.0), 2),
                }
            else:
                shares = {"auto": 100.0, "transit": 0.0, "active": 0.0}
            mode_split = {
                **mm,
                "shares_pct": shares,
                "transit_status": transit_status,
                "transit_los": transit_los_meta,
            }
            log += (
                f"Mode choice: auto {mm['auto_trips']:,} / transit {mm['transit_trips']:,} / "
                f"active {mm['active_trips']:,} "
                f"(auto {shares['auto']:.1f}% · transit {shares['transit']:.2f}% · active {shares['active']:.1f}%; "
                f"transit {transit_status}, {mm['transit_available_pairs']}/{mm['transit_total_pairs']} pairs served)\n"
            )
        except Exception as e:
            log += f"Mode choice warning ({e}); assigning all internal trips as auto.\n"
            mode_split = None
            _clear_stale_auto_od()
    else:
        _clear_stale_auto_od()

    # --- Assemble the full assignment demand matrix over internal + cordon
    # zones. Internal auto demand (od_array = auto_float from mode choice, or the
    # full internal OD if mode choice is off) sits in the internal block.
    # External gateway trips enter/exit at CORDON centroids placed on the
    # boundary highways, so through-traffic is forced ACROSS the crossing highway
    # link instead of dumping onto local roads. Each cordon's boundary-crossing
    # volume splits into an internal-destined portion (1−share; distributed by
    # job/pop share) and a pass-through portion (share; routed to the SAME route's
    # other cordon) — this loads the interior mainline ONLY for routes detected
    # crossing the boundary at two cordons (e.g. an interstate that traverses the
    # county); single-crossing routes have no partner and stay 100% internal. The
    # share is a fixed, documented screening assumption — NOT tuned to counts. ---
    # Demand is kept in TWO matrices so the assignment can run one traffic
    # class per matrix (M7): `resident` = internal auto demand; `external` =
    # cordon-injected boundary trips + routed pass-through. Per-class link
    # flows then give network-routed resident VMT with through-traffic
    # isolated exactly (link_vmt.py) instead of the circuity approximation.
    resident_od = np.zeros((n_assign, n_assign))
    resident_od[np.ix_(ii, ii)] = od_array
    external_od = np.zeros((n_assign, n_assign))
    external_gateway_trips = 0.0
    passthrough_trips = 0.0
    gateways = setup_result.get("gateways") or []
    active_gws = [g for g in gateways if g.get("cordon_zone_id") and int(g["cordon_zone_id"]) in cordon_map]
    if active_gws:
        try:
            zattr = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"))
            zattr["zone_id"] = zattr["zone_id"].astype(int)
            zattr = zattr.set_index("zone_id", drop=False)
            ordered_df = zattr.loc[ordered_zone_ids, ["est_population", "total_jobs"]].reset_index(drop=True)
            job_shares, pop_shares = build_cordon_injections(ordered_df)
            partners = pair_passthrough_cordons(active_gws)  # cordon_zid → same-route partners
            for g in active_gws:
                cordon_zid = int(g["cordon_zone_id"])
                cpos = _pos[cordon_map[cordon_zid]]
                pt = PASSTHROUGH_SHARE if partners.get(cordon_zid) else 0.0  # only paired routes pass through
                internal_frac = 1.0 - pt
                external_od[cpos, ii] += float(g["daily_in"]) * internal_frac * job_shares    # external → internal
                external_od[ii, cpos] += float(g["daily_out"]) * internal_frac * pop_shares   # internal → external
                external_gateway_trips += float(g["daily_in"]) + float(g["daily_out"])
                if pt > 0.0:
                    through_vol = float(g["daily_in"]) * pt
                    dest_cordons = partners[cordon_zid]
                    per_dest = through_vol / len(dest_cordons)
                    for dest_zid in dest_cordons:
                        dpos = _pos[cordon_map[int(dest_zid)]]
                        external_od[cpos, dpos] += per_dest   # enter at this cordon, exit at same-route cordon
                        passthrough_trips += per_dest
            log += (
                f"Loaded {external_gateway_trips:,.0f} external gateway trips via {len(active_gws)} "
                f"cordon centroid(s) on boundary highways ({passthrough_trips:,.0f} routed as "
                f"pass-through at share {PASSTHROUGH_SHARE:.2f} across {len(partners)} paired cordon(s)).\n"
            )
        except Exception as e:
            log += f"Cordon gateway loading warning: {e}\n"

    # total_trips stays person-scale (internal person + gateway); routable_trips
    # reflects the assigned (auto + gateway) demand.
    total_trips = internal_person_trips + external_gateway_trips
    unreachable = ~np.isfinite(time_skim_full)
    resident_od[unreachable] = 0
    external_od[unreachable] = 0
    routable_trips = float(resident_od.sum() + external_od.sum())

    # NOTE: AequilibraE names assignment-result columns after the matrix CORE
    # (matrix.view_names), NOT the TrafficClass name — so each class's matrix
    # needs a distinct core name or the per-class columns collide. The cores
    # "resident"/"external" become link_volumes.csv columns resident_ab/ba/tot
    # and external_ab/ba/tot, which link_vmt.py reads.
    def _demand_matrix(file_stem: str, core_name: str, demand_array: np.ndarray) -> AequilibraeMatrix:
        mat = AequilibraeMatrix()
        mat.create_empty(
            file_name=os.path.join(out_dir, f"{file_stem}.omx"),
            zones=n_assign, matrix_names=[core_name], memory_only=False,
        )
        mat.index = np.array(assignment_centroids)
        mat.matrix[core_name][:, :] = demand_array
        mat.computational_view([core_name])
        return mat

    # demand.omx keeps its historical meaning (the full assigned demand) for
    # artifact continuity; the per-class matrices are what get assigned.
    _demand_matrix("demand", "demand", resident_od + external_od)
    resident_mat = _demand_matrix("resident_demand", "resident", resident_od)
    external_mat = _demand_matrix("external_demand", "external", external_od)

    log += f"Demand: {total_trips:,.0f} total, {routable_trips:,.0f} routable "
    log += f"(resident {resident_od.sum():,.0f} · external {external_od.sum():,.0f})\n"
    log += "Running BFW assignment (2 classes: resident, external)...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    assig = TrafficAssignment()
    resident_class = TrafficClass(name="resident", graph=graph, matrix=resident_mat)
    external_class = TrafficClass(name="external", graph=graph, matrix=external_mat)
    for tc in (resident_class, external_class):
        tc.set_pce(1.0)
        assig.add_class(tc)
    assig.set_cores(AEQ_CORES)
    assig.set_vdf("BPR")
    assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
    assig.set_capacity_field("capacity")
    assig.set_time_field("travel_time")
    assig.max_iter = 50
    assig.rgap_target = 0.01
    assig.set_algorithm("bfw")

    # Select-link corridor attribution: resolve the validation-station
    # screenlines to link_ids and attach them to BOTH traffic classes BEFORE
    # execute (aequilibrae copies each class's _selected_links into its results
    # at execute start; setting after has no effect). Purely diagnostic — any
    # failure logs and skips, and set_select_links is all-or-nothing on an
    # unknown link_id, so screenlines are pre-filtered to graph-present links.
    select_link_sets: dict[str, list[tuple[int, int]]] = {}
    try:
        if COUNT_VALIDATION_ENABLED and os.path.exists(_active_counts_path):
            import csv as _csv
            with open(_active_counts_path) as _f:
                _sl_stations = list(_csv.DictReader(_f))
            _sl_db = sqlite3.connect(os.path.join(proj_dir, "project_database.sqlite"))
            _sl_db.enable_load_extension(True)
            _sl_db.load_extension(SPATIALITE_PATH)
            try:
                _sl_rows = _sl_db.execute(
                    "SELECT link_id, COALESCE(name,''), COALESCE(link_type,''), "
                    "X(Centroid(geometry)), Y(Centroid(geometry)) FROM links "
                    "WHERE name IS NOT NULL AND name != '' AND link_type != 'centroid_connector'"
                ).fetchall()
            finally:
                _sl_db.close()
            _sl_modeled = [
                {"link_id": int(lid), "name": nm, "link_type": lt,
                 "lon": float(cx) if cx is not None else None,
                 "lat": float(cy) if cy is not None else None}
                for lid, nm, lt, cx, cy in _sl_rows
            ]
            _screenlines = select_link.select_link_screenlines(_sl_stations, _sl_modeled)
            _graph_link_ids = {int(x) for x in graph.graph["link_id"].values}
            for _name, _link_ids in _screenlines.items():
                _present = [lid for lid in _link_ids if lid in _graph_link_ids]
                if _present:
                    select_link_sets[_name] = [(lid, 0) for lid in _present]  # dir 0 = both
            if select_link_sets:
                resident_class.set_select_links(select_link_sets)
                external_class.set_select_links(select_link_sets)
                log += (
                    f"Select-link: {len(select_link_sets)} corridor screenline(s) attached "
                    f"({sum(len(v) for v in select_link_sets.values())} links).\n"
                )
                sb_patch_stage(stage_id, {"log_tail": log})
    except Exception as e:
        select_link_sets = {}
        log += f"Select-link setup warning ({e}); corridor attribution skipped.\n"

    assig.execute()

    rgap = getattr(assig.assignment, "rgap", float("nan"))
    iters = getattr(assig.assignment, "iteration", 50)

    results_df = assig.results()
    results_df.to_csv(os.path.join(out_dir, "link_volumes.csv"))
    loaded_links = int((results_df["PCE_tot"] > 0).sum()) if "PCE_tot" in results_df.columns else 0

    # Convergence diagnostic: what circuity does THIS run's routing imply?
    # Demand-weighted routed distance (blended assignment skim, resident class)
    # over great-circle distance, interzonal pairs only. Diagnostic — never
    # alters the OD estimator's fixed 1.30, never fails the run.
    convergence_diag = None
    try:
        zattr_cd = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"))
        zattr_cd["zone_id"] = zattr_cd["zone_id"].astype(int)
        zattr_cd = zattr_cd.set_index("zone_id", drop=False)
        zc_cd = zattr_cd.loc[ordered_zone_ids, ["centroid_lon", "centroid_lat"]]
        lons_cd = zc_cd["centroid_lon"].to_numpy(dtype=float)
        lats_cd = zc_cd["centroid_lat"].to_numpy(dtype=float)
        straight_mi = np.zeros((n_zones, n_zones))
        for i in range(n_zones):
            for j in range(n_zones):
                if i != j:
                    straight_mi[i, j] = haversine_miles(lons_cd[i], lats_cd[i], lons_cd[j], lats_cd[j])
        routed_m = resident_class.results.skims.matrix["distance_net"][np.ix_(ii, ii)]
        convergence_diag = convergence.routed_effective_circuity(
            resident_od[np.ix_(ii, ii)], routed_m, straight_mi
        )
        if convergence_diag:
            log += (
                f"Routed effective circuity (resident, demand-weighted): "
                f"{convergence_diag['effective_circuity']} vs {convergence_diag['assumed_circuity']} assumed\n"
            )
    except Exception as e:
        log += f"Convergence diagnostic warning: {e}\n"

    # Select-link corridor attribution: classify each screenline's OD (the
    # trips that route through it) into local / commute / through by cordon
    # endpoint. Diagnostic; the SL-OD matrices are indexed over the assignment
    # centroids, so cordon membership marks the boundary-injection zones.
    select_link_analysis = None
    if select_link_sets:
        cordon_nodes = set(cordon_map.values())
        is_cordon = np.array([c in cordon_nodes for c in assignment_centroids])

        def _sl_od(cls, name):
            arr = np.asarray(cls.results.select_link_od.matrix[name])
            return arr[:, :, 0] if arr.ndim == 3 else arr

        # Per-screenline try/except: one anomalous screenline logs and skips
        # rather than voiding the whole run's corridor attribution.
        screenlines_out = []
        for name in select_link_sets:
            try:
                combined = _sl_od(resident_class, name) + _sl_od(external_class, name)
                attr = select_link.link_attribution(combined, is_cordon)
                attr["screenline"] = name
                attr["link_ids"] = [lid for lid, _ in select_link_sets[name]]
                screenlines_out.append(attr)
            except Exception as e:
                log += f"Select-link screenline {name} skipped ({e}).\n"
        if screenlines_out:
            select_link_analysis = {
                "screenlines": screenlines_out,
                "cordon_zone_count": int(is_cordon.sum()),
            }
            reached = [s for s in screenlines_out if s["total_trips"] > 0]
            if reached:
                log += (
                    f"Select-link attribution: {len(reached)}/{len(screenlines_out)} screenline(s) "
                    f"reached; through share "
                    f"{min(s['through_share'] for s in reached):.0%}–"
                    f"{max(s['through_share'] for s in reached):.0%}.\n"
                )

    # ── Count-based calibration (OPT-IN, off by default) ──────────────────
    # Staged: (1) per-road-class free-flow speed + capacity toward counts, then
    # (2) a select-link-guided demand nudge on the resident internal OD. Each
    # step re-runs equilibrium and is kept ONLY if it improves a held-out
    # (never-fit) count set. The OD-based resident_vmt (CEQA input) is never
    # touched; calibrated outputs get distinct KPI names.
    calibration_result = None
    if should_run_calibration(calibrate_requested, _active_counts_path):
        try:
            def _make_resident_mat(demand_array):
                m = AequilibraeMatrix()
                m.create_empty(zones=n_assign, matrix_names=["resident"], memory_only=True)
                m.index = np.array(assignment_centroids)
                m.matrix["resident"][:, :] = demand_array
                m.computational_view(["resident"])
                return m

            calibration_result, log = _run_calibration(
                proj_dir, out_dir, graph, resident_mat, external_mat, results_df, log,
                resident_od=resident_od, ii=ii, assignment_centroids=assignment_centroids,
                make_resident_mat=_make_resident_mat, pkg_dir=pkg_dir, ordered_zone_ids=ordered_zone_ids,
            )
        except Exception as e:
            log += f"Calibration warning ({e}); keeping the uncalibrated screening result.\n"

    project.close()

    log += f"Converged: gap={rgap:.6f}, iterations={iters}\n"
    log += f"Links with volume: {loaded_links}/{len(results_df)}\n"

    return {
        "convergence": {"final_gap": float(rgap) if np.isfinite(rgap) else None, "iterations": int(iters)},
        "network": {"links": int(graph.num_links), "nodes": int(graph.num_nodes), "zones": n_zones},
        "demand": {
            "total_trips": total_trips,
            "routable_trips": routable_trips,
            "external_gateway_trips": external_gateway_trips,
        },
        "mode_split": mode_split,
        "skims": {"reachable_pairs": n_reachable, "total_pairs": n_pairs,
                  "avg_time_min": avg_time, "max_time_min": max_time},
        "loaded_links": loaded_links,
        "convergence_diagnostic": convergence_diag,
        "select_link_analysis": select_link_analysis,
        "calibration": calibration_result,
        "log": log,
    }


# ─── Stage 3: Artifact Extraction ──────────────────────────────────────
def compute_daily_vmt(db_path: str, link_volumes_csv: str) -> float | None:
    """Total daily VMT = Σ (link assigned volume × link length in miles).

    AequilibraE stores link `distance` in metres, so we convert to miles.
    Virtual centroid connectors carry demand on/off the network but are not
    real roadway, so they are excluded from VMT. Returns None if inputs are
    missing.
    """
    if not (os.path.exists(db_path) and os.path.exists(link_volumes_csv)):
        return None

    import csv as _csv

    meters_per_mile = 1609.34
    pce_by_link: dict[int, float] = {}
    with open(link_volumes_csv) as fh:
        for row in _csv.DictReader(fh):
            raw_id = row.get("link_id") or row.get("") or ""
            try:
                lid = int(float(raw_id))
            except (TypeError, ValueError):
                continue
            try:
                pce = float(row.get("PCE_tot", 0) or 0)
            except (TypeError, ValueError):
                pce = 0.0
            if pce:
                pce_by_link[lid] = pce

    if not pce_by_link:
        return 0.0

    conn = sqlite3.connect(db_path)
    try:
        vmt = 0.0
        for lid, link_type, distance in conn.execute(
            "SELECT link_id, link_type, distance FROM links"
        ):
            if link_type == "centroid_connector":
                continue
            pce = pce_by_link.get(int(lid))
            if not pce:
                continue
            dist_m = float(distance) if distance is not None else 0.0
            vmt += pce * (dist_m / meters_per_mile)
    finally:
        conn.close()
    return vmt


def _run_count_validation(db_path: str, link_volumes_csv: str) -> dict | None:
    """Match assigned link volumes to observed traffic counts → screening-grade
    fit summary. Returns None when disabled or inputs are missing (never fails
    the run)."""
    import csv as _csv
    if not (COUNT_VALIDATION_ENABLED and os.path.exists(_active_counts_path)
            and os.path.exists(db_path) and os.path.exists(link_volumes_csv)):
        return None
    with open(_active_counts_path) as f:
        stations = list(_csv.DictReader(f))
    if not stations:
        return None
    pce: dict[int, float] = {}
    with open(link_volumes_csv) as f:
        for row in _csv.DictReader(f):
            try:
                pce[int(float(row["link_id"]))] = float(row.get("PCE_tot") or 0.0)
            except (TypeError, ValueError, KeyError):
                continue
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    conn.load_extension(SPATIALITE_PATH)
    try:
        rows = conn.execute(
            "SELECT link_id, COALESCE(name,''), COALESCE(link_type,''), "
            "X(Centroid(geometry)), Y(Centroid(geometry)) FROM links "
            "WHERE name IS NOT NULL AND name != '' AND link_type != 'centroid_connector'"
        ).fetchall()
    finally:
        conn.close()
    modeled_links = [
        {
            "link_id": int(lid), "name": name, "link_type": lt,
            "lon": float(cx) if cx is not None else None,
            "lat": float(cy) if cy is not None else None,
            "volume": pce.get(int(lid), 0.0),
        }
        for lid, name, lt, cx, cy in rows
    ]
    return count_validation.validate_against_counts(stations, modeled_links)


def stage_artifacts(
    run_id: str,
    stage_id: str,
    work_dir: str,
    setup_result: dict,
    assign_result: dict,
    package_meta: dict | None = None,
) -> str:
    out_dir = os.path.join(work_dir, "run_output")
    bbox = setup_result.get("bbox")
    model_area_label = (
        f"Dynamic study area ({bbox[0]:.5f},{bbox[1]:.5f} to {bbox[2]:.5f},{bbox[3]:.5f})"
        if bbox and len(bbox) == 4
        else "Dynamic study area"
    )
    log = "Extracting artifacts...\n"

    # ── Daily VMT (Σ link volume × length in miles) and per-capita VMT ──
    db_path = os.path.join(work_dir, "aeq_project", "project_database.sqlite")
    link_volumes_csv = os.path.join(out_dir, "link_volumes.csv")
    calibration_result = assign_result.get("calibration")
    daily_vmt = None
    vmt_per_capita = None
    population_total = None
    try:
        population_total = float(package_meta["total_population"]) if package_meta and package_meta.get("total_population") else None
    except (TypeError, ValueError):
        population_total = None
    try:
        daily_vmt = compute_daily_vmt(db_path, link_volumes_csv)
        if daily_vmt is not None:
            daily_vmt = round(daily_vmt, 1)
            if population_total and population_total > 0:
                vmt_per_capita = round(daily_vmt / population_total, 4)
        log += (
            f"Daily VMT: {daily_vmt:,.0f} vehicle-miles"
            + (f" · {vmt_per_capita} VMT/capita (pop {population_total:,.0f})\n" if vmt_per_capita is not None else " (population unknown — per-capita not derived)\n")
        )
    except Exception as e:
        log += f"VMT computation warning: {e}\n"

    # Calibrated network VMT — from the calibrated link volumes, under a DISTINCT
    # KPI name so it never feeds the CEQA screen (which reads exact screening
    # names). None unless calibration ran and improved the holdout.
    daily_vmt_calibrated = None
    if calibration_result and calibration_result.get("calibrated_link_volumes"):
        try:
            cal_csv = os.path.join(out_dir, calibration_result["calibrated_link_volumes"])
            _cvmt = compute_daily_vmt(db_path, cal_csv)
            if _cvmt is not None:
                daily_vmt_calibrated = round(_cvmt, 1)
                log += f"Calibrated daily VMT: {daily_vmt_calibrated:,.0f} vehicle-miles (network, distinct from the CEQA input).\n"
        except Exception as e:
            log += f"Calibrated VMT computation warning: {e}\n"

    # ── Per-class network VMT (M7): the 2-class assignment leaves resident_tot /
    # external_tot flow columns on link_volumes.csv; flow × routed link length
    # separates resident VMT from through+external VMT on the REAL network,
    # no circuity approximation. Never fails the run; a single-class CSV (pre-M7
    # rerun) simply reports neither KPI.
    resident_vmt_network = None
    through_vmt_network = None
    try:
        if os.path.exists(db_path) and os.path.exists(link_volumes_csv):
            import csv as _csv
            with open(link_volumes_csv) as fh:
                class_flows = link_vmt.parse_link_flows(
                    _csv.DictReader(fh),
                    {"resident": "resident_tot", "external": "external_tot"},
                )
            if class_flows:
                conn = sqlite3.connect(db_path)
                try:
                    link_rows = conn.execute(
                        "SELECT link_id, link_type, distance FROM links"
                    ).fetchall()
                finally:
                    conn.close()
                per_class = link_vmt.per_class_vmt(class_flows, link_rows)
                if "resident" in per_class:
                    resident_vmt_network = round(per_class["resident"], 1)
                if "external" in per_class:
                    through_vmt_network = round(per_class["external"], 1)
                if resident_vmt_network is not None:
                    log += (
                        f"Network-routed VMT split: resident {resident_vmt_network:,.0f} · "
                        f"through+external {through_vmt_network if through_vmt_network is not None else 0:,.0f} vehicle-miles\n"
                    )
    except Exception as e:
        log += f"Per-class network VMT warning: {e}\n"

    # ── Screening GHG (CO2e) from network VMT — EMFAC-style rate × VMT, ─────────
    # annualized. A published-rate × VMT product, NOT an EMFAC run of record.
    emissions_screen = None
    try:
        _emissions_year = int(os.getenv("AEQ_EMISSIONS_ANALYSIS_YEAR", str(emissions.DEFAULT_ANALYSIS_YEAR)))
        emissions_screen = emissions.estimate_screening_emissions(daily_vmt, population_total, _emissions_year)
        if emissions_screen is not None:
            log += (
                f"Screening CO2e: {emissions_screen['co2e_metric_tons_year']:,.0f} MT/year "
                f"({emissions_screen['co2e_g_per_mile']} g/mi, {emissions_screen['analysis_year']})\n"
            )
    except Exception as e:
        log += f"Emissions screening warning: {e}\n"

    # ── Resident VMT (CEQA §15064.3): Σ internal→internal OD × great-circle × ──
    # circuity, external gateway zones excluded. Same estimator the county lane
    # and the NCTC seed use — the AequilibraE lane converges onto it. Computed
    # from the internal base OD (od_trip_matrix.csv), NOT the gateway-augmented
    # assignment demand, so pass-through travel is not counted.
    gateways = setup_result.get("gateways") or []
    gateway_zone_ids = sorted({int(g["zone_id"]) for g in gateways})
    mode_split = assign_result.get("mode_split")
    select_link_analysis = assign_result.get("select_link_analysis")
    resident_vmt = None
    resident_vmt_per_capita = None
    resident_vmt_all_trips = None
    resident_vmt_calibrated = None
    resident_vmt_per_capita_calibrated = None
    resident_meta = None
    resident_basis = "all_trips"
    try:
        pkg_dir = (package_meta or {}).get("package_dir")
        if pkg_dir:
            zattr = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"))
            zattr["zone_id"] = zattr["zone_id"].astype(int)
            zone_ids = zattr["zone_id"].tolist()
            lons = zattr["centroid_lon"].tolist()
            lats = zattr["centroid_lat"].tolist()
            areas = zattr["area_sq_mi"].tolist()
            pops = zattr["est_population"].tolist()

            def _resident_from(csv_name: str):
                # od CSV: int row index, str(zone_id) column labels. No gateway
                # exclusion — the base OD is closed internal demand; gateway
                # through-traffic is on the network figure only.
                od_df = pd.read_csv(os.path.join(pkg_dir, csv_name), index_col=0)
                od = [
                    [
                        float(od_df.loc[zi, str(zj)])
                        if (zi in od_df.index and str(zj) in od_df.columns)
                        else 0.0
                        for zj in zone_ids
                    ]
                    for zi in zone_ids
                ]
                return compute_internal_resident_vmt(
                    od, zone_ids, lons, lats, areas, pops, gateway_zone_ids=[]
                )

            # All-trips figure (cross-lane continuity with the county/NCTC lanes).
            all_meta = _resident_from("od_trip_matrix.csv")
            resident_vmt_all_trips = round(all_meta["daily_vmt"], 1)
            # Headline resident VMT is auto-only when mode choice produced an auto
            # OD for THIS run (the §15064.3 vehicle-VMT basis); else all internal
            # trips. Gate on this run's mode_split, not just file existence, so a
            # stale od_auto_matrix.csv can never mislabel a mode-choice-off run.
            auto_csv = os.path.join(pkg_dir, "od_auto_matrix.csv")
            if mode_split and os.path.exists(auto_csv):
                resident_meta = _resident_from("od_auto_matrix.csv")
                resident_basis = "auto_only"
            else:
                resident_meta = all_meta
            resident_vmt = round(resident_meta["daily_vmt"], 1)
            pop_resident = resident_meta["population"]
            if pop_resident and pop_resident > 0:
                resident_vmt_per_capita = round(resident_vmt / pop_resident, 4)
            log += (
                f"Resident VMT ({resident_basis}): {resident_vmt:,.0f} vehicle-miles"
                + (f" · {resident_vmt_per_capita} resident VMT/capita" if resident_vmt_per_capita is not None else "")
                + (f"  (all-trips {resident_vmt_all_trips:,.0f})\n" if resident_vmt_all_trips is not None else "\n")
            )

            # Opt-in CALIBRATED resident VMT — the stage-2 nudged auto OD run
            # through the SAME estimator + zone coverage, under DISTINCT names.
            # The screening resident_vmt (default CEQA input) is untouched; this
            # feeds a CEQA determination only when the operator opts in.
            _cal_od = (calibration_result or {}).get("calibrated_auto_od")
            if _cal_od and os.path.exists(os.path.join(pkg_dir, _cal_od)):
                cal_meta = _resident_from(_cal_od)
                resident_vmt_calibrated = round(cal_meta["daily_vmt"], 1)
                if cal_meta["population"] and cal_meta["population"] > 0:
                    resident_vmt_per_capita_calibrated = round(resident_vmt_calibrated / cal_meta["population"], 4)
                log += (f"Calibrated resident VMT (opt-in, distinct from the CEQA input): "
                        f"{resident_vmt_calibrated:,.0f} · {resident_vmt_per_capita_calibrated} /capita.\n")
    except Exception as e:
        log += f"Resident VMT computation warning: {e}\n"

    # ── Equity / EJ overlay (screening, Title VI ACS indicators) ──────────────
    # Real ACS low-income / minority / zero-vehicle shares at the run's geography;
    # compares resident VMT/capita for above-typical-disadvantage zones vs the
    # rest. Needs a CENSUS key (now live). Screening-grade, NOT the SB 535 list.
    equity_screen = None
    try:
        census_key = os.getenv("CENSUS_API_KEY", "")
        pkg_dir = (package_meta or {}).get("package_dir")
        if census_key and pkg_dir:
            zattr_e = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"), dtype={"GEOID": str})
            zattr_e["zone_id"] = zattr_e["zone_id"].astype(int)
            zone_ids_e = zattr_e["zone_id"].tolist()
            # zfill length must come from the package geography, not be assumed
            # tract: a leading-zero-state block group coerced to 11 digits is
            # indistinguishable from a tract GEOID by length alone.
            geoids_e = equity.repair_geoids(
                zattr_e["GEOID"].tolist(), (package_meta or {}).get("zone_geography")
            )
            lons_e = zattr_e["centroid_lon"].tolist(); lats_e = zattr_e["centroid_lat"].tolist()
            areas_e = zattr_e["area_sq_mi"].tolist(); pops_e = zattr_e["est_population"].tolist()
            eq_csv = ("od_auto_matrix.csv"
                      if (mode_split and os.path.exists(os.path.join(pkg_dir, "od_auto_matrix.csv")))
                      else "od_trip_matrix.csv")
            od_e = pd.read_csv(os.path.join(pkg_dir, eq_csv), index_col=0)
            od_mat = [[float(od_e.loc[zi, str(zj)]) if (zi in od_e.index and str(zj) in od_e.columns) else 0.0
                       for zj in zone_ids_e] for zi in zone_ids_e]
            per_zone_vmt = equity.resident_vmt_by_origin_zone(od_mat, zone_ids_e, lons_e, lats_e, areas_e, gateway_zone_ids)
            level_e = "block group" if all(len(g) == 12 for g in geoids_e) else "tract"
            pairs_e = {(g[:2], g[2:5]) for g in geoids_e}
            acs_e = equity.fetch_acs_equity(pairs_e, level_e, census_key)
            if any(acs_e.get(g) for g in geoids_e):
                zones_eq = []
                for zid, geoid, pop in zip(zone_ids_e, geoids_e, pops_e):
                    z = equity.build_equity_zone(geoid, float(pop), acs_e.get(geoid) or {})
                    z["zone_id"] = int(zid)
                    zones_eq.append(z)
                zones_eq = equity.classify_equity_focus(zones_eq)
                equity_screen = equity.summarize_equity(zones_eq, per_zone_vmt)
                equity_screen["geography"] = level_e
                log += (
                    f"Equity overlay ({level_e}): {equity_screen['focus_zone_count']}/"
                    f"{equity_screen['total_zone_count']} focus zones; VMT/capita disparity "
                    f"{equity_screen.get('vmt_per_capita_disparity_ratio')}\n"
                )
            else:
                log += "Equity overlay skipped: ACS equity data unavailable for study geographies.\n"
    except Exception as e:
        log += f"Equity overlay warning: {e}\n"

    resident_basis_note = (
        "auto trips only (mode-choice output — the CEQA §15064.3 vehicle-VMT basis)"
        if resident_basis == "auto_only"
        else "all internal person-trips (mode choice not applied)"
    )
    # Zone geography (TAZ resolution) as the dynamic package actually built it;
    # None for pre-staged packages whose manifests predate the stamp.
    zone_geography = (package_meta or {}).get("zone_geography")
    zone_noun = "block-group" if zone_geography == "block_group" else "tract"
    resident_provenance = (
        "Σ internal→internal OD trips × centroid great-circle distance × 1.30 network "
        f"circuity (intrazonal ≈ 0.5·√(area/π), 0.75 mi fallback where {zone_noun} area is "
        f"unavailable), over {resident_basis_note}, at {zone_noun} zone resolution. External "
        "gateway through-traffic is loaded onto the network VMT figure only and is absent "
        "from this resident OD, so no gateway exclusion is applied. Screening-grade, "
        "derived — not measured. Not a validated travel model or calibrated forecast."
    )
    boundary_caveat = (
        f"Through-traffic loaded at {len(gateways)} boundary gateway(s) (screening-grade)"
        if gateways
        else "Closed boundary"
    )
    if not mode_split:
        mode_caveat = "All internal trips assigned as auto (mode choice disabled)"
    elif (mode_split or {}).get("transit_status") == "modeled":
        mode_caveat = (
            "Auto-only assignment; 3-way mode choice splits off walk/bike + GTFS-derived "
            "transit (transit 0 where no service, small where rural service exists)"
        )
    else:
        mode_caveat = (
            "Auto-only assignment; mode choice splits off walk/bike; transit 0 "
            f"(GTFS feed {(mode_split or {}).get('transit_status', 'unavailable')})"
        )

    # ── Observed-count validation (screening-grade diagnostic, NOT calibration) ──
    validation = None
    try:
        validation = _run_count_validation(db_path, link_volumes_csv)
        if validation:
            log += (
                f"Count validation: {validation['stations_matched']}/{validation['stations_total']} "
                f"stations matched; median APE {validation['median_ape']}%, %RMSE "
                f"{validation['percent_rmse']}, gate '{validation['screening_gate']}'.\n"
            )
    except Exception as e:
        log += f"Count validation warning: {e}\n"

    # Write the shared modeling claim-grade spine (modeling_validation_results +
    # modeling_claim_decisions) so reports read one consistent claim grade for
    # this run — the same tables the county lane populates.
    try:
        _ws_id = (sb_get_run(run_id) or {}).get("workspace_id")
        write_model_run_modeling_evidence(run_id, _ws_id, validation, calibration_result)
        _tier = "calibrated_to_counts" if calibration_result else (validation or {}).get("screening_gate", "unvalidated")
        log += f"Modeling claim spine updated (tier '{_tier}').\n"
    except Exception as e:
        log += f"Modeling evidence spine warning: {e}\n"

    validation_provenance = (validation or {}).get("method") or (
        "Observed-count validation did not run (no counts for this study area or disabled). "
        "Absence of validation is not a calibration claim."
    )

    # Convergence diagnostics between the two resident-VMT estimators —
    # measured per run, reported with provenance; neither estimator is altered.
    vmt_estimator_ratio = convergence.network_od_ratio(resident_vmt_network, resident_vmt)
    if vmt_estimator_ratio is not None:
        vmt_estimator_ratio = round(vmt_estimator_ratio, 4)

    evidence = {
        "run_id": run_id,
        "engine": ENGINE_STAMP,
        "network_source": "OpenStreetMap",
        "algorithm": "BFW",
        "vdf": "BPR (α=0.15, β=4.0)",
        "convergence": assign_result["convergence"],
        "network": assign_result["network"],
        "demand": assign_result["demand"],
        "skims": assign_result["skims"],
        "loaded_links": assign_result["loaded_links"],
        "largest_component_pct": setup_result.get("largest_component_pct"),
        "excluded_zones": setup_result.get("disconnected_zones") or [],
        "bbox": list(bbox) if bbox else None,
        "vmt": {
            "daily_vmt": daily_vmt,
            "vmt_per_capita": vmt_per_capita,
            "population_total": population_total,
            "method": "sum(link assigned PCE volume × link length in miles); centroid connectors excluded; AequilibraE distance metres → miles; includes external gateway through-traffic when gateways are detected",
            "source": "derived from assignment link volumes — screening-grade, not measured",
            "resident_vmt": resident_vmt,
            "resident_vmt_per_capita": resident_vmt_per_capita,
            "resident_vmt_all_trips": resident_vmt_all_trips,
            "resident_basis": resident_basis,
            "resident_method": resident_provenance,
            "resident_avg_trip_miles": round(resident_meta["avg_trip_miles"], 3) if resident_meta else None,
            "resident_vmt_network": resident_vmt_network,
            "through_vmt_network": through_vmt_network,
            # Convergence diagnostics between the two estimators (measured on
            # this run; the OD estimator's fixed 1.30 circuity is unchanged).
            "resident_vmt_network_od_ratio": vmt_estimator_ratio,
            "routed_circuity_diagnostic": assign_result.get("convergence_diagnostic"),
            "excluded_gateway_zone_ids": [],
            "network_gateway_zone_ids": gateway_zone_ids,
        },
        "emissions": emissions_screen,
        "equity": equity_screen,
        "mode_split": mode_split,
        "validation": validation,
        # Select-link corridor attribution: per-screenline local/commute/through
        # split of the trips routing through it. Screening decomposition of the
        # assigned demand — not a calibration; None where no counts define
        # corridor screenlines for this study area.
        "select_link": select_link_analysis,
        # Opt-in count calibration (None on the default screening path). Carries
        # the applied per-class factors + baseline/calibrated fit & holdout
        # accuracy. Calibrated VMT is under distinct KPI names, not the CEQA input.
        "calibration": calibration_result,
        "gateways": gateways,
        # TAZ resolution the dynamic package was actually built at (post any
        # tract fallback), with its OD-seed provenance. None fields for
        # pre-staged packages whose manifests predate these stamps.
        "zones": {
            "zone_geography": zone_geography,
            "count": (package_meta or {}).get("zones"),
            "demand_method": (package_meta or {}).get("demand_method"),
            "od_provenance": (package_meta or {}).get("od_provenance"),
        },
        # LODES-vs-synthetic employment provenance from the package manifest,
        # so the app can badge synthetic-fallback jobs as Estimated.
        "employment": (package_meta or {}).get("jobs_provenance"),
        "caveats": ["Uncalibrated", "OSM default speeds/capacities", boundary_caveat, mode_caveat, "Screening-grade"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model_area": model_area_label,
    }

    evidence_path = os.path.join(out_dir, "evidence_packet.json")
    with open(evidence_path, "w") as f:
        json.dump(evidence, f, indent=2)
    log += f"Wrote evidence packet to {evidence_path}.\n"

    # Upload the evidence packet to the private run-artifacts bucket so the
    # app can read it when app and worker run on different hosts (local://
    # refs only resolve in single-host dev). Falls back to local:// on failure.
    evidence_storage_ref = None
    try:
        ev_object_path = f"model-runs/{run_id}/evidence_packet.json"
        ev_upload_url = f"{SUPABASE_URL}/storage/v1/object/run-artifacts/{ev_object_path}"
        with open(evidence_path, "rb") as f:
            ev_upload_res = requests.post(
                ev_upload_url,
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "x-upsert": "true",
                },
                data=f.read(),
                timeout=60,
            )
        if ev_upload_res.status_code in (200, 201):
            evidence_storage_ref = f"storage://run-artifacts/{ev_object_path}"
            log += f"Uploaded evidence packet to private Storage as {evidence_storage_ref}.\n"
        else:
            log += f"Evidence packet Storage upload failed ({ev_upload_res.status_code}); registering local path.\n"
    except Exception as e:
        log += f"Evidence packet Storage upload warning: {e}\n"

    # Register artifacts in Supabase
    for fname, atype in [
        ("link_volumes.csv", "link_volumes"),
        ("demand.omx", "demand_matrix"),
        ("travel_time_skims.omx", "skim_matrix"),
        ("evidence_packet.json", "evidence_packet"),
    ]:
        fpath = os.path.join(out_dir, fname)
        if os.path.exists(fpath):
            size = os.path.getsize(fpath)
            with open(fpath, "rb") as fh:
                content_hash = hashlib.sha256(fh.read()).hexdigest()[:16]
            file_url = (
                evidence_storage_ref
                if atype == "evidence_packet" and evidence_storage_ref
                else f"local://{fpath}"
            )
            sb_post_artifact({
                "run_id": run_id,
                "stage_id": stage_id,
                "artifact_type": atype,
                "file_url": file_url,
                "file_size_bytes": size,
                "content_hash": content_hash,
                "metadata_json": evidence if atype == "evidence_packet" else {"filename": fname},
            })

    # Register the zone-attributes package input (local:// — same-host consumers
    # only). The ActivitySim behavioral worker reads this + travel_time_skims.omx
    # to build a real ActivitySim input bundle; it's also useful screening
    # provenance for any run. Lives in package/, not run_output/, so it's not in
    # the loop above.
    zone_attr_path = os.path.join(work_dir, "package", "zone_attributes.csv")
    if os.path.exists(zone_attr_path):
        with open(zone_attr_path, "rb") as fh:
            za_hash = hashlib.sha256(fh.read()).hexdigest()[:16]
        sb_post_artifact({
            "run_id": run_id,
            "stage_id": stage_id,
            "artifact_type": "zone_attributes",
            "file_url": f"local://{zone_attr_path}",
            "file_size_bytes": os.path.getsize(zone_attr_path),
            "content_hash": za_hash,
            "metadata_json": {"filename": "zone_attributes.csv"},
        })

    # Register KPIs
    kpis = [
        ("assignment", "total_links", "Total Links", assign_result["network"]["links"], "count"),
        ("assignment", "total_nodes", "Total Nodes", assign_result["network"]["nodes"], "count"),
        ("assignment", "zones", "Zones", assign_result["network"]["zones"], "count"),
        ("general", "total_trips", "Total Trips", assign_result["demand"]["total_trips"], "trips/day"),
        ("general", "routable_trips", "Routable Trips", assign_result["demand"]["routable_trips"], "trips/day"),
        ("assignment", "rgap", "Relative Gap", assign_result["convergence"]["final_gap"], "ratio"),
        ("assignment", "iterations", "Iterations", assign_result["convergence"]["iterations"], "count"),
        ("assignment", "loaded_links", "Loaded Links", assign_result["loaded_links"], "count"),
    ]
    if assign_result["skims"]["avg_time_min"] is not None:
        kpis.append(("assignment", "avg_travel_time", "Avg Travel Time", round(assign_result["skims"]["avg_time_min"], 1), "min"))
        kpis.append(("assignment", "max_travel_time", "Max Travel Time", round(assign_result["skims"]["max_time_min"], 1), "min"))

    # VMT KPIs land in a directly-readable category (not behavioral_onramp) so
    # the CEQA §15064.3 screen can derive a determination from them.
    if daily_vmt is not None:
        kpis.append(("general", "daily_vmt", "Daily VMT", daily_vmt, "vehicle-miles/day"))
    if vmt_per_capita is not None:
        kpis.append(("general", "vmt_per_capita", "VMT per Capita", vmt_per_capita, "vehicle-miles/person/day"))
    # Calibrated network VMT + calibrated holdout accuracy (opt-in calibration).
    # DISTINCT names, deliberately absent from every CEQA_* exact-name set so the
    # §15064.3 screen keeps using the uncalibrated screening VMT — calibrated VMT
    # is a separate, disclosed result, not the CEQA input.
    if daily_vmt_calibrated is not None:
        kpis.append(("general", "daily_vmt_calibrated", "Daily VMT (calibrated to counts)", daily_vmt_calibrated, "vehicle-miles/day"))
    # Opt-in CALIBRATED resident VMT (from the stage-2 nudged OD). DISTINCT names
    # — NOT in any CEQA_* set — so the CEQA screen uses them ONLY when the
    # operator explicitly opts into a calibrated-input determination.
    if resident_vmt_calibrated is not None:
        kpis.append(("general", "resident_vmt_calibrated", "Resident VMT (calibrated to counts)", resident_vmt_calibrated, "vehicle-miles/day"))
    if resident_vmt_per_capita_calibrated is not None:
        kpis.append(("general", "resident_vmt_per_capita_calibrated", "Resident VMT per Capita (calibrated to counts)", resident_vmt_per_capita_calibrated, "vehicle-miles/person/day"))
    if calibration_result:
        _cal_hold = (calibration_result.get("calibrated") or {}).get("holdout") or {}
        if _cal_hold.get("median_ape") is not None:
            kpis.append(("assignment", "validation_median_ape_calibrated", "Calibrated Holdout Median APE", _cal_hold["median_ape"], "percent"))
    # Resident (internal→internal, gateway-excluded) VMT — the CEQA §15064.3
    # number the screen prefers. Same estimator as the county lane and seed.
    if resident_vmt is not None:
        kpis.append(("general", "resident_vmt", "Resident VMT", resident_vmt, "vehicle-miles/day"))
    if resident_vmt_per_capita is not None:
        kpis.append(("general", "resident_vmt_per_capita", "Resident VMT per Capita", resident_vmt_per_capita, "vehicle-miles/person/day"))
    # All-modes resident person-trip miles, archived for cross-lane continuity
    # with the county/NCTC lanes (which do not yet split modes).
    if resident_vmt_all_trips is not None:
        kpis.append(("general", "resident_vmt_all_trips", "Resident Person-Trip Miles (all modes)", resident_vmt_all_trips, "vehicle-miles/day"))
    # M7 — network-routed per-class VMT from the 2-class assignment. These are
    # deliberately DISTINCT names from the CEQA-screened resident_vmt* set (the
    # exact-name CEQA_* KPI sets in ceqa-vmt-screen.ts must not match them):
    # the OD-based estimator stays the §15064.3 input; these carry the routed
    # network evidence beside it.
    if resident_vmt_network is not None:
        kpis.append(("general", "resident_vmt_network", "Resident VMT (network-routed)", resident_vmt_network, "vehicle-miles/day"))
    if through_vmt_network is not None:
        kpis.append(("general", "through_vmt_network", "Through+External VMT (network-routed)", through_vmt_network, "vehicle-miles/day"))
    # Convergence diagnostics between the two resident-VMT estimators
    # (assignment category — run-fit territory, not CEQA-adjacent `general`).
    # Names deliberately disjoint from every CEQA_* exact-name set.
    if vmt_estimator_ratio is not None:
        kpis.append(("assignment", "resident_vmt_network_od_ratio", "Network/OD Resident VMT Ratio", vmt_estimator_ratio, "ratio"))
    convergence_diag = assign_result.get("convergence_diagnostic")
    if convergence_diag and convergence_diag.get("effective_circuity") is not None:
        kpis.append(("assignment", "effective_circuity_routed", "Routed Effective Circuity", convergence_diag["effective_circuity"], "ratio"))
    # Select-link corridor attribution: a discovery KPI (count of reached
    # screenlines); the per-corridor local/commute/through detail rides in
    # breakdown_json + the evidence packet. Assignment category, CEQA-disjoint.
    sl_reached = [s for s in ((select_link_analysis or {}).get("screenlines") or []) if s.get("total_trips")]
    if sl_reached:
        kpis.append(("assignment", "select_link_screenlines", "Corridor Screenlines Attributed", len(sl_reached), "count"))
    if population_total is not None:
        kpis.append(("general", "population_total", "Population", round(population_total), "persons"))
    # Screening GHG (CO2e) — annual metric tons (the CEQA-style figure) + a
    # per-capita rate. Derived from network VMT; screening-grade, not an EMFAC run.
    if emissions_screen is not None:
        kpis.append(("general", "co2e_metric_tons_year", "GHG (CO2e, annual screening)", emissions_screen["co2e_metric_tons_year"], "metric tons CO2e/year"))
        if emissions_screen.get("co2e_kg_per_capita_day") is not None:
            kpis.append(("general", "co2e_kg_per_capita_day", "GHG per Capita (CO2e)", emissions_screen["co2e_kg_per_capita_day"], "kg CO2e/person/day"))
    # Equity / EJ overlay (category `equity`, directly-readable). Compares
    # resident VMT/capita between above-typical-disadvantage zones and the rest.
    if equity_screen is not None:
        kpis.append(("equity", "equity_focus_zone_count", "Equity-Focus Zones", equity_screen["focus_zone_count"], "count"))
        if equity_screen.get("focus_population_share") is not None:
            kpis.append(("equity", "equity_focus_population_share", "Equity-Focus Population Share", round(equity_screen["focus_population_share"] * 100, 1), "percent"))
        _fpc = (equity_screen.get("equity_focus") or {}).get("resident_vmt_per_capita")
        _rpc = (equity_screen.get("rest_of_area") or {}).get("resident_vmt_per_capita")
        if _fpc is not None:
            kpis.append(("equity", "equity_focus_vmt_per_capita", "Equity-Focus Resident VMT/Capita", _fpc, "vehicle-miles/person/day"))
        if _rpc is not None:
            kpis.append(("equity", "equity_rest_vmt_per_capita", "Rest-of-Area Resident VMT/Capita", _rpc, "vehicle-miles/person/day"))
        if equity_screen.get("vmt_per_capita_disparity_ratio") is not None:
            kpis.append(("equity", "equity_vmt_disparity_ratio", "Equity VMT/Capita Disparity Ratio", equity_screen["vmt_per_capita_disparity_ratio"], "ratio"))
    kpis.append(("assignment", "external_gateways", "External Gateways", len(gateways), "count"))
    # Mode-split KPIs (percentage points, 0-100), in the directly-readable
    # `general` category. Distinct, unit-explicit KPI names (the sketch lane
    # emits mode_share_auto / mode_share_transit as 0-1 "share"; these are 0-100
    # "percent" — different names + units so a cross-engine comparison never
    # mixes the two scales). Transit share is REAL (GTFS-derived), 0 where no
    # service; transit_status distinguishes that from a feed-load failure.
    if mode_split and mode_split.get("shares_pct"):
        sp = mode_split["shares_pct"]
        kpis.append(("general", "auto_mode_share_pct", "Auto Mode Share", sp["auto"], "percent"))
        kpis.append(("general", "transit_mode_share_pct", "Transit Mode Share", sp["transit"], "percent"))
        kpis.append(("general", "active_mode_share_pct", "Active (Walk+Bike) Mode Share", sp["active"], "percent"))
        kpis.append(("general", "auto_person_trips", "Auto Person-Trips (assigned)", mode_split["auto_trips"], "trips/day"))
        kpis.append(("general", "transit_person_trips", "Transit Person-Trips", mode_split.get("transit_trips", 0), "trips/day"))
        kpis.append(("general", "active_person_trips", "Active (Walk+Bike) Person-Trips", mode_split["active_trips"], "trips/day"))
        kpis.append(("general", "transit_available_pairs", "Transit-Available OD Pairs", mode_split.get("transit_available_pairs", 0), "count"))

    # Observed-count validation KPIs (screening-grade diagnostic). Emitted only
    # when >=1 station matched — a 0-match run is not a validation. The gate
    # label + per-station detail live in evidence.validation.
    if validation and validation.get("stations_matched", 0) > 0:
        kpis.append(("general", "validation_stations_matched", "Validation Stations Matched", validation["stations_matched"], "count"))
        if validation.get("median_ape") is not None:
            kpis.append(("assignment", "validation_median_ape", "Validation Median APE", validation["median_ape"], "percent"))
        if validation.get("percent_rmse") is not None:
            kpis.append(("assignment", "validation_percent_rmse", "Validation %RMSE", validation["percent_rmse"], "percent"))
        if (validation.get("geh") or {}).get("mean") is not None:
            kpis.append(("assignment", "validation_geh_mean", "Validation GEH (mean, avg-hourly)", round(validation["geh"]["mean"], 2), "geh"))
        if (validation.get("peak_hour_geh") or {}).get("mean") is not None:
            kpis.append(("assignment", "validation_peak_hour_geh_mean", "Validation GEH (mean, peak-hour)", round(validation["peak_hour_geh"]["mean"], 2), "geh"))
        if validation.get("spearman_rho") is not None:
            kpis.append(("assignment", "validation_spearman_rho", "Validation Spearman rho", validation["spearman_rho"], "ratio"))

    _transit_status = (mode_split or {}).get("transit_status", "not_run")
    if _transit_status == "modeled":
        mode_provenance = (
            "Screening-grade 3-way auto/transit/active(walk+bike) logit applied per internal "
            "OD cell before assignment. Auto disutility from the real AequilibraE travel-time "
            "skim; walk/bike from centroid great-circle distance at fixed planning speeds; "
            "transit LOS from published GTFS schedules (headway approximation — access-walk + "
            "wait≈headway/2 + scheduled in-vehicle time + one optional transfer + egress-walk + "
            "flat fare). Transit is available ONLY where a walk-access served stop exists at "
            "both ends and a direct-or-one-transfer scheduled itinerary runs on the modeled "
            "day — transit share is 0 elsewhere by construction, small where rural service "
            "exists. Coefficients are a trip-weighted blend of the sketch-ABM per-purpose "
            "tables. Derived from a FROZEN GTFS snapshot (service window "
            f"{((mode_split or {}).get('transit_los') or {}).get('service_period', 'n/a')}); a "
            "screening approximation, not current or real-time service. NOT a calibrated "
            "transit assignment or a validated model."
        )
    else:
        mode_provenance = (
            "Screening-grade auto-vs-active(walk+bike) logit; transit share is 0 because no usable "
            f"GTFS feed covered this study area (transit_status={_transit_status}) — this is NOT "
            "'no transit demand'. Not a validated mode choice model or calibrated forecast."
        )

    for cat, name, label, value, unit in kpis:
        kpi_payload = {
            "run_id": run_id,
            "kpi_category": cat,
            "kpi_name": name,
            "kpi_label": label,
            "value": value,
            "unit": unit,
        }
        # VMT KPIs carry their derivation provenance, mirroring the seeded
        # county-lane convention (breakdown_json.provenance).
        if name == "zones" and zone_geography is not None:
            kpi_payload["breakdown_json"] = {
                "zone_geography": zone_geography,
                "provenance": (
                    f"TAZs are Census {zone_noun}s from the dynamic package "
                    "(per-run launch option; tract is the default)."
                ),
            }
        elif name in ("daily_vmt", "vmt_per_capita"):
            kpi_payload["breakdown_json"] = {
                "provenance": evidence["vmt"]["method"] + "; " + evidence["vmt"]["source"],
            }
        elif name in ("resident_vmt", "resident_vmt_per_capita"):
            kpi_payload["breakdown_json"] = {"provenance": resident_provenance}
        elif name == "resident_vmt_all_trips":
            kpi_payload["breakdown_json"] = {
                "provenance": "All internal person-trips (not auto-only). " + resident_provenance,
            }
        elif name in ("resident_vmt_network", "through_vmt_network"):
            kpi_payload["breakdown_json"] = {
                "provenance": (
                    "Per-class network VMT: 2-class BFW assignment (resident = internal auto "
                    "demand; external = cordon-injected boundary + routed pass-through), Σ class "
                    "link flow × routed link length, centroid connectors excluded. The split is "
                    "as good as the documented cordon gateway assumptions. Screening-grade, "
                    "derived — not measured. The OD-based resident_vmt remains the CEQA input."
                ),
                "od_estimator_resident_vmt": resident_vmt,
            }
        elif name == "resident_vmt_network_od_ratio":
            kpi_payload["breakdown_json"] = {
                "provenance": (
                    "resident_vmt_network ÷ resident_vmt on this run: the network-routed "
                    "figure (2-class assignment link flows) over the OD estimator "
                    "(great-circle × 1.30 circuity). Convergence DIAGNOSTIC between two "
                    "screening estimators — not a correction; neither estimator is altered "
                    "and the OD-based resident_vmt remains the CEQA §15064.3 screening input."
                ),
                "resident_vmt_network": resident_vmt_network,
                "od_estimator_resident_vmt": resident_vmt,
            }
        elif name == "effective_circuity_routed":
            kpi_payload["breakdown_json"] = {
                "provenance": (
                    "Demand-weighted routed distance (blended BFW assignment skim, resident "
                    "class, virtual centroid connectors excluded — the same basis as "
                    "resident_vmt_network) ÷ great-circle distance over interzonal resident "
                    "OD pairs — the circuity this run's own routing implies, reported beside "
                    "the fixed 1.30 the OD estimator assumes. Screening-grade DIAGNOSTIC "
                    "only; the OD estimator's 1.30 is unchanged (replacing it is a flagged "
                    "calibration decision, not a code change)."
                ),
                **(assign_result.get("convergence_diagnostic") or {}),
            }
        elif name == "select_link_screenlines":
            kpi_payload["breakdown_json"] = {
                "provenance": (
                    "Select-link analysis on each corridor screenline (the validation-count "
                    "stations' road links): the origin-destination pattern of trips routing "
                    "through the screenline, split by boundary-cordon endpoint into local "
                    "(internal↔internal), commute (one cordon endpoint), and through (both "
                    "cordon endpoints). Screening decomposition of demand the 2-class BFW "
                    "assignment already routed — not a calibration or a validated forecast; "
                    "the split is as good as the documented cordon gateway assumptions."
                ),
                "screenlines": sl_reached,
            }
        elif name in ("daily_vmt_calibrated", "validation_median_ape_calibrated") and calibration_result:
            kpi_payload["breakdown_json"] = {
                "provenance": calibration_result.get("method"),
                "applied_class_factors": calibration_result.get("applied_class_factors"),
                "accepted_iterations": calibration_result.get("accepted_iterations"),
                "demand_nudge_iterations": calibration_result.get("demand_nudge_iterations"),
                "baseline_holdout_median_ape": (calibration_result.get("baseline") or {}).get("holdout", {}).get("median_ape"),
                "calibrated_holdout_median_ape": (calibration_result.get("calibrated") or {}).get("holdout", {}).get("median_ape"),
                "holdout_station_count": calibration_result.get("holdout_station_count"),
            }
        elif name in (
            "auto_mode_share_pct", "transit_mode_share_pct", "active_mode_share_pct",
            "auto_person_trips", "transit_person_trips", "active_person_trips",
            "transit_available_pairs",
        ):
            kpi_payload["breakdown_json"] = {"provenance": mode_provenance}
        elif name in (
            "validation_stations_matched", "validation_median_ape", "validation_percent_rmse",
            "validation_geh_mean", "validation_peak_hour_geh_mean", "validation_spearman_rho",
        ):
            kpi_payload["breakdown_json"] = {
                "provenance": validation_provenance,
                "screening_gate": (validation or {}).get("screening_gate"),
            }
        elif name in ("co2e_metric_tons_year", "co2e_kg_per_capita_day") and emissions_screen is not None:
            kpi_payload["breakdown_json"] = {
                "provenance": emissions_screen["method"],
                "co2e_g_per_mile": emissions_screen["co2e_g_per_mile"],
                "analysis_year": emissions_screen["analysis_year"],
            }
        elif name.startswith("equity_") and equity_screen is not None:
            kpi_payload["breakdown_json"] = {
                "provenance": equity_screen["method"],
                "geography": equity_screen.get("geography"),
                "equity_focus": equity_screen.get("equity_focus"),
                "rest_of_area": equity_screen.get("rest_of_area"),
            }
        sb_post_kpi(kpi_payload)

    # Generate GeoJSON for the map and upload to Supabase Storage
    try:
        import csv as csv_mod
        db_path = os.path.join(work_dir, "aeq_project", "project_database.sqlite")
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            conn.enable_load_extension(True)
            conn.load_extension(SPATIALITE_PATH)

            volumes = {}
            vol_path = os.path.join(out_dir, "link_volumes.csv")
            with open(vol_path) as f:
                for row in csv_mod.DictReader(f):
                    lid = int(float(row.get("link_id", row.get("", 0))))
                    pce = float(row.get("PCE_tot", 0))
                    if pce > 0:
                        volumes[lid] = {
                            "pce_tot": round(pce),
                            "pce_ab": round(float(row.get("PCE_AB", 0))),
                            "pce_ba": round(float(row.get("PCE_BA", 0))),
                            "voc_max": round(float(row.get("VOC_max", 0)), 3),
                            "delay_factor": round(float(row.get("Delay_factor_Max", 0)), 3),
                        }

            features = []
            for lid, vol in volumes.items():
                row = conn.execute(
                    "SELECT link_id, link_type, name, AsGeoJSON(geometry) FROM links WHERE link_id=?", (lid,)
                ).fetchone()
                if row and row[3]:
                    features.append({
                        "type": "Feature",
                        "properties": {"link_id": row[0], "name": row[2] or "", "link_type": row[1], **vol},
                        "geometry": json.loads(row[3]),
                    })
            conn.close()

            max_vol = max((v["pce_tot"] for v in volumes.values()), default=0)
            fc = {
                "type": "FeatureCollection",
                "features": features,
                "metadata": {
                    "totalLinks": len(features),
                    "maxVolume": max_vol,
                    "engine": ENGINE_STAMP,
                    "modelRunId": run_id,
                },
            }

            geojson_path = os.path.join(out_dir, "volumes.geojson")
            with open(geojson_path, "w") as f:
                json.dump(fc, f)

            # Upload to the (private) run-artifacts bucket. Store the storage
            # PATH — not a public URL — so the app resolves it through a
            # service-role signed URL and workspace RLS is never bypassed.
            bucket = "run-artifacts"
            object_path = f"model-runs/{run_id}/volumes.geojson"
            upload_url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{object_path}"
            with open(geojson_path, "rb") as f:
                upload_headers = {
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/geo+json",
                    "x-upsert": "true",
                }
                upload_res = requests.post(upload_url, headers=upload_headers, data=f.read())

            if upload_res.status_code in (200, 201):
                storage_ref = f"storage://{bucket}/{object_path}"
                with open(geojson_path, "rb") as geojson_file:
                    geojson_hash = hashlib.sha256(geojson_file.read()).hexdigest()[:16]
                sb_post_artifact({
                    "run_id": run_id,
                    "stage_id": stage_id,
                    "artifact_type": "volumes_geojson",
                    "file_url": storage_ref,
                    "file_size_bytes": os.path.getsize(geojson_path),
                    "content_hash": geojson_hash,
                    "metadata_json": {"format": "geojson", "features": len(features), "maxVolume": max_vol},
                })
                log += f"Uploaded volumes GeoJSON ({len(features)} features) to private Storage as {storage_ref}.\n"
            else:
                log += f"Storage upload failed ({upload_res.status_code}): {upload_res.text[:200]}\n"
        else:
            log += f"Skipped GeoJSON generation because project database was missing at {db_path}.\n"
    except Exception as e:
        log += f"GeoJSON generation warning: {e}\n"

    log += "Artifact extraction complete.\n"
    return log


# ─── Main poll loop ────────────────────────────────────────────────────
# Work directory: use /tmp/aeq_runs in cloud, or local data dir for dev
PILOT_WORK_DIR = os.getenv("AEQ_WORK_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "pilot-nevada-county"))


def process_stage(stage: dict):
    stage_id = stage["id"]
    run_id = stage["run_id"]
    stage_name = stage["stage_name"]
    now_iso = datetime.now(timezone.utc).isoformat()

    print(f"[{time.strftime('%X')}] Processing: {stage_name} (run={run_id[:8]}…)")

    # Atomic claim: only one worker may transition this stage queued -> running.
    claimed = sb_claim_stage(
        stage_id,
        {"status": "running", "started_at": now_iso, "log_tail": f"Starting {stage_name}..."},
    )
    if not claimed:
        print(f"[{time.strftime('%X')}] ⏭️ Lost claim race for {stage_name} (run={run_id[:8]}…); another worker owns it.")
        return
    sb_patch_run(run_id, {"status": "running"})

    # Each run gets its own working directory
    work_dir = os.path.join(PILOT_WORK_DIR, "runs", run_id[:12])
    os.makedirs(work_dir, exist_ok=True)
    state_file = os.path.join(work_dir, f"state.json")

    try:
        if stage_name == "AequilibraE Setup":
            run_row = sb_get_run(run_id)
            package_meta = ensure_dynamic_package(run_id, work_dir, run_row=run_row)
            pkg_dir = package_meta["package_dir"]
            bbox = tuple(package_meta["bbox"])

            result = stage_setup(run_id, stage_id, work_dir, bbox, pkg_dir)
            os.makedirs(os.path.join(work_dir, "run_output"), exist_ok=True)
            with open(state_file, "w") as f:
                json.dump({"setup": result, "package": package_meta}, f)
            sb_patch_stage(stage_id, {
                "status": "succeeded",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "log_tail": result["log"],
            })

        elif stage_name == "Network Assignment":
            with open(state_file) as f:
                state = json.load(f)
            pkg_dir = state["package"]["package_dir"]
            result = stage_assignment(run_id, stage_id, work_dir, state["setup"], pkg_dir)
            state["assignment"] = result
            with open(state_file, "w") as f:
                json.dump(state, f)
            sb_patch_stage(stage_id, {
                "status": "succeeded",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "log_tail": result["log"],
            })

        elif stage_name == "Artifact Extraction":
            with open(state_file) as f:
                state = json.load(f)
            log = stage_artifacts(
                run_id, stage_id, work_dir, state["setup"], state["assignment"], state.get("package")
            )
            sb_patch_stage(stage_id, {
                "status": "succeeded",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "log_tail": log,
            })

        else:
            sb_patch_stage(stage_id, {
                "status": "failed",
                "error_message": f"Unknown stage: {stage_name}",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            return

        print(f"[{time.strftime('%X')}] ✅ {stage_name} succeeded")

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        print(f"[{time.strftime('%X')}] ❌ {stage_name} failed: {error_msg}")
        sb_patch_stage(stage_id, {
            "status": "failed",
            "error_message": error_msg[:2000],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        sb_patch_run(run_id, {"status": "failed"})
        return

    # Check if run is complete
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/model_run_stages?run_id=eq.{run_id}&status=neq.succeeded",
        headers=HEADERS,
    )
    if res.status_code == 200 and not res.json():
        print(f"[{time.strftime('%X')}] 🎉 Run {run_id[:8]}… complete!")
        sb_patch_run(run_id, {"status": "succeeded", "completed_at": datetime.now(timezone.utc).isoformat()})


def get_prior_stage_statuses(run_id: str, sort_order: int) -> list[dict]:
    if sort_order <= 1:
        return []
    url = (
        f"{SUPABASE_URL}/rest/v1/model_run_stages"
        f"?run_id=eq.{run_id}&sort_order=lt.{sort_order}&select=id,stage_name,sort_order,status,error_message&order=sort_order.asc"
    )
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Failed to load prior stage state: {res.status_code} {res.text[:200]}")
    return res.json()


def classify_stage_readiness(stage: dict) -> tuple[str, str | None]:
    prior = get_prior_stage_statuses(stage["run_id"], int(stage.get("sort_order") or 0))
    if not prior:
        return "ready", None

    terminal_blockers = [s for s in prior if s["status"] in {"failed", "cancelled", "skipped"}]
    if terminal_blockers:
        blocker = terminal_blockers[-1]
        return "blocked_terminal", f"Blocked by prior stage {blocker['stage_name']} ({blocker['status']})"

    if any(s["status"] != "succeeded" for s in prior):
        return "waiting", None

    return "ready", None


def mark_stage_skipped(stage: dict, reason: str):
    sb_patch_stage(stage["id"], {
        "status": "skipped",
        "error_message": reason[:2000],
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "log_tail": reason,
    })


# This worker owns exactly these stage names. Other workers (e.g. the
# ActivitySim behavioral-preflight worker) poll the same model_run_stages table,
# so the poll query is scoped by name — otherwise this worker would claim a
# behavioral ActivitySim stage it has no code to run. A behavioral_demand run's
# screening portion reuses these same names, so those stages are still claimed.
AEQ_STAGE_NAMES = ("AequilibraE Setup", "Network Assignment", "Artifact Extraction")
_AEQ_STAGE_FILTER = "stage_name=" + urllib.parse.quote(
    "in.(" + ",".join(f'"{name}"' for name in AEQ_STAGE_NAMES) + ")",
    safe="().,",
)


def poll_for_jobs():
    print(f"AequilibraE Worker started at {time.strftime('%c')}")
    print(f"Polling {SUPABASE_URL} for queued stages (owned: {', '.join(AEQ_STAGE_NAMES)})...")

    while True:
        try:
            url = (
                f"{SUPABASE_URL}/rest/v1/model_run_stages"
                f"?status=eq.queued&{_AEQ_STAGE_FILTER}"
                "&select=id,run_id,stage_name,status,sort_order,created_at&order=created_at.asc,sort_order.asc&limit=25"
            )
            res = requests.get(url, headers=HEADERS, timeout=30)
            if res.status_code != 200:
                print(f"Poll error: {res.text}")
                time.sleep(5)
                continue

            stages = res.json()
            if not stages:
                time.sleep(5)
                continue

            processed = False
            for stage in stages:
                readiness, reason = classify_stage_readiness(stage)
                if readiness == "ready":
                    process_stage(stage)
                    processed = True
                    break
                if readiness == "blocked_terminal":
                    print(f"[{time.strftime('%X')}] ⏭️ Skipping {stage['stage_name']} (run={stage['run_id'][:8]}…): {reason}")
                    mark_stage_skipped(stage, reason or "Skipped due to failed prior stage")
                    processed = True
                    break

            if not processed:
                time.sleep(5)

        except Exception as e:
            print(f"Poll loop error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    poll_for_jobs()
