#!/usr/bin/env python3
"""
AequilibraE Worker — executes real traffic assignment on queued model_run_stages
using the proven OSM + AequilibraE pipeline.

Stage pipeline:
  1. AequilibraE Setup     — download OSM network, add centroids, renumber nodes
  2. Network Assignment    — build graph, run skims, load demand, run BFW
  3. Artifact Extraction   — export evidence packet, link volumes, skim matrix
  4. ActivitySim Network Assignment (behavioral runs only) — reuse the retained
                             project with ActivitySim vehicle demand
  5. Demand Model Agreement (behavioral runs only) — compute GEH and agreement
                             artifacts without averaging the methods

TWO WAYS TO START IT, ONE WAY IT RUNS (AEQ_WORKER_MODE):
  poll (default) — the original behaviour: an always-on process reading queued
                   stages out of Supabase.
  push           — an HTTP trigger the app POSTs a run id to, so a stateless
                   pool can be woken on demand instead of kept running.
  both           — both at once. Two processes cannot take the same stage: every
                   stage is claimed with an atomic queued -> running update, so
                   whichever reaches it first runs it and the other stops. And
                   the two threads INSIDE this process cannot execute two stages
                   at once either — see _STAGE_EXECUTION_LOCK, which is what
                   makes that true rather than assumed.
"""
import os
import sys
import time
import json
import shutil
import sqlite3
import string
import hashlib
import hmac
import queue
import re
import signal
import tempfile
import threading
import urllib.parse
import uuid
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Tuple

import requests
import numpy as np
import pandas as pd
from network_ids import renumber_nodes
from shapely.geometry import box, shape
from dotenv import load_dotenv

# Load local operator configuration before importing worker modules that capture
# environment-backed settings at import time (notably data_pipeline's Census
# fallback).  Loading this below those imports leaves their module constants
# empty even though the worker itself later sees the configured values.
load_dotenv()  # will read .env in the cwd if present
_ENV_LOCAL = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "openplan", ".env.local"
)
load_dotenv(_ENV_LOCAL, override=False)

from data_pipeline import (
    DataPipelineError,
    ZONE_ATTRIBUTE_PAYLOAD_VERSION,
    generate_package,
    normalize_zone_geography,
    package_geography_mismatch,
    supplied_measure_table,
)
from resident_vmt import compute_internal_resident_vmt, haversine_miles, intrazonal_miles
import convergence
import link_vmt
import select_link
import calibration
from assignment_progress import stream_assignment_progress
from assignment_settings import (
    AssignmentSettingsError,
    assignment_profile_payload_json,
    assignment_convergence_record,
    assignment_iteration_count,
    assignment_profile_digest,
    build_traffic_assignment,
    canonical_convergence_record,
    canonical_assignment_profile,
    require_matching_assignment_profiles,
    resolve_assignment_profile,
    validated_assignment_profile,
    validated_convergence_profile,
)
from gateways import (
    detect_external_gateways,
    build_cordon_injections,
    resolve_exterior_node,
    pair_passthrough_cordons,
    GATEWAY_PASSTHROUGH_SHARE,
)
from centroid_geometry import candidates_on_routable_component, insert_distinct_centroid
import mode_choice
import gtfs_skim
import count_validation
import emissions
import equity

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
#
# An EMPTY value is deliberately NOT an off switch, for the same reason it is not
# one for GTFS_DISCOVER below: several hosting platforms materialize a variable
# nobody defined as an empty string, and reading that as a deliberate "off" would
# silently drop mode choice entirely — every internal trip back to auto, which
# OVERSTATES the auto share and INFLATES the VMT a planner defends. Empty means
# unset, which means the default; only an explicit falsy value turns it off.
MODE_SPLIT_ENABLED = (os.getenv("MODE_SPLIT_ENABLED") or "1").strip().lower() not in ("0", "false")

# Dynamic per-place GTFS discovery (keyless Mobility Database catalog). Default
# ON — see gtfs_skim.discovery_enabled for the reasoning and for GTFS_DISCOVER=0,
# the explicit operator OFF switch (an EMPTY value is not one — it means unset).
# When on (and no explicit GTFS_PATH/GTFS_URL is set) the worker resolves a feed
# covering the study area. What happens on a miss is gtfs_skim.plan_feed's call:
# a catalog that answered and covered nothing degrades to the honest no_local_feed
# state, while a catalog we could not READ falls back to the bundled feed under
# feed_covers() — so an offline deployment keeps transit where the bundled feed
# genuinely reaches, and never skims it against an arbitrary place.
GTFS_DISCOVER = gtfs_skim.discovery_enabled(os.getenv("GTFS_DISCOVER"))

# Fixed share of each boundary-crossing highway's daily volume routed as
# pass-through (cordon→same-route cordon) so interior mainlines load, rather than
# terminating at internal zones. Uncalibrated screening assumption; the env
# override is for what-if sweeps only, never to fit observed counts.
# One source for the share: `gateways.share_from_env` reads and clamps it, so
# the worker and the county-script lane cannot honour different values —
# which they did until 2026-08-18, when only this file read the override.
PASSTHROUGH_SHARE = GATEWAY_PASSTHROUGH_SHARE

# Observed-count validation: match assigned link volumes to published traffic
# counts and report screening-grade fit metrics + a gate. Default counts cover
# the Nevada County pilot; VALIDATION_COUNTS_PATH overrides. Set to 0 to disable.
#
# The bundled default is only USED where it applies: `_run_count_validation`
# checks the count set's own station extent against the study area first, so a
# run outside that extent reports a coverage gap instead of matching another
# jurisdiction's stations and reporting a failed gate.
# Empty is unset, not off — see MODE_SPLIT_ENABLED above. Losing count validation
# to a hosting platform's empty string would silently drop the check that decides
# whether a run may claim the calibrated tier at all.
COUNT_VALIDATION_ENABLED = (os.getenv("COUNT_VALIDATION_ENABLED") or "1").strip().lower() not in ("0", "false")
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

# THERE IS DELIBERATELY NO MODULE-GLOBAL "counts path for the current run".
#
# stage_assignment resolves exactly one counts path per run — auto-ingested local
# DOT AADT for that study area, or the configured default — and hands it to every
# reader: the select-link screenlines and the calibration gate inside the same
# stage, and `_run_count_validation` in the artifact stage, through the run state
# the stages already persist.
#
# It used to be a module global, justified by "the worker processes one stage per
# process at a time". That was true of the poll loop and it was never true of the
# ARTIFACT stage: a run whose artifact stage is picked up by a different worker
# process read the module default rather than the counts its own assignment
# validated against, and a process that had just run another run's assignment
# read THAT run's counts. The count set is what decides whether a run may claim
# the calibrated tier, so validating one study area against another's stations is
# a wrong number on a claim surface — and it looks exactly like a normal result.
# Passing it explicitly is what makes the correct counts a property of the run
# rather than of whatever the process did last.

# The registered count-source regions now live in count_validation.py
# (COUNT_REGION_BOUNDS) so the coverage rules are stdlib-testable without the
# geo/modeling stack, and so the "which states are covered" answer has ONE
# source. Each key maps to a state-DOT AADT source in
# scripts/modeling/count_sources.py::COUNT_SOURCES (CA=Caltrans, WA=WSDOT,
# CO=CDOT, OR=ODOT); test_count_coverage.py fails if the two drift apart.
_region_for_bbox = count_validation.region_for_bbox


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
# Written as an OFF list, not an allow-list: an allow-list turns every value it
# does not recognise — including the empty string a host hands over for a variable
# nobody set — into a silent "off" for a stage that is meant to default ON.
CALIBRATION_DEMAND_ENABLED = (os.getenv("AEQ_CALIBRATE_DEMAND") or "1").strip().lower() not in ("0", "false")
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
    response = requests.post(url, headers=HEADERS, json=payload, timeout=30)
    if not 200 <= response.status_code < 300:
        raise RuntimeError(
            "Failed to register model artifact: "
            f"{response.status_code} {response.text[:200]}"
        )


def sb_get_run_artifacts(run_id: str) -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/model_run_artifacts?run_id=eq.{run_id}"
        "&select=artifact_type,file_url,content_hash,metadata_json,created_at"
        "&order=created_at.desc"
    )
    response = requests.get(url, headers=HEADERS, timeout=30)
    if response.status_code != 200:
        raise RuntimeError(
            f"Failed to load model artifacts for {run_id}: "
            f"{response.status_code} {response.text[:200]}"
        )
    return response.json()


def verified_latest_local_artifact(
    run_id: str,
    artifact_type: str,
    *,
    expected_assignment_profile: dict,
    expected_assignment_profile_payload_json: str,
    expected_assignment_profile_digest: str,
    expected_network_settings: dict,
    expected_network_settings_payload_json: str,
    expected_network_settings_digest: str,
    expected_network_state_record: dict,
    expected_network_state_digest: str,
) -> str:
    matches = [
        artifact for artifact in sb_get_run_artifacts(run_id)
        if artifact.get("artifact_type") == artifact_type
    ]
    if not matches:
        raise RuntimeError(f"No {artifact_type} artifact was registered for this run")
    selected = matches[0]
    file_url = str(selected.get("file_url") or "")
    if not file_url.startswith("local://"):
        raise RuntimeError(f"{artifact_type} is not available on the shared worker volume")
    path = file_url[len("local://"):]
    if not os.path.isfile(path):
        raise RuntimeError(f"{artifact_type} is unreadable at {path}")
    expected_profile = validated_assignment_profile(
        expected_assignment_profile,
        expected_assignment_profile_payload_json,
        expected_assignment_profile_digest,
        f"expected {artifact_type}",
    )
    expected_settings = validated_network_settings_record(
        expected_network_settings,
        expected_network_settings_payload_json,
        expected_network_settings_digest,
        f"expected {artifact_type}",
    )
    expected_state = validated_network_state(
        expected_network_state_record,
        expected_network_state_digest,
        f"expected {artifact_type}",
    )
    metadata = selected.get("metadata_json")
    if not isinstance(metadata, dict):
        raise RuntimeError(f"{artifact_type} has no assignment custody metadata")
    actual_profile = validated_assignment_profile(
        metadata.get("assignment_profile"),
        metadata.get("assignment_profile_payload_json"),
        metadata.get("assignment_profile_digest"),
        artifact_type,
    )
    actual_settings = validated_network_settings_record(
        metadata.get("network_settings"),
        metadata.get("network_settings_payload_json"),
        metadata.get("network_settings_digest"),
        artifact_type,
    )
    actual_state = validated_network_state(
        metadata.get("network_state_record"),
        metadata.get("network_state_digest"),
        artifact_type,
    )
    if actual_profile != expected_profile:
        raise RuntimeError(f"{artifact_type} assignment-profile metadata does not match")
    if actual_settings != expected_settings:
        raise RuntimeError(f"{artifact_type} network-settings metadata does not match")
    if actual_state != expected_state:
        raise RuntimeError(f"{artifact_type} assignment network-state metadata does not match")
    if actual_state[0].get("network_settings_digest") != actual_settings[2]:
        raise RuntimeError(f"{artifact_type} network state names different settings")
    expected_hash = str(selected.get("content_hash") or "")
    with open(path, "rb") as handle:
        actual_hash = hashlib.sha256(handle.read()).hexdigest()
    if not _is_sha256(expected_hash) or actual_hash != expected_hash:
        raise RuntimeError(f"{artifact_type} failed its content-hash check")
    return path


def register_agreement_artifact(
    run_id: str,
    stage_id: str,
    artifact_type: str,
    path: str,
    content_type: str,
    *,
    first_assignment_convergence: dict,
    second_assignment_convergence: dict,
    assignment_profile: dict,
    assignment_profile_payload_json: str,
    assignment_profile_digest: str,
    network_settings: dict,
    network_settings_payload_json: str,
    network_settings_digest: str,
    network_state_record: dict,
    network_state_digest: str,
) -> None:
    """Put the combined result where the app can read it, with local fallback."""
    with open(path, "rb") as handle:
        payload = handle.read()
    filename = os.path.basename(path)
    object_path = f"model-runs/{run_id}/agreement/{filename}"
    upload_url = f"{SUPABASE_URL}/storage/v1/object/run-artifacts/{object_path}"
    response = requests.post(
        upload_url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=payload,
        timeout=60,
    )
    file_url = (
        f"storage://run-artifacts/{object_path}"
        if response.status_code in (200, 201)
        else f"local://{path}"
    )
    profile, profile_payload, profile_digest = validated_assignment_profile(
        assignment_profile,
        assignment_profile_payload_json,
        assignment_profile_digest,
        f"agreement artifact {artifact_type}",
    )
    first_convergence = canonical_convergence_record(
        first_assignment_convergence,
        f"agreement artifact {artifact_type} first assignment",
    )
    second_convergence = canonical_convergence_record(
        second_assignment_convergence,
        f"agreement artifact {artifact_type} second assignment",
    )
    for label, convergence_record in (
        ("first", first_convergence),
        ("second", second_convergence),
    ):
        recorded_profile = validated_convergence_profile(
            convergence_record,
            f"agreement artifact {artifact_type} {label} assignment",
        )
        if recorded_profile != (profile, profile_payload, profile_digest):
            raise AssignmentSettingsError(
                f"agreement artifact {artifact_type} {label} convergence names another profile"
            )
    settings, settings_payload, settings_digest = validated_network_settings_record(
        network_settings,
        network_settings_payload_json,
        network_settings_digest,
        f"agreement artifact {artifact_type}",
    )
    state, state_digest = validated_network_state(
        network_state_record,
        network_state_digest,
        f"agreement artifact {artifact_type}",
    )
    if state.get("network_settings_digest") != settings_digest:
        raise RuntimeError("Agreement artifact network state names different settings")
    sb_post_artifact({
        "run_id": run_id,
        "stage_id": stage_id,
        "artifact_type": artifact_type,
        "file_url": file_url,
        "file_size_bytes": len(payload),
        "content_hash": hashlib.sha256(payload).hexdigest(),
        "metadata_json": {
            "kind": "dual_demand_model_agreement",
            "is_average": False,
            "first_assignment_convergence": first_convergence,
            "second_assignment_convergence": second_convergence,
            "assignment_profile": profile,
            "assignment_profile_payload_json": profile_payload,
            "assignment_profile_digest": profile_digest,
            "network_settings": settings,
            "network_settings_payload_json": settings_payload,
            "network_settings_digest": settings_digest,
            "network_state_record": state,
            "network_state_digest": state_digest,
            "upload_status": "stored" if response.status_code in (200, 201) else "local_fallback",
        },
    })


def write_agreement_network_geojson(
    work_dir: str,
    output_path: str,
    *,
    network_state_record: dict,
    network_state_digest: str,
) -> str:
    """Export the complete retained roadway set, never modeling connectors."""
    db_path = os.path.join(work_dir, "aeq_project", "project_database.sqlite")
    if not os.path.isfile(db_path):
        raise RuntimeError("The retained AequilibraE project is missing its network database")
    selected_state, selected_state_digest = validated_network_state(
        network_state_record,
        network_state_digest,
        "agreement geometry",
    )
    selected_manifest = selected_state["retained_network_manifest"]
    current_manifest = retained_network_manifest(os.path.dirname(db_path))
    if current_manifest != selected_manifest:
        raise RuntimeError("Agreement geometry no longer matches the selected retained network")
    connection = sqlite3.connect(db_path)
    try:
        connection.enable_load_extension(True)
        connection.load_extension(SPATIALITE_PATH)
        rows = connection.execute(
            "SELECT link_id, link_type, name, AsGeoJSON(geometry) FROM links ORDER BY link_id"
        ).fetchall()
    finally:
        connection.close()
    features = []
    roadway_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw_link_id, raw_link_type, raw_name, raw_geometry in rows:
        link_id = _strict_link_id(raw_link_id, "Agreement geometry")
        if link_id in seen_ids:
            raise RuntimeError(f"Agreement geometry contains duplicate link id {link_id}")
        seen_ids.add(link_id)
        if str(raw_link_type or "").strip().lower() == "centroid_connector":
            continue
        if not raw_geometry:
            raise RuntimeError(f"Agreement roadway link {link_id} has no readable geometry")
        try:
            geometry = json.loads(raw_geometry)
        except (TypeError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"Agreement roadway link {link_id} has invalid geometry"
            ) from error
        if not isinstance(geometry, dict):
            raise RuntimeError(f"Agreement roadway link {link_id} has invalid geometry")
        roadway_ids.append(link_id)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "link_id": link_id,
                    "link_type": raw_link_type or "",
                    "name": raw_name or "",
                },
                "geometry": geometry,
            }
        )
    if (
        len(features) != selected_manifest["roadway_link_count"]
        or _payload_digest(sorted(roadway_ids))
        != selected_manifest["roadway_link_ids_digest"]
    ):
        raise RuntimeError("Agreement geometry does not cover the exact retained roadway set")
    feature_collection = {
        "type": "FeatureCollection",
        "metadata": {
            "retained_network_manifest": selected_manifest,
            "network_state_digest": selected_state_digest,
            "source_feature_count": len(features),
        },
        "features": features,
    }
    with open(output_path, "w") as handle:
        json.dump(feature_collection, handle, allow_nan=False)
    return output_path


