#!/usr/bin/env python3
"""OpenPlan self-hosted ODM processing worker.

Implements the SAME service contract as the external Aerial Intel Platform
(schemas/aerial_processing_contract.schema.json at the repo root): OpenPlan
POSTs a ProcessingRequest to /api/v1/processing-requests with a bearer token;
this worker answers an `accepted` ProcessingCallback body, runs the imagery
through NodeODM (the official opendronemap/nodeodm container, wrapped by
docker-compose.yml next to this file), and POSTs running/succeeded/failed
callbacks to the request's callbackUrl with the shared callback bearer token.

Because it speaks the contract, the app needs ZERO dispatch changes to use it —
set OPENPLAN_AERIAL_PROCESSING_WORKER_URL at this worker, and (to send stored
mission photos rather than a pasted ZIP link) set
OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT=v1.1. Both imagery shapes are
accepted here: zip_url (contract v1) and photo_manifest (v1.1).

Mirrors workers/aequilibrae_worker's posture: stdlib ThreadingHTTPServer (no
Flask), plain-script test_*.py suites, one honest sentence for every failure.

ONE JOB AT A TIME, BY DESIGN. NodeODM processes one photogrammetry task well
and several badly (they contend for the same cores and RAM); the queue accepts
up to ODM_WORKER_MAX_QUEUED jobs and refuses beyond that with a 503 that says
so, rather than accepting work it may never reach.

Environment:
  OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN            required — inbound bearer
  OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN   required — outbound bearer
  NODEODM_URL              default http://nodeodm:3000 (docker-compose name)
  NODEODM_TOKEN            optional NodeODM --token
  ODM_WORKER_PORT / PORT   default 8484
  ODM_WORKER_PUBLIC_URL    default http://localhost:<port> — base of the
                           artifact downloadUrls this worker issues; set it to
                           whatever URL the OpenPlan deployment can reach.
  ODM_WORKER_WORK_DIR      default <system tmp>/odm_worker_jobs
  ODM_WORKER_ARTIFACT_TTL_SECONDS  default 86400 — how long issued artifact
                           links stay valid (OpenPlan takes custody of the
                           bytes on the succeeded callback, so links only need
                           to outlive that pass).
  ODM_WORKER_MAX_QUEUED    default 4
  ODM_WORKER_POLL_INTERVAL_SECONDS  default 10 — NodeODM task polling
"""

import hmac
import json
import mimetypes
import os
import queue
import secrets
import shutil
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import callbacks as callbacks_module
import contract
import intake

try:  # Optional; the env vars can come from the host instead.
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024  # a 10,000-photo manifest is ~3 MB

# NodeODM task options per contract preset — data, not code. orthophoto-png is
# always requested: it is the ortho_preview artifact, the one output a browser
# can consume without a tiler (the reason COG tiling was deferred).
PRESET_OPTIONS = {
    "fast-preview": [
        {"name": "fast-orthophoto", "value": True},
        {"name": "pc-quality", "value": "low"},
        {"name": "feature-quality", "value": "low"},
    ],
    "balanced": [{"name": "dsm", "value": True}],
    "high-quality": [
        {"name": "dsm", "value": True},
        {"name": "dtm", "value": True},
        {"name": "pc-quality", "value": "high"},
        {"name": "feature-quality", "value": "high"},
    ],
}
ALWAYS_OPTIONS = [{"name": "orthophoto-png", "value": True}]

# Which NodeODM download asset carries which contract artifact kind. Absence of
# an optional asset is an answer (the preset did not produce it), not an error;
# only the orthomosaic is required for a job to count as succeeded.
ASSET_BY_KIND = [
    ("orthomosaic", "orthophoto.tif", "image/tiff", True),
    ("ortho_preview", "orthophoto.png", "image/png", False),
    ("dsm", "dsm.tif", "image/tiff", False),
    ("dtm", "dtm.tif", "image/tiff", False),
    ("point_cloud", "georeferenced_model.laz", "application/octet-stream", False),
]


