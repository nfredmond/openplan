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

# Stage names this worker owns. The AequilibraE worker owns a disjoint set, so
# scoping the poll by name means neither worker claims a stage it cannot run.
STAGE_BUNDLE_PREFLIGHT = "ActivitySim Bundle Preflight"
STAGE_RUNTIME_STAGING = "Runtime Staging & Readiness"
OWNED_STAGE_NAMES = (STAGE_BUNDLE_PREFLIGHT, STAGE_RUNTIME_STAGING)
_STAGE_FILTER = "stage_name=" + urllib.parse.quote(
    "in.(" + ",".join(f'"{name}"' for name in OWNED_STAGE_NAMES) + ")",
    safe="().,",
)

EVIDENCE_SCHEMA_VERSION = "openplan.behavioral_demand_preflight_evidence.v0"

# The honest, non-forecast caveats surfaced on every preflight run.
PREFLIGHT_CAVEATS = [
    "This is an ActivitySim PREFLIGHT, not a behavioral forecast.",
    "The preflight validates run inputs and stages the ActivitySim runtime; it does "
    "not run a demand model and emits no VMT/trip/mode-share output.",
    "A calibrated behavioral run additionally requires a screening skim bundle and a "
    "dedicated modeling host with ActivitySim installed (see DEPLOY.md).",
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


def run_bundle_preflight_stage(run_id: str, run: dict, stage_id: str) -> dict:
    _require_study_area(run)
    log = (
        "ActivitySim bundle preflight\n"
        "- Study area: present (corridor_geojson validated)\n"
        "- Input-bundle contract: a real ActivitySim run consumes an input bundle of\n"
        "  land_use.csv + households.csv + persons.csv + skims/travel_time_skims.omx.\n"
        "- This preflight tier does NOT build that bundle; the bundle is produced by the\n"
        "  AequilibraE screening -> bundle pipeline (a fuller run).\n"
    )
    sb_patch_stage(stage_id, {"log_tail": log})
    return {"log": log}


def run_runtime_staging_stage(run_id: str, run: dict, stage_id: str) -> dict:
    corridor = _require_study_area(run)
    # On the default ($0, RAM-light) infra this lane is preflight-only: no
    # ActivitySim CLI + no built config package, so no execution is attempted.
    runtime_mode = "preflight_only"
    log = (
        "Runtime staging & readiness\n"
        f"- Runtime mode on this infra: {runtime_mode}\n"
        "- ActivitySim execution NOT attempted (no built bundle / config package / CLI here).\n"
        "- Writing honest preflight evidence packet.\n"
    )
    sb_patch_stage(stage_id, {"log_tail": log})

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
        "preflight_status": "complete",
        "runtime_mode": runtime_mode,
        "config_package_status": "not_built",
        "study_area": {"corridor_geojson_present": bool(corridor)},
        "requirements_for_a_real_run": [
            "A screening skim bundle (land_use + households + persons + OMX skims) built "
            "from an AequilibraE screening of this study area.",
            "A dedicated modeling host with ActivitySim installed (multi-GB RAM, always-on).",
            "County-specific calibration before any forecast/regulatory use.",
        ],
        "caveats": list(PREFLIGHT_CAVEATS),
    }
    data = (json.dumps(evidence, indent=2) + "\n").encode("utf-8")
    filename = "behavioral_demand_evidence_packet.json"
    storage_ref = sb_upload_evidence(run_id, filename, data, "application/json")

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

    # One honest, non-forecast general KPI: the runtime mode (a label, not a metric).
    # value is left null; the mode + provenance live in breakdown_json.
    sb_post_kpi(
        {
            "run_id": run_id,
            "kpi_category": "general",
            "kpi_name": "activitysim_runtime_mode",
            "kpi_label": "ActivitySim runtime mode",
            "value": None,
            "unit": "",
            "breakdown_json": {
                "mode": runtime_mode,
                "provenance": "Behavioral-demand preflight — inputs validated & runtime staged; "
                "NOT a behavioral forecast.",
            },
        }
    )

    log += f"- Evidence packet: {'uploaded' if storage_ref else 'upload failed (best-effort)'}\n"
    sb_patch_stage(stage_id, {"log_tail": log})
    return {"log": log}


STAGE_DISPATCH = {
    STAGE_BUNDLE_PREFLIGHT: run_bundle_preflight_stage,
    STAGE_RUNTIME_STAGING: run_runtime_staging_stage,
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
