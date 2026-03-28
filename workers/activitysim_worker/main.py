#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shlex
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from runtime import BundleContractError, run_activitysim_runtime

load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
load_dotenv(Path(__file__).resolve().parents[2] / "openplan" / ".env.local", override=False)

app = Flask(__name__)

WORKER_TOKEN = (os.getenv("OPENPLAN_ACTIVITYSIM_WORKER_TOKEN") or "").strip()


def _parse_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    parts = authorization_header.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def _split_cli_command(value: str | None) -> list[str] | None:
    if not value:
        return None
    parts = shlex.split(value)
    return parts or None


def _coerce_string(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid '{key}'")
    return value.strip()


def _parse_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object payload")
    return {
        "bundle_path": _coerce_string(payload, "bundlePath"),
        "manifest_path": _coerce_string(payload, "manifestPath"),
        "runtime_dir": _coerce_string(payload, "runtimeOutputDir"),
        "config_dir": _coerce_string(payload, "configDir"),
        "cli_template": _coerce_string(payload, "activitysimCliTemplate"),
        "cli_command": _split_cli_command(_coerce_string(payload, "activitysimCli")),
        "container_image": _coerce_string(payload, "activitysimContainerImage"),
        "container_engine_command": _split_cli_command(_coerce_string(payload, "containerEngineCli")),
        "container_template": _coerce_string(payload, "activitysimContainerCliTemplate"),
        "container_network_mode": _coerce_string(payload, "containerNetworkMode"),
        "run_label": _coerce_string(payload, "runLabel"),
        "force": bool(payload.get("force")),
    }


def _run_from_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    summary = run_activitysim_runtime(
        bundle_path=payload["bundle_path"],
        manifest_path=payload["manifest_path"],
        runtime_dir=payload["runtime_dir"],
        config_dir=payload["config_dir"],
        cli_command=payload["cli_command"],
        cli_template=payload["cli_template"],
        container_image=payload["container_image"],
        container_engine_command=payload["container_engine_command"],
        container_template=payload["container_template"],
        container_network_mode=payload["container_network_mode"],
        run_label=payload["run_label"],
        force=payload["force"],
    )
    if summary["status"] == "failed":
        return summary, 500
    if summary["status"] == "blocked":
        return summary, 200
    return summary, 200


@app.get("/healthz")
def healthz():
    return jsonify(
        {
            "ok": True,
            "worker": "activitysim_worker",
            "default_mode": "preflight_only",
        }
    )


@app.post("/")
@app.post("/run")
@app.post("/jobs")
def run_job():
    if WORKER_TOKEN:
        request_token = _parse_bearer_token(request.headers.get("authorization"))
        if request_token != WORKER_TOKEN:
            return jsonify({"error": "Unauthorized"}), 401

    try:
        payload = _parse_payload(request.get_json(silent=True))
        summary, status_code = _run_from_payload(payload)
    except (ValueError, BundleContractError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(summary), status_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the OpenPlan ActivitySim worker runtime prototype against a built input bundle."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--bundle-path", help="Path to an ActivitySim input bundle directory")
    source_group.add_argument("--manifest-path", help="Path to the bundle manifest.json inside an ActivitySim bundle")
    parser.add_argument("--runtime-dir", help="Output runtime directory. Defaults to <bundle>/runtime/<timestamp>-<label>")
    parser.add_argument("--config-dir", help="Optional ActivitySim config directory override")
    parser.add_argument("--activitysim-cli", help="Optional ActivitySim CLI command, for example 'activitysim'")
    parser.add_argument(
        "--activitysim-cli-template",
        help=(
            "Optional command template with placeholders such as "
            "{config_dir}, {data_dir}, {output_dir}, {working_dir}, {bundle_dir}, {runtime_dir}"
        ),
    )
    parser.add_argument(
        "--activitysim-container-image",
        help="Optional container image for managed ActivitySim execution, for example 'python:3.11-slim'",
    )
    parser.add_argument(
        "--container-engine-cli",
        help="Optional container engine command, for example 'docker' or '/usr/bin/docker'",
    )
    parser.add_argument(
        "--activitysim-container-cli-template",
        help=(
            "Optional command template executed inside the container with placeholders such as "
            "{config_dir}, {data_dir}, {output_dir}, {working_dir}, {bundle_dir}, {runtime_dir}"
        ),
    )
    parser.add_argument(
        "--container-network-mode",
        default="none",
        help="Optional container network mode. Defaults to 'none'; use 'bridge' when the container must install or fetch dependencies.",
    )
    parser.add_argument("--run-label", help="Optional label used in the default runtime output directory")
    parser.add_argument("--force", action="store_true", help="Replace an existing runtime output directory")
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Run the Flask HTTP wrapper instead of the CLI entrypoint",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.serve:
        host = os.getenv("OPENPLAN_ACTIVITYSIM_WORKER_HOST", "0.0.0.0")
        port = int(os.getenv("PORT", os.getenv("OPENPLAN_ACTIVITYSIM_WORKER_PORT", "8080")))
        app.run(host=host, port=port)
        return 0

    try:
        summary = run_activitysim_runtime(
            bundle_path=args.bundle_path,
            manifest_path=args.manifest_path,
            runtime_dir=args.runtime_dir,
            config_dir=args.config_dir,
            cli_command=_split_cli_command(args.activitysim_cli),
            cli_template=args.activitysim_cli_template,
            container_image=args.activitysim_container_image,
            container_engine_command=_split_cli_command(args.container_engine_cli),
            container_template=args.activitysim_container_cli_template,
            container_network_mode=args.container_network_mode,
            run_label=args.run_label,
            force=args.force,
        )
    except BundleContractError as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, indent=2))
        return 2

    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
