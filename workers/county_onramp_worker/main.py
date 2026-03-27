#!/usr/bin/env python3
from __future__ import annotations

import json
import logging
import os
import shlex
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
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


def _parse_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
      return None
    parts = authorization_header.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


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
    }
    for key in ("overallDemandScalar", "externalDemandScalar", "hbwScalar", "hboScalar", "nhbScalar"):
        value = runtime.get(key)
        if value is not None and not isinstance(value, (int, float)):
            raise ValueError(f"Invalid runtime option '{key}'")
        parsed[key] = value
    return parsed


def _require_artifact_targets(container: dict[str, Any]) -> dict[str, str]:
    targets = container.get("artifactTargets")
    if not isinstance(targets, dict):
        raise ValueError("Missing or invalid 'artifactTargets'")
    return {
        "scaffoldCsvPath": _require_string(targets, "scaffoldCsvPath"),
        "reviewPacketMdPath": _require_string(targets, "reviewPacketMdPath"),
        "manifestPath": _require_string(targets, "manifestPath"),
    }


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
        "runtimeOptions": _require_runtime_options(payload),
        "artifactTargets": _require_artifact_targets(payload),
        "callback": _require_callback(payload),
    }


def _resolve_repo_path(relative_or_absolute_path: str) -> Path:
    path = Path(relative_or_absolute_path).expanduser()
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path.resolve()


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
        "--county-fips",
        job["geographyId"],
        "--county-prefix",
        job["countyPrefix"],
        "--output-csv",
        str(output_csv),
        "--output-md",
        str(output_md),
        "--output-manifest",
        str(output_manifest),
    ]

    if runtime_options["keepProject"]:
        command.append("--keep-project")
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
    command, manifest_path = _build_bootstrap_command(job)
    logger.info("Starting county onramp job %s", job["jobId"])
    logger.info("Bootstrap command: %s", " ".join(shlex.quote(part) for part in command))

    try:
        completed = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            check=True,
            capture_output=True,
            text=True,
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
        logger.info("Completed county onramp job %s", job["jobId"])
        if completed.stdout.strip():
            logger.info("Job %s stdout: %s", job["jobId"], completed.stdout.strip())
        if completed.stderr.strip():
            logger.warning("Job %s stderr: %s", job["jobId"], completed.stderr.strip())
    except Exception as exc:
        logger.exception("County onramp job %s failed", job["jobId"])
        details = None
        if isinstance(exc, subprocess.CalledProcessError):
            details = (exc.stderr or exc.stdout or "").strip()[:4000] or None
        elif not isinstance(exc, requests.RequestException):
            details = str(exc)[:4000]
        try:
            _post_callback(
                job,
                {
                    "jobId": job["jobId"],
                    "status": "failed",
                    "error": {
                        "message": str(exc),
                        "kind": exc.__class__.__name__,
                        **({"details": details} if details else {}),
                    },
                },
            )
        except Exception:
            logger.exception("Callback failed for county onramp job %s", job["jobId"])


@app.get("/healthz")
def healthz():
    return jsonify(
        {
            "ok": True,
            "repoRoot": str(REPO_ROOT),
            "bootstrapScript": str(BOOTSTRAP_SCRIPT),
        }
    )


@app.post("/")
@app.post("/jobs")
def create_job():
    if WORKER_TOKEN:
        request_token = _parse_bearer_token(request.headers.get("authorization"))
        if request_token != WORKER_TOKEN:
            return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(silent=True)
    try:
        job = _parse_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    executor.submit(_run_job, job)
    return jsonify({"accepted": True, "jobId": job["jobId"]}), 202


if __name__ == "__main__":
    host = os.getenv("OPENPLAN_COUNTY_ONRAMP_WORKER_HOST", "0.0.0.0")
    port = int(os.getenv("PORT", os.getenv("OPENPLAN_COUNTY_ONRAMP_WORKER_PORT", "8080")))
    app.run(host=host, port=port)
