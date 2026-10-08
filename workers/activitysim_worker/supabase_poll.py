#!/usr/bin/env python3
"""
ActivitySim behavioral-demand worker — Supabase poll/claim loop.

Polls `model_run_stages` for queued `behavioral_demand` preflight stages and runs
an HONEST ActivitySim preflight. This is NOT a behavioral forecast: on the default
(RAM-light, $0) infra it validates the run inputs and stages the ActivitySim
runtime, records an honest readiness/evidence packet, and states plainly what a
calibrated behavioral run requires (a screening skim bundle + a dedicated modeling
host with ActivitySim installed).

Stage pipeline (L1 preflight — two stages this worker owns):
  1. "ActivitySim Bundle Preflight"  — validate the run's study area is present +
                                        record the ActivitySim input-bundle contract
  2. "Runtime Staging & Readiness"   — report runtime capability (preflight_only on
                                        this infra) + write the evidence packet

This mirrors workers/aequilibrae_worker/main.py's REST poll/claim contract exactly:
there are NO Postgres RPCs; the atomic stage claim is a conditional PATCH
(`?id=eq.<id>&status=eq.queued` with Prefer: return=representation — a lost race
matches zero rows). Both workers poll the same table, so each scopes its poll query
by the stage names it owns.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import tempfile
import uuid
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from worker_heartbeat import WorkerHeartbeat

_WORKER_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _WORKER_DIR.parents[1]

# The AequilibraE image ships sibling Python files; both ActivitySim images ship
# the repository tree. Share this stdlib-only receipt check without copying it.
_SHARED_WORKER_DIR = str(_WORKER_DIR.parent / "aequilibrae_worker")
if _SHARED_WORKER_DIR not in sys.path:
    sys.path.append(_SHARED_WORKER_DIR)
from model_receipt_values import same_json_value

# Locally load .env (worker dir) then the app's .env.local; in a container these
# come from the environment. override=False so real env vars always win.
load_dotenv()
load_dotenv(_REPO_ROOT / "openplan" / ".env.local", override=False)

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError(
        "Missing Supabase credentials — set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) "
        "and SUPABASE_SERVICE_ROLE_KEY."
    )

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

POLL_INTERVAL_SECONDS = 5

# Stage this worker owns. The AequilibraE worker owns the three screening stages
# that precede it; scoping each worker's poll by name means neither claims a
# stage it cannot run. A behavioral_demand run is:
#   AequilibraE Setup -> Network Assignment -> Artifact Extraction   (aeq worker)
#   -> ActivitySim Bundle & Preflight                                (this worker)
# sequenced by the shared classify_stage_readiness gate.
STAGE_BUNDLE_PREFLIGHT = "ActivitySim Bundle & Preflight"
OWNED_STAGE_NAMES = (STAGE_BUNDLE_PREFLIGHT,)
_STAGE_FILTER = "stage_name=" + urllib.parse.quote(
    "in.(" + ",".join(f'"{name}"' for name in OWNED_STAGE_NAMES) + ")",
    safe="().,",
)

EVIDENCE_SCHEMA_VERSION = "openplan.behavioral_demand_preflight_evidence.v0"

# Runtime modes in which a REAL ActivitySim command actually executed. On the
# default ($0, RAM-light) infra none of these apply and the run stays a preflight.
EXECUTED_RUNTIME_MODES = {"activitysim_cli", "activitysim_container_cli"}

_WORKER_HEARTBEAT: WorkerHeartbeat | None = None


def _activitysim_exec_config() -> dict:
    """ActivitySim execution config from env. UNSET by default ($0 infra) → the
    runtime detects no CLI and stays preflight_only. A dedicated modeling host
    sets these (ActivitySim installed, or a container image) to run a real —
    still UNCALIBRATED, starter-grade — ActivitySim run. See DEPLOY.md."""
    return {
        "config_dir": os.getenv("ACTIVITYSIM_CONFIG_DIR") or None,
        "activitysim_cli": os.getenv("ACTIVITYSIM_CLI") or None,
        "activitysim_cli_template": os.getenv("ACTIVITYSIM_CLI_TEMPLATE") or None,
        "activitysim_container_image": os.getenv("ACTIVITYSIM_CONTAINER_IMAGE") or None,
        "container_engine_cli": os.getenv("ACTIVITYSIM_CONTAINER_ENGINE") or None,
        "activitysim_container_cli_template": os.getenv("ACTIVITYSIM_CONTAINER_CLI_TEMPLATE") or None,
        "container_network_mode": os.getenv("ACTIVITYSIM_CONTAINER_NETWORK_MODE", "none"),
    }


def _bundle_profile_for_execution(exec_cfg: dict[str, Any]) -> dict[str, str]:
    """Choose inputs from requested capability, never from a completed output.

    If an operator configures a real ActivitySim command, building a scaffold
    starter bundle first would make successful execution look more authoritative
    without making either the population or behavior real. The executable path
    therefore requires Census synthesis and the named stock MTC package. An
    unconfigured worker retains the cheap, explicitly non-behavioral preflight.
    """
    execution_requested = any(
        exec_cfg.get(key)
        for key in (
            "activitysim_cli",
            "activitysim_cli_template",
            "activitysim_container_image",
            "activitysim_container_cli_template",
        )
    )
    return (
        {"population_source": "census", "config_package": "mtc"}
        if execution_requested
        else {"population_source": "scaffold", "config_package": "starter"}
    )


def _build_executed_demand_package(
    pipeline: dict[str, Any], screening_dir: str, run_root: str
) -> dict[str, Any]:
    """Reduce a real ActivitySim trip list to the package used by assignment.

    This is deliberately a separate artifact boundary. ActivitySim emits person
    trips; AequilibraE assigns vehicles. The converter applies occupancy and
    removes non-auto trips arithmetically, and refuses an absent/empty trip list
    instead of letting an executed run finish without its comparison input.
    """
    ingestion_path = pipeline.get("ingestion_summary_path")
    if not ingestion_path or not os.path.exists(ingestion_path):
        raise RuntimeError("Executed ActivitySim run has no ingestion summary for demand packaging")
    with open(ingestion_path) as fh:
        ingestion = json.load(fh)
    trips = (ingestion.get("common_tables") or {}).get("trips") or {}
    runtime_dir = ((ingestion.get("runtime") or {}).get("runtime_dir") or "").strip()
    trips_relative_path = (trips.get("relative_path") or "").strip()
    trips_path = Path(runtime_dir) / trips_relative_path if runtime_dir and trips_relative_path else None
    if not trips_path or not trips_path.exists():
        raise RuntimeError("Executed ActivitySim run produced no readable final trip table")

    scripts_dir = str(_REPO_ROOT / "scripts" / "modeling")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from activitysim_demand_package import (
        build_activitysim_demand_package,
        read_zone_rows_from_csv,
    )

    zone_path = Path(screening_dir) / "package" / "zone_attributes.csv"
    output_dir = Path(run_root) / "activitysim_demand_package"
    return build_activitysim_demand_package(
        trips_csv=trips_path,
        zone_rows=read_zone_rows_from_csv(zone_path),
        output_dir=output_dir,
        source={
            "trips_csv": str(trips_path),
            "zone_attributes_csv": str(zone_path),
            "behavioral_pipeline_manifest": pipeline.get("manifest_path"),
        },
    )
# Per-run scratch dir for the built bundle + prototype pipeline outputs.
ACTIVITYSIM_WORK_DIR = os.getenv(
    "ACTIVITYSIM_WORK_DIR", str(_REPO_ROOT / "data" / "activitysim-bundles" / "runs")
)

# worker_residents (employed residents) and area_share are NOT in the AequilibraE
# worker's zone_attributes.csv but the bundle builder needs them. area_share is
# exact (area_sq_mi / total); worker_residents is a labeled SCAFFOLD estimate for
# the synthetic population only — never presented as observed or calibrated.
WORKER_RESIDENTS_PER_HOUSEHOLD_SCAFFOLD = 1.25

# The honest, non-forecast caveats surfaced on every preflight run.
PREFLIGHT_CAVEATS = [
    "This is an ActivitySim PREFLIGHT / uncalibrated bundle, not a behavioral forecast.",
    "The bundle's households/persons are a DETERMINISTIC SYNTHETIC SCAFFOLD (incl. a "
    "scaffold worker_residents estimate), not a calibrated population synthesis.",
    "On the default infra no ActivitySim run executes (preflight_only); it emits no "
    "VMT/trip/mode-share output.",
    "A calibrated behavioral run additionally requires a dedicated modeling host with "
    "ActivitySim installed + county-specific calibration (see DEPLOY.md).",
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Supabase REST helpers (mirror workers/aequilibrae_worker/main.py:304-437).
# ---------------------------------------------------------------------------
class WorkerStateWriteUnconfirmed(RuntimeError):
    """A state update has no matching receipt; it may already be committed."""


def _confirmed_state_patch(table: str, record_id: str, payload: dict, *, queued_claim: bool = False) -> bool:
    """Require a returned row without exposing provider response bodies.

    An absent acknowledgement is not proof of rollback. Callers must not turn
    this exception into a contradictory failed-stage update.
    """
    try:
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{record_id}" + ("&status=eq.queued" if queued_claim else ""),
            headers=HEADERS, json=payload, timeout=30,
        )
        if response.status_code != 200:
            raise WorkerStateWriteUnconfirmed(
                f"Worker state write unconfirmed for {table} (HTTP {response.status_code})"
            )
        rows = response.json()
        if queued_claim and rows == []:
            return False
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict) or rows[0].get("id") != record_id:
            raise WorkerStateWriteUnconfirmed(f"Worker state write unconfirmed for {table}: missing matching row")
        for field, expected in payload.items():
            actual = rows[0].get(field)
            if field.endswith("_at") and isinstance(expected, str) and isinstance(actual, str):
                matches = datetime.fromisoformat(expected.replace("Z", "+00:00")) == datetime.fromisoformat(actual.replace("Z", "+00:00"))
            else:
                matches = field in rows[0] and actual == expected
            if not matches:
                raise WorkerStateWriteUnconfirmed(f"Worker state write unconfirmed for {table}: returned values differ")
        return True
    except WorkerStateWriteUnconfirmed:
        raise
    except (requests.RequestException, ValueError, TypeError) as error:
        raise WorkerStateWriteUnconfirmed(f"Worker state write unconfirmed for {table}: no valid receipt") from error


def sb_patch_stage(stage_id: str, payload: dict):
    _confirmed_state_patch("model_run_stages", stage_id, payload)


def sb_claim_stage(stage_id: str, payload: dict) -> bool:
    """Atomically claim a queued stage.

    Transitions status queued -> running only if the row is still queued. Using
    a conditional PATCH (id=eq.X & status=eq.queued) with return=representation
    means a second worker that lost the race gets an empty result set and skips,
    so two replicas never double-process the same stage.
    """
    return _confirmed_state_patch("model_run_stages", stage_id, payload, queued_claim=True)


def sb_patch_run(run_id: str, payload: dict):
    _confirmed_state_patch("model_runs", run_id, payload)



def _confirmed_record_insert(table: str, payload: dict) -> None:
    """Confirm retained fields without retrying a possibly committed insert."""
    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS, json=payload, timeout=30,
        )
        if response.status_code != 201:
            raise WorkerStateWriteUnconfirmed(f"Worker insert unconfirmed for {table}: HTTP response failed")
        rows = response.json()
        if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
                or not isinstance(rows[0].get("id"), str) or not rows[0]["id"]):
            raise WorkerStateWriteUnconfirmed(f"Worker insert unconfirmed for {table}: missing retained record")
        if any(field not in rows[0] or not same_json_value(rows[0][field], value) for field, value in payload.items()):
            raise WorkerStateWriteUnconfirmed(f"Worker insert unconfirmed for {table}: returned values differ")
    except WorkerStateWriteUnconfirmed:
        raise
    except (requests.RequestException, ValueError, TypeError) as error:
        raise WorkerStateWriteUnconfirmed(f"Worker insert unconfirmed for {table}: no valid receipt") from error


def sb_post_kpi(payload: dict) -> None:
    _confirmed_record_insert("model_run_kpis", payload)


def sb_post_artifact(payload: dict) -> None:
    _confirmed_record_insert("model_run_artifacts", payload)


def sb_get_run(run_id: str) -> dict:
    url = (
        f"{SUPABASE_URL}/rest/v1/model_runs?id=eq.{run_id}"
        "&select=id,workspace_id,corridor_geojson,query_text,engine_key,run_title,input_snapshot_json"
    )
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Failed to load model run {run_id}: {res.status_code} {res.text[:200]}")
    rows = res.json()
    if not rows:
        raise RuntimeError(f"Model run {run_id} not found")
    return rows[0]


def sb_get_run_artifacts(run_id: str) -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/model_run_artifacts?run_id=eq.{run_id}"
        "&select=id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json,model_run_stages!inner(id,run_id,status,attempt_managed,active_attempt_id)"
    )
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Failed to load run artifacts {run_id}: {res.status_code} {res.text[:200]}")
    return res.json()


def sb_upload_evidence(
    run_id: str, filename: str, data: bytes, content_type: str, *, stage_id: str,
) -> str | None:
    """Return verified content-addressed evidence, or explicit unavailability."""
    digest = hashlib.sha256(data).hexdigest()
    object_path = f"model-runs/{run_id}/stages/{stage_id}/sha256-{digest}/{filename}"
    try:
        requests.post(
            f"{SUPABASE_URL}/storage/v1/object/run-artifacts/{object_path}",
            headers={
                "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": content_type, "x-upsert": "false",
            },
            data=data, timeout=60,
        )
    except requests.RequestException:
        pass
    try:
        retained = requests.get(
            f"{SUPABASE_URL}/storage/v1/object/authenticated/run-artifacts/{object_path}",
            headers=HEADERS, timeout=60,
        )
        if retained.status_code == 200 and retained.content == data:
            return f"storage://run-artifacts/{object_path}"
    except requests.RequestException:
        pass
    print("  Evidence Storage bytes could not be verified")
    return None


# ---------------------------------------------------------------------------
# Stage sequencing (mirror aequilibrae_worker/main.py:2626-2661).
# ---------------------------------------------------------------------------
def get_prior_stage_statuses(run_id: str, sort_order: int) -> list[dict]:
    if sort_order <= 1:
        return []
    url = (
        f"{SUPABASE_URL}/rest/v1/model_run_stages"
        f"?run_id=eq.{run_id}&sort_order=lt.{sort_order}"
        "&select=id,stage_name,sort_order,status,error_message&order=sort_order.asc"
    )
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Failed to load prior stage state: {res.status_code} {res.text[:200]}")
    return res.json()


def classify_stage_readiness(stage: dict) -> tuple[str, str | None]:
    prior = get_prior_stage_statuses(stage["run_id"], int(stage.get("sort_order") or 0))
    if not prior:
        return "ready", None
    terminal = [s for s in prior if s["status"] in {"failed", "cancelled", "skipped"}]
    if terminal:
        blocker = terminal[-1]
        return "blocked_terminal", f"Blocked by prior stage {blocker['stage_name']} ({blocker['status']})"
    if any(s["status"] != "succeeded" for s in prior):
        return "waiting", None
    return "ready", None


def mark_stage_skipped(stage: dict, reason: str) -> None:
    sb_patch_stage(
        stage["id"],
        {
            "status": "skipped",
            "error_message": reason[:2000],
            "completed_at": _utc_now(),
            "log_tail": reason,
        },
    )


class WorkerStateReadUnconfirmed(RuntimeError):
    """The worker cannot determine whether unfinished stages remain."""


def maybe_mark_run_succeeded(run_id: str) -> None:
    """Require a stage-list response before requesting run completion.

    The read and write are separate operations; this is not attempt fencing.
    """
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/model_run_stages?run_id=eq.{run_id}&status=neq.succeeded&select=id",
            headers=HEADERS, timeout=30,
        )
        if res.status_code != 200:
            raise WorkerStateReadUnconfirmed("Worker completion read unconfirmed: HTTP response failed")
        unfinished = res.json()
        if not isinstance(unfinished, list):
            raise WorkerStateReadUnconfirmed("Worker completion read unconfirmed: expected a stage list")
    except (requests.RequestException, ValueError) as error:
        raise WorkerStateReadUnconfirmed("Worker completion read unconfirmed: no valid response") from error
    if not unfinished:
        sb_patch_run(run_id, {"status": "succeeded", "completed_at": _utc_now()})
        print(f"[{time.strftime('%X')}] behavioral preflight run {run_id[:8]} complete")


# ---------------------------------------------------------------------------
# Stage bodies — L1 honest preflight (no bundle build, no forecast).
# ---------------------------------------------------------------------------
def _require_study_area(run: dict) -> dict:
    """Honesty rule (matches the Wave 1 worker): a missing corridor is a hard
    error, never a silent pilot/Nevada fallback."""
    corridor = run.get("corridor_geojson")
    if not corridor:
        raise RuntimeError(
            "No corridor_geojson on the run — cannot preflight an ActivitySim study area "
            "without a drawn/selected area. (No pilot fallback.)"
        )
    return corridor


def _local_path(file_url: str | None) -> str | None:
    """Resolve a `local://<abs_path>` artifact ref to a filesystem path (same-host
    only). Non-local refs (storage://, http) return None."""
    if isinstance(file_url, str) and file_url.startswith("local://"):
        return file_url[len("local://"):]
    return None


def _retain_handoff_file(artifacts: list[dict], artifact_type: str, run_id: str, execution_dir: str) -> str:
    """Copy and verify registered bytes before the preflight pipeline sees them."""
    validate_run_identity(run_id)
    if not isinstance(artifacts, list) or any(not isinstance(row, dict) for row in artifacts):
        raise RuntimeError("Invalid screening handoff inventory")
    candidates = [row for row in artifacts if row.get("artifact_type") == artifact_type]
    if len(candidates) != 1:
        raise RuntimeError("Missing or ambiguous AequilibraE screening handoff: " + artifact_type)
    artifact = candidates[0]
    if artifact.get("run_id") != run_id:
        raise RuntimeError("Screening handoff run identity differs")
    validate_run_identity(artifact.get("id"))
    producer = artifact.get("model_run_stages")
    if not isinstance(producer, dict) or producer.get("id") != artifact.get("stage_id") or producer.get("run_id") != run_id or producer.get("status") != "succeeded":
        raise RuntimeError("Screening handoff requires a completed producing stage of this run")
    validate_run_identity(producer.get("id"))
    managed = producer.get("attempt_managed")
    if type(managed) is not bool:
        raise RuntimeError("Screening handoff producer ownership is unconfirmed")
    if managed:
        validate_run_identity(artifact.get("attempt_id"))
        if producer.get("active_attempt_id") != artifact["attempt_id"]:
            raise RuntimeError("Screening handoff belongs to an inactive attempt")
    elif artifact.get("attempt_id") is not None or producer.get("active_attempt_id") is not None:
        raise RuntimeError("Screening handoff legacy ownership is inconsistent")
    source = _local_path(artifact.get("file_url"))
    if not source or not os.path.isabs(source):
        raise RuntimeError("Screening handoff requires an absolute local:// reference")
    shared_root = Path(os.getenv("AEQ_WORK_DIR", os.path.join(tempfile.gettempdir(), "openplan-model-runs"))).resolve()
    run_root = shared_root / "runs" / run_id
    resolved = Path(source).resolve(strict=True)
    if not resolved.is_relative_to(run_root) or not resolved.is_file():
        raise RuntimeError("Screening handoff path is outside the complete run identity")
    expected_hash, expected_size = artifact.get("content_hash"), artifact.get("file_size_bytes")
    if not isinstance(expected_hash, str) or len(expected_hash) != 64 or any(c not in "0123456789abcdef" for c in expected_hash):
        raise RuntimeError("Screening handoff hash is unavailable")
    if type(expected_size) is not int or expected_size < 0:
        raise RuntimeError("Screening handoff byte size is unavailable")
    destination = Path(execution_dir) / (artifact_type + ".retained")
    digest = hashlib.sha256()
    size = 0
    with resolved.open("rb") as reader, destination.open("xb") as writer:
        while chunk := reader.read(1024 * 1024):
            size += len(chunk)
            if size > expected_size:
                raise RuntimeError("Screening handoff byte size differs")
            digest.update(chunk)
            writer.write(chunk)
    if size != expected_size or digest.hexdigest() != expected_hash:
        raise RuntimeError("Screening handoff bytes differ from the registered artifact")
    return str(destination)


def _adapt_zone_attributes(src_csv: str, dest_csv: str) -> int:
    """Copy the AequilibraE worker's zone_attributes.csv, adding the two columns
    the ActivitySim bundle builder needs but the screening package omits:
      - area_share:       exact = area_sq_mi / sum(area_sq_mi)
      - worker_residents: SCAFFOLD = households * 1.25 (avg workers/hh), labeled
                          in the bundle caveats — never presented as observed.
    Returns the zone (row) count."""
    import csv

    with open(src_csv, newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise RuntimeError("zone_attributes.csv has no rows")

    total_area = sum(float(r.get("area_sq_mi") or 0.0) for r in rows)
    fieldnames = list(rows[0].keys())
    for col in ("worker_residents", "area_share"):
        if col not in fieldnames:
            fieldnames.append(col)

    for r in rows:
        if "worker_residents" not in r or r.get("worker_residents") in (None, ""):
            households = float(r.get("households") or 0.0)
            r["worker_residents"] = int(round(households * WORKER_RESIDENTS_PER_HOUSEHOLD_SCAFFOLD))
        if "area_share" not in r or r.get("area_share") in (None, ""):
            area = float(r.get("area_sq_mi") or 0.0)
            r["area_share"] = f"{(area / total_area) if total_area > 0 else 0.0:.8f}"

    os.makedirs(os.path.dirname(dest_csv), exist_ok=True)
    with open(dest_csv, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def _materialize_screening_dir(
    run_id: str,
    skim_path: str,
    zone_attr_path: str,
    setup_summary_path: str,
    dest_root: str,
    *, source_artifacts: list[dict], consumer_stage_id: str,
) -> str:
    """Lay out the screening-run-dir the bundle builder expects:
    <dir>/bundle_manifest.json, <dir>/package/zone_attributes.csv,
    <dir>/run_output/travel_time_skims.omx."""
    import shutil

    screening_dir = os.path.join(dest_root, "screening")
    if os.path.exists(screening_dir):
        shutil.rmtree(screening_dir)
    os.makedirs(os.path.join(screening_dir, "run_output"), exist_ok=True)

    zones = _adapt_zone_attributes(zone_attr_path, os.path.join(screening_dir, "package", "zone_attributes.csv"))
    shutil.copy2(skim_path, os.path.join(screening_dir, "run_output", "travel_time_skims.omx"))
    os.makedirs(os.path.join(screening_dir, "work"), exist_ok=True)
    shutil.copy2(setup_summary_path, os.path.join(screening_dir, "work", "network_setup_summary.json"))

    # Preserve original registered inputs separately from adapted pipeline files.
    source_records = []
    for kind in ("skim_matrix", "zone_attributes", "network_setup_summary"):
        matches = [row for row in source_artifacts if row.get("artifact_type") == kind]
        if len(matches) != 1 or matches[0].get("run_id") != run_id:
            raise RuntimeError("Screening provenance requires one exact run artifact per input")
        row = matches[0]
        source_records.append({key: row.get(key) for key in ("id", "run_id", "stage_id", "attempt_id", "artifact_type", "content_hash", "file_size_bytes", "model_run_stages")})
    materialized = []
    for relative, transformation in (
        ("run_output/travel_time_skims.omx", "exact_copy"),
        ("package/zone_attributes.csv", "zone_attributes_adapter"),
        ("work/network_setup_summary.json", "exact_copy"),
    ):
        file_path = Path(screening_dir) / relative
        digest = hashlib.sha256()
        with file_path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        materialized.append({"path": relative, "sha256": digest.hexdigest(), "bytes": file_path.stat().st_size, "transformation": transformation})
    manifest = {
        "schema_version": "openplan.screening_handoff.v0",
        "run_name": f"behavioral-{run_id}",
        "screening_grade": True,
        "source": "aequilibrae_worker",
        "model_run_id": run_id,
        "consumer_stage_id": consumer_stage_id,
        "source_artifacts": source_records,
        "materialized_files": materialized,
        "zones": {"count": zones},
        "caveats": ["Screening-grade AequilibraE handoff; not calibrated."],
    }
    with open(os.path.join(screening_dir, "bundle_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    return screening_dir


def validate_run_identity(run_id: str) -> None:
    if not isinstance(run_id, str) or str(uuid.UUID(run_id)) != run_id:
        raise ValueError("Model run identity must be a canonical UUID")


def create_run_workspace(run_id: str) -> str:
    """Retain each execution separately without deleting predecessor files."""
    validate_run_identity(run_id)
    directory = os.path.join(ACTIVITYSIM_WORK_DIR, run_id)
    os.makedirs(directory, exist_ok=True)
    return tempfile.mkdtemp(prefix="execution-", dir=directory)


def run_bundle_and_preflight_stage(run_id: str, run: dict, stage_id: str) -> dict:
    """Build a REAL ActivitySim input bundle from the AequilibraE screening
    artifacts, then run the preflight pipeline (no execution on $0 infra) and
    write an honest, NON-forecast evidence packet + structural KPIs."""
    import sys

    corridor = _require_study_area(run)

    log = "ActivitySim bundle & preflight\n- Study area validated.\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # 1. Locate the screening handoff (skim + zone attributes) the AequilibraE
    #    worker registered as local:// artifacts (same-host consumers only).
    artifacts = sb_get_run_artifacts(run_id)
    run_root = create_run_workspace(run_id)
    skim_path = _retain_handoff_file(artifacts, "skim_matrix", run_id, run_root)
    zone_attr_path = _retain_handoff_file(artifacts, "zone_attributes", run_id, run_root)
    setup_summary_path = _retain_handoff_file(artifacts, "network_setup_summary", run_id, run_root)
    log += "- Screening handoff copied and verified against registered bytes.\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    screening_dir = _materialize_screening_dir(
        run_id, skim_path, zone_attr_path, setup_summary_path, run_root,
        source_artifacts=artifacts, consumer_stage_id=stage_id,
    )

    scripts_dir = str(_REPO_ROOT / "scripts" / "modeling")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from run_behavioral_demand_prototype import run_behavioral_demand_prototype

    # Execution config is UNSET on $0 infra → the runtime stays preflight_only.
    # On a dedicated modeling host (ActivitySim installed / a container image) the
    # same call runs a real, still-UNCALIBRATED ActivitySim run.
    exec_cfg = _activitysim_exec_config()
    bundle_profile = _bundle_profile_for_execution(exec_cfg)
    pipeline = run_behavioral_demand_prototype(
        screening_run_dir=screening_dir,
        output_root=os.path.join(run_root, "behavioral_demand_prototype"),
        force=True,
        **bundle_profile,
        **exec_cfg,
    )
    pipeline_status = pipeline.get("pipeline_status")
    runtime_mode = pipeline.get("runtime_mode") or "preflight_only"
    executed = runtime_mode in EXECUTED_RUNTIME_MODES
    demand_package = (
        _build_executed_demand_package(pipeline, screening_dir, run_root) if executed else None
    )
    log += f"- Bundle built + pipeline: {pipeline_status} (runtime mode: {runtime_mode}).\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # 3. Read the built-bundle structural totals (labeled scaffold, NOT a forecast).
    bundle_stats = {}
    accepted_components = []
    manifest_path = pipeline.get("manifest_path")
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path) as fh:
            pmanifest = json.load(fh)
        build_meta = (pmanifest.get("steps", {}).get("build_activitysim_input_bundle", {}) or {}).get("metadata", {})
        bundle_stats = {
            "zones": build_meta.get("land_use_rows"),
            "synthetic_households": build_meta.get("households"),
            "synthetic_persons": build_meta.get("persons"),
        }
        accepted_components = list(build_meta.get("accepted_components") or [])

    # 4. Assemble + upload the honest evidence packet. When a real (still
    #    UNCALIBRATED) ActivitySim run executed, say so; never call it a forecast.
    if executed:
        accepted_names = {
            str(component.get("component") or "") for component in accepted_components
        }
        lead_caveats = [
            "A real but UNCALIBRATED, screening-grade ActivitySim run executed — this is "
            "NOT a calibrated behavioral forecast.",
            "Households and persons come from real Census PUMS records fitted to each zone's "
            "published totals; the population is local but the behavior coefficients are not.",
        ]
        if "auto_ownership" in accepted_names:
            lead_caveats.append(
                "Auto ownership uses OpenPlan's nationally estimated component accepted by a "
                "locked fresh-holdout study. Destination choice, mode choice, scheduling, and "
                "the remaining behavior still use prototype_mtc coefficients estimated for the "
                "San Francisco Bay Area. Component acceptance is not corridor validation."
            )
        else:
            lead_caveats.append(
                "Behavior uses ActivitySim's stock prototype_mtc coefficients estimated for the "
                "San Francisco Bay Area, not this study area. County-specific validation is "
                "required before any forecast or regulatory use."
            )
    else:
        lead_caveats = list(PREFLIGHT_CAVEATS)
    evidence = {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "packet_type": "behavioral_demand_preflight_evidence",
        "generated_at_utc": _utc_now(),
        "run_id": run_id,
        "workspace_id": run.get("workspace_id"),
        "engine_key": run.get("engine_key"),
        "run_title": run.get("run_title"),
        "query_text": run.get("query_text"),
        "is_forecast": False,
        "claim_tier": "prototype",
        "calibration": "uncalibrated",
        "executed": executed,
        "preflight_status": "complete",
        "pipeline_status": pipeline_status,
        "runtime_mode": runtime_mode,
        "bundle": bundle_stats,
        "bundle_profile": bundle_profile,
        "accepted_behavior_components": accepted_components,
        "demand_package": {
            "status": "ready_for_same_network_assignment",
            "zones": demand_package["zones"],
            "conversion": demand_package["conversion"],
        } if demand_package else None,
        "study_area": {"corridor_geojson_present": bool(corridor)},
        "requirements_for_a_calibrated_run": [
            "A dedicated modeling host with ActivitySim installed (multi-GB RAM, always-on)."
            if not executed
            else "A dedicated modeling host is already providing execution.",
            "County-specific calibration before any forecast/regulatory use.",
        ],
        "caveats": lead_caveats + list(pipeline.get("caveats", [])),
    }
    data = (json.dumps(evidence, indent=2) + "\n").encode("utf-8")
    storage_ref = sb_upload_evidence(run_id, "behavioral_demand_evidence_packet.json", data, "application/json", stage_id=stage_id)
    if storage_ref:
        sb_post_artifact(
            {
                "run_id": run_id,
                "stage_id": stage_id,
                "artifact_type": "evidence_packet",
                "file_url": storage_ref,
                "file_size_bytes": len(data),
                "content_hash": hashlib.sha256(data).hexdigest(),
                "metadata_json": {"kind": "behavioral_demand_preflight_evidence", "is_forecast": False},
            }
        )

    if demand_package:
        artifact_specs = (
            ("activitysim_demand_package_manifest", demand_package["files"]["manifest"]),
            ("activitysim_demand_matrix", demand_package["files"]["od_trip_matrix"]),
            ("activitysim_demand_zones", demand_package["files"]["zone_attributes"]),
        )
        for artifact_type, artifact_path in artifact_specs:
            artifact_bytes = Path(artifact_path).read_bytes()
            sb_post_artifact(
                {
                    "run_id": run_id,
                    "stage_id": stage_id,
                    "artifact_type": artifact_type,
                    "file_url": f"local://{artifact_path}",
                    "file_size_bytes": len(artifact_bytes),
                    "content_hash": hashlib.sha256(artifact_bytes).hexdigest(),
                    "metadata_json": {
                        "kind": "activitysim_assignment_handoff",
                        "uncalibrated": True,
                    },
                }
            )

    # 5. Structural, non-forecast general KPIs (bundle scaffold sizes + runtime mode).
    scaffold_provenance = (
        "ActivitySim input-bundle scaffold — deterministic synthetic population, "
        "NOT a calibrated synthesis or a behavioral forecast."
        if not executed
        else "Census PUMS population fitted to published zone totals; accepted component "
        "provenance and remaining borrowed behavior are recorded in the evidence packet. This "
        "is NOT a local forecast."
    )
    kpis = [
        ("activitysim_runtime_mode", "ActivitySim runtime mode", None, "", {"mode": runtime_mode, "provenance": scaffold_provenance}),
    ]
    if bundle_stats.get("zones") is not None:
        kpis.append(("activitysim_bundle_zones", "ActivitySim bundle zones", float(bundle_stats["zones"]), "zones", {"provenance": scaffold_provenance}))
    if bundle_stats.get("synthetic_households") is not None:
        kpis.append((
            "activitysim_bundle_fitted_households" if executed else "activitysim_bundle_synthetic_households",
            "ActivitySim bundle Census-fitted households" if executed else "ActivitySim bundle synthetic households (scaffold)",
            float(bundle_stats["synthetic_households"]), "households", {"provenance": scaffold_provenance},
        ))
    if bundle_stats.get("synthetic_persons") is not None:
        kpis.append((
            "activitysim_bundle_fitted_persons" if executed else "activitysim_bundle_synthetic_persons",
            "ActivitySim bundle Census-fitted persons" if executed else "ActivitySim bundle synthetic persons (scaffold)",
            float(bundle_stats["synthetic_persons"]), "persons", {"provenance": scaffold_provenance},
        ))
    for name, label, value, unit, breakdown in kpis:
        sb_post_kpi(
            {
                "run_id": run_id,
                "kpi_category": "general",
                "kpi_name": name,
                "kpi_label": label,
                "value": value,
                "unit": unit,
                "breakdown_json": breakdown,
            }
        )

    # 6. ONLY when a real ActivitySim run executed AND produced supportable
    #    behavioral outputs, write those KPIs — always LABELED uncalibrated/starter,
    #    never a forecast. On $0 preflight infra this block is skipped entirely, so
    #    no demand-shaped number is ever emitted without a real run behind it.
    real_kpis = (
        _write_executed_behavioral_kpis(run_id, pipeline, accepted_components)
        if executed else 0
    )

    log += (
        f"- Evidence packet: {'uploaded' if storage_ref else 'upload failed (best-effort)'}; "
        f"{len(kpis)} scaffold KPIs"
        + (f" + {real_kpis} uncalibrated behavioral KPIs" if real_kpis else "")
        + (" + assignment demand package" if demand_package else "")
        + " written.\n"
    )
    sb_patch_stage(stage_id, {"log_tail": log})
    return {"log": log}


def _write_executed_behavioral_kpis(
    run_id: str, pipeline: dict, accepted_components: list[dict[str, Any]] | None = None
) -> int:
    """Write behavioral KPIs from a REAL (uncalibrated, starter) ActivitySim run,
    reading the extractor's honest summary. Emits nothing if the run produced
    insufficient behavioral outputs (the common starter/zero-model case)."""
    summary_path = pipeline.get("kpi_summary_path")
    if not summary_path or not os.path.exists(summary_path):
        return 0
    try:
        with open(summary_path) as fh:
            kpi_summary = json.load(fh)
    except (OSError, ValueError):
        return 0
    if kpi_summary.get("availability_status") == "not_enough_behavioral_outputs":
        return 0

    accepted_names = sorted(
        str(component.get("component") or "")
        for component in (accepted_components or [])
        if component.get("component")
    )
    component_note = (
        f" Accepted components: {', '.join(accepted_names)}."
        if accepted_names else " No accepted behavior component is recorded."
    )
    provenance = (
        "Real but UNCALIBRATED, screening-grade ActivitySim run. NOT a calibrated behavioral "
        "forecast. Component acceptance does not establish corridor accuracy."
        + component_note
    )
    totals = kpi_summary.get("totals") or {}
    written = 0
    for key, unit in (("households", "households"), ("persons", "persons"), ("tours", "tours"), ("trips", "trips")):
        value = totals.get(key)
        if value is None:
            continue
        sb_post_kpi(
            {
                "run_id": run_id,
                "kpi_category": "general",
                "kpi_name": f"activitysim_{key}",
                "kpi_label": f"ActivitySim {key} (uncalibrated)",
                "value": float(value),
                "unit": unit,
                "breakdown_json": {"provenance": provenance, "calibration": "uncalibrated"},
            }
        )
        written += 1
    return written


STAGE_DISPATCH = {
    STAGE_BUNDLE_PREFLIGHT: run_bundle_and_preflight_stage,
}


def process_stage(stage: dict) -> None:
    stage_id = stage["id"]
    run_id = stage["run_id"]
    stage_name = stage["stage_name"]

    validate_run_identity(run_id)
    claimed = sb_claim_stage(
        stage_id,
        {"status": "running", "started_at": _utc_now(), "log_tail": f"Starting {stage_name}..."},
    )
    if not claimed:
        print(f"[{time.strftime('%X')}] ⏭️ Lost claim race for {stage_name} (run={run_id[:8]}…)")
        return
    sb_patch_run(run_id, {"status": "running"})

    if _WORKER_HEARTBEAT is not None:
        _WORKER_HEARTBEAT.set_current_work(
            {"runId": run_id, "stageId": stage_id, "stageName": stage_name}
        )

    try:
        run = sb_get_run(run_id)
        handler = STAGE_DISPATCH.get(stage_name)
        if handler is None:
            raise RuntimeError(f"No handler for stage '{stage_name}'")
        result = handler(run_id, run, stage_id)
        sb_patch_stage(
            stage_id,
            {"status": "succeeded", "completed_at": _utc_now(), "log_tail": result["log"]},
        )
        maybe_mark_run_succeeded(run_id)
    except (WorkerStateWriteUnconfirmed, WorkerStateReadUnconfirmed):
        # A completion may already be committed. Preserve state for reconciliation.
        raise
    except Exception as exc:  # noqa: BLE001 — record any failure honestly on the stage
        error_msg = f"{type(exc).__name__}: {exc}"
        print(f"[{time.strftime('%X')}] ❌ {stage_name} failed (run={run_id[:8]}…): {error_msg}")
        sb_patch_stage(
            stage_id,
            {"status": "failed", "error_message": error_msg[:2000], "completed_at": _utc_now()},
        )
        sb_patch_run(run_id, {"status": "failed"})
    finally:
        if _WORKER_HEARTBEAT is not None:
            _WORKER_HEARTBEAT.set_current_work(None)


def poll_for_jobs() -> None:
    global _WORKER_HEARTBEAT
    exec_cfg = _activitysim_exec_config()
    runtime_mode = "activitysim_container_cli" if (
        exec_cfg.get("activitysim_container_image") or exec_cfg.get("activitysim_container_cli_template")
    ) else "activitysim_cli" if (
        exec_cfg.get("activitysim_cli") or exec_cfg.get("activitysim_cli_template")
    ) else "preflight_only"
    _WORKER_HEARTBEAT = WorkerHeartbeat(
        supabase_url=SUPABASE_URL,
        service_key=SUPABASE_KEY,
        worker_kind="activitysim",
        supported_stages=OWNED_STAGE_NAMES,
        runtime_mode=runtime_mode,
    )
    _WORKER_HEARTBEAT.start()
    print(f"ActivitySim behavioral-preflight worker started at {time.strftime('%c')}")
    print(f"Polling {SUPABASE_URL} for queued stages (owned: {', '.join(OWNED_STAGE_NAMES)})...")

    while True:
        try:
            url = (
                f"{SUPABASE_URL}/rest/v1/model_run_stages"
                f"?status=eq.queued&{_STAGE_FILTER}"
                "&select=id,run_id,stage_name,status,sort_order,created_at"
                "&order=created_at.asc,sort_order.asc&limit=25"
            )
            res = requests.get(url, headers=HEADERS, timeout=30)
            if res.status_code != 200:
                print(f"Poll error: {res.text[:200]}")
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            stages = res.json()
            if not stages:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            processed = False
            for stage in stages:
                readiness, reason = classify_stage_readiness(stage)
                if readiness == "ready":
                    process_stage(stage)
                    processed = True
                    break
                if readiness == "blocked_terminal":
                    print(f"[{time.strftime('%X')}] ⏭️ Skipping {stage['stage_name']}: {reason}")
                    mark_stage_skipped(stage, reason or "Skipped due to failed prior stage")
                    processed = True
                    break

            if not processed:
                time.sleep(POLL_INTERVAL_SECONDS)

        except Exception as exc:  # noqa: BLE001 — keep the poll loop alive
            print(f"Poll loop error: {exc}")
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    poll_for_jobs()
