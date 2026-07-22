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
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

_WORKER_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _WORKER_DIR.parents[1]

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
def sb_patch_stage(stage_id: str, payload: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/model_run_stages?id=eq.{stage_id}"
    requests.patch(url, headers=HEADERS, json=payload, timeout=30)


def sb_claim_stage(stage_id: str, payload: dict) -> bool:
    """Atomically claim a queued stage: transition queued -> running only if the row
    is still queued. The conditional filter + return=representation means a worker
    that lost the race gets an empty result and skips, so no double-processing."""
    url = f"{SUPABASE_URL}/rest/v1/model_run_stages?id=eq.{stage_id}&status=eq.queued"
    res = requests.patch(url, headers=HEADERS, json=payload, timeout=30)
    if res.status_code not in (200, 201, 204):
        print(f"  Claim PATCH returned {res.status_code}: {res.text[:200]}")
        return False
    try:
        rows = res.json()
    except ValueError:
        rows = []
    return bool(rows)


def sb_patch_run(run_id: str, payload: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/model_runs?id=eq.{run_id}"
    requests.patch(url, headers=HEADERS, json=payload, timeout=30)


def sb_post_kpi(payload: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/model_run_kpis"
    requests.post(url, headers=HEADERS, json=payload, timeout=30)


def sb_post_artifact(payload: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/model_run_artifacts"
    requests.post(url, headers=HEADERS, json=payload, timeout=30)


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
        "&select=artifact_type,file_url,metadata_json"
    )
    res = requests.get(url, headers=HEADERS, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Failed to load run artifacts {run_id}: {res.status_code} {res.text[:200]}")
    return res.json()


def sb_upload_evidence(run_id: str, filename: str, data: bytes, content_type: str) -> str | None:
    """Upload to the private run-artifacts bucket. Returns the storage:// ref the app
    resolves via a service-role signed URL, or None on failure (best-effort)."""
    object_path = f"model-runs/{run_id}/{filename}"
    url = f"{SUPABASE_URL}/storage/v1/object/run-artifacts/{object_path}"
    res = requests.post(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=data,
        timeout=60,
    )
    if res.status_code in (200, 201):
        return f"storage://run-artifacts/{object_path}"
    print(f"  Evidence upload returned {res.status_code}: {res.text[:200]}")
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


def maybe_mark_run_succeeded(run_id: str) -> None:
    """Mark the run succeeded once no non-succeeded stage remains. Idempotent and
    safe when a run's stages are split across this worker and the AequilibraE
    worker (whichever finishes the final stage flips the run)."""
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/model_run_stages?run_id=eq.{run_id}&status=neq.succeeded&select=id",
        headers=HEADERS,
        timeout=30,
    )
    if res.status_code == 200 and not res.json():
        print(f"[{time.strftime('%X')}] behavioral preflight run {run_id[:8]}… complete")
        sb_patch_run(run_id, {"status": "succeeded", "completed_at": _utc_now()})


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


def _find_artifact_path(artifacts: list[dict], artifact_type: str) -> str | None:
    for art in artifacts:
        if art.get("artifact_type") == artifact_type:
            path = _local_path(art.get("file_url"))
            if path and os.path.exists(path):
                return path
    return None


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


def _materialize_screening_dir(run_id: str, skim_path: str, zone_attr_path: str, dest_root: str) -> str:
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

    # Minimal source manifest — the builder requires the file but tolerates missing
    # fields (they only feed a provenance excerpt).
    manifest = {
        "schema_version": "openplan.screening_handoff.v0",
        "run_name": f"behavioral-{run_id[:12]}",
        "screening_grade": True,
        "source": "aequilibrae_worker",
        "zones": {"count": zones},
        "caveats": ["Screening-grade AequilibraE handoff; not calibrated."],
    }
    with open(os.path.join(screening_dir, "bundle_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    return screening_dir


def run_bundle_and_preflight_stage(run_id: str, run: dict, stage_id: str) -> dict:
    """Build a REAL ActivitySim input bundle from the AequilibraE screening
    artifacts, then run the preflight pipeline (no execution on $0 infra) and
    write an honest, NON-forecast evidence packet + structural KPIs."""
    import shutil
    import sys

    corridor = _require_study_area(run)

    log = "ActivitySim bundle & preflight\n- Study area validated.\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # 1. Locate the screening handoff (skim + zone attributes) the AequilibraE
    #    worker registered as local:// artifacts (same-host consumers only).
    artifacts = sb_get_run_artifacts(run_id)
    skim_path = _find_artifact_path(artifacts, "skim_matrix")
    zone_attr_path = _find_artifact_path(artifacts, "zone_attributes")
    if not skim_path or not zone_attr_path:
        raise RuntimeError(
            "Missing AequilibraE screening handoff (skim_matrix / zone_attributes local:// "
            "artifacts). The behavioral lane needs the ActivitySim worker co-located with "
            "the AequilibraE worker (shared filesystem)."
        )
    log += f"- Screening handoff located (skim + zone attributes).\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # 2. Materialize the screening-run-dir + build the bundle + run the preflight
    #    pipeline. All stdlib; no ActivitySim needed for the preflight path.
    run_root = os.path.join(ACTIVITYSIM_WORK_DIR, run_id[:12])
    if os.path.exists(run_root):
        shutil.rmtree(run_root)
    os.makedirs(run_root, exist_ok=True)
    screening_dir = _materialize_screening_dir(run_id, skim_path, zone_attr_path, run_root)

    scripts_dir = str(_REPO_ROOT / "scripts" / "modeling")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from run_behavioral_demand_prototype import run_behavioral_demand_prototype

    # Execution config is UNSET on $0 infra → the runtime stays preflight_only.
    # On a dedicated modeling host (ActivitySim installed / a container image) the
    # same call runs a real, still-UNCALIBRATED ActivitySim run.
    exec_cfg = _activitysim_exec_config()
    pipeline = run_behavioral_demand_prototype(
        screening_run_dir=screening_dir,
        output_root=os.path.join(run_root, "behavioral_demand_prototype"),
        force=True,
        **exec_cfg,
    )
    pipeline_status = pipeline.get("pipeline_status")
    runtime_mode = pipeline.get("runtime_mode") or "preflight_only"
    executed = runtime_mode in EXECUTED_RUNTIME_MODES
    log += f"- Bundle built + pipeline: {pipeline_status} (runtime mode: {runtime_mode}).\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # 3. Read the built-bundle structural totals (labeled scaffold, NOT a forecast).
    bundle_stats = {}
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

    # 4. Assemble + upload the honest evidence packet. When a real (still
    #    UNCALIBRATED) ActivitySim run executed, say so; never call it a forecast.
    if executed:
        lead_caveats = [
            "A real but UNCALIBRATED, starter-grade ActivitySim run executed — this is "
            "NOT a calibrated behavioral forecast.",
            "The synthetic population is a deterministic scaffold (incl. a scaffold "
            "worker_residents estimate), not a calibrated synthesis.",
            "County-specific calibration is required before any forecast/regulatory use.",
        ]
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
    storage_ref = sb_upload_evidence(run_id, "behavioral_demand_evidence_packet.json", data, "application/json")
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

    # 5. Structural, non-forecast general KPIs (bundle scaffold sizes + runtime mode).
    scaffold_provenance = (
        "ActivitySim input-bundle scaffold — deterministic synthetic population, "
        "NOT a calibrated synthesis or a behavioral forecast."
    )
    kpis = [
        ("activitysim_runtime_mode", "ActivitySim runtime mode", None, "", {"mode": runtime_mode, "provenance": scaffold_provenance}),
    ]
    if bundle_stats.get("zones") is not None:
        kpis.append(("activitysim_bundle_zones", "ActivitySim bundle zones", float(bundle_stats["zones"]), "zones", {"provenance": scaffold_provenance}))
    if bundle_stats.get("synthetic_households") is not None:
        kpis.append(("activitysim_bundle_synthetic_households", "ActivitySim bundle synthetic households (scaffold)", float(bundle_stats["synthetic_households"]), "households", {"provenance": scaffold_provenance}))
    if bundle_stats.get("synthetic_persons") is not None:
        kpis.append(("activitysim_bundle_synthetic_persons", "ActivitySim bundle synthetic persons (scaffold)", float(bundle_stats["synthetic_persons"]), "persons", {"provenance": scaffold_provenance}))
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
    real_kpis = _write_executed_behavioral_kpis(run_id, pipeline) if executed else 0

    log += (
        f"- Evidence packet: {'uploaded' if storage_ref else 'upload failed (best-effort)'}; "
        f"{len(kpis)} scaffold KPIs"
        + (f" + {real_kpis} uncalibrated behavioral KPIs" if real_kpis else "")
        + " written.\n"
    )
    sb_patch_stage(stage_id, {"log_tail": log})
    return {"log": log}


def _write_executed_behavioral_kpis(run_id: str, pipeline: dict) -> int:
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

    provenance = (
        "Real but UNCALIBRATED, starter-grade ActivitySim run — NOT a calibrated "
        "behavioral forecast. County-specific calibration required before any use."
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

    claimed = sb_claim_stage(
        stage_id,
        {"status": "running", "started_at": _utc_now(), "log_tail": f"Starting {stage_name}..."},
    )
    if not claimed:
        print(f"[{time.strftime('%X')}] ⏭️ Lost claim race for {stage_name} (run={run_id[:8]}…)")
        return
    sb_patch_run(run_id, {"status": "running"})

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
    except Exception as exc:  # noqa: BLE001 — record any failure honestly on the stage
        error_msg = f"{type(exc).__name__}: {exc}"
        print(f"[{time.strftime('%X')}] ❌ {stage_name} failed (run={run_id[:8]}…): {error_msg}")
        sb_patch_stage(
            stage_id,
            {"status": "failed", "error_message": error_msg[:2000], "completed_at": _utc_now()},
        )
        sb_patch_run(run_id, {"status": "failed"})


def poll_for_jobs() -> None:
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