def env_int(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
        return value if value > 0 else default
    except ValueError:
        print(f"[odm-worker] {name}={raw!r} is not a positive integer; using {default}")
        return default


def config():
    port = env_int("ODM_WORKER_PORT", env_int("PORT", 8484))
    return {
        "worker_token": os.environ.get(
            "OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN", ""
        ).strip(),
        "callback_token": os.environ.get(
            "OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN", ""
        ).strip(),
        "nodeodm_url": os.environ.get("NODEODM_URL", "http://nodeodm:3000").strip(),
        "nodeodm_token": os.environ.get("NODEODM_TOKEN", "").strip() or None,
        "port": port,
        "public_url": (
            os.environ.get("ODM_WORKER_PUBLIC_URL", "").strip()
            or f"http://localhost:{port}"
        ).rstrip("/"),
        "work_dir": os.environ.get("ODM_WORKER_WORK_DIR", "").strip()
        or os.path.join(tempfile.gettempdir(), "odm_worker_jobs"),
        "artifact_ttl_seconds": env_int("ODM_WORKER_ARTIFACT_TTL_SECONDS", 86400),
        "max_queued": env_int("ODM_WORKER_MAX_QUEUED", 4),
        "poll_interval_seconds": env_int("ODM_WORKER_POLL_INTERVAL_SECONDS", 10),
    }


CONFIG = config()

# ── Job registry ─────────────────────────────────────────────────────────────
# request_id -> job dict. The accepted callback is stored so a retried
# submission (same requestId) gets the SAME answer instead of a second job —
# the contract's idempotency rule.
JOBS = {}
JOBS_LOCK = threading.Lock()
JOB_QUEUE = queue.Queue()

# job_reference -> {"token", "dir", "expires_at", "files": {filename: path}}
ARTIFACTS = {}
ARTIFACTS_LOCK = threading.Lock()


def register_job(request):
    job_reference = f"odm-{uuid.uuid4().hex[:20]}"
    accepted = contract.build_callback(
        request["schemaVersion"], request["requestId"], job_reference, "accepted"
    )
    job = {
        "request": request,
        "job_reference": job_reference,
        "accepted_callback": accepted,
        "state": "accepted",
    }
    with JOBS_LOCK:
        JOBS[request["requestId"]] = job
    return job


def publish_artifacts(job_reference, staged_files, ttl_seconds=None):
    """Make downloaded outputs servable under an unguessable, expiring URL.
    staged_files: {filename: absolute_path}. Returns (token, expires_at_iso)."""
    token = secrets.token_urlsafe(24)
    expires_at = time.time() + (ttl_seconds or CONFIG["artifact_ttl_seconds"])
    with ARTIFACTS_LOCK:
        ARTIFACTS[job_reference] = {
            "token": token,
            "expires_at": expires_at,
            "files": dict(staged_files),
        }
    iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at))
    return token, iso


def artifact_download_url(job_reference, token, filename):
    return f"{CONFIG['public_url']}/artifacts/{job_reference}/{token}/{filename}"


# ── The pipeline ─────────────────────────────────────────────────────────────


def send_job_callback(job, status, progress=None, message=None, artifacts=None, benchmark=None):
    payload = contract.build_callback(
        job["request"]["schemaVersion"],
        job["request"]["requestId"],
        job["job_reference"],
        status,
        progress=progress,
        message=message,
        artifacts=artifacts,
        benchmark_summary=benchmark,
    )
    ok, detail = callbacks_module.post_callback(
        job["request"]["callbackUrl"], CONFIG["callback_token"], payload
    )
    if not ok:
        print(
            f"[odm-worker] callback {status} for {job['request']['requestId']} "
            f"NOT delivered: {detail}"
        )
    return ok


