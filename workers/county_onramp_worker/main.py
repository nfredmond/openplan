#!/usr/bin/env python3
from __future__ import annotations

import hmac
import json
import logging
import os
import shlex
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
load_dotenv(Path(__file__).resolve().parents[2] / "openplan" / ".env.local", override=False)

logging.basicConfig(
    level=os.getenv("OPENPLAN_COUNTY_ONRAMP_WORKER_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("county_onramp_worker")

app = Flask(__name__)
executor = ThreadPoolExecutor(max_workers=int(os.getenv("OPENPLAN_COUNTY_ONRAMP_MAX_CONCURRENCY", "1")))

REPO_ROOT = Path(os.getenv("OPENPLAN_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
BOOTSTRAP_SCRIPT = REPO_ROOT / "scripts" / "modeling" / "bootstrap_county_validation_onramp.py"
PYTHON_BIN = os.getenv("OPENPLAN_COUNTY_ONRAMP_PYTHON_BIN", sys.executable)
WORKER_TOKEN = (os.getenv("OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN") or "").strip()
CALLBACK_TIMEOUT_SECONDS = float(os.getenv("OPENPLAN_COUNTY_ONRAMP_CALLBACK_TIMEOUT_SECONDS", "30"))
HEARTBEAT_SECONDS = max(1.0, float(os.getenv("OPENPLAN_COUNTY_ONRAMP_HEARTBEAT_SECONDS", "30")))
CANCEL_GRACE_SECONDS = max(1.0, float(os.getenv("OPENPLAN_COUNTY_ONRAMP_CANCEL_GRACE_SECONDS", "15")))

_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_job_status(job_id: str, status: str, **fields: Any) -> None:
    with _jobs_lock:
        record = _jobs.get(job_id)
        if record is None:
            return
        record.update({"status": status, "updatedAt": _utc_now(), **fields})


def _public_job_status(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        record = _jobs.get(job_id)
        if record is None:
            return None
        return {
            key: record.get(key)
            for key in (
                "jobId",
                "countyRunId",
                "status",
                "acceptedAt",
                "startedAt",
                "heartbeatAt",
                "cancellationRequestedAt",
                "cancelledAt",
                "completedAt",
                "failedAt",
                "updatedAt",
            )
            if record.get(key) is not None
        }


def _parse_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
      return None
    parts = authorization_header.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


# Loopback addresses, as Flask reports the socket peer in request.remote_addr.
_LOOPBACK_ADDRS = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1"})


def _is_loopback_addr(remote_addr: str | None) -> bool:
    if not remote_addr:
        return False
    return remote_addr in _LOOPBACK_ADDRS or remote_addr.startswith("127.")


def _authorize_job_request(
    configured_token: str, authorization_header: str | None, remote_addr: str | None
) -> bool:
    """Whether a job request may proceed.

    This endpoint launches a subprocess whose executable name comes from the
    payload (runtimeOptions.containerEngineCli), so an unauthenticated caller is
    remote code execution. Two ways to be authorized, and NO third:

    - a configured token, presented as a bearer and compared in constant time; or
    - no token configured AND the caller is on loopback (local single-machine
      dev, not reachable from any network).

    A tokenless request from a non-loopback peer is refused. This is the runtime
    backstop that holds even under gunicorn, where the app cannot see its own
    bind address — so it closes the exposure regardless of how the server was
    started.
    """
    if configured_token:
        provided = _parse_bearer_token(authorization_header)
        if provided is None:
            return False
        return hmac.compare_digest(provided, configured_token)
    return _is_loopback_addr(remote_addr)


def _authorize_control_request(
    configured_token: str, authorization_header: str | None
) -> bool:
    """Status and cancellation always require the shared bearer.

    Loopback limits who can reach a socket; it does not identify which local
    process may stop a planner's run.
    """
    supplied_token = _parse_bearer_token(authorization_header)
    return bool(configured_token) and supplied_token is not None and hmac.compare_digest(
        supplied_token, configured_token
    )


def _startup_bind_refusal(host: str, configured_token: str) -> str | None:
    """Refuse to START an unauthenticated endpoint on a network interface.

    A message means refuse (mirrors odm_worker). Binding a non-loopback host
    with no token is an explicit request to expose the RCE surface to the
    network — the exact posture DEPLOY.md's no-Docker recipe used to produce.
    Loopback binds, and any bind with a token set, are allowed.
    """
    if configured_token:
        return None
    if _is_loopback_addr(host) or host in {"localhost"}:
        return None
    return (
        f"REFUSING TO START: bind host {host!r} is not loopback and "
        "OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN is not set. This endpoint runs a "
        "subprocess named by the request payload, so exposing it unauthenticated "
        "on a network interface is remote code execution. Set the token, or bind "
        "127.0.0.1 for local single-machine use."
    )


def _require_string(container: dict[str, Any], key: str) -> str:
    value = container.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing or invalid '{key}'")
    return value.strip()


def _require_runtime_options(container: dict[str, Any]) -> dict[str, Any]:
    runtime = container.get("runtimeOptions")
    if not isinstance(runtime, dict):
        raise ValueError("Missing or invalid 'runtimeOptions'")

    parsed = {
        "keepProject": bool(runtime.get("keepProject")),
        "force": bool(runtime.get("force")),
        # Opt-in: fit the model to published traffic counts. Comparing against
        # them happens either way; this decides whether the model is also
        # adjusted toward them, which is a different, disclosed claim.
        "calibrateToCounts": bool(runtime.get("calibrateToCounts")),
    }
    for key in ("overallDemandScalar", "externalDemandScalar", "hbwScalar", "hboScalar", "nhbScalar"):
        value = runtime.get(key)
        if value is not None and not isinstance(value, (int, float)):
            raise ValueError(f"Invalid runtime option '{key}'")
        parsed[key] = value
    for key in (
        "activitysimContainerImage",
        "containerEngineCli",
        "activitysimContainerCliTemplate",
        "containerNetworkMode",
    ):
        value = runtime.get(key)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError(f"Invalid runtime option '{key}'")
        parsed[key] = value.strip() if isinstance(value, str) and value.strip() else None
    return parsed


def _require_artifact_targets(container: dict[str, Any]) -> dict[str, str]:
    targets = container.get("artifactTargets")
    if not isinstance(targets, dict):
        raise ValueError("Missing or invalid 'artifactTargets'")
    parsed = {
        "attemptDirectory": _require_string(targets, "attemptDirectory"),
        "scaffoldCsvPath": _require_string(targets, "scaffoldCsvPath"),
        "reviewPacketMdPath": _require_string(targets, "reviewPacketMdPath"),
        "manifestPath": _require_string(targets, "manifestPath"),
    }
    # Reject an escaping path HERE, so a bad job is refused with 400 at submit
    # time rather than accepted, started, and reported as a failed run.
    attempt_directory = _resolve_repo_path(parsed["attemptDirectory"])
    expected_attempt = REPO_ROOT / "data" / "screening-runs" / _require_string(container, "countyRunId") / _require_string(container, "jobId")
    if attempt_directory != expected_attempt.resolve():
        raise ValueError("Invalid artifact target 'attemptDirectory': path does not name this countyRunId/jobId attempt")
    for key, value in parsed.items():
        try:
            resolved = _resolve_repo_path(value)
        except ValueError as exc:
            raise ValueError(f"Invalid artifact target '{key}': {exc}") from exc
        if resolved != attempt_directory and attempt_directory not in resolved.parents:
            raise ValueError(f"Invalid artifact target '{key}': path escapes the job attempt directory")
    return parsed


def _require_callback(container: dict[str, Any]) -> dict[str, str | None]:
    callback = container.get("callback")
    if not isinstance(callback, dict):
        raise ValueError("Missing or invalid 'callback'")
    bearer_token = callback.get("bearerToken")
    if bearer_token is not None and (not isinstance(bearer_token, str) or not bearer_token.strip()):
        raise ValueError("Invalid callback 'bearerToken'")
    return {
        "manifestIngestUrl": _require_string(callback, "manifestIngestUrl"),
        "bearerToken": bearer_token.strip() if isinstance(bearer_token, str) and bearer_token.strip() else None,
    }


def _parse_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object payload")

    return {
        "jobId": _require_string(payload, "jobId"),
        "countyRunId": _require_string(payload, "countyRunId"),
        "workspaceId": _require_string(payload, "workspaceId"),
        "runName": _require_string(payload, "runName"),
        "geographyType": _require_string(payload, "geographyType"),
        "geographyId": _require_string(payload, "geographyId"),
        "geographyLabel": _require_string(payload, "geographyLabel"),
        "countyPrefix": _require_string(payload, "countyPrefix"),
        # The polygon for a study area with no FIPS code. Optional: a county run
        # sends none and resolves its own boundary from the code.
        "boundaryGeojson": payload.get("boundaryGeojson"),
        "runtimeOptions": _require_runtime_options(payload),
        "artifactTargets": _require_artifact_targets(payload),
        "callback": _require_callback(payload),
    }


def _resolve_repo_path(relative_or_absolute_path: str) -> Path:
    """
    Turn a job's artifact path into a real path inside the checkout — and refuse
    anything that lands outside it.

    The confinement is the point. Every path here comes off the wire, this
    process creates the parent directories and the model then writes into them,
    and under docker-compose the checkout is a bind mount of the operator's own
    working tree. Without the check, `../../../.ssh/authorized_keys` is a valid
    artifact target. The app itself only ever sends paths relative to the repo
    root, so nothing legitimate is lost.
    """
    path = Path(relative_or_absolute_path).expanduser()
    if not path.is_absolute():
        path = REPO_ROOT / path
    resolved = path.resolve()
    if resolved != REPO_ROOT and REPO_ROOT not in resolved.parents:
        raise ValueError(f"path escapes the repository root: {relative_or_absolute_path}")
    return resolved


def _build_bootstrap_command(job: dict[str, Any]) -> tuple[list[str], Path]:
    if not BOOTSTRAP_SCRIPT.exists():
        raise FileNotFoundError(f"Missing bootstrap script: {BOOTSTRAP_SCRIPT}")

    artifact_targets = job["artifactTargets"]
    runtime_options = job["runtimeOptions"]

    output_csv = _resolve_repo_path(artifact_targets["scaffoldCsvPath"])
    output_md = _resolve_repo_path(artifact_targets["reviewPacketMdPath"])
    output_manifest = _resolve_repo_path(artifact_targets["manifestPath"])

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_manifest.parent.mkdir(parents=True, exist_ok=True)

    command = [
        PYTHON_BIN,
        str(BOOTSTRAP_SCRIPT),
        "--name",
        job["runName"],
        "--output-root",
        str(_resolve_repo_path(artifact_targets["attemptDirectory"])),
    ]

    # A county resolves its own boundary from its FIPS code through a cached
    # path; anything else arrives as the polygon the planner actually chose.
    # Written beside the run's other artifacts so a reader can see exactly which
    # area was analysed — a study area described only in a payload that is gone
    # is not something an appendix can defend.
    if job.get("geographyType") == "place" and job.get("boundaryGeojson"):
        boundary_path = _resolve_repo_path(job["artifactTargets"]["manifestPath"]).with_name(
            f"{job['runName']}.boundary.geojson"
        )
        boundary_path.parent.mkdir(parents=True, exist_ok=True)
        boundary_path.write_text(json.dumps(job["boundaryGeojson"]))
        command.extend(["--boundary-geojson", str(boundary_path)])
    else:
        command.extend(["--county-fips", job["geographyId"]])

    command.extend([
        "--county-prefix",
        job["countyPrefix"],
        "--output-csv",
        str(output_csv),
        "--output-md",
        str(output_md),
        "--output-manifest",
        str(output_manifest),
    ])

    if runtime_options["keepProject"]:
        command.append("--keep-project")
    if runtime_options.get("calibrateToCounts"):
        command.append("--calibrate")
    if runtime_options["force"]:
        command.append("--force")

    scalar_flags = {
        "--overall-demand-scalar": runtime_options["overallDemandScalar"],
        "--external-demand-scalar": runtime_options["externalDemandScalar"],
        "--hbw-scalar": runtime_options["hbwScalar"],
        "--hbo-scalar": runtime_options["hboScalar"],
        "--nhb-scalar": runtime_options["nhbScalar"],
    }
    for flag, value in scalar_flags.items():
        if value is not None:
            command.extend([flag, str(value)])

    string_flags = {
        "--activitysim-container-image": runtime_options["activitysimContainerImage"],
        "--container-engine-cli": runtime_options["containerEngineCli"],
        "--activitysim-container-cli-template": runtime_options["activitysimContainerCliTemplate"],
        "--container-network-mode": runtime_options["containerNetworkMode"],
    }
    for flag, value in string_flags.items():
        if value is not None:
            command.extend([flag, value])

    return command, output_manifest


def _post_callback(job: dict[str, Any], payload: dict[str, Any]) -> None:
    callback = job["callback"]
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
    }
    if callback["bearerToken"]:
        headers["authorization"] = f"Bearer {callback['bearerToken']}"

    response = requests.post(
        callback["manifestIngestUrl"],
        headers=headers,
        json=payload,
        timeout=CALLBACK_TIMEOUT_SECONDS,
    )
    response.raise_for_status()


def _run_job(job: dict[str, Any]) -> None:
    job_id = job["jobId"]
    with _jobs_lock:
        record = _jobs[job_id]
        cancel_event = record["cancelEvent"]
    try:
        # Command construction creates directories and may fail. It belongs in
        # the same boundary as execution so an accepted job always attempts a
        # terminal callback even when setup itself is broken.
        command, manifest_path = _build_bootstrap_command(job)
        if cancel_event.is_set():
            cancelled_at = _utc_now()
            _set_job_status(job_id, "cancelled", cancelledAt=cancelled_at)
            _post_callback(job, {"jobId": job_id, "status": "cancelled"})
            return

        started_at = _utc_now()
        _set_job_status(job_id, "running", startedAt=started_at, heartbeatAt=started_at)
        _post_callback(job, {"jobId": job_id, "status": "running"})
        logger.info("Starting county onramp job %s", job_id)
        logger.info("Bootstrap command: %s", " ".join(shlex.quote(part) for part in command))

        process = subprocess.Popen(
            command,
            cwd=str(REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        with _jobs_lock:
            _jobs[job_id]["process"] = process

        while True:
            if cancel_event.is_set():
                process.terminate()
                try:
                    stdout, stderr = process.communicate(timeout=CANCEL_GRACE_SECONDS)
                except subprocess.TimeoutExpired:
                    process.kill()
                    stdout, stderr = process.communicate()
                cancelled_at = _utc_now()
                _set_job_status(job_id, "cancelled", cancelledAt=cancelled_at)
                _post_callback(job, {"jobId": job_id, "status": "cancelled"})
                logger.info("Cancelled county onramp job %s", job_id)
                return
            try:
                stdout, stderr = process.communicate(timeout=HEARTBEAT_SECONDS)
                break
            except subprocess.TimeoutExpired:
                heartbeat_at = _utc_now()
                _set_job_status(job_id, "running", heartbeatAt=heartbeat_at)
                try:
                    _post_callback(job, {"jobId": job_id, "status": "heartbeat"})
                except Exception:
                    logger.exception("Heartbeat callback failed for county onramp job %s", job_id)

        if process.returncode != 0:
            raise subprocess.CalledProcessError(
                process.returncode,
                command,
                output=stdout,
                stderr=stderr,
            )
        manifest = json.loads(manifest_path.read_text())
        _post_callback(
          job,
          {
              "jobId": job["jobId"],
              "status": "completed",
              "manifest": manifest,
          },
        )
        completed_at = _utc_now()
        _set_job_status(job_id, "completed", completedAt=completed_at)
        logger.info("Completed county onramp job %s", job_id)
        if stdout.strip():
            logger.info("Job %s stdout: %s", job_id, stdout.strip())
        if stderr.strip():
            logger.warning("Job %s stderr: %s", job_id, stderr.strip())
    except Exception as exc:
        failed_at = _utc_now()
        _set_job_status(job_id, "failed", failedAt=failed_at)
        logger.exception("County onramp job %s failed", job_id)
        details = None
        if isinstance(exc, subprocess.CalledProcessError):
            details = (exc.stderr or exc.stdout or "").strip()[:4000] or None
        elif not isinstance(exc, requests.RequestException):
            details = str(exc)[:4000]
        try:
            _post_callback(
                job,
                {
                    "jobId": job_id,
                    "status": "failed",
                    "error": {
                        "message": str(exc),
                        "kind": exc.__class__.__name__,
                        **({"details": details} if details else {}),
                    },
                },
            )
        except Exception:
            logger.exception("Callback failed for county onramp job %s", job_id)
    finally:
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["process"] = None


@app.get("/healthz")
def healthz():
    return jsonify(
        {
            "ok": True,
            "repoRoot": str(REPO_ROOT),
            "bootstrapScript": str(BOOTSTRAP_SCRIPT),
        }
    )


@app.get("/jobs/<job_id>")
def get_job(job_id: str):
    if not _authorize_control_request(WORKER_TOKEN, request.headers.get("authorization")):
        return jsonify({"error": "Unauthorized"}), 401
    status = _public_job_status(job_id)
    if status is None:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(status), 200


@app.post("/jobs/<job_id>/cancel")
def cancel_job(job_id: str):
    if not _authorize_control_request(WORKER_TOKEN, request.headers.get("authorization")):
        return jsonify({"error": "Unauthorized"}), 401
    with _jobs_lock:
        record = _jobs.get(job_id)
        if record is None:
            return jsonify({"error": "Job not found"}), 404
        if record["status"] in {"cancelled", "completed", "failed"}:
            return jsonify({"error": f"Job is already {record['status']}"}), 409
        requested_at = _utc_now()
        record["cancellationRequestedAt"] = requested_at
        record["updatedAt"] = requested_at
        record["status"] = "cancelling"
        record["cancelEvent"].set()
    return jsonify({"accepted": True, "jobId": job_id, "status": "cancelling"}), 202


@app.post("/")
@app.post("/jobs")
def create_job():
    if not _authorize_job_request(
        WORKER_TOKEN, request.headers.get("authorization"), request.remote_addr
    ):
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(silent=True)
    try:
        job = _parse_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    accepted_at = _utc_now()
    with _jobs_lock:
        if job["jobId"] in _jobs:
            return jsonify({"error": "Job id already exists"}), 409
        _jobs[job["jobId"]] = {
            "jobId": job["jobId"],
            "countyRunId": job["countyRunId"],
            "job": job,
            "status": "queued",
            "acceptedAt": accepted_at,
            "updatedAt": accepted_at,
            "cancelEvent": threading.Event(),
            "process": None,
        }
    executor.submit(_run_job, job)
    return jsonify({"accepted": True, "jobId": job["jobId"]}), 202


if __name__ == "__main__":
    # Loopback by default: this worker only needs to be reached by the OpenPlan
    # app on the same machine (the compose file sets 127.0.0.1 under host
    # networking). A wider bind is an explicit choice, and an unauthenticated
    # one is refused below.
    host = os.getenv("OPENPLAN_COUNTY_ONRAMP_WORKER_HOST", "127.0.0.1")
    refusal = _startup_bind_refusal(host, WORKER_TOKEN)
    if refusal:
        print(f"[county-onramp-worker] {refusal}")
        sys.exit(2)
    port = int(os.getenv("PORT", os.getenv("OPENPLAN_COUNTY_ONRAMP_WORKER_PORT", "8080")))
    app.run(host=host, port=port)
