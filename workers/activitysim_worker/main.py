#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hmac
import uuid
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


def http_configuration() -> tuple[Path, Path]:
    """Require operator-owned roots and credentials for every HTTP deployment."""
    if not WORKER_TOKEN:
        raise ValueError("OPENPLAN_ACTIVITYSIM_WORKER_TOKEN is required for HTTP operation")
    roots = []
    for name in ("OPENPLAN_ACTIVITYSIM_BUNDLE_ROOT", "OPENPLAN_ACTIVITYSIM_RUNTIME_ROOT"):
        value = os.getenv(name)
        if not value or not Path(value).expanduser().is_dir():
            raise ValueError(f"{name} must name an existing operator-owned directory")
        roots.append(Path(value).expanduser().resolve())
    return roots[0], roots[1]


def _parse_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object payload")
    if set(payload) - {"bundlePath", "manifestPath", "runLabel"}:
        raise ValueError("HTTP requests may select a bundle and label only; execution configuration belongs to the operator")
    bundle_root, runtime_root = http_configuration()
    bundle = _coerce_string(payload, "bundlePath")
    manifest = _coerce_string(payload, "manifestPath")
    if bool(bundle) == bool(manifest):
        raise ValueError("Provide exactly one bundlePath or manifestPath")
    selected = Path(bundle or manifest).expanduser()
    selected = (selected if selected.is_absolute() else bundle_root / selected).resolve()
    if selected != bundle_root and bundle_root not in selected.parents:
        raise ValueError("Bundle path escapes the configured bundle root")
    return {
        "bundle_path": str(selected) if bundle else None,
        "manifest_path": str(selected) if manifest else None,
        "runtime_dir": str(runtime_root / str(uuid.uuid4())),
        "config_dir": os.getenv("ACTIVITYSIM_CONFIG_DIR") or None,
        "cli_template": os.getenv("ACTIVITYSIM_CLI_TEMPLATE") or None,
        "cli_command": _split_cli_command(os.getenv("ACTIVITYSIM_CLI")),
        "container_image": os.getenv("ACTIVITYSIM_CONTAINER_IMAGE") or None,
        "container_engine_command": _split_cli_command(os.getenv("ACTIVITYSIM_CONTAINER_ENGINE_CLI")),
        "container_template": os.getenv("ACTIVITYSIM_CONTAINER_CLI_TEMPLATE") or None,
        "container_network_mode": os.getenv("ACTIVITYSIM_CONTAINER_NETWORK_MODE", "none"),
        "run_label": _coerce_string(payload, "runLabel"),
        "force": False,
        "host_memory_bytes": int(os.environ["ACTIVITYSIM_HOST_MEMORY_BYTES"]) if os.getenv("ACTIVITYSIM_HOST_MEMORY_BYTES") else None,
        "host_tasks": int(os.environ["ACTIVITYSIM_HOST_TASKS"]) if os.getenv("ACTIVITYSIM_HOST_TASKS") else None,
        "container_memory_bytes": int(os.environ["ACTIVITYSIM_CONTAINER_MEMORY_BYTES"]) if os.getenv("ACTIVITYSIM_CONTAINER_MEMORY_BYTES") else None,
        "container_tasks": int(os.environ["ACTIVITYSIM_CONTAINER_TASKS"]) if os.getenv("ACTIVITYSIM_CONTAINER_TASKS") else None,
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
        host_memory_bytes=payload["host_memory_bytes"],
        host_tasks=payload["host_tasks"],
        container_memory_bytes=payload["container_memory_bytes"],
        container_tasks=payload["container_tasks"],
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
    request_token = _parse_bearer_token(request.headers.get("authorization"))
    if not WORKER_TOKEN or request_token is None or not hmac.compare_digest(request_token, WORKER_TOKEN):
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
    source_group = parser.add_mutually_exclusive_group(required=False)
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
    parser.add_argument("--container-memory-bytes", type=int, help="Container RAM cap with zero swap; requires --container-tasks")
    parser.add_argument("--container-tasks", type=int, help="Container process limit; requires --container-memory-bytes")
    parser.add_argument("--host-memory-bytes", type=int, help="Opt in to Linux host supervision with this RAM limit; requires --host-tasks")
    parser.add_argument("--host-tasks", type=int, help="Maximum supervised host tasks; requires --host-memory-bytes")
    parser.add_argument("--run-label", help="Optional label used in the default runtime output directory")
    parser.add_argument("--force", action="store_true", help="Replace an existing runtime output directory")
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Run the Flask HTTP wrapper instead of the CLI entrypoint",
    )
    parser.add_argument("--check-http-config", action="store_true", help="Validate HTTP credentials and roots before starting Gunicorn")
    args = parser.parse_args()
    if not args.serve and not args.check_http_config and not (args.bundle_path or args.manifest_path):
        parser.error("a bundle or manifest is required for CLI execution")
    return args


def main() -> int:
    args = parse_args()
    if args.serve or args.check_http_config:
        try:
            http_configuration()
        except ValueError as exc:
            print(str(exc))
            return 2
        if args.check_http_config:
            return 0
        host = os.getenv("OPENPLAN_ACTIVITYSIM_WORKER_HOST", "127.0.0.1")
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
            host_memory_bytes=args.host_memory_bytes,
            host_tasks=args.host_tasks,
            container_memory_bytes=args.container_memory_bytes,
            container_tasks=args.container_tasks,
        )
    except BundleContractError as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, indent=2))
        return 2

    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