def activitysim_assignment_package(run_id: str) -> str | None:
    """Resolve the executed ActivitySim demand package on the shared worker volume.

    The manifest is the package boundary: taking a matrix alone would lose its
    zone-system provenance and make a same-network comparison impossible to
    defend. Remote storage is deliberately not guessed here; the behavioral
    worker currently declares and documents a shared-filesystem handoff.
    """
    artifacts = sb_get_run_artifacts(run_id)
    manifests = [
        artifact for artifact in artifacts
        if artifact.get("artifact_type") == "activitysim_demand_package_manifest"
    ]
    if not manifests:
        return None
    required = {
        "activitysim_demand_package_manifest": "manifest.json",
        "activitysim_demand_matrix": "od_trip_matrix.csv",
        "activitysim_demand_zones": "zone_attributes.csv",
    }
    verified_paths: dict[str, str] = {}
    for artifact_type, expected_filename in required.items():
        matches = [item for item in artifacts if item.get("artifact_type") == artifact_type]
        if not matches:
            raise RuntimeError(
                f"ActivitySim assignment requires {artifact_type}; none was registered"
            )
        # The query is newest-first. Relaunching a failed run keeps its earlier
        # artifact rows, so the latest handoff supersedes them without deleting
        # historical evidence or mistaking an old hash for the current file.
        selected = matches[0]
        file_url = str(selected.get("file_url") or "")
        if not file_url.startswith("local://"):
            raise RuntimeError("ActivitySim demand package is not on the shared local worker volume")
        path = file_url[len("local://"):]
        if os.path.basename(path) != expected_filename or not os.path.isfile(path):
            raise RuntimeError(f"ActivitySim demand package has no readable {expected_filename}")
        expected_hash = str(selected.get("content_hash") or "")
        with open(path, "rb") as handle:
            actual_hash = hashlib.sha256(handle.read()).hexdigest()
        if not expected_hash or actual_hash != expected_hash:
            raise RuntimeError(f"ActivitySim {expected_filename} failed its content-hash check")
        verified_paths[artifact_type] = path
    package_dirs = {os.path.dirname(path) for path in verified_paths.values()}
    if len(package_dirs) != 1:
        raise RuntimeError("ActivitySim demand-package artifacts do not share one package directory")
    package_dir = package_dirs.pop()
    return package_dir


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
        # THE ZONE SYSTEM GATES BOTH LINK-BASED TIERS.
        #
        # `screening_grade` and `calibrated_to_counts` rest on exactly one kind
        # of evidence: modelled link volumes compared to observed counts. Where
        # a large share of travel never reaches a link, that comparison
        # establishes nothing, so NEITHER tier is established — and this must be
        # checked before the calibration branch, not after, because
        # `calibrated_to_counts` outranks `screening_grade` and closing only the
        # lower one would leave the hole open at the higher.
        #
        # Calibration is the sharper case. Tuning a model until coarse-zone link
        # volumes match observed counts does not recover the missing intrazonal
        # travel; it distorts the parameters that CAN move until they absorb its
        # absence. The held-out APE improves and the model gets worse.
        #
        # This only ever LOWERS a tier. `prototype_only` is the floor already
        # used for a failed gate and for a coverage gap, so nothing here can
        # promote anything — only the reason changes, and only to a truer one.
        zone_block = (validation or {}).get("zone_resolution") or {}
        if zone_block.get("supports_link_level_validation") is False:
            zone_note = zone_block.get("note") or (
                "At this zone resolution a large share of travel never reaches a link."
            )
            if calibration:
                detail = (
                    "Count calibration ran, but is not recorded as a calibrated tier: tuning to "
                    "link volumes cannot recover travel that never reaches a link, and may instead "
                    "absorb its absence into the calibrated parameters."
                )
            elif zone_block.get("gate_withheld"):
                detail = (
                    f"The count comparison ({matched} stations, median APE {median_ape}%) met the "
                    "screening thresholds, but a screening claim is NOT recorded from it, because "
                    "at this zone resolution matching the counts does not establish one."
                )
            else:
                detail = (
                    f"The count comparison ({matched} stations, median APE {median_ape}%) did not "
                    "meet the screening thresholds, and at this zone resolution it could not have "
                    "settled the question either way."
                )
            claim_status, reason = "prototype_only", (
                f"{detail} {zone_note} Trip totals, mode share and VMT do count intrazonal travel "
                "and remain usable; a finer zone system is what would let a link-level comparison "
                "support a claim. This banding is OpenPlan's own screening heuristic, not an "
                "adopted standard."
            )
        elif calibration:
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
        elif (validation or {}).get("coverage") and not (validation or {})["coverage"].get("covered", True):
            # A coverage gap is not a validation failure, and must not be
            # reported as one. Name the gap so the planner knows it is about
            # data availability in their state, not about their model.
            claim_status, reason = "prototype_only", (
                f"{(validation or {})['coverage'].get('reason', 'No observed-count source covers this study area.')} "
                "Screening-grade claims require a validation pass against local counts."
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
            # Same zone qualification the claim decision above applied, so the
            # metric row and the claim beside it cannot tell a planner two
            # different stories about one comparison.
            status, detail = count_validation.metric_status_for_gate(
                median_ape, max_ape, matched,
                intrazonal_share_pct=zone_block.get("intrazonal_share_pct"),
            )
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


# The app writes the run's zone-attribute payload to private Storage and stamps
# a pointer into input_snapshot_json.zoneAttributes. The worker caches the
# downloaded payload beside (not inside) the package directory, because a
# package rebuild wipes that directory and the payload is a RUN input, not a
# generated package artifact.
ZONE_ATTRIBUTES_CACHE_FILENAME = "zone_attributes_payload.json"


def parse_zone_attribute_stamp(run_row: dict | None) -> tuple[str | None, dict]:
    """Read the app's zone-attribute stamp off a run row.

    Returns ``(storage_ref, note)``. ``storage_ref`` is None whenever there is
    nothing to download, and ``note`` then always carries the REASON — an
    older launch path, or the app's own stated failure (no Census key, source
    unavailable, outside coverage). Pure: no network, so it is unit-testable.
    """
    snapshot = (run_row or {}).get("input_snapshot_json") or {}
    stamp = snapshot.get("zoneAttributes")
    if not isinstance(stamp, dict):
        return None, {
            "status": "not_stamped",
            "reason": (
                "This run was launched without an app-supplied zone-attribute table (an older "
                "launch path or an older app version), so the worker used its own configured "
                "data source."
            ),
        }

    if stamp.get("status") != "supplied":
        return None, {
            "status": str(stamp.get("status") or "unavailable"),
            # The app knows the real cause; repeating it verbatim is the only
            # way the worker's failure names something the planner can act on.
            "reason": (
                stamp.get("reason")
                or (stamp.get("demographics") or {}).get("reason")
                or "The app supplied no zone attributes for this run and gave no reason."
            ),
        }

    storage_ref = stamp.get("storageRef")
    if not isinstance(storage_ref, str) or not storage_ref:
        return None, {
            "status": "malformed",
            "reason": "The app marked zone attributes as supplied but recorded no storage reference.",
        }

    return storage_ref, {"status": "supplied", "reason": None}


def zone_attribute_object_path(run_id: str, storage_ref: str) -> str | None:
    """Validate a ``storage://run-artifacts/...`` reference and return its object
    path, or None when it points anywhere but THIS run's own prefix.

    Workspace members can write `input_snapshot_json`, and this worker reads
    Storage with the service-role key — so an unchecked reference would turn the
    worker into a read oracle for the whole bucket. Same containment rule the
    app's artifact resolver applies (src/lib/models/artifact-source.ts).
    """
    prefix = "storage://run-artifacts/"
    if not storage_ref.startswith(prefix):
        return None
    object_path = storage_ref[len(prefix):]
    expected = f"model-runs/{run_id}/"
    if not object_path.startswith(expected) or ".." in object_path:
        return None
    return object_path


def unavailable_zone_attributes(reason: str) -> dict:
    """A payload-shaped record that carries a REASON instead of measures.

    The setup stage learns why a table is missing; the artifact stage, which
    runs later and separately, is the one that must say so in the run's
    evidence. Writing the reason in the payload's own shape carries it across
    that boundary through the existing contract — `supplied_measure_table`
    already knows how to pass a stated reason through — rather than inventing a
    second channel that could go stale independently.
    """
    table = {"status": "unavailable", "reason": reason}
    return {
        "version": ZONE_ATTRIBUTE_PAYLOAD_VERSION,
        "source": {},
        "tables": {"demographics": dict(table), "equity": dict(table)},
    }


def _cache_zone_attributes(work_dir: str, payload: dict) -> None:
    """Persist the payload (or its stated absence) for the later stages.

    Always overwrites, so the artifact stage reads THIS attempt's outcome and
    never a previous attempt's leftovers in the same per-run work directory.

    Overwriting is also what makes the relaunch recovery visible here: the
    relaunch route rebuilds `input_snapshot_json.zoneAttributes` before it
    re-queues the row, so a re-queue downloads a table read with whatever key
    the workspace has NOW, not the one it had at the original launch. That is
    why the no-key messages in this file and in data_pipeline.py are allowed to
    say "relaunch this run". This docstring previously recorded the opposite —
    that a re-queue re-downloaded the same stored table — which was true of the
    launch route before the rebuild landed; do not reinstate that wording
    without also removing "relaunch" from those messages.
    """
    try:
        os.makedirs(work_dir, exist_ok=True)
        with open(os.path.join(work_dir, ZONE_ATTRIBUTES_CACHE_FILENAME), "w") as f:
            json.dump(payload, f)
    except Exception as exc:
        # Caching is a convenience for the later artifact stage; a failure here
        # must not cost the setup stage its demographics.
        print(f"  Warning: could not cache the zone-attribute payload ({exc}).")


def resolve_zone_attributes(run_id: str, work_dir: str, run_row: dict | None) -> tuple[dict | None, dict]:
    """Download this run's app-supplied zone-attribute payload, cache it in
    ``work_dir``, and return ``(payload, note)``.

    The payload is the app's read of the workspace's OWN demographic source —
    the only route by which a per-workspace Census key can reach a model build,
    since the worker cannot see per-workspace secrets. Every failure returns a
    reason rather than None-and-silence, and the reason is cached alongside so
    the artifact stage can state it too.
    """

    def unavailable(status: str, reason: str) -> tuple[None, dict]:
        _cache_zone_attributes(work_dir, unavailable_zone_attributes(reason))
        return None, {"status": status, "reason": reason}

    storage_ref, note = parse_zone_attribute_stamp(run_row)
    if storage_ref is None:
        return unavailable(note["status"], note["reason"])

    object_path = zone_attribute_object_path(run_id, storage_ref)
    if object_path is None:
        return unavailable(
            "rejected_reference",
            f"The run's zone-attribute reference {storage_ref!r} does not point inside this "
            "run's own storage prefix, so it was not read.",
        )

    try:
        res = requests.get(
            f"{SUPABASE_URL}/storage/v1/object/run-artifacts/{object_path}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=60,
        )
        if res.status_code != 200:
            return unavailable(
                "download_failed",
                f"The app-supplied zone-attribute table could not be downloaded "
                f"(HTTP {res.status_code}), so the worker fell back to its own data source.",
            )
        payload = res.json()
    except Exception as exc:
        return unavailable(
            "download_failed",
            f"The app-supplied zone-attribute table could not be downloaded ({exc}).",
        )

    if not isinstance(payload, dict):
        return unavailable(
            "malformed", "The app-supplied zone-attribute table was not a JSON object."
        )

    _cache_zone_attributes(work_dir, payload)
    return payload, {"status": "supplied", "reason": None}


def load_cached_zone_attributes(work_dir: str) -> dict | None:
    """Re-read the payload the setup stage cached, so the artifact stage uses
    the SAME demographic source the zones were built from rather than a second,
    possibly-newer download."""
    path = os.path.join(work_dir, ZONE_ATTRIBUTES_CACHE_FILENAME)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


# --- The travel-model transit feed handoff (transit-feed-v1) ------------------
#
# A planner who ingested a GTFS feed in the Data Hub can name it on a model run.
# The worker then skims THE EXACT BYTES OPENPLAN PARSED, read out of the private
# `gtfs-uploads` bucket and verified against the checksum the ingest recorded.
#
# WHY THE BYTES AND NOT THE URL, which is the obvious and cheaper design. Two
# reasons, both measured rather than assumed:
#
#   1. `gtfs_skim.load_feed` caches a downloaded feed under a URL hash with NO TTL
#      and no revalidation, while the catalog CSV beside it does have one. On a
#      long-lived worker the first run to touch a URL freezes those bytes
#      indefinitely. Handing over a URL is therefore not "the worker may see newer
#      bytes"; it is "the worker sees whatever it first saw, in either direction,
#      forever" — while the service-levels page a planner is reading moves.
#   2. The divergence would be CAMOUFLAGED. The KPI provenance sentence is built
#      from `transit_los.source_url`, which is the same URL the Data Hub card
#      names, so two surfaces would cite one address for numbers that came from
#      different bytes — exactly the evidence a reviewer uses to conclude they
#      agree. Every other refusal in this lane renders an unknown AS an unknown.
#
# THE SNAPSHOT SUPPLIES A UUID AND NOTHING ELSE. `input_snapshot_json` is
# writable by any workspace member and this worker reads with the service-role
# key, so a storage path taken from the snapshot would be a cross-tenant read
# oracle. Every path, every checksum and every displayed value below is read from
# the DATABASE, under a tenancy filter the worker applies itself.
GTFS_UPLOADS_BUCKET = "gtfs-uploads"

_GTFS_VERSION_SELECT = (
    "id,feed_id,workspace_id,source_kind,source_url,storage_path,checksum_sha256,"
    "byte_size,service_start_date,service_end_date,status,is_current"
)


def _transit_feed_summary(los) -> dict:
    """What a successfully skimmed feed reports about ITSELF, for the evidence panel.

    Extracted so the two skim paths — a run's chosen workspace feed and the
    discovered/operator/bundled feed — cannot report a different set of facts.
    A shared capability living inside one of its two callers gets reimplemented
    wrongly by the other; that has already happened twice in this repo.

    Every value here is derived by the worker's OWN parser from the bytes it
    read. The `feed_service_*_date` values that sit beside these in the packet
    come from the database instead, and the two are deliberately kept apart:
    migration 20260805000006 records that a feed's calendar-derived window and
    the window its ingest recorded legitimately disagree, and collapsing them
    would destroy the evidence that they did.
    """
    return {
        "service_day": los.service_day,
        "service_start": los.service_start,
        "service_end": los.service_end,
        # None — not the string "None..None" — when the feed's calendar states no
        # window. An unknown service window must not render downstream as a
        # confident one.
        "service_period": (
            f"{los.service_start}..{los.service_end}"
            if los.service_start and los.service_end
            else None
        ),
        "n_routes": los.n_routes,
        "n_served_stops": los.n_stops,
        "n_lines": len(los.lines),
        "access_buffer_miles": gtfs_skim.GTFS_ACCESS_MILES,
        "flat_fare_usd": gtfs_skim.GTFS_FLAT_FARE,
        # Trips published as a headway band rather than departure times. Excluded
        # from the skim and counted, so a transit share built from part of a feed
        # never presents itself as one built from all of it.
        "frequency_trips_excluded": los.frequency_trips_excluded,
        "scheduled_trips_used": los.scheduled_trips_used,
        # ── THE EXPIRY DISCLOSURE, ON EVERY ORIGIN ────────────────────────────
        # `schedule_expired` had exactly ONE caller — the chosen-workspace-feed
        # path — so a run that used the operator's GTFS_URL, a discovered catalog
        # feed, or the feed bundled with the worker modeled from a schedule of
        # any age with nothing on any surface admitting it. That is not a corner
        # case: the bundled feed is expired TODAY, and it is what every
        # deployment without a workspace feed models transit from.
        #
        # Derived from the PARSER'S OWN calendar window here, so the disclosure
        # is produced by the same function that produces the skim summary and
        # cannot be present on one path and missing on the other. The chosen-feed
        # path overwrites these three with the values its INGEST recorded — see
        # `skim_selected_feed_version` — because migration 20260805000006 records
        # that the two windows legitimately disagree.
        "feed_service_end_date": gtfs_skim.iso_service_date(los.service_end),
        "feed_schedule_expired": gtfs_skim.schedule_expired(
            gtfs_skim.iso_service_date(los.service_end)
        ),
        # "Expired" is a claim about a MOMENT, and this run is the moment. A
        # packet re-read next year must not present today's answer as timeless.
        "feed_expiry_evaluated_at": datetime.now(timezone.utc).isoformat(),
    }


# The three keys `_transit_feed_summary` derives from the parser that the chosen
# feed's INGEST is authoritative for. Named once so the two sides cannot drift.
_INGEST_AUTHORITATIVE_FEED_KEYS = (
    "feed_service_start_date",
    "feed_service_end_date",
    "feed_schedule_expired",
    "feed_expiry_evaluated_at",
)


def _feed_expiry_log_note(meta: dict) -> str:
    """The run-log sentence for a schedule that has already ended, or "".

    ONE sentence, shared by both skim paths. An expired schedule is the ORDINARY
    case — three of four real Sacramento-area feeds are expired, SacRT's by
    sixteen months — and is usually still the right thing to model with, being
    the last schedule the agency published. It must simply never be silent, and
    it must not be silent on some origins and loud on others.
    """
    if not meta.get("feed_schedule_expired"):
        return ""
    return (
        "NOTE: this feed's published service ended on "
        f"{meta.get('feed_service_end_date')}. It is still the schedule the agency last "
        "published, and it is what this run's transit level of service was built from — "
        "but it is not the schedule in force today.\n"
    )


def _feed_version_agency_name(feed_id: str | None) -> str | None:
    """The agency label for a feed, or None. Best-effort: a miss costs a display
    string, never the run, so it is fetched separately rather than as an embedded
    resource that could fail the whole version read."""
    if not gtfs_skim.is_uuid(feed_id):
        return None
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/gtfs_feeds?id=eq.{feed_id}&select=agency_name",
            headers=HEADERS,
            timeout=20,
        )
        if res.status_code != 200:
            return None
        rows = res.json()
        name = (rows[0] or {}).get("agency_name") if rows else None
        return str(name)[:200] if name else None
    except Exception:
        return None


def resolve_selected_feed_version(feed_version_id: str, run_workspace_id: str | None) -> dict:
    """Read the chosen `gtfs_feed_versions` row, under this run's tenancy.

    Raises `SelectedFeedError` — never falls back — with the machine reason the
    evidence panel prints. A row belonging to some OTHER workspace is reported as
    NOT FOUND rather than as forbidden: a member who can write the snapshot must
    not be able to use the worker's answers to learn which feed ids exist
    elsewhere.

    A row whose `workspace_id` is NULL is a PUBLIC preloaded feed and is
    deliberately allowed — that is what NULL means in this schema, and sharing it
    is the point. What is not allowed is one tenant's feed reaching another's run.
    """
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/gtfs_feed_versions?id=eq.{feed_version_id}"
        f"&select={_GTFS_VERSION_SELECT}",
        headers=HEADERS,
        timeout=30,
    )
    if res.status_code != 200:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_not_found",
            f"The transit feed chosen for this run could not be looked up (HTTP {res.status_code}).",
        )
    rows = res.json() or []
    if not rows:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_not_found",
            "The transit feed chosen for this run no longer exists. Re-ingest the feed in the "
            "Data Hub and relaunch, or launch without a feed to let the worker discover one.",
        )
    row = rows[0]
    row_workspace = row.get("workspace_id")
    if row_workspace is not None and row_workspace != run_workspace_id:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_not_found",
            "The transit feed chosen for this run no longer exists. Re-ingest the feed in the "
            "Data Hub and relaunch, or launch without a feed to let the worker discover one.",
        )
    if (row.get("status") or "") != "ready":
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_not_ready",
            "The transit feed chosen for this run has not finished ingesting successfully "
            f"(its ingest is '{str(row.get('status'))[:40]}'), so there was nothing to skim. "
            "A feed has to reach 'ready' in the Data Hub before a model can use it.",
        )
    return row


def download_selected_feed_bytes(row: dict) -> bytes:
    """Fetch the stored archive for a feed version and verify its checksum.

    THE CHECKSUM CHECK IS THE WHOLE POINT OF STORING BYTES. Without it this is
    just a slower refetch: the guarantee being bought is that the archive the
    model skimmed is byte-for-byte the archive whose route and stop counts the
    planner read on the service-levels page. A mismatch is refused rather than
    skimmed, because the one thing worse than no transit is a transit number
    attributed to a feed that did not produce it.
    """
    storage_path = row.get("storage_path")
    if not isinstance(storage_path, str) or not storage_path.strip():
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_bytes_unavailable",
            "This feed was ingested without keeping a copy of the archive, so the model cannot "
            "read the exact bytes OpenPlan parsed. Re-ingest the feed and relaunch. (The worker "
            "will not refetch the source URL instead: the publisher may have changed the feed "
            "since, and the run would then cite a feed that produced none of its numbers.)",
        )
    # The object must sit inside the OWNING workspace's own prefix — the same
    # containment rule the app's uploader applies when it writes the path
    # (`gtfsUploadObjectPath`). storage_path is service-role written and not
    # member-writable today, so this is defence in depth rather than a live hole;
    # it is here because a bucket read with the service-role key has no RLS above
    # it, and the day something else writes this column the confinement should
    # already exist.
    owner = row.get("workspace_id")
    expected_prefix = f"{owner}/" if owner else None
    if expected_prefix is None or not storage_path.startswith(expected_prefix) or ".." in storage_path:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_bytes_unavailable",
            "The stored archive for this feed is not where its own workspace's feeds are kept, "
            "so it was not read.",
        )

    try:
        res = requests.get(
            f"{SUPABASE_URL}/storage/v1/object/{GTFS_UPLOADS_BUCKET}/{storage_path}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=120,
        )
    except Exception as exc:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_bytes_unavailable",
            f"The stored archive for this feed could not be downloaded ({exc}).",
        ) from exc
    if res.status_code != 200:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_bytes_unavailable",
            f"The stored archive for this feed could not be downloaded (HTTP {res.status_code}).",
        )
    raw = res.content

    expected = (row.get("checksum_sha256") or "").strip().lower()
    actual = hashlib.sha256(raw).hexdigest()
    if not expected:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_checksum_mismatch",
            "This feed version records no checksum, so the archive that was read cannot be shown "
            "to be the one OpenPlan parsed. Re-ingest the feed and relaunch.",
        )
    if actual != expected:
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_checksum_mismatch",
            "The stored archive for this feed does not match the checksum recorded when OpenPlan "
            f"parsed it (expected {expected[:16]}…, read {actual[:16]}…), so it was not skimmed.",
        )
    return raw


def load_selected_feed_version(feed_version_id: str, run_workspace_id: str | None) -> tuple:
    """Resolve, download, verify and parse a run's chosen feed version.

    Returns ``(los, meta)`` where every value in `meta` was read from the database
    or computed here — NOTHING comes from the run snapshot, which a workspace
    member can write. Raises `SelectedFeedError` on every failure, and the caller
    must not fall back to another feed on any of them.
    """
    row = resolve_selected_feed_version(feed_version_id, run_workspace_id)
    raw = download_selected_feed_bytes(row)

    source_url = row.get("source_url") or None
    agency_name = _feed_version_agency_name(row.get("feed_id"))
    try:
        los = gtfs_skim.load_feed(
            raw=raw,
            source_url=source_url,
            # An uploaded archive has no URL, so the agency's own name is the best
            # identity a planner can be shown. `_feed_ref` in the KPI provenance
            # sentence falls through source_url -> source_name, so leaving both
            # empty would render this run's feed as "feed not identified".
            source_name=None if source_url else (agency_name or f"feed version {feed_version_id[:8]}"),
        )
    except gtfs_skim.GtfsFrequencyOnly as exc:
        raise gtfs_skim.SelectedFeedError("selected_feed_uses_frequencies", str(exc)) from exc

    service_end = row.get("service_end_date")
    meta = {
        "feed_version_id": row.get("id"),
        "feed_id": row.get("feed_id"),
        "feed_agency_name": agency_name,
        "feed_source_kind": row.get("source_kind"),
        # The checksum the worker VERIFIED against the bytes it read, not merely
        # the one the row claims — download_selected_feed_bytes refused anything
        # that did not match, so recording it here is a statement about these
        # bytes.
        "feed_checksum_sha256": (row.get("checksum_sha256") or "").strip().lower() or None,
        # Kept DISTINCT from `service_start`/`service_end`, which the worker's own
        # parser derives from calendar.txt. Migration 20260805000006 records that
        # the two legitimately disagree in real feeds; collapsing them would
        # destroy the evidence that they did.
        "feed_service_start_date": row.get("service_start_date"),
        "feed_service_end_date": service_end,
        "feed_schedule_expired": gtfs_skim.schedule_expired(service_end),
        # "Expired" is a claim about a MOMENT, and this run is the moment. A
        # packet re-read next year must not be able to present today's answer as
        # timeless.
        "feed_expiry_evaluated_at": datetime.now(timezone.utc).isoformat(),
        # A newer ingest of the same feed exists and is the one the Data Hub now
        # shows. The run still skims the version it was launched with — that is
        # what byte-pinning means — but a planner comparing the two surfaces is
        # owed the reason they differ.
        "feed_version_is_current": row.get("is_current"),
        "frequency_trips_excluded": los.frequency_trips_excluded,
        "scheduled_trips_used": los.scheduled_trips_used,
    }
    return los, meta