def process_job(job, make_client=None, prepare=None, publish=None, send=None, sleep=time.sleep):
    """Run one job end to end. Every dependency is injectable so the test
    suite can drive this without NodeODM, the network, or pyproj."""
    send = send or send_job_callback
    prepare = prepare or intake.prepare_imagery
    publish = publish or publish_artifacts
    request = job["request"]
    started = time.time()
    work_dir = os.path.join(CONFIG["work_dir"], job["job_reference"])
    os.makedirs(work_dir, exist_ok=True)

    try:
        send(job, "running", progress=2, message="Downloading imagery")
        images_dir = prepare(request["imagery"], work_dir)
        image_paths = intake.collect_images(images_dir)

        if make_client is None:
            from nodeodm_client import NodeODMClient  # lazy: needs `requests`

            client = NodeODMClient(CONFIG["nodeodm_url"], token=CONFIG["nodeodm_token"])
        else:
            client = make_client()

        preset = request.get("presetId") or "balanced"
        options = list(PRESET_OPTIONS.get(preset, PRESET_OPTIONS["balanced"])) + list(
            ALWAYS_OPTIONS
        )

        send(
            job,
            "running",
            progress=8,
            message=f"Uploading {len(image_paths)} images to NodeODM ({preset} preset)",
        )
        task_uuid = client.create_task(request["missionTitle"][:200], options)
        for image_path in image_paths:
            client.upload_image(task_uuid, image_path)
        client.commit_task(task_uuid)

        # Poll NodeODM, forwarding progress. NodeODM owns 10..90 of our scale.
        from nodeodm_client import TERMINAL_STATUSES, STATUS_FAILED, STATUS_CANCELED

        last_sent_progress = 8
        while True:
            info = client.task_info(task_uuid)
            status_code = (info.get("status") or {}).get("code")
            odm_progress = float(info.get("progress") or 0)
            overall = 10 + int(odm_progress * 0.8)
            if status_code in TERMINAL_STATUSES:
                break
            if overall >= last_sent_progress + 5:
                last_sent_progress = overall
                send(job, "running", progress=overall, message="NodeODM processing")
            sleep(CONFIG["poll_interval_seconds"])

        if status_code == STATUS_CANCELED:
            send(job, "canceled", message="NodeODM reported the task canceled")
            job["state"] = "canceled"
            return
        if status_code == STATUS_FAILED:
            error_detail = (info.get("status") or {}).get("errorMessage") or "no detail"
            send(
                job,
                "failed",
                message=f"NodeODM reported the task failed: {error_detail}"[:2048],
            )
            job["state"] = "failed"
            return

        send(job, "running", progress=92, message="Collecting outputs from NodeODM")
        downloads_dir = os.path.join(work_dir, "outputs")
        os.makedirs(downloads_dir, exist_ok=True)
        staged = {}
        found_kinds = []
        for kind, asset, content_type, required in ASSET_BY_KIND:
            dest = os.path.join(downloads_dir, asset)
            written = client.download_asset(task_uuid, asset, dest)
            if written is None:
                if required:
                    send(
                        job,
                        "failed",
                        message=(
                            f"NodeODM completed but its {asset} output is missing — "
                            "the job produced no orthomosaic to deliver"
                        ),
                    )
                    job["state"] = "failed"
                    return
                continue
            staged[asset] = dest
            found_kinds.append((kind, asset, content_type))

        # Georeferencing: read the orthomosaic's own tags; the preview PNG is a
        # rendering of the same pixel grid, so the bounds apply to both. A file
        # the parser cannot read means the fields are ABSENT and the message
        # says so — the consumer then refuses map placement rather than
        # guessing.
        georef_fields = None
        georef_note = None
        ortho_path = staged.get("orthophoto.tif")
        if ortho_path:
            try:
                import georef as georef_module

                parsed = georef_module.parse_geotiff(ortho_path)
                bounds = georef_module.wgs84_bounds(parsed)
                georef_fields = {
                    "bounds_wgs84": bounds,
                    "crs": f"EPSG:{parsed['epsg']}",
                    "pixel_size_m": georef_module.pixel_size_meters(parsed),
                }
            except Exception as exc:  # noqa: BLE001 - GeorefError and friends
                georef_note = f"georeferencing was not read from the orthomosaic: {exc}"

        token, expires_iso = publish(job["job_reference"], staged)
        artifact_payloads = []
        for kind, asset, content_type in found_kinds:
            geo = georef_fields if kind in ("orthomosaic", "ortho_preview") else None
            artifact_payloads.append(
                contract.build_artifact(
                    kind,
                    artifact_download_url(job["job_reference"], token, asset),
                    expires_iso,
                    size_bytes=os.path.getsize(staged[asset]),
                    content_type=content_type,
                    bounds_wgs84=(geo or {}).get("bounds_wgs84"),
                    crs=(geo or {}).get("crs"),
                    pixel_size_m=(geo or {}).get("pixel_size_m"),
                )
            )

        benchmark = {
            "wallClockSeconds": int(time.time() - started),
            "preset": preset,
            "imageCount": len(image_paths),
            "engine": "nodeodm",
        }
        send(
            job,
            "succeeded",
            progress=100,
            message=georef_note,
            artifacts=artifact_payloads,
            benchmark=benchmark,
        )
        job["state"] = "succeeded"
    except intake.IntakeError as exc:
        send(job, "failed", message=f"Imagery intake failed: {exc}"[:2048])
        job["state"] = "failed"
    except Exception as exc:  # noqa: BLE001 - the stage name is the honesty
        send(job, "failed", message=f"Processing failed: {exc}"[:2048])
        job["state"] = "failed"
    finally:
        # Keep only published outputs; the working copies (source photos,
        # NodeODM downloads are the published copies' own paths) stay until
        # expiry sweep. Source images are always removable.
        shutil.rmtree(os.path.join(work_dir, "images"), ignore_errors=True)


# Tests replace this to observe scheduling without running NodeODM.
PIPELINE = process_job


def worker_loop():
    while True:
        job = JOB_QUEUE.get()
        if job is None:
            return
        try:
            PIPELINE(job)
        except Exception as exc:  # noqa: BLE001
            print(f"[odm-worker] pipeline crashed: {exc}")
        finally:
            JOB_QUEUE.task_done()