def build_mode_provenance(mode_split: dict | None) -> str:
    """The sentence a planner quotes when defending this run's transit share.

    Pure, and a function rather than eighty inline lines, because it is the
    highest-stakes STRING the worker produces: it is what a reviewer reads to
    decide whether a transit number is defensible, and it was previously buried
    inside a stage no test can call. Every claim it may make is exercised in
    `test_transit_feed_handoff.py`.
    """
    transit_status = (mode_split or {}).get("transit_status", "not_run")
    # Name the feed and its service window in the KPI provenance itself, so the
    # transit share travels with the evidence for it rather than pointing at a
    # bundled snapshot the run may not have used. `or` (not a dict default) —
    # these keys are present-but-null when the feed did not state a window.
    los = (mode_split or {}).get("transit_los") or {}
    feed_ref = los.get("source_url") or los.get("source_name") or "feed not identified"
    service_window = los.get("service_period") or "service window not stated in the feed calendar"

    # An expired schedule is the ORDINARY case, not a pathology — three of four
    # real Sacramento-area feeds are expired — and modelling with it is usually
    # right, since it is the last schedule the agency published. What it may never
    # be is SILENT, and this is the sentence where that matters most.
    expiry_note = ""
    if los.get("feed_schedule_expired"):
        expiry_note = (
            " This feed's published service ended on "
            f"{los.get('feed_service_end_date')}, so the schedule modeled is the last "
            "one the agency published and NOT the schedule in force today."
        )
    # A skim built from part of a feed must not present itself as one built from
    # all of it.
    frequency_note = ""
    if los.get("frequency_trips_excluded"):
        frequency_note = (
            f" {los['frequency_trips_excluded']} trip(s) in this feed are published as a "
            "frequencies.txt headway band rather than departure times and were EXCLUDED from the "
            f"skim; {los.get('scheduled_trips_used')} scheduled trip(s) were used."
        )

    if transit_status == "modeled":
        return (
            "Screening-grade 3-way auto/transit/active(walk+bike) logit applied per internal "
            "OD cell before assignment. Auto disutility from the real AequilibraE travel-time "
            "skim; walk/bike from centroid great-circle distance at fixed planning speeds; "
            "transit LOS from published GTFS schedules (headway approximation — access-walk + "
            "wait≈headway/2 + scheduled in-vehicle time + one optional transfer + egress-walk + "
            "flat fare). Transit is available ONLY where a walk-access served stop exists at "
            "both ends and a direct-or-one-transfer scheduled itinerary runs on the modeled "
            "day — transit share is 0 elsewhere by construction, small where rural service "
            "exists. Coefficients are a trip-weighted blend of the sketch-ABM per-purpose "
            f"tables. Derived from a point-in-time snapshot of {feed_ref} ({service_window}); "
            "a screening approximation, not current or real-time service. NOT a calibrated "
            "transit assignment or a validated model."
            + expiry_note
            + frequency_note
        )

    no_feed_reason = los.get("no_feed_reason")
    # WHAT THIS SENTENCE MAY CLAIM DEPENDS ON WHY THERE IS NO SKIM, and the two
    # are not interchangeable. "No usable GTFS feed covered this study area" is a
    # fact about the AREA and is only earned when a feed was actually looked for.
    # When the planner NAMED a feed and that feed could not be used, nothing
    # whatever was established about the area — asserting coverage there would put
    # an unchecked claim under a VMT number, which is the failure this whole lane
    # exists to prevent.
    if (los.get("feed_origin") == "workspace_feed_version"
            or str(no_feed_reason or "").startswith("selected_feed_")):
        detail = los.get("selection_reason") or los.get("error")
        return (
            "Screening-grade auto-vs-active(walk+bike) logit; transit share is 0 because the "
            "transit feed chosen for this run could not be used "
            f"(transit_status={transit_status}"
            + (f"; {no_feed_reason}" if no_feed_reason else "")
            + ")"
            + (f" — {detail}" if detail else "")
            + ". No other feed was substituted, and whether any published feed covers this "
            "study area was NOT determined. This is NOT 'no transit demand' and NOT 'no "
            "transit service here'. Not a validated mode choice model or calibrated forecast."
        )

    return (
        "Screening-grade auto-vs-active(walk+bike) logit; transit share is 0 because no usable "
        f"GTFS feed covered this study area (transit_status={transit_status}"
        + (f"; {no_feed_reason}" if no_feed_reason else "")
        + ") — this is NOT 'no transit demand'. Not a validated mode choice model or "
        "calibrated forecast."
    )


def skim_selected_feed_version(
    feed_version_id: str,
    run_workspace_id: str | None,
    lons,
    lats,
    *,
    deadline: float | None = None,
    feed_origin: str = "workspace_feed_version",
) -> tuple:
    """The WHOLE selected-feed path: read, verify, disclose, cover-check, skim.

    Returns ``(meta, skim, log)``. Raises `SelectedFeedError` on every refusal;
    the caller must never substitute another feed on any of them.

    IT IS A FUNCTION BECAUSE THE STAGE AROUND IT CANNOT BE CALLED. `stage_assignment`
    needs a built AequilibraE project, a demand matrix and a graph, so a branch
    inside it can only ever be checked by reading the file — and a guard that reads
    a file is satisfied by the string appearing anywhere in it, which is how a
    branch that had been turned off entirely stayed green here under mutation. The
    boundary is drawn so that what remains inside the stage is a three-line
    dispatch and everything that could be WRONG is on this side of it.
    """
    los, meta = load_selected_feed_version(feed_version_id, run_workspace_id)
    meta = dict(meta)
    meta["source_url"] = los.source_url
    meta["source_name"] = los.source_name

    log = _feed_expiry_log_note(meta)
    if meta.get("feed_version_is_current") is False:
        log += (
            "NOTE: a newer ingest of this feed exists and is the one the Data Hub now shows. "
            "This run deliberately skimmed the version it was launched with, so its numbers "
            "stay reproducible.\n"
        )
    if los.frequency_trips_excluded:
        log += (
            f"{los.frequency_trips_excluded} trip(s) in this feed are defined by "
            "frequencies.txt (a published headway band rather than departure times) and were "
            f"excluded; {los.scheduled_trips_used} scheduled trip(s) were skimmed.\n"
        )

    gtfs_skim.check_deadline(deadline, "reading and parsing the chosen feed")
    if not gtfs_skim.feed_covers(los, lons, lats):
        # A chosen feed with no stops in the study area is a fact about THAT FEED.
        # It must not be reported as `no_local_feed`, which asserts that a feed was
        # looked for and none covers the area — nobody checked that here, and the
        # claim would then sit under a VMT number a planner has to defend.
        raise gtfs_skim.SelectedFeedError(
            "selected_feed_has_no_stops_in_study_area",
            "The transit feed chosen for this run has no stops inside this study area, so it "
            "was not skimmed. Pick the feed that serves this area, or launch without one and "
            "let the worker look for a covering feed.",
        )

    skim = gtfs_skim.transit_skim(los, lons, lats, deadline=deadline)
    # THE INGEST'S OWN SERVICE WINDOW WINS ON THIS PATH. `_transit_feed_summary`
    # derives an expiry from the parser's calendar for the origins that have no
    # database row behind them; here there IS one, and migration 20260805000006
    # records that the two windows legitimately disagree in real feeds. Letting
    # the summary overwrite them would destroy the evidence that they did — and
    # would silently change what the expiry statement above was computed from.
    _from_ingest = {k: meta[k] for k in _INGEST_AUTHORITATIVE_FEED_KEYS if k in meta}
    meta.update(_transit_feed_summary(los))
    meta.update(_from_ingest)
    log += (
        f"Transit LOS from {los.source_url or los.source_name} "
        f"({feed_origin}): {los.n_routes} route(s), {los.n_stops} served stop(s), "
        f"service day {los.service_day}, service window "
        f"{meta['service_period'] or 'not stated in the feed calendar'}.\n"
    )
    return meta, skim, log


def acs_row_from_equity_measures(measures: dict[str, float]) -> dict[str, float]:
    """Translate the app's jurisdiction-neutral equity measures into the ACS
    variable names ``equity.build_equity_zone`` already speaks.

    Translating instead of recomputing keeps exactly ONE definition of each
    equity share — in equity.py — rather than a second copy here that could
    silently drift from it. Two details are deliberate:

    * B25044's owner/renter zero-vehicle split collapses into one field, because
      build_equity_zone only ever sums the two.
    * The poverty pair is always expressed as B17001 even for block groups. The
      app has already made the C17002-for-B17001 substitution that block-group
      geography requires; by the time it reaches here it is just a universe and
      a below-poverty count, and build_equity_zone divides them identically.
    """
    minority_universe = float(measures.get("minorityUniverse", 0.0))
    minority_count = float(measures.get("minorityCount", 0.0))
    return {
        "B01003_001E": float(measures.get("population", 0.0)),
        "B17001_001E": float(measures.get("lowIncomeUniverse", 0.0)),
        "B17001_002E": float(measures.get("lowIncomeCount", 0.0)),
        "B03002_001E": minority_universe,
        # build_equity_zone derives the minority share as (total - reference
        # group), so the supplied COUNT is expressed as its complement.
        "B03002_003E": max(0.0, minority_universe - minority_count),
        "B25044_001E": float(measures.get("zeroVehicleHouseholdUniverse", 0.0)),
        "B25044_003E": float(measures.get("zeroVehicleHouseholdCount", 0.0)),
        "B25044_010E": 0.0,
    }


def resolve_equity_measure_source(
    supplied_equity: dict[str, dict[str, float]] | None,
    supplied_note: dict,
    zone_level_key: str,
    zone_level_label: str,
    worker_census_key: str,
    worker_fetch,
) -> tuple[dict[str, dict[str, float]], str | None, str | None, str | None]:
    """Decide where this run's equity measures come from, and say why if nowhere.

    Returns ``(acs_rows, source_label, reason, supplied_refusal)``:

    * ``acs_rows`` — ``{geoid: ACS-shaped row}``; empty when nothing answered.
    * ``source_label`` — provenance for an overlay that was produced, else None.
    * ``reason`` — why NO measures could be obtained; None when some were.
    * ``supplied_refusal`` — why the APP's table was set aside, when it was. That
      is provenance, not an absence: the caller records it alongside a produced
      overlay rather than reporting a gap that did not happen.

    WHY THE WORKER'S OWN FETCH IS NOT SKIPPED WHEN THE SUPPLIED TABLE IS REFUSED.
    A supplied table published at a different geography than the run's zones
    actually resolved to would mis-scale every share, so refusing it is correct.
    Skipping the worker's own fetch at the same time was not, and it cost real
    overlays: a run launched with ``zoneGeography: "block_group"`` whose
    block-group refinement legitimately falls back to tracts (an explicitly
    supported fallback in data_pipeline) produced NO equity overlay at all — even
    on a worker with CENSUS_API_KEY set, which could have answered the question
    at the geography the zones really are. Refusing a table that cannot answer is
    honest; refusing the one that can is a silent degrade.

    Pure: the ACS call arrives as ``worker_fetch``, so the decision is testable
    without a network or the scientific stack.
    """
    supplied_refusal = None
    if supplied_equity is not None and supplied_note.get("level") != zone_level_key:
        supplied_refusal = (
            f"The app supplied equity data at {supplied_note.get('level')!r} geography, but this "
            f"run's zones resolved to {zone_level_key!r}, so the supplied table was not used — "
            "comparing across geographies would mis-scale every share."
        )
        supplied_equity = None

    if supplied_equity is not None:
        rows = {
            geoid: acs_row_from_equity_measures(measures)
            for geoid, measures in supplied_equity.items()
        }
        label = supplied_note.get("source_label") or supplied_note.get("source_id")
        return rows, label, None, None

    if worker_census_key:
        # Second choice, kept so an operator running this worker directly is not
        # broken — and, since the refusal above, the ONLY route that can answer
        # at a geography the app did not publish.
        return worker_fetch() or {}, f"worker-side ACS fetch ({zone_level_label})", None, supplied_refusal

    # Neither route had data. Say BOTH halves — "the app sent nothing" alone
    # would imply the worker could have covered for it, which it could not.
    unavailable = (
        supplied_refusal
        or supplied_note.get("reason")
        or "The app supplied no equity table for this run."
    )
    return (
        {},
        None,
        (
            f"{unavailable} No Census API key is set on the worker either, so the EJ/Title VI "
            "overlay could not be produced. A workspace owner or admin can add a free Census key "
            "under Settings -> Integrations and then relaunch this run: the app rebuilds this "
            "run's demographics on every launch, so the new key is picked up."
        ),
        supplied_refusal,
    )


def demographic_coverage_caveat(demographics_provenance: dict | None) -> str | None:
    """State partial demographic coverage, or None when there is nothing to state.

    A zone the supplied table could not cover is dropped from the model entirely
    (``data_pipeline._merge_demographics_with_centroids`` keeps only the rows it
    matched). That is the honest thing to do with a zone whose population is
    unknown — inventing one would be worse — but it silently SHRINKS the modelled
    area, and every study-area total (population, VMT per capita, the equity
    denominators) then describes less ground than the planner drew. One flaky ACS
    county response out of several is enough to trigger it.

    The caller routes this into ``evidence["caveats"]``, the one evidence field
    the app's packet normalizer copies through verbatim. Left in the manifest
    alone it would let a partial read render as a complete model — and a
    per-capita number over a silently shrunken denominator is exactly the
    overclaim the caveat channel exists to prevent.
    """
    provenance = demographics_provenance or {}
    unmatched = provenance.get("unmatched_tracts") or 0
    candidates = provenance.get("candidate_tracts") or 0
    if unmatched:
        return (
            f"Partial demographic coverage — {unmatched} of {candidates} census tracts in this "
            "study area had no supplied demographics and are excluded from the model, so "
            "study-area totals (including VMT per capita) cover less than the area requested."
        )
    if provenance.get("geography_index_truncated"):
        # The source told the app its geography index was cut short. Nothing is
        # known to be missing, but "complete" is no longer a claim this run can
        # make, and an unstated maybe is the failure mode this repo forbids.
        return (
            "The demographic source reported a truncated geography index for this study area, "
            "so the supplied table is not guaranteed to cover every zone in it."
        )
    return None


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

    # Demographics the APP read with the workspace's own key. Fetched on every
    # setup — including a cache hit — so the artifact stage's equity overlay
    # always has this run's payload, not a previous run's leftovers.
    zone_attributes, zone_attributes_note = resolve_zone_attributes(run_id, work_dir, run_row)
    if zone_attributes is None:
        print(f"  Zone attributes: {zone_attributes_note['reason']}")

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
            zone_geography=zone_geography, zone_attributes=zone_attributes,
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

    conn.execute("CREATE TEMP TABLE openplan_routable_connector_nodes (node_id INTEGER PRIMARY KEY)")
    conn.executemany(
        "INSERT INTO openplan_routable_connector_nodes (node_id) VALUES (?)",
        ((int(node_id),) for node_id in largest),
    )

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

        connector_lon, connector_lat, _centroid_offset_m = insert_distinct_centroid(
            conn, centroid_nid, clon, clat
        )

        nearest = conn.execute(
            "SELECT node_id, (X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
            "FROM nodes WHERE is_centroid=0 AND node_id!=? ORDER BY d2 ASC LIMIT 50",
            (clon, clon, clat, clat, centroid_nid),
        ).fetchall()

        nearest_in_comp, searched_component_directly = candidates_on_routable_component(
            nearest,
            largest,
            lambda: conn.execute(
                "SELECT node_id, (X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
                "FROM nodes WHERE is_centroid=0 AND node_id IN "
                "(SELECT node_id FROM openplan_routable_connector_nodes) "
                "ORDER BY d2 ASC LIMIT 3",
                (clon, clon, clat, clat),
            ).fetchall(),
        )
        nearest_in_comp = nearest_in_comp[:3]
        if searched_component_directly:
            log += f"Zone {zid}: nearest connector search extended to the routable component.\n"
        for near_nid, dist2 in nearest_in_comp:
            nx, ny = conn.execute("SELECT X(geometry),Y(geometry) FROM nodes WHERE node_id=?", (near_nid,)).fetchone()
            line_wkt = f"LINESTRING({connector_lon} {connector_lat}, {nx} {ny})"
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
            connector_lon, connector_lat, _centroid_offset_m = insert_distinct_centroid(
                conn, cordon_nid, clon, clat
            )
            nx, ny = conn.execute("SELECT X(geometry),Y(geometry) FROM nodes WHERE node_id=?", (ext_node,)).fetchone()
            line_wkt = f"LINESTRING({connector_lon} {connector_lat}, {nx} {ny})"
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
    # AequilibraE's `aequilibrae_updated_node_id` trigger updates every attached
    # link endpoint on each node-id change. Updating links again here applies
    # the permutation twice: in a real county graph that detached 13 of 34
    # centroids and drove native assignment into heap corruption.
    renumber_nodes(conn, remap)
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
        verdict = calibration.evaluate_calibration_step(
            best_hold_obj,
            trial_obj,
            best_hold_ev,
            trial_hold,
            CALIBRATION_MIN_IMPROVEMENT,
        )
        if verdict["accepted"]:
            cur_od, best_df, best_hold_obj, best_hold_ev = trial_od, trial_df, trial_obj, trial_hold
            best_fit_ev = calibration.evaluate(_match_counts(fit_stations, link_attrs, trial_vol))
            accepted += 1
            log += f"  demand iter {it + 1}: accepted (holdout median APE {trial_hold['median_ape']}%).\n"
        else:
            log += f"  demand iter {it + 1}: rejected ({verdict['reason']}); stopping.\n"
            break
    # final_internal_od = the accepted nudged resident internal OD (ordered as
    # ii → ordered_zone_ids); None if no step was accepted. Used to write a
    # calibrated auto-OD for the (opt-in, distinct-name) calibrated resident VMT.
    final_internal_od = cur_od[internal].copy() if accepted else None
    return accepted, best_df, best_hold_obj, best_fit_ev, best_hold_ev, log, final_internal_od


def _run_calibration(proj_dir, out_dir, graph, resident_mat, external_mat, baseline_df, log,
                     *, counts_path, resident_od=None, ii=None, assignment_centroids=None,
                     make_resident_mat=None, pkg_dir=None, ordered_zone_ids=None,
                     assignment_profile):
    """Staged count calibration outer loop. Returns (calibration_result_or_None,
    log). Reuses the prepared graph. Stage 1 (always): mutate per-road-class
    free-flow travel_time + capacity and re-run a fresh BFW assignment. Stage 2
    (when the resident_od/ii/assignment_centroids/make_resident_mat context is
    provided and enabled): a select-link-guided demand nudge on the resident
    internal OD. Every step is kept only if it improves the HELD-OUT count
    objective. Never mutates the OD-based resident_vmt or the screening result.

    `counts_path` is required and is THIS RUN's count set — see the note where
    the old module global used to live. Calibrating against another study area's
    stations would promote a run to the calibrated tier on evidence that is not
    about it."""
    import csv as _csv
    import numpy as _np
    from aequilibrae.paths import TrafficAssignment, TrafficClass

    with open(counts_path) as _cf:
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
    active_network_settings = assignment_network_settings()

    def _assign_once(resident_matrix=None, select_links=None):
        """Run one BFW assignment. resident_matrix overrides the resident demand
        (stage-2 nudge); select_links attaches select-link to the resident class
        (dict name->[(link_id,dir)]). Returns (results_df, resident_class)."""
        rc = TrafficClass(name="resident", graph=graph, matrix=resident_matrix or resident_mat)
        ec = TrafficClass(name="external", graph=graph, matrix=external_mat)
        if select_links:
            rc.set_select_links(select_links)
        a = build_traffic_assignment(
            TrafficAssignment,
            (rc, ec),
            profile=assignment_profile,
        )
        active_settings_payload = network_settings_payload_json(active_network_settings)
        active_settings_digest = network_settings_digest(
            active_network_settings, active_settings_payload
        )
        state_centroids = (
            assignment_centroids
            if assignment_centroids is not None
            else list(graph.centroids)
        )
        state_record, state_digest = assignment_network_state(
            a,
            graph,
            state_centroids,
            proj_dir,
            network_settings_digest_value=active_settings_digest,
        )
        a.execute()
        result_frame = a.results()
        result_frame.attrs["convergence"] = assignment_convergence_record(
            getattr(a.assignment, "rgap", float("nan")),
            assignment_iteration_count(a.assignment),
            assignment_profile,
        )
        result_frame.attrs["network_state_record"] = state_record
        result_frame.attrs["network_state_digest"] = state_digest
        return result_frame, rc

    def _apply(cum):
        nonlocal active_network_settings
        next_network_settings = assignment_network_settings(cum)
        # factor>1 (under-assigned class) -> faster (tt down) + more capacity, so
        # the class attracts more equilibrium flow. Reset from baseline first.
        tt = base_tt.copy()
        cap = base_cap.copy()
        for cls, f in next_network_settings["road_class_factors"].items():
            m = (link_class == cls).to_numpy()
            tt[m] = base_tt[m] / f
            cap[m] = base_cap[m] * f
        graph.graph["travel_time"] = tt
        graph.graph["capacity"] = cap
        graph.set_graph("travel_time")
        active_network_settings = next_network_settings

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
        # is a no-op and must never promote the run to the calibrated tier.
        # The shared verdict also protects the planner-facing median-APE gate;
        # improving the blend while worsening that metric is not accepted.
        verdict = calibration.evaluate_calibration_step(
            best_hold_obj,
            trial_obj,
            best_hold_ev,
            trial_hold,
            CALIBRATION_MIN_IMPROVEMENT,
        )
        if verdict["accepted"]:
            cum = trial_cum
            best_df = trial_df
            best_hold_obj = trial_obj
            best_fit_ev = calibration.evaluate(_match_counts(fit_stations, link_attrs, trial_vol))
            best_hold_ev = trial_hold
            accepted += 1
            log += (f"  iter {it + 1}: accepted (holdout median APE {trial_hold['median_ape']}%, "
                    f"factors { {k: round(v, 3) for k, v in cum.items()} }).\n")
        else:
            log += f"  iter {it + 1}: rejected ({verdict['reason']}); stopping.\n"
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
    network_settings = assignment_network_settings(cum)
    settings_payload = network_settings_payload_json(network_settings)
    settings_digest = network_settings_digest(network_settings, settings_payload)
    accepted_state, accepted_state_digest = validated_network_state(
        best_df.attrs.get("network_state_record"),
        best_df.attrs.get("network_state_digest"),
        "accepted calibration",
    )
    if accepted_state.get("network_settings_digest") != settings_digest:
        raise AssignmentSettingsError(
            "Accepted calibration state does not match its network settings"
        )
    accepted_convergence = canonical_convergence_record(
        best_df.attrs.get("convergence"), "accepted calibration"
    )
    settings_path = os.path.join(out_dir, "accepted_network_calibration.json")
    with open(settings_path, "w") as settings_file:
        json.dump(
            {
                "network_settings": network_settings,
                "network_settings_payload_json": settings_payload,
                "network_settings_digest": settings_digest,
                "network_state_record": accepted_state,
                "network_state_digest": accepted_state_digest,
                "assignment_convergence": accepted_convergence,
            },
            settings_file,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
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
        # Full-precision, versioned assignment settings are the machine handoff.
        # `applied_class_factors` above remains the rounded presentation summary.
        "network_settings": network_settings,
        "network_settings_payload_json": settings_payload,
        "network_settings_digest": settings_digest,
        "network_state_record": accepted_state,
        "network_state_digest": accepted_state_digest,
        "network_settings_artifact": os.path.basename(settings_path),
        "holdout_station_count": len(holdout_stations),
        "fit_station_count": len(fit_stations),
        "baseline": {"fit": base_fit, "holdout": base_hold},
        "calibrated": {"fit": best_fit_ev, "holdout": best_hold_ev},
        "convergence": accepted_convergence,
        "holdout_station_ids": sorted(str(s.get("station_id")) for s in holdout_stations),
        "calibrated_link_volumes": os.path.basename(cal_csv),
        "calibrated_auto_od": calibrated_auto_od,
    }, log


# ─── Stage 2: Network Assignment ───────────────────────────────────────
def should_apply_trip_based_mode_split(
    demand_is_vehicle: bool, mode_split_enabled: bool = MODE_SPLIT_ENABLED
) -> bool:
    """A vehicle matrix must never be reduced by person-trip mode choice again."""
    return mode_split_enabled and not demand_is_vehicle


def assignment_network_settings(road_class_factors: dict | None = None) -> dict:
    """Build the one versioned settings object for baseline and calibrated networks."""
    factors: dict[str, float] = {}
    for road_class, raw_factor in (road_class_factors or {}).items():
        if isinstance(raw_factor, bool):
            raise AssignmentSettingsError("Network calibration factors cannot be boolean")
        try:
            factor = float(raw_factor)
        except (TypeError, ValueError, OverflowError) as error:
            raise AssignmentSettingsError("Network calibration factors must be numeric") from error
        if not isinstance(road_class, str) or not road_class or not np.isfinite(factor) or factor <= 0:
            raise AssignmentSettingsError("Network calibration factors must have a name and be finite and positive")
        factors[road_class] = factor
    return {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": dict(sorted(factors.items())),
        "application": {
            "travel_time": "baseline_travel_time / factor",
            "capacity": "baseline_capacity * factor",
        },
        "excludes": ["trip_based_od_adjustments"],
    }


def canonical_network_settings(settings: dict) -> dict:
    """Validate a persisted network-settings object without trusting its spelling."""
    if not isinstance(settings, dict):
        raise AssignmentSettingsError("Network settings are missing")
    expected_keys = {"schema_version", "road_class_factors", "application", "excludes"}
    if set(settings) != expected_keys:
        raise AssignmentSettingsError("Network settings fields do not match the v1 schema")
    canonical = assignment_network_settings(settings.get("road_class_factors"))
    if settings.get("schema_version") != canonical["schema_version"]:
        raise AssignmentSettingsError("Unsupported network-settings schema")
    if settings.get("application") != canonical["application"]:
        raise AssignmentSettingsError("Network-settings application semantics do not match v1")
    if settings.get("excludes") != canonical["excludes"]:
        raise AssignmentSettingsError("Network-settings exclusions do not match v1")
    return canonical


def network_settings_payload_json(settings: dict) -> str:
    canonical = canonical_network_settings(settings)
    return json.dumps(
        canonical,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def network_settings_digest(settings: dict, payload_json: str | None = None) -> str:
    """SHA-256 of the exact canonical UTF-8 network-settings payload."""
    expected_payload = network_settings_payload_json(settings)
    payload = expected_payload if payload_json is None else payload_json
    if payload != expected_payload:
        raise AssignmentSettingsError(
            "Network-settings payload is not the canonical JSON for its settings object"
        )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validated_network_settings_record(
    settings: dict | None,
    payload_json: str | None,
    digest: str | None,
    context: str,
) -> tuple[dict, str, str]:
    canonical = canonical_network_settings(settings)
    expected_payload = network_settings_payload_json(canonical)
    if not isinstance(payload_json, str) or payload_json != expected_payload:
        raise AssignmentSettingsError(f"{context} network-settings payload is absent or noncanonical")
    try:
        parsed = json.loads(payload_json)
    except json.JSONDecodeError as error:
        raise AssignmentSettingsError(f"{context} network-settings payload is invalid JSON") from error
    if parsed != canonical:
        raise AssignmentSettingsError(f"{context} network-settings payload does not equal its object")
    expected_digest = network_settings_digest(canonical, payload_json)
    if digest != expected_digest:
        raise AssignmentSettingsError(f"{context} network-settings digest mismatch")
    return canonical, payload_json, expected_digest


def require_matching_network_settings(
    first: tuple[dict | None, str | None, str | None],
    second: tuple[dict | None, str | None, str | None],
    context: str,
) -> tuple[dict, str, str]:
    first_record = validated_network_settings_record(*first, f"{context} first side")
    second_record = validated_network_settings_record(*second, f"{context} second side")
    if first_record != second_record:
        raise AssignmentSettingsError(f"{context} network settings differ")
    return first_record


def _compact_json(value) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def _payload_digest(value) -> str:
    return hashlib.sha256(_compact_json(value).encode("utf-8")).hexdigest()


def _is_sha256(value) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _strict_link_id(value, context: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)):
        raise RuntimeError(f"{context} contains a noninteger link id")
    return int(value)


def retained_network_manifest(proj_dir: str) -> dict:
    """Identify every retained link and the roadway subset without place assumptions."""
    connection = sqlite3.connect(os.path.join(proj_dir, "project_database.sqlite"))
    try:
        rows = connection.execute("SELECT link_id, COALESCE(link_type, '') FROM links").fetchall()
    finally:
        connection.close()
    roles: dict[int, str] = {}
    for raw_link_id, raw_link_type in rows:
        link_id = _strict_link_id(raw_link_id, "Retained network")
        if link_id in roles:
            raise RuntimeError(f"Retained network contains duplicate link id {link_id}")
        roles[link_id] = (
            "modeling_connector"
            if str(raw_link_type or "").strip().lower() == "centroid_connector"
            else "roadway"
        )
    all_ids = sorted(roles)
    roadway_ids = sorted(link_id for link_id, role in roles.items() if role == "roadway")
    connector_ids = sorted(
        link_id for link_id, role in roles.items() if role == "modeling_connector"
    )
    if not all_ids or not roadway_ids:
        raise RuntimeError("Retained network must contain at least one link and one roadway link")
    return {
        "schema_version": "openplan.retained-network-manifest.v1",
        "all_link_count": len(all_ids),
        "all_link_ids_digest": _payload_digest(all_ids),
        "roadway_link_count": len(roadway_ids),
        "roadway_link_ids_digest": _payload_digest(roadway_ids),
        "modeling_connector_link_count": len(connector_ids),
        "modeling_connector_link_ids_digest": _payload_digest(connector_ids),
        "excluded_roles": ["modeling_connector"],
        "role_definition": {
            "roadway": "link_type != centroid_connector",
            "modeling_connector": "link_type = centroid_connector",
        },
    }


_RETAINED_MANIFEST_KEYS = frozenset(
    {
        "schema_version",
        "all_link_count",
        "all_link_ids_digest",
        "roadway_link_count",
        "roadway_link_ids_digest",
        "modeling_connector_link_count",
        "modeling_connector_link_ids_digest",
        "excluded_roles",
        "role_definition",
    }
)


def canonical_retained_network_manifest(manifest: dict | None) -> dict:
    if not isinstance(manifest, dict) or frozenset(manifest) != _RETAINED_MANIFEST_KEYS:
        raise AssignmentSettingsError("Retained-network manifest fields do not match v1")
    if manifest.get("schema_version") != "openplan.retained-network-manifest.v1":
        raise AssignmentSettingsError("Unsupported retained-network manifest schema")
    canonical = dict(manifest)
    for field, allow_zero in (
        ("all_link_count", False),
        ("roadway_link_count", False),
        ("modeling_connector_link_count", True),
    ):
        value = manifest.get(field)
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < (0 if allow_zero else 1)
        ):
            raise AssignmentSettingsError(f"Retained-network {field} is invalid")
    if (
        canonical["roadway_link_count"] + canonical["modeling_connector_link_count"]
        != canonical["all_link_count"]
    ):
        raise AssignmentSettingsError("Retained-network role counts do not cover all links")
    for field in (
        "all_link_ids_digest",
        "roadway_link_ids_digest",
        "modeling_connector_link_ids_digest",
    ):
        if not _is_sha256(manifest.get(field)):
            raise AssignmentSettingsError(f"Retained-network {field} is not a full SHA-256")
    if manifest.get("excluded_roles") != ["modeling_connector"]:
        raise AssignmentSettingsError("Retained-network excluded roles do not match v1")
    if manifest.get("role_definition") != {
        "roadway": "link_type != centroid_connector",
        "modeling_connector": "link_type = centroid_connector",
    }:
        raise AssignmentSettingsError("Retained-network role definition does not match v1")
    return canonical


_NETWORK_STATE_KEYS = frozenset(
    {
        "schema_version",
        "network_settings_digest",
        "assignment_centroid_count",
        "assignment_centroid_order_digest",
        "block_centroid_flows",
        "penalty_through_centroids",
        "cost_field",
        "capacity_field",
        "graph_row_count",
        "graph_rows_digest",
        "graph_float_dtype",
        "graph_cost_digest",
        "graph_cost_dtype",
        "compact_cost_digest",
        "compact_cost_dtype",
        "solver_free_flow_tt_digest",
        "solver_free_flow_tt_dtype",
        "solver_capacity_digest",
        "solver_capacity_dtype",
        "retained_network_digest",
        "retained_network_manifest",
    }
)


def _finite_float_hex(value, context: str) -> str:
    if isinstance(value, bool):
        raise RuntimeError(f"{context} contains a boolean where a float belongs")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise RuntimeError(f"{context} contains a nonnumeric value") from error
    if not np.isfinite(number):
        raise RuntimeError(f"{context} contains a nonfinite value")
    return number.hex()


def _float_array_identity(values, context: str) -> tuple[str, str, list[str]]:
    array = np.asarray(values)
    encoded = [_finite_float_hex(value, context) for value in array.reshape(-1)]
    return array.dtype.str, _payload_digest(encoded), encoded


def assignment_network_state(
    assignment,
    graph,
    assignment_centroids,
    proj_dir: str,
    *,
    network_settings_digest_value: str,
) -> tuple[dict, str]:
    """Fingerprint the exact solver-visible network immediately before execute."""
    if not _is_sha256(network_settings_digest_value):
        raise AssignmentSettingsError("Assignment network state needs a full settings SHA-256")
    manifest = retained_network_manifest(proj_dir)
    frame = graph.graph
    required_columns = {
        "link_id",
        "a_node",
        "b_node",
        "direction",
        "id",
        "distance",
        "modes",
        assignment.time_field,
        assignment.capacity_field,
        "__supernet_id__",
        "__compressed_id__",
    }
    missing = sorted(required_columns - set(frame.columns))
    if missing:
        raise RuntimeError(f"Prepared assignment graph is missing identity fields: {missing}")
    columns = {name: frame[name].to_numpy() for name in required_columns}
    all_nodes = np.asarray(graph.all_nodes)
    rows = []
    graph_link_ids: set[int] = set()
    for ordinal in range(len(frame)):
        link_id = _strict_link_id(columns["link_id"][ordinal], "Prepared graph")
        graph_link_ids.add(link_id)
        internal_a = _strict_link_id(columns["a_node"][ordinal], "Prepared graph a-node map")
        internal_b = _strict_link_id(columns["b_node"][ordinal], "Prepared graph b-node map")
        if not (0 <= internal_a < len(all_nodes) and 0 <= internal_b < len(all_nodes)):
            raise RuntimeError("Prepared graph contains a node index outside its node map")
        rows.append(
            [
                ordinal,
                link_id,
                _strict_link_id(all_nodes[internal_a], "Prepared graph original a-node"),
                _strict_link_id(all_nodes[internal_b], "Prepared graph original b-node"),
                internal_a,
                internal_b,
                _strict_link_id(columns["direction"][ordinal], "Prepared graph direction"),
                _strict_link_id(columns["id"][ordinal], "Prepared graph row id"),
                _strict_link_id(
                    columns["__supernet_id__"][ordinal], "Prepared graph supernet map"
                ),
                _strict_link_id(
                    columns["__compressed_id__"][ordinal], "Prepared graph compressed map"
                ),
                _finite_float_hex(columns[assignment.time_field][ordinal], "Prepared travel time"),
                _finite_float_hex(columns[assignment.capacity_field][ordinal], "Prepared capacity"),
                _finite_float_hex(columns["distance"][ordinal], "Prepared distance"),
                str(columns["modes"][ordinal]),
            ]
        )
    if len(frame) <= 0:
        raise RuntimeError("Prepared assignment graph is empty")
    graph_link_ids_payload = sorted(graph_link_ids)
    if (
        len(graph_link_ids_payload) != manifest["all_link_count"]
        or _payload_digest(graph_link_ids_payload) != manifest["all_link_ids_digest"]
    ):
        raise RuntimeError("Prepared assignment graph does not contain the retained all-link set")

    centroids = [_strict_link_id(value, "Assignment centroids") for value in assignment_centroids]
    if not centroids or len(set(centroids)) != len(centroids):
        raise RuntimeError("Assignment has no centroids")
    graph_cost_dtype, graph_cost_digest, graph_cost = _float_array_identity(
        graph.cost, "Prepared graph cost"
    )
    compact_cost_dtype, compact_cost_digest, compact_cost = _float_array_identity(
        graph.compact_cost, "Prepared compact graph cost"
    )
    solver = getattr(assignment, "assignment", None)
    if solver is None:
        raise RuntimeError("TrafficAssignment has no configured solver")
    free_flow_dtype, free_flow_digest, free_flow = _float_array_identity(
        solver.free_flow_tt, "Solver free-flow time"
    )
    capacity_dtype, capacity_digest, capacity = _float_array_identity(
        solver.capacity, "Solver capacity"
    )
    if len(free_flow) != len(rows) or len(capacity) != len(rows):
        raise RuntimeError("Solver network arrays do not cover every prepared graph row")
    penalty = getattr(graph, "penalty_through_centroids", float("inf"))
    penalty_identity = (
        "positive_infinity"
        if np.isposinf(float(penalty))
        else _finite_float_hex(penalty, "Centroid-through penalty")
    )
    detailed_payload = {
        "assignment_centroids": centroids,
        "block_centroid_flows": bool(getattr(graph, "block_centroid_flows", False)),
        "penalty_through_centroids": penalty_identity,
        "cost_field": str(graph.cost_field),
        "capacity_field": str(assignment.capacity_field),
        "graph_rows": rows,
        "graph_float_dtype": np.dtype(graph.default_types("float")).str,
        "graph_cost": graph_cost,
        "compact_cost": compact_cost,
        "solver_free_flow_tt": free_flow,
        "solver_capacity": capacity,
        "retained_network_manifest": manifest,
        "network_settings_digest": network_settings_digest_value,
    }
    record = {
        "schema_version": "openplan.assignment-network-state.v1",
        "network_settings_digest": network_settings_digest_value,
        "assignment_centroid_count": len(centroids),
        "assignment_centroid_order_digest": _payload_digest(centroids),
        "block_centroid_flows": bool(getattr(graph, "block_centroid_flows", False)),
        "penalty_through_centroids": penalty_identity,
        "cost_field": str(graph.cost_field),
        "capacity_field": str(assignment.capacity_field),
        "graph_row_count": len(rows),
        "graph_rows_digest": _payload_digest(rows),
        "graph_float_dtype": np.dtype(graph.default_types("float")).str,
        "graph_cost_digest": graph_cost_digest,
        "graph_cost_dtype": graph_cost_dtype,
        "compact_cost_digest": compact_cost_digest,
        "compact_cost_dtype": compact_cost_dtype,
        "solver_free_flow_tt_digest": free_flow_digest,
        "solver_free_flow_tt_dtype": free_flow_dtype,
        "solver_capacity_digest": capacity_digest,
        "solver_capacity_dtype": capacity_dtype,
        "retained_network_digest": _payload_digest(detailed_payload),
        "retained_network_manifest": manifest,
    }
    return record, assignment_network_state_digest(record)


def assignment_network_state_digest(record: dict) -> str:
    canonical = canonical_assignment_network_state(record)
    return hashlib.sha256(_compact_json(canonical).encode("utf-8")).hexdigest()


def canonical_assignment_network_state(record: dict | None) -> dict:
    if not isinstance(record, dict) or frozenset(record) != _NETWORK_STATE_KEYS:
        raise AssignmentSettingsError("Assignment network-state fields do not match v1")
    if record.get("schema_version") != "openplan.assignment-network-state.v1":
        raise AssignmentSettingsError("Unsupported assignment network-state schema")
    canonical = dict(record)
    for field in ("assignment_centroid_count", "graph_row_count"):
        value = record.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise AssignmentSettingsError(f"Assignment network-state {field} is invalid")
    if not isinstance(record.get("block_centroid_flows"), bool):
        raise AssignmentSettingsError("Assignment network-state blocked-centroid flag is invalid")
    penalty = record.get("penalty_through_centroids")
    if penalty != "positive_infinity":
        if not isinstance(penalty, str):
            raise AssignmentSettingsError("Assignment network-state centroid penalty is invalid")
        try:
            parsed_penalty = float.fromhex(penalty)
        except ValueError as error:
            raise AssignmentSettingsError(
                "Assignment network-state centroid penalty is invalid"
            ) from error
        if (
            not np.isfinite(parsed_penalty)
            or parsed_penalty < 0
            or parsed_penalty.hex() != penalty
        ):
            raise AssignmentSettingsError(
                "Assignment network-state centroid penalty is noncanonical"
            )
    for field in ("cost_field", "capacity_field"):
        value = record.get(field)
        if not isinstance(value, str) or not value:
            raise AssignmentSettingsError(
                f"Assignment network-state {field} is invalid"
            )
    for field in (
        "graph_float_dtype",
        "graph_cost_dtype",
        "compact_cost_dtype",
        "solver_free_flow_tt_dtype",
        "solver_capacity_dtype",
    ):
        value = record.get(field)
        if not isinstance(value, str) or not value:
            raise AssignmentSettingsError(f"Assignment network-state {field} is invalid")
    for field in (
        "network_settings_digest",
        "assignment_centroid_order_digest",
        "graph_rows_digest",
        "graph_cost_digest",
        "compact_cost_digest",
        "solver_free_flow_tt_digest",
        "solver_capacity_digest",
        "retained_network_digest",
    ):
        if not _is_sha256(record.get(field)):
            raise AssignmentSettingsError(
                f"Assignment network-state {field} is not a full SHA-256"
            )
    canonical["retained_network_manifest"] = canonical_retained_network_manifest(
        record.get("retained_network_manifest")
    )
    return canonical


def validated_network_state(record: dict | None, digest: str | None, context: str) -> tuple[dict, str]:
    canonical = canonical_assignment_network_state(record)
    expected = assignment_network_state_digest(canonical)
    if digest != expected:
        raise AssignmentSettingsError(f"{context} assignment network-state digest mismatch")
    return canonical, expected


def require_matching_network_states(
    first_record: dict | None,
    first_digest: str | None,
    second_record: dict | None,
    second_digest: str | None,
    context: str,
) -> tuple[dict, str]:
    first = validated_network_state(first_record, first_digest, f"{context} first side")
    second = validated_network_state(second_record, second_digest, f"{context} second side")
    if first != second:
        raise AssignmentSettingsError(f"{context} assignment network states differ")
    return first


def require_expected_network_state(
    current_record: dict,
    current_digest: str,
    expected_record: dict | None,
    expected_digest: str | None,
    network_settings_digest_value: str,
    context: str,
) -> tuple[dict, str]:
    """Refuse a handed-off network before the solver is allowed to execute."""
    current = validated_network_state(current_record, current_digest, f"{context} current")
    if (expected_record is None) != (expected_digest is None):
        raise AssignmentSettingsError(
            f"{context} expected network-state record and digest must be supplied together"
        )
    if expected_record is None:
        return current
    expected = validated_network_state(expected_record, expected_digest, context)
    if expected[0].get("network_settings_digest") != network_settings_digest_value:
        raise AssignmentSettingsError(
            f"{context} expected network state names different network settings"
        )
    if current != expected:
        raise AssignmentSettingsError(
            f"Refusing {context} because its solver-visible retained network changed"
        )
    return current


def _assignment_identity_source(assign_result: dict, filename: str) -> dict:
    if filename in {"link_volumes_calibrated.csv", "accepted_network_calibration.json"}:
        return assign_result.get("calibration") or {}
    return assign_result