# ── HTTP surface ─────────────────────────────────────────────────────────────


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "openplan-odm-worker"

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        configured = CONFIG["worker_token"]
        if not configured:
            self._send_json(
                503,
                {
                    "error": "worker_not_configured",
                    "detail": (
                        "OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN is not set on this "
                        "worker, so it refuses every request rather than serving "
                        "without authentication."
                    ),
                },
            )
            return False
        header = self.headers.get("Authorization", "")
        presented = header[len("Bearer ") :] if header.startswith("Bearer ") else ""
        if not presented or not hmac.compare_digest(presented, configured):
            self._send_json(401, {"error": "unauthorized"})
            return False
        return True

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        if self.path == "/healthz":
            nodeodm = {"reachable": False, "detail": "not probed"}
            try:
                from nodeodm_client import NodeODMClient

                info = NodeODMClient(
                    CONFIG["nodeodm_url"], token=CONFIG["nodeodm_token"], timeout=5
                ).info()
                nodeodm = {
                    "reachable": True,
                    "version": info.get("version"),
                    "engine": info.get("engine"),
                }
            except Exception as exc:  # noqa: BLE001
                nodeodm = {"reachable": False, "detail": str(exc)}
            # Health of the PROCESS, never a promise a job would succeed.
            self._send_json(
                200,
                {
                    "status": "ok",
                    "contract": list(contract.SCHEMA_VERSIONS),
                    "nodeodm": nodeodm,
                    "queued": JOB_QUEUE.qsize(),
                },
            )
            return

        if self.path.startswith("/artifacts/"):
            parts = self.path.split("/")
            # /artifacts/<job_reference>/<token>/<filename>
            if len(parts) != 5:
                self._send_json(404, {"error": "no_such_artifact"})
                return
            _, _, job_reference, token, filename = parts
            with ARTIFACTS_LOCK:
                entry = ARTIFACTS.get(job_reference)
            if not entry or not hmac.compare_digest(token, entry["token"]):
                self._send_json(404, {"error": "no_such_artifact"})
                return
            if time.time() > entry["expires_at"]:
                self._send_json(
                    410,
                    {
                        "error": "artifact_link_expired",
                        "detail": (
                            "This output's link has expired. Re-request processing to "
                            "produce it again — the worker does not keep outputs forever."
                        ),
                    },
                )
                return
            path = entry["files"].get(filename)
            if not path or not os.path.exists(path):
                self._send_json(404, {"error": "no_such_artifact"})
                return
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(path, "rb") as handle:
                shutil.copyfileobj(handle, self.wfile)
            return

        self._send_json(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/api/v1/processing-requests":
            self._send_json(404, {"error": "not_found"})
            return
        if not self._authorized():
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_REQUEST_BODY_BYTES:
            self._send_json(413, {"error": "request_body_too_large_or_empty"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "request body is not valid JSON"})
            return

        errors = contract.validate_processing_request(payload)
        if errors:
            self._send_json(
                422, {"error": "contract_validation_failed", "issues": errors}
            )
            return

        with JOBS_LOCK:
            existing = JOBS.get(payload["requestId"])
        if existing:
            # Idempotency: the same requestId gets the SAME accepted answer,
            # never a second job.
            self._send_json(200, existing["accepted_callback"])
            return

        if JOB_QUEUE.qsize() >= CONFIG["max_queued"]:
            self._send_json(
                503,
                {
                    "error": "queue_full",
                    "detail": (
                        f"This worker already holds {JOB_QUEUE.qsize()} unstarted "
                        "jobs and refuses to accept more than it may reach. "
                        "Retry after the queue drains."
                    ),
                },
            )
            return

        job = register_job(payload)
        JOB_QUEUE.put(job)
        self._send_json(202, job["accepted_callback"])

    def log_message(self, fmt, *args):  # noqa: A003 - quieter default logging
        print(f"[odm-worker] {self.address_string()} {fmt % args}")


def build_server(host="0.0.0.0", port=None):
    return ThreadingHTTPServer((host, port or CONFIG["port"]), WorkerHandler)


def main():
    missing = [
        name
        for name, key in (
            ("OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN", "worker_token"),
            ("OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN", "callback_token"),
        )
        if not CONFIG[key]
    ]
    if missing:
        print(
            "[odm-worker] REFUSING TO START: missing required environment "
            f"variables: {', '.join(missing)}. Both bearer tokens must be set — "
            "an unauthenticated processing endpoint would let anyone start "
            "minutes of compute and read mission outputs."
        )
        sys.exit(2)

    os.makedirs(CONFIG["work_dir"], exist_ok=True)
    threading.Thread(target=worker_loop, daemon=True, name="odm-pipeline").start()
    server = build_server()
    print(
        f"[odm-worker] serving on :{CONFIG['port']} "
        f"(NodeODM at {CONFIG['nodeodm_url']}; artifact links under "
        f"{CONFIG['public_url']}; contract {', '.join(contract.SCHEMA_VERSIONS)})"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