def assignment_artifact_metadata(assign_result: dict, filename: str) -> dict:
    """Attach the assignment method identity to every assignment output."""
    source = _assignment_identity_source(assign_result, filename)
    convergence_record = canonical_convergence_record(
        source.get("convergence"), f"assignment artifact {filename}"
    )
    profile, profile_payload, profile_digest = validated_convergence_profile(
        convergence_record, f"assignment artifact {filename}"
    )
    settings, settings_payload, settings_digest_value = validated_network_settings_record(
        source.get("network_settings"),
        source.get("network_settings_payload_json"),
        source.get("network_settings_digest"),
        f"assignment artifact {filename}",
    )
    state_record, state_digest = validated_network_state(
        source.get("network_state_record"),
        source.get("network_state_digest"),
        f"assignment artifact {filename}",
    )
    if state_record.get("network_settings_digest") != settings_digest_value:
        raise AssignmentSettingsError(
            f"assignment artifact {filename} network state names different settings"
        )
    return {
        "filename": filename,
        "assignment_convergence": convergence_record,
        "assignment_profile": profile,
        "assignment_profile_payload_json": profile_payload,
        "assignment_profile_digest": profile_digest,
        "network_settings": settings,
        "network_settings_payload_json": settings_payload,
        "network_settings_digest": settings_digest_value,
        "network_state_record": state_record,
        "network_state_digest": state_digest,
    }


def assignment_engine_stamp(profile: dict) -> str:
    canonical = canonical_assignment_profile(profile)
    engine_name = (
        "AequilibraE"
        if canonical["engine"] == "aequilibrae"
        else canonical["engine"]
    )
    return f"{engine_name} {canonical['engine_version']}"


def accepted_network_settings_metadata(assign_result: dict, filename: str) -> dict:
    """Describe the persisted settings independently of the artifact's file encoding."""
    calibration = assign_result.get("calibration") or {}
    settings, _, expected_settings_digest = validated_network_settings_record(
        calibration.get("network_settings"),
        calibration.get("network_settings_payload_json"),
        calibration.get("network_settings_digest"),
        f"assignment artifact {filename}",
    )
    return {
        **assignment_artifact_metadata(assign_result, filename),
        "kind": "accepted_assignment_network_settings",
        "schema_version": settings.get("schema_version"),
        "network_settings_digest": expected_settings_digest,
        "excludes": settings.get("excludes", []),
    }


def apply_persisted_network_settings(graph, proj_dir: str, settings: dict | None) -> int:
    """Apply the first assignment's accepted network calibration exactly once.

    Only speed/capacity factors cross the demand-model boundary.  The calibrated
    trip-based OD is deliberately absent: sharing it would make the ActivitySim
    assignment partly trip-based and destroy the comparison's provenance.
    """
    if settings is None:
        return 0
    settings = canonical_network_settings(settings)
    factors = settings["road_class_factors"]

    clean: dict[str, float] = {}
    for road_class, raw_factor in factors.items():
        if isinstance(raw_factor, bool):
            raise RuntimeError("Persisted network-calibration settings contain a boolean factor")
        factor = float(raw_factor)
        if not road_class or not np.isfinite(factor) or factor <= 0:
            raise RuntimeError("Persisted network-calibration settings contain an invalid factor")
        clean[str(road_class)] = factor

    connection = sqlite3.connect(os.path.join(proj_dir, "project_database.sqlite"))
    try:
        type_by_id = {
            int(link_id): str(link_type or "")
            for link_id, link_type in connection.execute("SELECT link_id, link_type FROM links")
        }
    finally:
        connection.close()

    link_class = graph.graph["link_id"].map(type_by_id)
    travel_time = graph.graph["travel_time"].to_numpy(dtype=float).copy()
    capacity = graph.graph["capacity"].to_numpy(dtype=float).copy()
    changed = 0
    for road_class, factor in clean.items():
        mask = (link_class == road_class).to_numpy()
        changed += int(mask.sum())
        travel_time[mask] /= factor
        capacity[mask] *= factor
    graph.graph["travel_time"] = travel_time
    graph.graph["capacity"] = capacity
    graph.set_graph("travel_time")
    return changed


def stage_assignment(
    run_id: str,
    stage_id: str,
    work_dir: str,
    setup_result: dict,
    pkg_dir: str,
    *,
    output_dir_name: str = "run_output",
    demand_is_vehicle: bool = False,
    counts_path_override: str | None = None,
    persisted_network_settings: dict | None = None,
    persisted_network_settings_payload_json: str | None = None,
    persisted_network_settings_digest: str | None = None,
    assignment_profile_override: dict | None = None,
    assignment_profile_override_payload_json: str | None = None,
    assignment_profile_override_digest: str | None = None,
    expected_network_state_record: dict | None = None,
    expected_network_state_digest: str | None = None,
) -> dict:
    from aequilibrae import Project
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

    proj_dir = os.path.join(work_dir, "aeq_project")
    out_dir = os.path.join(work_dir, output_dir_name)
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
    # Resolve once for the first assignment, then persist and hand this exact
    # profile to the ActivitySim assignment. Stages may run on different worker
    # replicas with different environments; re-resolving there would turn
    # "same assignment settings" into an assumption instead of a run property.
    if assignment_profile_override is None:
        if (
            assignment_profile_override_payload_json is not None
            or assignment_profile_override_digest is not None
        ):
            raise AssignmentSettingsError(
                "Assignment-profile payload/digest were supplied without a profile object"
            )
        assignment_profile = resolve_assignment_profile()
        assignment_profile_payload = assignment_profile_payload_json(assignment_profile)
        assignment_profile_hash = assignment_profile_digest(
            assignment_profile, assignment_profile_payload
        )
    else:
        assignment_profile, assignment_profile_payload, assignment_profile_hash = (
            validated_assignment_profile(
                assignment_profile_override,
                assignment_profile_override_payload_json,
                assignment_profile_override_digest,
                "assignment-stage handoff",
            )
        )
    log += (
        f"Assignment profile {assignment_profile['profile_id']}: "
        f"{assignment_profile['algorithm'].upper()} / {assignment_profile['vdf']}, "
        f"target gap {assignment_profile['target_gap']}, at most "
        f"{assignment_profile['max_iterations']:,} iterations; SHA-256 "
        f"{assignment_profile_hash}.\n"
    )

    # Resolve the counts used for validation/calibration for THIS run: auto-fetch
    # local DOT AADT for the study area when count auto-ingest is on (deployment
    # env OR this run's calibrate opt-in) and the area is in a registered region,
    # else the configured default. A run outside the default count set's own
    # extent gets count-backed validation against its LOCAL counts instead of
    # matching nothing against a distant jurisdiction's stations.
    #
    # A LOCAL, and returned to the caller below. Never a module global: the
    # artifact stage validates against this same path, and it may run in another
    # process (or after this process has handled a different run), where a global
    # would silently be someone else's count set. See the note by
    # VALIDATION_COUNTS_PATH.
    counts_path = counts_path_override or (
        auto_ingest_counts(setup_result.get("bbox"), proj_dir, out_dir,
                           calibrate_requested=calibrate_requested)
        or VALIDATION_COUNTS_PATH
    )
    if counts_path != VALIDATION_COUNTS_PATH:
        log += f"Auto-ingested local DOT AADT counts for validation ({os.path.basename(counts_path)}).\n"
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
    if persisted_network_settings is None:
        if (
            persisted_network_settings_payload_json is not None
            or persisted_network_settings_digest is not None
        ):
            raise AssignmentSettingsError(
                "Network-settings payload/digest were supplied without a settings object"
            )
        applied_network_settings = assignment_network_settings()
        applied_network_settings_payload = network_settings_payload_json(
            applied_network_settings
        )
        applied_network_settings_digest = network_settings_digest(
            applied_network_settings, applied_network_settings_payload
        )
    else:
        (
            applied_network_settings,
            applied_network_settings_payload,
            applied_network_settings_digest,
        ) = validated_network_settings_record(
            persisted_network_settings,
            persisted_network_settings_payload_json,
            persisted_network_settings_digest,
            "assignment-stage handoff",
        )
    reused_network_links = apply_persisted_network_settings(
        graph, proj_dir, applied_network_settings
    )
    if persisted_network_settings is not None:
        log += (
            "Applied the trip-based assignment's persisted, accepted road-class "
            f"speed/capacity factors to {reused_network_links} retained-network links; "
            "no trip-based OD adjustment was reused. "
            f"Settings SHA-256: {applied_network_settings_digest}.\n"
        )
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

    mode_split = (
        {
            "method": "supplied_vehicle_trip_matrix",
            "note": (
                "ActivitySim person trips were converted to vehicles before assignment; "
                "the trip-based mode split was not applied a second time."
            ),
        }
        if demand_is_vehicle
        else None
    )
    if should_apply_trip_based_mode_split(demand_is_vehicle):
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

            # Transit LOS from a published GTFS feed. A feed failure falls back to
            # the auto/active split, but records transit_status so a 0 transit
            # share is never mistaken for "no transit demand".
            #
            # `transit_los_meta` is written on EVERY outcome, hits and misses
            # alike, because it is what the run-detail evidence panel reads. A
            # planner defending a VMT number has to be able to say which feed and
            # from when; a run with no feed has to state that as a coverage fact
            # rather than by leaving the provenance blank.
            transit_skim = None
            transit_status = "modeled"
            transit_los_meta = {}
            try:
                # One wall-clock budget for the WHOLE transit stage — discovery,
                # feed download and skim together — started before any of it runs.
                # The worker's stages are serial inside one queued job, so an
                # unbounded transit stage stalls every run behind this one. The
                # budget is COOPERATIVE — it stops the stage at the next
                # check_deadline call, not the instant it expires, so a stalled
                # download is still bounded by requests' own timeout rather than by
                # this. It never changes a modeled number, only converts an
                # open-ended stall into a named refusal.
                transit_deadline = gtfs_skim.stage_deadline()
                discovery = None
                env_url = os.getenv("GTFS_URL")
                env_path = os.getenv("GTFS_PATH")
                explicit_feed = bool(env_path or env_url)
                # The run's OWN choice of feed, if the planner made one. It
                # outranks the operator's env feed and the catalog both — see
                # gtfs_skim.plan_feed for why a per-run act beats a
                # deployment-wide default — so discovery is not even attempted
                # when one is present, rather than attempted and then discarded.
                feed_selection = gtfs_skim.parse_feed_selection(run_row)
                discovering = GTFS_DISCOVER and not explicit_feed and feed_selection is None
                if discovering:
                    study_bbox = (float(lons.min()), float(lats.min()), float(lons.max()), float(lats.max()))
                    discovery = gtfs_skim.discover_feed(study_bbox)
                    if discovery.url:
                        log += f"GTFS discovery selected a feed covering this study area: {discovery.url}\n"

                # WHICH feed this run tries, and what it may say when it has none.
                # The decision itself lives in gtfs_skim.plan_feed so it is unit
                # testable — main.py cannot be imported by the stdlib worker suites.
                feed_plan = gtfs_skim.plan_feed(
                    discovery, discovering=discovering, env_url=env_url, env_path=env_path,
                    selection=feed_selection,
                )
                feed_origin = feed_plan.origin
                transit_los_meta = {"feed_origin": feed_origin}
                if feed_plan.operator_env_overridden:
                    # An operator who pinned GTFS_URL/GTFS_PATH and finds a run
                    # skimmed something else is owed the reason, on the run, not
                    # in a changelog. This is the disclosure that makes the
                    # precedence reversal honest rather than surprising.
                    transit_los_meta["operator_env_overridden"] = True
                    log += (
                        "This run names its own transit feed, which takes precedence over the "
                        "deployment-wide GTFS_URL/GTFS_PATH feed for this run only.\n"
                    )
                if feed_plan.selection_reason:
                    transit_los_meta["selection_reason"] = feed_plan.selection_reason[:300]
                if feed_plan.discovery_error:
                    # Kept even when the fallback below goes on to model transit
                    # successfully: a run that says "modeled" must still disclose
                    # that discovery never actually ran for this study area.
                    # Truncated so an unexpectedly long message cannot bloat the packet.
                    transit_los_meta["discovery_error"] = feed_plan.discovery_error[:300]
                if feed_plan.fallback_after_catalog_failure:
                    log += (
                        "GTFS feed catalog could not be reached "
                        f"({feed_plan.discovery_error or 'reason not reported'}); falling back to the feed "
                        "bundled with the worker, which is applied only if its own stops fall inside "
                        "this study area. Discovery did NOT run for this study area, so a published "
                        "feed covering it may exist and was not looked for.\n"
                    )

                if not feed_plan.load:
                    # Two very different refusals share this branch, and each says
                    # its own sentence. Neither may fall back to another feed:
                    # discovery's is a checked coverage fact about the AREA, and a
                    # selection's is a fact about the feed the planner CHOSE.
                    transit_status = feed_plan.status
                    transit_los_meta["no_feed_reason"] = feed_plan.no_feed_reason
                    if feed_plan.origin == "workspace_feed_version":
                        log += (
                            "The transit feed chosen for this run could not be used "
                            f"({feed_plan.no_feed_reason}"
                            + (f": {feed_plan.selection_reason}" if feed_plan.selection_reason else "")
                            + "); transit not modeled (transit share 0 — NOT 'no transit demand'). "
                            "No other feed was substituted: a run that names one feed must not "
                            "report numbers produced by another.\n"
                        )
                    else:
                        log += (
                            "GTFS discovery found no scheduled feed covering this study area; "
                            "transit not modeled (transit share 0 — NOT 'no transit demand').\n"
                        )
                elif feed_plan.feed_version_id:
                    # The run named one of the workspace's own ingested feeds.
                    # Everything this path does lives in one function so a test can
                    # DRIVE it — the rest of this stage cannot be called without a
                    # built AequilibraE project, which is how a branch that does
                    # nothing would otherwise reach production green.
                    _sel_meta, transit_skim, _sel_log = skim_selected_feed_version(
                        feed_plan.feed_version_id,
                        run_row.get("workspace_id"),
                        lons,
                        lats,
                        deadline=transit_deadline,
                        feed_origin=feed_origin,
                    )
                    transit_los_meta.update(_sel_meta)
                    log += _sel_log
                else:
                    los = gtfs_skim.load_feed(url=feed_plan.url)
                    transit_los_meta["source_url"] = los.source_url
                    transit_los_meta["source_name"] = los.source_name
                    # A slow-drip download can outlast requests' per-read timeout;
                    # check before committing to the skim rather than starting one
                    # there is no longer time to finish.
                    gtfs_skim.check_deadline(transit_deadline, "downloading and parsing the feed")
                    if not gtfs_skim.feed_covers(los, lons, lats):
                        # The feed loaded but none of its stops fall within the study
                        # area — skimming it would report a misleading transit_status
                        # of "modeled" with a 0 share.
                        if feed_plan.fallback_after_catalog_failure:
                            # The bundled feed was standing in for a catalog we could
                            # not read, so its miss says only that IT is the wrong
                            # feed. Nothing was established about this area, and
                            # calling that "no local feed" would state a coverage
                            # fact nobody checked.
                            transit_status = "feed_unavailable"
                            transit_los_meta["no_feed_reason"] = "feed_catalog_unavailable"
                            log += (
                                "The bundled fallback feed has no stops in this study area, and the "
                                "feed catalog could not be reached — so whether a feed covers this "
                                "study area is UNKNOWN, not an absence of local service.\n"
                            )
                        else:
                            transit_status = "no_local_feed"
                            transit_los_meta["no_feed_reason"] = "feed_has_no_stops_in_study_area"
                            log += (
                                "No GTFS feed covers this study area; transit not modeled "
                                "(transit share 0 — NOT 'no transit demand'). Provide a local feed "
                                "via GTFS_PATH/GTFS_URL to model transit for this area.\n"
                            )
                    else:
                        transit_skim = gtfs_skim.transit_skim(los, lons, lats, deadline=transit_deadline)
                        transit_los_meta.update(_transit_feed_summary(los))
                        log += (
                            f"Transit LOS from {los.source_url or los.source_name} "
                            f"({feed_origin}): {los.n_routes} route(s), {los.n_stops} served stop(s), "
                            f"service day {los.service_day}, service window "
                            f"{transit_los_meta['service_period'] or 'not stated in the feed calendar'}.\n"
                        )
                        # The SAME sentence the chosen-feed path prints. The
                        # operator-env, discovered-catalog and bundled feeds are
                        # exactly the origins that used to say nothing about an
                        # expired schedule — and the bundled feed is expired
                        # today, so this is the ordinary deployment rather than
                        # an edge case.
                        log += _feed_expiry_log_note(transit_los_meta)
            except Exception as te:
                transit_status = "feed_unavailable"
                # Carry forward whatever provenance was already established, then
                # name the REAL reason (e.g. the loud frequencies.txt rejection).
                # Truncated so an unexpectedly long message cannot bloat the packet.
                #
                # Which failure it was decides what we may say. `load_feed` stamps
                # the feed's identity the moment it succeeds, so the presence of a
                # source is the evidence that the feed WAS read and something after
                # it — the coverage check or the skim itself — is what failed.
                # Reporting that as "the feed could not be read" would give a real
                # refusal the wrong reason, and would send a planner off to fix a
                # feed that is fine.
                _feed_was_read = bool(transit_los_meta.get("source_url") or transit_los_meta.get("source_name"))
                if isinstance(te, gtfs_skim.SelectedFeedError):
                    # A run that NAMED a feed already knows exactly what went
                    # wrong with it, and that specificity is the whole value of
                    # letting a planner choose. Flattening it into
                    # "feed_load_failed" would send someone to re-upload an
                    # archive when the real answer was "that feed does not serve
                    # this study area".
                    _no_feed_reason = te.no_feed_reason
                elif isinstance(te, gtfs_skim.GtfsFrequencyOnly):
                    # Not a broken feed: an agency that publishes headway bands
                    # instead of a timetable. Named separately so nobody is sent
                    # to fix a feed that is fine.
                    _no_feed_reason = "feed_publishes_frequencies_only"
                elif isinstance(te, gtfs_skim.GtfsTimeout):
                    # Ran out of time, not out of data. Reported separately because
                    # nothing about the feed is wrong — a rerun, a smaller zone
                    # system or a larger GTFS_STAGE_BUDGET_S is the answer, and
                    # calling it a feed problem would send a planner to their
                    # transit agency over a budget the operator sets.
                    _no_feed_reason = "transit_skim_timed_out"
                elif _feed_was_read:
                    _no_feed_reason = "transit_skim_failed"
                else:
                    _no_feed_reason = "feed_load_failed"
                transit_los_meta = {
                    **transit_los_meta,
                    "no_feed_reason": _no_feed_reason,
                    "error": str(te)[:300],
                }
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

    resident_class = TrafficClass(name="resident", graph=graph, matrix=resident_mat)
    external_class = TrafficClass(name="external", graph=graph, matrix=external_mat)
    assig = build_traffic_assignment(
        TrafficAssignment,
        (resident_class, external_class),
        profile=assignment_profile,
    )

    # Select-link corridor attribution: resolve the validation-station
    # screenlines to link_ids and attach them to BOTH traffic classes BEFORE
    # execute (aequilibrae copies each class's _selected_links into its results
    # at execute start; setting after has no effect). Purely diagnostic — any
    # failure logs and skips, and set_select_links is all-or-nothing on an
    # unknown link_id, so screenlines are pre-filtered to graph-present links.
    select_link_sets: dict[str, list[tuple[int, int]]] = {}
    try:
        if COUNT_VALIDATION_ENABLED and os.path.exists(counts_path):
            import csv as _csv
            with open(counts_path) as _f:
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

    network_state_record, network_state_digest_value = assignment_network_state(
        assig,
        graph,
        assignment_centroids,
        proj_dir,
        network_settings_digest_value=applied_network_settings_digest,
    )
    require_expected_network_state(
        network_state_record,
        network_state_digest_value,
        expected_network_state_record,
        expected_network_state_digest,
        applied_network_settings_digest,
        "assignment-stage handoff",
    )

    # The assignment is one blocking call that can run for minutes. Without
    # this the stage log froze on its last line and a healthy long run looked
    # identical to a hung one — the stuck-run banner only fires after ten
    # minutes, which is longer than many assignments take in total. The engine
    # already logs an iteration line; this forwards it, throttled.
    def _emit_progress(line: str) -> None:
        nonlocal log
        log += line + "\n"
        sb_patch_stage(stage_id, {"log_tail": log})

    with stream_assignment_progress(
        _emit_progress,
        target_gap=assig.rgap_target,
        max_iterations=assig.max_iter,
    ):
        assig.execute()

    rgap = getattr(assig.assignment, "rgap", float("nan"))
    iters = assignment_iteration_count(assig.assignment)

    results_df = assig.results()
    convergence_record = assignment_convergence_record(rgap, iters, assignment_profile)
    results_df.attrs["convergence"] = convergence_record
    results_df.attrs["network_state_record"] = network_state_record
    results_df.attrs["network_state_digest"] = network_state_digest_value
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
    if should_run_calibration(calibrate_requested and not demand_is_vehicle, counts_path):
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
                counts_path=counts_path,
                resident_od=resident_od, ii=ii, assignment_centroids=assignment_centroids,
                make_resident_mat=_make_resident_mat, pkg_dir=pkg_dir, ordered_zone_ids=ordered_zone_ids,
                assignment_profile=assignment_profile,
            )
        except Exception as e:
            log += f"Calibration warning ({e}); keeping the uncalibrated screening result.\n"

    project.close()

    log += (
        f"Converged: {'yes' if convergence_record['converged'] else 'NO'}, "
        f"gap={rgap:.6f}, target={convergence_record['target_gap']}, "
        f"iterations={iters}/{convergence_record['max_iterations']}\n"
    )
    log += f"Links with volume: {loaded_links}/{len(results_df)}\n"

    return {
        "convergence": convergence_record,
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
        "network_settings": applied_network_settings,
        "network_settings_payload_json": applied_network_settings_payload,
        "network_settings_digest": applied_network_settings_digest,
        "network_state_record": network_state_record,
        "network_state_digest": network_state_digest_value,
        # Carried forward so the artifact stage validates against the counts THIS
        # run used, whichever process picks that stage up. Persisted in the run's
        # state.json by process_stage.
        "counts_path": counts_path,
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


def _run_count_validation(db_path: str, link_volumes_csv: str, study_bbox=None,
                          counts_path: str | None = None,
                          intrazonal_share_pct: float | None = None,
                          zone_count: int | None = None) -> dict | None:
    """Match assigned link volumes to observed traffic counts → screening-grade
    fit summary. Returns None when disabled or inputs are missing (never fails
    the run).

    `counts_path` is THIS RUN's count set, recorded by its assignment stage.
    Falling back to the configured default when it is absent (or no longer on
    disk, e.g. an artifact stage running on a different machine) is safe rather
    than merely convenient: the coverage check below compares the count set's own
    station extent against the study area first, so a default that does not cover
    this area reports a coverage gap instead of a fit.

    COVERAGE FIRST. When the available count set does not cover the study area —
    the case for any state with no registered count source, which falls back to
    the bundled pilot file — this returns an explicit coverage summary and does
    NOT match. Matching another jurisdiction's stations against this network
    produced "Only 0 matched station(s); >= 3 required for a screening claim",
    which reads as a failed model rather than an absent data source.

    `intrazonal_share_pct` (PERCENT, 0-100) is how much of this run's travel
    never reaches a link. It QUALIFIES the resulting gate: past the threshold in
    count_validation.py the comparison cannot establish screening grade, and a
    gate that would have passed is withheld rather than awarded. Note the unit —
    the worker measures this share as a FRACTION everywhere else, and the
    conversion happens at the one call site below."""
    import csv as _csv
    resolved_counts = counts_path if (counts_path and os.path.exists(counts_path)) else VALIDATION_COUNTS_PATH
    if not (COUNT_VALIDATION_ENABLED and os.path.exists(resolved_counts)
            and os.path.exists(db_path) and os.path.exists(link_volumes_csv)):
        return None
    with open(resolved_counts) as f:
        stations = list(_csv.DictReader(f))
    if not stations:
        return None

    coverage = count_validation.describe_count_coverage(stations, study_bbox)
    if not coverage["covered"]:
        return count_validation.uncovered_validation_summary(coverage)
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
        # `direction` rides along because a count station on a divided highway
        # measures BOTH carriageways while OSM maps them as two one-way links.
        # Without it the comparison puts half a road against a whole one — worth
        # a factor of two on 99% of motorway links. See count_validation.corridor_volume.
        rows = conn.execute(
            "SELECT link_id, COALESCE(name,''), COALESCE(link_type,''), "
            "X(Centroid(geometry)), Y(Centroid(geometry)), COALESCE(direction, 0) FROM links "
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
            "is_one_way": int(direction or 0) != 0,
        }
        for lid, name, lt, cx, cy, direction in rows
    ]
    return count_validation.validate_against_counts(
        stations, modeled_links,
        intrazonal_share_pct=intrazonal_share_pct, zone_count=zone_count,
    )


def _network_coverage_for_run(run_id: str, db_path: str, link_volumes_csv: str) -> dict | None:
    """Share of the study area's roads this run put traffic on, or None with the
    reason logged.

    Best effort by design: it needs the run's study polygon and link geometry,
    and an artifact stage that cannot reach one of them must still produce every
    other artifact. `link_vmt.network_coverage` owns the arithmetic; the geometry
    and the fetch live here.
    """
    import csv as _csv

    try:
        from shapely import wkb as _wkb
        from shapely.geometry import shape as _shape

        corridor_geojson, _ = resolve_run_study_area(sb_get_run(run_id))
        boundary = _shape(corridor_geojson)

        volumes: dict[int, float] = {}
        with open(link_volumes_csv) as handle:
            for row in _csv.DictReader(handle):
                try:
                    volumes[int(float(row["link_id"]))] = float(row.get("PCE_tot") or 0.0)
                except (TypeError, ValueError, KeyError):
                    continue

        connection = sqlite3.connect(db_path)
        try:
            connection.enable_load_extension(True)
            connection.load_extension(SPATIALITE_PATH)
            rows = connection.execute(
                "SELECT link_id, COALESCE(link_type,''), ST_AsBinary(geometry) FROM links"
            ).fetchall()
        finally:
            connection.close()

        links = []
        for link_id, link_type, blob in rows:
            if blob is None:
                continue
            try:
                line = _wkb.loads(bytes(blob))
                inside = (line.intersection(boundary).length / line.length) if line.length else 0.0
            except Exception:  # noqa: BLE001 - a link whose geometry will not read is skipped
                continue
            links.append((link_id, link_type, inside))
        return link_vmt.network_coverage(volumes, links)
    except Exception as error:  # noqa: BLE001 - the reason is the product here
        return {"measured": False, "reason": f"{type(error).__name__}: {error}"}


def stage_artifacts(
    run_id: str,
    stage_id: str,
    work_dir: str,
    setup_result: dict,
    assign_result: dict,
    package_meta: dict | None = None,
) -> str:
    out_dir = os.path.join(work_dir, "run_output")
    (
        verified_assignment_profile,
        verified_assignment_profile_payload,
        verified_assignment_profile_digest,
    ) = validated_convergence_profile(
        assign_result.get("convergence"),
        "assignment artifact stage",
    )
    baseline_assignment_metadata = assignment_artifact_metadata(
        assign_result, "link_volumes.csv"
    )
    verified_engine_stamp = assignment_engine_stamp(verified_assignment_profile)
    bbox = setup_result.get("bbox")
    model_area_label = (
        f"Dynamic study area ({bbox[0]:.5f},{bbox[1]:.5f} to {bbox[2]:.5f},{bbox[3]:.5f})"
        if bbox and len(bbox) == 4
        else "Dynamic study area"
    )
    log = "Extracting artifacts...\n"

    # ActivitySim must translate skim matrix rows back to source zone ids. The
    # worker state already owns that exact centroid map; publish it as an
    # explicit handoff artifact instead of making a co-located worker guess at
    # this process's scratch-directory layout.
    setup_summary_path = os.path.join(out_dir, "network_setup_summary.json")
    with open(setup_summary_path, "w") as setup_summary_file:
        json.dump(setup_result, setup_summary_file, indent=2)

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
    # Initialised here, not only inside the flows branch: the evidence packet
    # reads it unconditionally, and a run whose per-class flows were
    # unavailable would otherwise raise NameError after a successful
    # assignment — a crash at the very end of an hours-long run.
    vmt_by_class: dict[str, float] = {}
    network_coverage: dict | None = None
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
                # HOW MUCH OF THE NETWORK THIS RUN HAS AN OPINION ABOUT.
                # A road that received no traffic has NO estimate, which is not
                # the same as a low one, and until 2026-08-21 nothing told a
                # planner how many of their roads were in that state. Measured
                # across eleven counties: 77-85% of links inside a study
                # boundary carry nothing, almost all of the minor ones. Clipped
                # to the study polygon because the network is built with a
                # buffer, and counting travel outside the area a planner asked
                # about would overstate the limit.
                network_coverage = _network_coverage_for_run(
                    run_id, db_path, link_volumes_csv
                )
                # WHERE the travel went, not just whose it was. FHWA publishes
                # VMT by functional system for every state every year, so this
                # is the one accuracy check available in all fifty states
                # rather than the four whose count feeds this repo can read.
                vmt_by_class = link_vmt.vmt_by_road_class(class_flows, link_rows)
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
    # Share of internal trips that begin and end in the same zone. None means
    # not measured — never 0.0, which would assert a fine-grained zone system
    # nobody looked at.
    intrazonal_trip_share = None
    intrazonal_trip_count = None
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
            # Measured on the SAME matrix the headline resident VMT came from,
            # so the share describes the travel that figure is built out of.
            if resident_meta.get("internal_trips", 0) > 0:
                intrazonal_trip_share = round(float(resident_meta["intrazonal_share"]), 4)
                intrazonal_trip_count = float(resident_meta["intrazonal_trips"])
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
    # Real low-income / minority / zero-vehicle shares at the run's geography;
    # compares resident VMT/capita for above-typical-disadvantage zones vs the
    # rest. The measures come from the app (read with the workspace's own key)
    # when supplied, else from this worker's own key. Screening-grade, NOT the
    # SB 535 list.
    equity_screen = None
    # Why the overlay did not run, in words. This used to be nothing at all: the
    # block was gated on `if census_key and pkg_dir`, so a run without a Census
    # key produced no equity KPIs, no log line and no evidence — a result that
    # reads exactly like "we looked and found no disparity". Under this repo's
    # rules that silent degrade is the more dangerous of the two failure modes,
    # so every path out of here now leaves a reason behind.
    equity_reason = None
    try:
        pkg_dir = (package_meta or {}).get("package_dir")
        if not pkg_dir:
            equity_reason = (
                "This run has no zone package directory, so the equity overlay had no zones to "
                "screen."
            )
        else:
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
            # The payload spells the level "block_group"; the ACS `for=` clause
            # spells it "block group". normalize_zone_geography does not accept
            # the spaced form, so convert explicitly rather than silently
            # degrading a block-group run to a tract comparison.
            level_key_e = "block_group" if level_e == "block group" else "tract"
            pairs_e = {(g[:2], g[2:5]) for g in geoids_e}

            # Preferred source: the equity measures the APP read with this
            # workspace's own key and handed over at launch. This is what makes
            # the overlay work for a self-serve workspace at all — the worker
            # cannot see per-workspace secrets.
            supplied_equity, supplied_note = supplied_measure_table(
                load_cached_zone_attributes(work_dir), "equity"
            )
            census_key = os.getenv("CENSUS_API_KEY", "")
            acs_e, equity_source, source_reason, supplied_refusal = resolve_equity_measure_source(
                supplied_equity=supplied_equity,
                supplied_note=supplied_note,
                zone_level_key=level_key_e,
                zone_level_label=level_e,
                worker_census_key=census_key,
                worker_fetch=lambda: equity.fetch_acs_equity(pairs_e, level_e, census_key),
            )
            if source_reason:
                equity_reason = source_reason

            if acs_e and any(acs_e.get(g) for g in geoids_e):
                zones_eq = []
                for zid, geoid, pop in zip(zone_ids_e, geoids_e, pops_e):
                    z = equity.build_equity_zone(geoid, float(pop), acs_e.get(geoid) or {})
                    z["zone_id"] = int(zid)
                    zones_eq.append(z)
                zones_eq = equity.classify_equity_focus(zones_eq)
                equity_screen = equity.summarize_equity(zones_eq, per_zone_vmt)
                equity_screen["status"] = "computed"
                equity_screen["geography"] = level_e
                equity_screen["source"] = equity_source
                if supplied_refusal:
                    # The app's table was set aside and the worker's own fetch
                    # covered for it. That is provenance about WHICH source
                    # answered, not a missing result — so it rides with the
                    # computed screen instead of becoming an "unavailable".
                    equity_screen["supplied_table_note"] = supplied_refusal
                # An overlay exists, so nothing here is an absence any more.
                equity_reason = None
                log += (
                    f"Equity overlay ({level_e}, {equity_source}): {equity_screen['focus_zone_count']}/"
                    f"{equity_screen['total_zone_count']} focus zones; VMT/capita disparity "
                    f"{equity_screen.get('vmt_per_capita_disparity_ratio')}\n"
                )
            elif equity_reason is None:
                # Both routes ran and neither covered these zones. When the app's
                # table was set aside first, that is half the story and has to be
                # said too, or the reader is sent to fix the wrong thing.
                equity_reason = (f"{supplied_refusal} " if supplied_refusal else "") + (
                    f"No {level_e}-level equity data was returned for this study area's "
                    f"{len(geoids_e)} zone(s), so the overlay had nothing to compare."
                )
    except Exception as e:
        equity_reason = f"The equity overlay failed while being computed: {e}"

    if equity_screen is None:
        # The absence is reported, with its cause, in the same field a computed
        # screen would occupy — so a reader of the evidence cannot mistake
        # "not measured" for "measured, no disparity".
        equity_screen_evidence = {
            "status": "unavailable",
            "reason": equity_reason or "The equity overlay did not run and no reason was recorded.",
            "method": equity.EQUITY_METHOD_NOTE,
        }
        log += f"Equity overlay not produced: {equity_screen_evidence['reason']}\n"
        equity_caveat = f"Equity overlay not produced — {equity_screen_evidence['reason']}"
    else:
        equity_screen_evidence = equity_screen
        equity_caveat = None

    # ── Demographic COVERAGE, stated rather than buried ──────────────────────
    # Why this cannot stay in the manifest alone: see demographic_coverage_caveat.
    coverage_caveat = demographic_coverage_caveat(
        (package_meta or {}).get("demographics_provenance")
    )
    if coverage_caveat:
        log += f"Demographic coverage: {coverage_caveat}\n"

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
        validation = _run_count_validation(
            db_path, link_volumes_csv, setup_result.get("bbox"),
            # The counts the ASSIGNMENT stage of this run actually used, not
            # whatever this process happened to resolve last.
            counts_path=assign_result.get("counts_path"),
            # HOW MUCH OF THIS RUN'S TRAVEL NEVER REACHED A LINK, so the gate
            # below cannot award a screening claim on a comparison that could
            # not establish one. `intrazonal_trip_share` is a FRACTION (the KPI
            # and the app's panel both read it as one); the qualifier works in
            # PERCENT like the app's bands. The x100 is the whole seam — it is
            # here, once, rather than inside the qualifier, so that the
            # qualifier's threshold reads in the same unit as the app's.
            # None stays None: an unmeasured share must not become 0.0, which
            # would assert the finest possible zone system.
            intrazonal_share_pct=(
                None if intrazonal_trip_share is None else float(intrazonal_trip_share) * 100.0
            ),
            zone_count=assign_result["network"]["zones"],
        )
        # WHICH ROADS THIS RUN CAN SPEAK ABOUT, carried on the validation summary
        # beside `zone_resolution` because it answers the same kind of question:
        # what this comparison can and cannot establish. A road the run assigned
        # no traffic to has NO estimate, not a low one, and until 2026-08-21
        # nothing said so on any surface a planner reads.
        if validation is not None and network_coverage is not None:
            validation["network_coverage"] = network_coverage
        if validation and not (validation.get("coverage") or {}).get("covered", True):
            log += f"Count validation: not run. {(validation['coverage'] or {}).get('reason', '')}\n"
        elif validation:
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
        "engine": verified_engine_stamp,
        "network_source": "OpenStreetMap",
        "algorithm": verified_assignment_profile["algorithm"].upper(),
        "vdf": verified_assignment_profile["vdf"],
        "convergence": assign_result["convergence"],
        "assignment_convergence": baseline_assignment_metadata[
            "assignment_convergence"
        ],
        "assignment_profile": verified_assignment_profile,
        "assignment_profile_payload_json": verified_assignment_profile_payload,
        "assignment_profile_digest": verified_assignment_profile_digest,
        "network_settings": baseline_assignment_metadata["network_settings"],
        "network_settings_payload_json": baseline_assignment_metadata[
            "network_settings_payload_json"
        ],
        "network_settings_digest": baseline_assignment_metadata["network_settings_digest"],
        "network_state_record": baseline_assignment_metadata["network_state_record"],
        "network_state_digest": baseline_assignment_metadata["network_state_digest"],
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
            # Vehicle-miles by KIND OF ROAD, so the run can be compared against
            # FHWA's published VMT by functional system — the one accuracy
            # check available in all fifty states rather than the four whose
            # DOT count feeds this repository can read. Absent rather than
            # zeroed when the per-class flows were unavailable.
            "vmt_by_road_class": (
                {name: round(value, 1) for name, value in sorted(vmt_by_class.items())}
                if vmt_by_class
                else None
            ),
            # WHICH ROADS THIS RUN HAS AN OPINION ABOUT. A road it assigned no
            # traffic to has no estimate, not a low one, and a planner reading a
            # corridor number is entitled to know how much of their network is
            # in that state. Null when it could not be measured, never zeroed —
            # "no coverage" and "coverage unknown" are different facts.
            "network_coverage": network_coverage,
            # Convergence diagnostics between the two estimators (measured on
            # this run; the OD estimator's fixed 1.30 circuity is unchanged).
            "resident_vmt_network_od_ratio": vmt_estimator_ratio,
            "routed_circuity_diagnostic": assign_result.get("convergence_diagnostic"),
            "excluded_gateway_zone_ids": [],
            "network_gateway_zone_ids": gateway_zone_ids,
        },
        "emissions": emissions_screen,
        # Always an object: either the computed screen or a stated reason there
        # is none. A bare null here read as "nothing to report".
        "equity": equity_screen_evidence,
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
        # Where the zone population/household marginals came from — the app's
        # read on the workspace's own key, or this worker's own fetch.
        "demographics": (package_meta or {}).get("demographics_provenance"),
        # `caveats` is the one evidence field the app's packet normalizer copies
        # through verbatim, so a missing equity overlay is stated on a surface a
        # planner actually reads rather than only in the raw evidence JSON.
        "caveats": [
            c
            for c in [
                "Uncalibrated",
                "OSM default speeds/capacities",
                boundary_caveat,
                mode_caveat,
                "Screening-grade",
                equity_caveat,
                coverage_caveat,
            ]
            if c
        ],
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
        ("link_volumes_calibrated.csv", "link_volumes_calibrated"),
        ("accepted_network_calibration.json", "accepted_network_calibration"),
        ("demand.omx", "demand_matrix"),
        ("travel_time_skims.omx", "skim_matrix"),
        ("network_setup_summary.json", "network_setup_summary"),
        ("evidence_packet.json", "evidence_packet"),
    ]:
        fpath = os.path.join(out_dir, fname)
        if os.path.exists(fpath):
            size = os.path.getsize(fpath)
            with open(fpath, "rb") as fh:
                content_hash = hashlib.sha256(fh.read()).hexdigest()
            file_url = (
                evidence_storage_ref
                if atype == "evidence_packet" and evidence_storage_ref
                else f"local://{fpath}"
            )
            metadata = (
                evidence
                if atype == "evidence_packet"
                else assignment_artifact_metadata(assign_result, fname)
            )
            if atype == "accepted_network_calibration":
                metadata = accepted_network_settings_metadata(assign_result, fname)
            sb_post_artifact({
                "run_id": run_id,
                "stage_id": stage_id,
                "artifact_type": atype,
                "file_url": file_url,
                "file_size_bytes": size,
                "content_hash": content_hash,
                "metadata_json": metadata,
            })

    # Register the zone-attributes package input (local:// — same-host consumers
    # only). The ActivitySim behavioral worker reads this + travel_time_skims.omx
    # to build a real ActivitySim input bundle; it's also useful screening
    # provenance for any run. Lives in package/, not run_output/, so it's not in
    # the loop above.
    zone_attr_path = os.path.join(work_dir, "package", "zone_attributes.csv")
    if os.path.exists(zone_attr_path):
        with open(zone_attr_path, "rb") as fh:
            za_hash = hashlib.sha256(fh.read()).hexdigest()
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
    if intrazonal_trip_share is not None:
        # HOW MUCH OF THIS RUN'S TRAVEL NEVER REACHES A LINK.
        #
        # Emitted under the same KPI name the in-app sketch engine uses, because
        # it is the same measurement and a planner comparing two runs must not
        # meet two names for it. The app owns the banding and the wording —
        # duplicating those here would be a second definition of one judgement,
        # free to drift.
        #
        # OpenPlan's own county validation ran 26 zones at 36% intrazonal and
        # link-level AADT comparison failed there. This is the number that says
        # so before somebody concludes the demand is wrong.
        kpis.append(
            (
                "general",
                "intrazonal_trip_share",
                "Trips that never reach the network",
                intrazonal_trip_share,
                "share",
            )
        )

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

    mode_provenance = build_mode_provenance(mode_split)

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
        if name == "intrazonal_trip_share":
            # FACTS ONLY. The band, the verdict and the wording are the app's
            # (src/lib/models/zone-resolution.ts) — two definitions of one
            # judgement are free to drift, and the app is where a planner reads
            # it. What the worker knows and the app does not is the zone count
            # and the raw trip counts behind the share.
            kpi_payload["breakdown_json"] = {
                "zone_count": assign_result["network"]["zones"],
                "zone_geography": zone_geography,
                "intrazonal_trips": intrazonal_trip_count,
                "provenance": (
                    "Share of INTERNAL person-trips on the OD matrix diagonal — trips that begin "
                    "and end in the same zone and therefore never travel on a link. Gateway zones "
                    "are excluded from both halves so through-traffic cannot shrink the share."
                ),
            }
        elif name == "zones" and zone_geography is not None:
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
                    "engine": verified_engine_stamp,
                    "modelRunId": run_id,
                    **baseline_assignment_metadata,
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
                    geojson_hash = hashlib.sha256(geojson_file.read()).hexdigest()
                sb_post_artifact({
                    "run_id": run_id,
                    "stage_id": stage_id,
                    "artifact_type": "volumes_geojson",
                    "file_url": storage_ref,
                    "file_size_bytes": os.path.getsize(geojson_path),
                    "content_hash": geojson_hash,
                    "metadata_json": {
                        **baseline_assignment_metadata,
                        "format": "geojson",
                        "features": len(features),
                        "maxVolume": max_vol,
                    },
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
# Where per-run working directories are created. AEQ_WORK_DIR is the operator's
# answer; the fallback is a neutral, repo-local scratch root for a developer who
# has set nothing.
#
# The old fallback was `data/pilot-nevada-county` — one county's name baked into
# the path every run in the world would be written under. It was scratch space,
# never that county's data, and naming it that way both stated something untrue
# about the run and made the pilot look like part of the runtime. A worker in
# Ohio writing into a directory named for a California county is exactly the
# defect the no-hardcoded-place rule exists to prevent, however harmless the
# bytes.
#
# WHAT AN OPERATOR MUST DO: nothing, unless they were relying on the old default.
# Every deployment path sets AEQ_WORK_DIR explicitly (the Dockerfile and both Fly
# configs point it at container scratch), so only a local checkout that never set
# it moves — and only for NEW runs. A run already in flight under the old path
# keeps its state.json there: point AEQ_WORK_DIR at that directory to finish it.
#
# The fallback is the system temp directory rather than somewhere in the repo,
# for the same reason the container default is /tmp: this is scratch, it is
# rebuilt per run, and a worker must not silently accumulate gigabytes of run
# output inside a checkout. Set AEQ_WORK_DIR if you want it kept (and point the
# app's OPENPLAN_WORKER_LOCAL_ROOT at the same path — see LOCAL.md).
RUN_WORK_ROOT = os.getenv(
    "AEQ_WORK_DIR",
    os.path.join(tempfile.gettempdir(), "openplan-model-runs"),
)


# ONE STAGE AT A TIME IN THIS PROCESS — the invariant, not a preference.
#
# resolve_max_concurrent_runs refuses AEQ_MAX_CONCURRENT_RUNS above 1 because
# AequilibraE keeps the open project in a process-wide global
# (`aequilibrae.context._current_project`, set by `Project.open()`/`new()` and
# read by TrafficAssignment, NetworkSkimming and the graph builders when no
# project is passed). Two stages executing at once in one process therefore
# assign each other's networks and validate against each other's counts.
#
# Refusing that knob was necessary and NOT sufficient: `AEQ_WORKER_MODE=both`
# runs the poll loop on one thread and the push executor's drain on another, in
# the SAME process. The atomic queued -> running claim stops them taking the same
# stage; it does nothing at all to stop them taking two DIFFERENT stages — of two
# different runs, in two different study areas — and executing them side by side.
# That is the identical corruption arriving through the other door.
#
# So execution is serialized here, at the one place both entrypoints funnel
# through. Poll-only and push-only deployments never contend for this lock (they
# have one executing thread), so it costs them nothing; `both` now genuinely is
# safe by construction rather than only as far as the claim reaches. The lock is
# released between stages, which is correct: everything a stage hands the next
# one travels through state.json and the project directory on disk, never
# through a live AequilibraE object.
_STAGE_EXECUTION_LOCK = threading.Lock()


def process_stage(stage: dict) -> bool:
    """Claim and execute one stage. Returns False when the claim was lost.

    The return value is what makes a PUSHED run safe (see serve_push_trigger
    below). A push is only a doorbell: it hands over no ownership, so a pushed
    worker and a polling worker can both arrive at the same stage, and the
    conditional PATCH in sb_claim_stage is the one thing that decides which of
    them runs it. The loser must be able to tell it lost and stop, rather than
    carry on as though it owned the run.

    Serialized process-wide: see `_STAGE_EXECUTION_LOCK` above. The claim is
    taken INSIDE the lock deliberately — a thread that waited its turn must
    re-test whether the stage is still `queued`, and the conditional PATCH is
    exactly that test, so a stage finished by someone else in the meantime is
    reported as a lost claim instead of being executed twice.
    """
    with _STAGE_EXECUTION_LOCK:
        return _claim_and_run_stage(stage)


def _claim_and_run_stage(stage: dict) -> bool:
    """The body of `process_stage`, which owns the serialization above it.

    Never call this directly: it assumes `_STAGE_EXECUTION_LOCK` is held.
    """
    stage_id = stage["id"]
    run_id = stage["run_id"]
    stage_name = stage["stage_name"]
    now_iso = datetime.now(timezone.utc).isoformat()

    print(f"[{time.strftime('%X')}] Processing: {stage_name} (run={run_id[:8]}…)")

    # Atomic claim: only one worker may transition this stage queued -> running.
    claimed = sb_claim_stage(
        stage_id,
        {"status": "running", "started_at": now_iso, "log_tail": stage_claim_placeholder(stage_name)},
    )
    if not claimed:
        print(f"[{time.strftime('%X')}] ⏭️ Lost claim race for {stage_name} (run={run_id[:8]}…); another worker owns it.")
        return False
    sb_patch_run(run_id, {"status": "running"})

    # Each run gets its own working directory
    work_dir = os.path.join(RUN_WORK_ROOT, "runs", run_id[:12])
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

        elif stage_name == "ActivitySim Network Assignment":
            with open(state_file) as f:
                state = json.load(f)
            package_dir = activitysim_assignment_package(run_id)
            if package_dir is None:
                log = (
                    "No executed ActivitySim demand package was registered. The behavioral lane "
                    "completed in its documented preflight-only posture, so there is no second "
                    "network assignment to run.\n"
                )
                sb_patch_stage(stage_id, {
                    "status": "succeeded",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "log_tail": log,
                })
                print(f"[{time.strftime('%X')}] ✅ {stage_name} not applicable (preflight only)")
            else:
                first_assignment = state.get("assignment") or {}
                calibrated_handoff = bool(first_assignment.get("calibration"))
                handoff_source = (
                    first_assignment.get("calibration") or {}
                    if calibrated_handoff
                    else first_assignment
                )
                (
                    first_assignment_profile,
                    first_assignment_profile_payload,
                    first_assignment_profile_digest,
                ) = validated_convergence_profile(
                    handoff_source.get("convergence"),
                    "trip-based assignment",
                )
                (
                    accepted_settings,
                    accepted_settings_payload,
                    expected_settings_digest,
                ) = validated_network_settings_record(
                    handoff_source.get("network_settings"),
                    handoff_source.get("network_settings_payload_json"),
                    handoff_source.get("network_settings_digest"),
                    "ActivitySim assignment handoff",
                )
                expected_state, expected_state_digest = validated_network_state(
                    handoff_source.get("network_state_record"),
                    handoff_source.get("network_state_digest"),
                    "ActivitySim assignment handoff first assignment",
                )
                if expected_state.get("network_settings_digest") != expected_settings_digest:
                    raise RuntimeError(
                        "ActivitySim assignment handoff state names different network settings"
                    )
                result = stage_assignment(
                    run_id,
                    stage_id,
                    work_dir,
                    state["setup"],
                    package_dir,
                    output_dir_name="activitysim_assignment_output",
                    demand_is_vehicle=True,
                    counts_path_override=first_assignment.get("counts_path"),
                    persisted_network_settings=accepted_settings,
                    persisted_network_settings_payload_json=accepted_settings_payload,
                    persisted_network_settings_digest=expected_settings_digest,
                    assignment_profile_override=first_assignment_profile,
                    assignment_profile_override_payload_json=first_assignment_profile_payload,
                    assignment_profile_override_digest=first_assignment_profile_digest,
                    expected_network_state_record=expected_state,
                    expected_network_state_digest=expected_state_digest,
                )
                require_matching_assignment_profiles(
                    handoff_source.get("convergence"),
                    result.get("convergence"),
                    "ActivitySim assignment handoff",
                )
                require_matching_network_settings(
                    (
                        accepted_settings,
                        accepted_settings_payload,
                        expected_settings_digest,
                    ),
                    (
                        result.get("network_settings"),
                        result.get("network_settings_payload_json"),
                        result.get("network_settings_digest"),
                    ),
                    "ActivitySim assignment handoff",
                )
                require_matching_network_states(
                    expected_state,
                    expected_state_digest,
                    result.get("network_state_record"),
                    result.get("network_state_digest"),
                    "ActivitySim assignment handoff",
                )
                state["activitysim_assignment"] = result
                with open(state_file, "w") as f:
                    json.dump(state, f)
                volume_path = os.path.join(
                    work_dir, "activitysim_assignment_output", "link_volumes.csv"
                )
                with open(volume_path, "rb") as volume_handle:
                    volume_bytes = volume_handle.read()
                sb_post_artifact({
                    "run_id": run_id,
                    "stage_id": stage_id,
                    "artifact_type": "activitysim_link_volumes",
                    "file_url": f"local://{volume_path}",
                    "file_size_bytes": len(volume_bytes),
                    "content_hash": hashlib.sha256(volume_bytes).hexdigest(),
                    "metadata_json": {
                        **assignment_artifact_metadata(result, "link_volumes.csv"),
                        "kind": "same_network_activitysim_assignment",
                        "demand_is_vehicle": True,
                        "network_calibration": (
                            "accepted_trip_based_network_settings"
                            if calibrated_handoff
                            else "baseline_network_settings"
                        ),
                        "trip_based_od_adjustments_reused": False,
                    },
                })
                sb_patch_stage(stage_id, {
                    "status": "succeeded",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "log_tail": result["log"],
                })

        elif stage_name == "Demand Model Agreement":
            artifacts = sb_get_run_artifacts(run_id)
            has_activitysim_assignment = any(
                item.get("artifact_type") == "activitysim_link_volumes" for item in artifacts
            )
            if not has_activitysim_assignment:
                log = (
                    "No executed ActivitySim assignment exists. The run completed in its "
                    "preflight-only posture, so there are no two demand models to compare.\n"
                )
                sb_patch_stage(stage_id, {
                    "status": "succeeded",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "log_tail": log,
                })
            else:
                with open(state_file) as f:
                    state = json.load(f)
                first_assignment = state.get("assignment") or {}
                second_assignment = state.get("activitysim_assignment") or {}
                calibrated_comparison = bool(first_assignment.get("calibration"))
                first_source = (
                    first_assignment.get("calibration") or {}
                    if calibrated_comparison
                    else first_assignment
                )
                try:
                    first_convergence_record = canonical_convergence_record(
                        first_source.get("convergence"),
                        "demand-model agreement first side",
                    )
                    second_convergence_record = canonical_convergence_record(
                        second_assignment.get("convergence"),
                        "demand-model agreement second side",
                    )
                    (
                        shared_assignment_profile,
                        shared_assignment_profile_payload,
                        shared_assignment_profile_digest,
                    ) = require_matching_assignment_profiles(
                        first_convergence_record,
                        second_convergence_record,
                        "demand-model agreement",
                    )
                    (
                        shared_settings,
                        shared_settings_payload,
                        shared_settings_digest,
                    ) = require_matching_network_settings(
                        (
                            first_source.get("network_settings"),
                            first_source.get("network_settings_payload_json"),
                            first_source.get("network_settings_digest"),
                        ),
                        (
                            second_assignment.get("network_settings"),
                            second_assignment.get("network_settings_payload_json"),
                            second_assignment.get("network_settings_digest"),
                        ),
                        "demand-model agreement",
                    )
                    shared_network_state, shared_network_state_digest = (
                        require_matching_network_states(
                            first_source.get("network_state_record"),
                            first_source.get("network_state_digest"),
                            second_assignment.get("network_state_record"),
                            second_assignment.get("network_state_digest"),
                            "demand-model agreement",
                        )
                    )
                except AssignmentSettingsError as error:
                    raise RuntimeError(
                        "Refusing demand-model agreement without identical, verified assignment "
                        f"profile, network settings, and solver-visible retained network: {error}"
                    ) from error
                if shared_network_state.get("network_settings_digest") != shared_settings_digest:
                    raise RuntimeError(
                        "Refusing demand-model agreement because network state names different settings"
                    )
                first_volumes = verified_latest_local_artifact(
                    run_id,
                    "link_volumes_calibrated" if calibrated_comparison else "link_volumes",
                    expected_assignment_profile=shared_assignment_profile,
                    expected_assignment_profile_payload_json=shared_assignment_profile_payload,
                    expected_assignment_profile_digest=shared_assignment_profile_digest,
                    expected_network_settings=shared_settings,
                    expected_network_settings_payload_json=shared_settings_payload,
                    expected_network_settings_digest=shared_settings_digest,
                    expected_network_state_record=shared_network_state,
                    expected_network_state_digest=shared_network_state_digest,
                )
                second_volumes = verified_latest_local_artifact(
                    run_id,
                    "activitysim_link_volumes",
                    expected_assignment_profile=shared_assignment_profile,
                    expected_assignment_profile_payload_json=shared_assignment_profile_payload,
                    expected_assignment_profile_digest=shared_assignment_profile_digest,
                    expected_network_settings=shared_settings,
                    expected_network_settings_payload_json=shared_settings_payload,
                    expected_network_settings_digest=shared_settings_digest,
                    expected_network_state_record=shared_network_state,
                    expected_network_state_digest=shared_network_state_digest,
                )
                agreement_dir = os.path.join(work_dir, "demand_model_agreement")
                os.makedirs(agreement_dir, exist_ok=True)
                geometry_path = write_agreement_network_geojson(
                    work_dir,
                    os.path.join(agreement_dir, "retained_network.geojson"),
                    network_state_record=shared_network_state,
                    network_state_digest=shared_network_state_digest,
                )
                repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
                scripts_dir = os.path.join(repo_root, "scripts", "modeling")
                if scripts_dir not in sys.path:
                    sys.path.insert(0, scripts_dir)
                from compare_behavioral_demand_outputs import compare_link_volume_runs

                result = compare_link_volume_runs(
                    first_csv=first_volumes,
                    second_csv=second_volumes,
                    first_label=(
                        "AequilibraE trip-based demand (count-calibrated)"
                        if calibrated_comparison
                        else "AequilibraE trip-based demand"
                    ),
                    second_label="ActivitySim activity-based demand",
                    output_dir=agreement_dir,
                    force=False,
                    loaded_links_geojson=geometry_path,
                    first_convergence_record=first_convergence_record,
                    second_convergence_record=second_convergence_record,
                    first_assignment_profile_payload_json=shared_assignment_profile_payload,
                    first_assignment_profile_digest=shared_assignment_profile_digest,
                    second_assignment_profile_payload_json=shared_assignment_profile_payload,
                    second_assignment_profile_digest=shared_assignment_profile_digest,
                    first_network_settings_payload_json=shared_settings_payload,
                    first_network_settings_digest=shared_settings_digest,
                    second_network_settings_payload_json=shared_settings_payload,
                    second_network_settings_digest=shared_settings_digest,
                    first_network_state_record=shared_network_state,
                    first_network_state_digest=shared_network_state_digest,
                    second_network_state_record=shared_network_state,
                    second_network_state_digest=shared_network_state_digest,
                )
                for artifact_type, path, content_type in (
                    ("demand_model_agreement", result["json_path"], "application/json"),
                    ("demand_model_agreement_report", result["markdown_path"], "text/markdown"),
                    ("demand_model_agreement_geojson", result["geojson_path"], "application/geo+json"),
                ):
                    register_agreement_artifact(
                        run_id,
                        stage_id,
                        artifact_type,
                        path,
                        content_type,
                        first_assignment_convergence=first_convergence_record,
                        second_assignment_convergence=second_convergence_record,
                        assignment_profile=shared_assignment_profile,
                        assignment_profile_payload_json=shared_assignment_profile_payload,
                        assignment_profile_digest=shared_assignment_profile_digest,
                        network_settings=shared_settings,
                        network_settings_payload_json=shared_settings_payload,
                        network_settings_digest=shared_settings_digest,
                        network_state_record=shared_network_state,
                        network_state_digest=shared_network_state_digest,
                    )
                summary = result["summary"]
                log = (
                    f"Both assignments used {'accepted' if calibrated_comparison else 'baseline'} "
                    f"network settings SHA-256 {shared_settings_digest}.\n"
                    + f"Both assignments used assignment profile SHA-256 "
                    f"{shared_assignment_profile_digest}.\n"
                    + f"Both assignments used solver-visible network state SHA-256 "
                    f"{shared_network_state_digest}.\n"
                    + f"Compared {summary['links_compared']:,} links on the retained network; "
                    f"{summary['links_carrying_meaningful_traffic']:,} carry meaningful traffic.\n"
                    f"Busy-link agreement share: {summary['agree_share_meaningful_links']}; "
                    f"divergence share: {summary['diverge_share_meaningful_links']}.\n"
                    "The two demand models were not averaged. JSON, report, and agreement-map "
                    "GeoJSON were registered as run artifacts.\n"
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
            return True

        print(f"[{time.strftime('%X')}] ✅ {stage_name} succeeded")

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        print(f"[{time.strftime('%X')}] ❌ {stage_name} failed: {error_msg}")
        failure_patch = {
            "status": "failed",
            "error_message": error_msg[:2000],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        # DO NOT LEAVE THE CLAIM-TIME PLACEHOLDER ON A FAILED STAGE.
        #
        # The claim above stamps `log_tail` with "Starting {stage_name}...", and
        # a stage that failed before writing any real log kept it — so the app
        # rendered a console box saying the stage was STARTING directly beneath
        # its red error. That is every failure a planner can actually fix (no
        # study area, no Census key, study area too large), because those raise
        # early. A partial log written by a stage that got further is real
        # output and is left alone; the app labels it as reaching only the point
        # of failure.
        if _stage_log_is_claim_placeholder(stage_id, stage_name):
            failure_patch["log_tail"] = None
        sb_patch_stage(stage_id, failure_patch)
        sb_patch_run(run_id, {"status": "failed"})
        # True: this worker owned the stage and reached a terminal answer for it.
        # Only a LOST CLAIM is False, because only that means someone else is
        # carrying the run.
        return True

    # Check if run is complete
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/model_run_stages?run_id=eq.{run_id}&status=neq.succeeded",
        headers=HEADERS,
    )
    if res.status_code == 200 and not res.json():
        print(f"[{time.strftime('%X')}] 🎉 Run {run_id[:8]}… complete!")
        sb_patch_run(run_id, {"status": "succeeded", "completed_at": datetime.now(timezone.utc).isoformat()})

    return True


def stage_claim_placeholder(stage_name: str) -> str:
    """The `log_tail` written when a stage is claimed, before it logs anything.

    Named once so the writer and the "is this still the placeholder?" check
    cannot drift into disagreeing about the exact string.
    """
    return f"Starting {stage_name}..."


def _stage_log_is_claim_placeholder(stage_id: str, stage_name: str) -> bool:
    """Whether this stage's stored log is still the claim-time placeholder.

    Best-effort: any read failure answers False, so an unreadable row keeps
    whatever log it has rather than losing real output to a network blip.
    """
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/model_run_stages?id=eq.{stage_id}&select=log_tail",
            headers=HEADERS, timeout=15,
        )
        if res.status_code != 200:
            return False
        rows = res.json()
        if not rows:
            return False
        return (rows[0].get("log_tail") or "").strip() == stage_claim_placeholder(stage_name)
    except Exception:
        return False


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
AEQ_STAGE_NAMES = (
    "AequilibraE Setup",
    "Network Assignment",
    "Artifact Extraction",
    "ActivitySim Network Assignment",
    "Demand Model Agreement",
)
_AEQ_STAGE_FILTER = "stage_name=" + urllib.parse.quote(
    "in.(" + ",".join(f'"{name}"' for name in AEQ_STAGE_NAMES) + ")",
    safe="().,",
)


POLL_INTERVAL_SECONDS = max(1, int(os.getenv("AEQ_POLL_INTERVAL_SECONDS", "5")))


def fetch_queued_stages(run_id: str | None = None, limit: int = 25) -> list[dict]:
    """Queued stages this worker owns, oldest first — optionally for ONE run.

    The single read behind both entrypoints. Filtering by run is what a push
    trigger uses; without it this is the poll query, unchanged.
    """
    url = f"{SUPABASE_URL}/rest/v1/model_run_stages?status=eq.queued&{_AEQ_STAGE_FILTER}"
    if run_id:
        url += f"&run_id=eq.{urllib.parse.quote(run_id, safe='')}"
    url += (
        "&select=id,run_id,stage_name,status,sort_order,created_at"
        f"&order=created_at.asc,sort_order.asc&limit={int(limit)}"
    )
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Stage read failed: {res.status_code} {res.text[:200]}")
    return res.json()


def process_first_actionable_stage(stages: list[dict]) -> str:
    """Act on the first stage in `stages` that can be acted on, and say what happened.

    THE SINGLE EXECUTION PATH. Polling and push differ only in how a list of
    candidate stages is obtained; from here on there is one function, one claim,
    one stage runner — so a run started by a push cannot behave differently from
    one started by a poll, and a change to either lane changes both.

      "processed" — a stage was claimed and driven to a terminal state here
      "skipped"   — a stage was marked skipped because a prior stage is terminal
      "lost"      — a stage was ready, but another process claimed it first
      "idle"      — nothing here is actionable yet (a prior stage is still running)
    """
    for stage in stages:
        readiness, reason = classify_stage_readiness(stage)
        if readiness == "ready":
            return "processed" if process_stage(stage) else "lost"
        if readiness == "blocked_terminal":
            print(f"[{time.strftime('%X')}] ⏭️ Skipping {stage['stage_name']} (run={stage['run_id'][:8]}…): {reason}")
            mark_stage_skipped(stage, reason or "Skipped due to failed prior stage")
            return "skipped"
    return "idle"


def poll_for_jobs():
    print(f"AequilibraE Worker started at {time.strftime('%c')}")
    print(f"Polling {SUPABASE_URL} for queued stages (owned: {', '.join(AEQ_STAGE_NAMES)})...")

    while True:
        try:
            stages = fetch_queued_stages()
            if not stages:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            # Anything but "idle" means work moved; go straight back for more.
            if process_first_actionable_stage(stages) == "idle":
                time.sleep(POLL_INTERVAL_SECONDS)

        except Exception as e:
            print(f"Poll loop error: {e}")
            time.sleep(POLL_INTERVAL_SECONDS)


# ─── Push trigger ───────────────────────────────────────────────────────
#
# WHY THIS EXISTS ALONGSIDE THE POLL LOOP
#   Polling requires a process that is always on. That is a fine way to run a
#   worker and it is not going away — but it is the ONLY way this worker could be
#   run, which quietly meant that "give your deployment modeling compute" always
#   meant "keep a machine running". An operator who would rather run a stateless
#   pool (a container woken by a request, which executes and then goes away) had
#   no way to be told there is work. This is that way.
#
# WHAT A PUSH IS AND IS NOT
#   It is a doorbell carrying a run id. It confers no ownership, sets no lock and
#   writes no "assigned" flag, and the app deliberately does not mark a pushed run
#   as spoken for. Both entrypoints converge on process_first_actionable_stage,
#   so every stage — pushed or polled — is taken with the same conditional
#   queued -> running PATCH, and whoever loses that race stops. That is why a
#   deployment can run BOTH a poller and a push pool with no coordination between
#   them, and why a pushed worker that dies before claiming anything leaves a run
#   a poller can still rescue.
#
# WHAT IT STILL CANNOT DO
#   It cannot create compute. A deployment that runs neither a poller nor a pool
#   has nothing to push to, and the app says exactly that at launch instead of
#   reporting a queued run that nothing will ever look at.

MODEL_RUN_DISPATCH_PATH = "/api/v1/model-runs"
MODEL_RUN_DISPATCH_CONTRACT = "openplan-modeling-dispatch.v1"
TRIGGER_HEALTH_PATH = "/healthz"

# Shared secret, identical in name and shape to the app's dispatcher and to the
# aerial worker contract. There is no unauthenticated mode: this endpoint starts
# minutes of compute on request, so an open one is an abuse surface rather than a
# convenience, and serve_push_trigger refuses to start without it.
TRIGGER_TOKEN = (os.getenv("OPENPLAN_MODELING_WORKER_TOKEN") or "").strip()

# PORT first: the platforms a stateless pool actually runs on (Fly, Railway,
# Cloud Run, Render) assign it and expect the process to obey.
TRIGGER_PORT = int(os.getenv("PORT") or os.getenv("AEQ_HTTP_PORT") or "8080")
TRIGGER_HOST = os.getenv("AEQ_HTTP_HOST", "0.0.0.0")

# ONE run at a time, per process. This is not a default an operator may raise —
# see resolve_max_concurrent_runs — and horizontal scale is the pool's job.
MAX_CONCURRENT_RUNS = 1

MAX_CONCURRENT_RUNS_ENV = "AEQ_MAX_CONCURRENT_RUNS"


def resolve_max_concurrent_runs(env=None) -> int:
    """Always 1, and REFUSES any other value instead of honouring it.

    A knob is offered here because one was offered here: an operator who read
    "up to N runs at a time" and set 2 would have got two threads executing
    stage_assignment inside one process, and the result would not have been
    slower or flakier — it would have been WRONG, quietly, on the surface that
    decides what a run may claim. Two reasons, and the second is the one that
    settles it:

      * `aequilibrae` (1.6.x) keeps the open project in a PROCESS-GLOBAL —
        `aequilibrae.context._current_project`, set by `Project.open()` — and
        `traffic_assignment`, `network_skimming`, `graph` and
        `database_connection` all read it. A second run opening its project
        redirects the first run's assignment at the second run's database. No
        amount of care in this file fixes that; it is the library's design.
      * This worker's own per-run state (the count set a run validates and
        calibrates against) is now threaded through explicitly rather than kept
        in a module global, which was the other half of the same hazard.

    So the honest answer is that this process runs one run at a time, and the way
    to run more at once is to run more processes — which is exactly what a pool
    is for, and what the push trigger exists to serve. Refusing loudly at startup
    is the point: silently clamping to 1 would leave an operator believing they
    had bought concurrency they did not get, and honouring the value would
    corrupt calibration for a study area nobody asked about.
    """
    raw = ((env if env is not None else os.environ).get(MAX_CONCURRENT_RUNS_ENV) or "").strip()
    if not raw:
        return MAX_CONCURRENT_RUNS
    try:
        requested = int(raw)
    except ValueError:
        raise SystemExit(
            f'{MAX_CONCURRENT_RUNS_ENV}="{raw}" is not a whole number. This worker executes '
            "one model run per process; unset the variable, or set it to 1."
        )
    if requested == MAX_CONCURRENT_RUNS:
        return MAX_CONCURRENT_RUNS
    raise SystemExit(
        f"{MAX_CONCURRENT_RUNS_ENV}={requested} is refused: this worker cannot execute more than one "
        "model run per process. AequilibraE keeps the open project in a process-wide global, so two "
        "runs in one process would assign each other's networks and validate against each other's "
        "traffic counts — a wrong number on the surface that decides what a run may claim, with "
        "nothing on screen to show it happened. Run more instances (or more machines in your pool) "
        "instead; each one takes stages with the same atomic claim, so they cannot collide."
    )


# How many accepted-but-not-yet-started runs this process will hold. Past this
# the trigger REFUSES (503) rather than accepting, because an acceptance it
# cannot honour is worse than a refusal it can explain: the run stays queued
# either way, but only the refusal reaches the planner. Operator-tunable for a
# pool with more headroom than one machine; never a tier.
MAX_QUEUED_RUNS = max(1, int((os.getenv("AEQ_MAX_QUEUED_RUNS") or "8").strip() or "8"))

# How long a shutdown waits for accepted runs to finish before giving up and
# saying which ones it dropped. Bounded by whatever the platform allows between
# SIGTERM and SIGKILL (Fly's `kill_timeout`, Kubernetes'
# terminationGracePeriodSeconds) — set that at least as high as this, or the
# platform stops the process mid-run whatever this says.
SHUTDOWN_GRACE_SECONDS = max(0, int((os.getenv("AEQ_SHUTDOWN_GRACE_SECONDS") or "300").strip() or "300"))

# Enough for a pointer payload; anything larger is not one.
MAX_TRIGGER_BODY_BYTES = 64 * 1024

# A pushed run drains stage by stage, so one trigger carries a whole run. Bounded
# so a pathological state (a stage that re-queues itself) cannot spin forever.
MAX_STAGES_PER_TRIGGER = 12


def execute_run_from_trigger(run_id: str) -> str:
    """Drive ONE pushed run as far as this process can take it.

    A trigger has to be able to finish a run on its own, or a push-only pool
    would need the app to ring once per stage — which it has no way to know to
    do. So this drains: claim the ready stage, run it, look again. It stops the
    moment there is nothing left for THIS process to do, which is also what keeps
    it correct when something else is working the same run:

      lost  — another process claimed the stage, and it will carry the run on.
      idle  — a prior stage is running elsewhere; whoever finishes it continues.

    Both are "not ours any more", not "wait and retry", because retrying would
    mean two processes spinning on one run.
    """
    outcome = "idle"
    for _ in range(MAX_STAGES_PER_TRIGGER):
        stages = fetch_queued_stages(run_id=run_id, limit=MAX_STAGES_PER_TRIGGER)
        if not stages:
            return outcome
        result = process_first_actionable_stage(stages)
        if result in ("processed", "skipped"):
            outcome = result
            continue
        return result
    print(f"[{time.strftime('%X')}] Trigger for run {run_id[:8]}… hit the per-trigger stage bound.")
    return outcome


class RunTriggerExecutor:
    """Accepts run ids and executes them on a bounded pool of worker threads.

    Accepting and executing are separated on purpose: a screening run takes
    minutes, and holding an HTTP connection open for it would make every timeout
    in the path — the app's, a proxy's, a platform's — into a false "the worker
    did not take it". The app's contract matches: 202 means accepted, and the
    real progress is read from the stage rows.

    THE COST OF THAT SEPARATION, AND WHAT BOUNDS IT
      Because the answer goes out before the work starts, an acceptance is a
      promise made by a process that might not be here in a minute — and on the
      very platform this lane is for (a container that wakes on a request and is
      reclaimed when it looks idle) that is not a remote possibility. Two things
      keep the promise honest:

        * The queue is BOUNDED. Past the bound the trigger refuses instead of
          accepting, so "accepted" always means "there is a slot for this",
          never "it is on a pile nobody may get to". The app turns the refusal
          into a planner-visible answer with the reason in it.
        * `wait_for_drain` lets shutdown finish what was accepted. The process
          stops taking pushes, drains, and then names anything it could not
          finish, so a lost run is a logged event with a run id rather than a
          silence. A run that was never claimed is still `queued` in the
          database — a poller can take it, and the staleness sweep fails it —
          so the worst case is a delay that something else can see, not a run
          that disappeared.
    """

    def __init__(self, execute=execute_run_from_trigger, workers: int = MAX_CONCURRENT_RUNS,
                 max_queued: int | None = None):
        self._execute = execute
        self._queue: "queue.Queue[str]" = queue.Queue(
            maxsize=MAX_QUEUED_RUNS if max_queued is None else max(1, max_queued)
        )
        self._inflight: set[str] = set()
        self._lock = threading.Lock()
        self._idle = threading.Event()
        self._idle.set()
        self._threads = [
            threading.Thread(target=self._drain, name=f"aeq-run-{index}", daemon=True)
            for index in range(max(1, workers))
        ]
        for thread in self._threads:
            thread.start()

    def submit(self, run_id: str) -> tuple[str, str]:
        """Queue a run. Returns (job reference, one of the states below).

          "queued"         — accepted, and there is room for it.
          "already_queued" — this process already has it. De-duplication here is
                             an efficiency, NOT the safety property (the stage
                             claim is that): two triggers for one run would
                             simply race for a stage and one would lose. The app
                             treats it as acceptance, because for the planner it
                             is — something has the run.
          "refused_full"   — the queue is at its bound. Refusing is the honest
                             answer: this process cannot say when it would reach
                             the run, and a 202 here would tell a planner a
                             worker had taken something it may never start.
        """
        job_reference = str(uuid.uuid4())
        with self._lock:
            if run_id in self._inflight:
                return job_reference, "already_queued"
            self._inflight.add(run_id)
            self._idle.clear()
        try:
            self._queue.put_nowait(run_id)
        except queue.Full:
            with self._lock:
                self._inflight.discard(run_id)
                if not self._inflight:
                    self._idle.set()
            return job_reference, "refused_full"
        return job_reference, "queued"

    def pending_run_ids(self) -> list[str]:
        """Runs this process has accepted and not finished. For the shutdown log."""
        with self._lock:
            return sorted(self._inflight)

    def wait_for_drain(self, timeout_seconds: float) -> list[str]:
        """Block until nothing is accepted-but-unfinished, or the grace expires.

        Returns the run ids still outstanding — empty when everything accepted
        was carried to a terminal answer.
        """
        self._idle.wait(timeout=max(0.0, timeout_seconds))
        return self.pending_run_ids()

    def _drain(self):
        while True:
            run_id = self._queue.get()
            try:
                result = self._execute(run_id)
                print(f"[{time.strftime('%X')}] Pushed run {run_id[:8]}… -> {result}")
            except Exception as e:
                # Never kill the drain thread: the pool would silently stop
                # accepting work while still answering 202, which is the exact
                # "looks fine, does nothing" failure this whole lane exists to
                # remove. The run id is printed IN FULL and the consequence is
                # spelled out, because this line is the only trace that a pushed
                # run stopped here — process_stage records its own failures, so
                # what lands here is a failure above it (a stage read, a network
                # blip) that left the run queued rather than failed.
                print(
                    f"[{time.strftime('%X')}] Pushed run {run_id} errored before reaching a stage "
                    f"outcome: {type(e).__name__}: {e}. Its stages are unchanged, so a polling "
                    "worker can still take it and OpenPlan's staleness sweep will fail it if "
                    "nothing does."
                )
            finally:
                with self._lock:
                    self._inflight.discard(run_id)
                    if not self._inflight:
                        self._idle.set()
                self._queue.task_done()


def _token_matches(header_value: str | None, expected: str) -> bool:
    """Constant-time bearer-token check. Empty expected never matches."""
    if not expected or not header_value:
        return False
    prefix = "bearer "
    if header_value[: len(prefix)].lower() != prefix:
        return False
    return hmac.compare_digest(header_value[len(prefix):].strip(), expected)


def build_trigger_server(token: str, submit, host: str = TRIGGER_HOST, port: int = TRIGGER_PORT):
    """An HTTP server that turns an authenticated POST into a queued run.

    `submit` is injected so the transport can be exercised without executing a
    model run, and so this stays a thin adapter: everything below the queue is
    the same code the poll loop runs.
    """

    class TriggerHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "OpenPlanAequilibraeWorker/1"

        def _respond(self, status: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            # A refusal ends the connection. A rejected caller's request body is
            # deliberately never read, and unread bytes left on a keep-alive
            # connection make the NEXT request on it parse as garbage — behind a
            # proxy that reuses connections, one 401 would produce a trail of
            # spurious 400s that look like the app sending malformed pushes.
            if status >= 400:
                self.close_connection = True
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            if status >= 400:
                self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
            if self.path.split("?")[0] != TRIGGER_HEALTH_PATH:
                self._respond(404, {"error": "not_found"})
                return
            # Says the PROCESS is up and nothing more. It is deliberately not a
            # statement that a run would succeed — this worker cannot know that
            # until it tries — so nothing here may be read as a worker heartbeat
            # for a run.
            self._respond(200, {
                "status": "ok",
                "contract": MODEL_RUN_DISPATCH_CONTRACT,
                "stages": list(AEQ_STAGE_NAMES),
            })

        def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
            if self.path.split("?")[0] != MODEL_RUN_DISPATCH_PATH:
                self._respond(404, {"error": "not_found"})
                return

            if not _token_matches(self.headers.get("Authorization"), token):
                self._respond(401, {"error": "unauthorized"})
                return

            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_TRIGGER_BODY_BYTES:
                self._respond(413, {"error": "payload_too_large"})
                return

            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, OSError):
                self._respond(400, {"error": "invalid_json"})
                return

            if not isinstance(payload, dict):
                self._respond(400, {"error": "invalid_payload"})
                return

            contract = payload.get("contract")
            if contract is not None and contract != MODEL_RUN_DISPATCH_CONTRACT:
                # Refuse a shape we do not understand by name, rather than
                # accepting it and silently doing nothing with the parts we
                # could not read.
                self._respond(400, {
                    "error": "unsupported_contract",
                    "expected": MODEL_RUN_DISPATCH_CONTRACT,
                })
                return

            run_id = payload.get("runId")
            if not isinstance(run_id, str) or not run_id.strip():
                self._respond(400, {"error": "missing_run_id"})
                return

            job_reference, state = submit(run_id.strip())
            if state == "refused_full":
                # 503, not 202. The run is untouched and still queued in the
                # database; what this refuses is the CLAIM that this process has
                # taken it. The app renders the reason, so the planner learns at
                # launch that the pool is saturated instead of watching a run sit
                # there — and a poller, if the deployment runs one, is unaffected.
                self._respond(503, {
                    "error": "pool_at_capacity",
                    "detail": (
                        f"This worker already has {MAX_QUEUED_RUNS} run(s) waiting and will not accept "
                        "another it cannot say when it would start. The run is still queued; another "
                        "worker can take it, or push again once this one is clear."
                    ),
                })
                return
            self._respond(202, {
                "status": "accepted",
                "runId": run_id.strip(),
                "jobReference": job_reference,
                # Honest, and not an error: the run was already in this process's
                # queue. The app treats acceptance the same either way, because
                # for the planner the answer is the same — something has it.
                "alreadyQueued": state == "already_queued",
                "acceptedAt": datetime.now(timezone.utc).isoformat(),
            })

        def log_message(self, fmt, *args):
            print(f"[{time.strftime('%X')}] trigger {fmt % args}")

    return ThreadingHTTPServer((host, port), TriggerHandler)


def serve_push_trigger(executor: "RunTriggerExecutor | None" = None):
    if not TRIGGER_TOKEN:
        raise SystemExit(
            "Refusing to start the push trigger with no shared secret: this endpoint "
            "starts model runs on request, so an unauthenticated one would let anyone "
            "spend this deployment's compute. Set OPENPLAN_MODELING_WORKER_TOKEN here "
            "to the same value the app has, or run in the default polling mode "
            "(AEQ_WORKER_MODE=poll), which needs no inbound port at all."
        )

    # Refuses a raised concurrency knob here, at startup, rather than at the first
    # push — an operator who set it learns immediately, and no run is executed
    # under a setting this worker cannot honour.
    workers = resolve_max_concurrent_runs()

    dispatcher = executor or RunTriggerExecutor(workers=workers)
    server = build_trigger_server(TRIGGER_TOKEN, dispatcher.submit, TRIGGER_HOST, TRIGGER_PORT)
    print(f"AequilibraE Worker push trigger listening on {TRIGGER_HOST}:{TRIGGER_PORT}{MODEL_RUN_DISPATCH_PATH}")
    print(f"Owned stages: {', '.join(AEQ_STAGE_NAMES)}; {workers} run at a time, "
          f"up to {MAX_QUEUED_RUNS} waiting.")
    print(f"On shutdown this process finishes what it accepted, waiting up to "
          f"{SHUTDOWN_GRACE_SECONDS}s — make sure your platform's kill timeout is at least that long, "
          "or it will stop the process mid-run.")

    _serve_until_drained(server, dispatcher)


def _serve_until_drained(server, dispatcher: "RunTriggerExecutor"):
    """Serve pushes, and on a shutdown signal finish what was already accepted.

    THE FAILURE THIS EXISTS FOR. The trigger answers 202 and executes afterwards,
    so on a platform that reclaims an instance the moment it looks idle — which
    is precisely the platform this lane is for, because the run happens AFTER the
    response the platform is watching — an accepted run could be terminated
    before it ever claimed a stage, in a deployment with no poller to rescue it.
    That is the one shape of failure this product must not have: not a run that
    fails, a run that quietly stops existing while the planner has been told a
    worker took it.

    So SIGTERM is treated as "stop accepting, then finish": the listener closes
    immediately (further pushes are refused at the socket, and the app reports
    that honestly), accepted runs drain, and anything still outstanding when the
    grace expires is NAMED. Nothing here can outrun a SIGKILL — a platform that
    gives no grace will still kill a run mid-stage — which is why the log says
    what state that leaves behind, and why the deployment docs make the kill
    timeout part of the recipe rather than an afterthought.
    """
    def _request_stop(signum, _frame):
        print(f"[{time.strftime('%X')}] Signal {signum}: no longer accepting pushes; "
              "finishing runs already accepted.")
        # shutdown() blocks until serve_forever returns, and the handler runs ON
        # the thread inside serve_forever — calling it here would deadlock.
        threading.Thread(target=server.shutdown, name="aeq-stop", daemon=True).start()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)
    except ValueError:
        # Only installable from the main thread. A worker started from a thread
        # (a test, an embedding process) simply gets no graceful drain rather
        # than failing to serve.
        print("Shutdown handling not installed (not the main thread); a stop signal will not drain.")

    try:
        server.serve_forever()
    finally:
        # Close the LISTENING socket before draining, not after. `shutdown()`
        # only stops the accept loop: the socket stays bound, so a push arriving
        # during the drain window would be accepted by the kernel into the
        # backlog and then sit there unanswered until the app's own timeout —
        # ten seconds of a planner waiting to be told nothing took their run.
        # Closed, the connection is refused at once and the app says so
        # immediately. Established connections are unaffected (a handler only
        # queues and returns), and server_close() is safe to call twice.
        server.server_close()
        unfinished = dispatcher.wait_for_drain(SHUTDOWN_GRACE_SECONDS)
        if unfinished:
            print(
                f"[{time.strftime('%X')}] Shutting down with {len(unfinished)} accepted run(s) "
                f"unfinished: {', '.join(unfinished)}. Their stages stay as this worker left them — "
                "an unclaimed run is still queued and any worker can take it; one stopped mid-stage "
                "reports no further progress and OpenPlan's staleness sweep will fail it. Neither is "
                "lost, and neither will finish here."
            )
        else:
            print(f"[{time.strftime('%X')}] Drained cleanly; nothing accepted was left unfinished.")
        server.server_close()


# How this process is started. `poll` is the default and is byte-for-byte the
# behaviour that shipped before the trigger existed, so an existing deployment
# that upgrades this file changes nothing about how it runs.
WORKER_MODES = ("poll", "push", "both")


def run_worker(mode: str | None = None):
    resolved = (mode or os.getenv("AEQ_WORKER_MODE") or "poll").strip().lower()
    if resolved not in WORKER_MODES:
        raise SystemExit(
            f'AEQ_WORKER_MODE="{resolved}" is not one of {", ".join(WORKER_MODES)}. '
            "Refusing to guess: starting the wrong one would either leave a queue "
            "unserved or open an unexpected port."
        )

    # Checked for EVERY mode, not just push: a poller is one run at a time too,
    # so an operator who set this variable expecting concurrency is wrong in the
    # same way, and silently ignoring it would leave them believing otherwise.
    resolve_max_concurrent_runs()

    if resolved == "poll":
        poll_for_jobs()
    elif resolved == "push":
        serve_push_trigger()
    else:
        # Both: a poller for anything queued while nothing was listening (or by a
        # deployment that pushes nowhere), and the trigger for immediate starts.
        #
        # These two threads share this process, so the atomic claim is only half
        # of what keeps them apart — it stops them taking the SAME stage, not
        # from running two different runs' stages side by side through
        # AequilibraE's process-global project. `_STAGE_EXECUTION_LOCK` is the
        # other half: the poll thread and the drain thread execute stages one at
        # a time, and whichever arrives second waits rather than interleaving.
        threading.Thread(target=poll_for_jobs, name="aeq-poll", daemon=True).start()
        serve_push_trigger()


if __name__ == "__main__":
    run_worker()
