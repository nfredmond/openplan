#!/usr/bin/env python3
"""OpenPlan self-hosted OCR worker.

Turns a scanned PDF into PER-PAGE text so a planner can cite page 112 of the
plan their board adopted.

It speaks the OCR extraction contract (schemas/ocr_extraction_contract.schema
.json at the repo root): OpenPlan POSTs an OcrRequest to
/api/v1/ocr-requests with a bearer token; this worker answers an `accepted`
OcrCallback body, downloads the PDF from the signed link, recognises it with
ocrmypdf + tesseract, and POSTs running/succeeded/failed callbacks to the
request's callbackUrl with the shared callback bearer token.

WHAT THIS EXISTS TO FIX. Until now a scanned plan uploaded to OpenPlan's
document library was stored, marked `failed`, given zero chunks, and was
permanently uncitable — and most adopted RTPs older than a few years are exactly
that. This worker is the only thing standing between "we have the plan" and
"we can quote page 112 of it".

WHAT IT REFUSES TO DO. It transcribes. It does not summarise, does not
paraphrase, does not repair, does not reorder, and does not report a
confidence, certainty or likelihood about what it read. Every page of the
source comes back, in order, including the ones that produced nothing — see
contract.validate_page_sequence, which refuses to assemble a payload otherwise.

Mirrors workers/odm_worker's posture: stdlib ThreadingHTTPServer (no Flask),
plain-script test_*.py suites, one honest sentence for every failure.

ONE JOB AT A TIME, BY DESIGN. OCR is CPU-bound across every core it can reach;
two documents recognised at once take longer than the same two in sequence. The
queue accepts up to OCR_WORKER_MAX_QUEUED jobs and refuses beyond that with a
503 that says so, rather than accepting work it may never reach.

Environment:
  OPENPLAN_KB_OCR_WORKER_TOKEN            required — inbound bearer
  OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN   required — outbound bearer
  OCR_WORKER_PORT / PORT       default 8585
  OCR_WORKER_WORK_DIR          default <system tmp>/ocr_worker_jobs
  OCR_WORKER_MAX_QUEUED        default 4
  OCR_WORKER_MAX_SOURCE_BYTES  default 209715200 (200 MiB)
  OCR_WORKER_MAX_PAGES         default 2000
  OCR_WORKER_TIMEOUT_SECONDS   default 5400 (90 minutes)
  OCR_WORKER_JOBS              default unset — ocrmypdf --jobs (cores per doc)
  OCR_WORKER_DEFAULT_LANGUAGES default eng — used ONLY when a request names no
                               languages. OpenPlan always names them.
"""

import hmac
import json
import os
import queue
import shutil
import sys
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import callbacks as callbacks_module
import contract
import intake
import ocr as ocr_module

try:  # Optional; the env vars can come from the host instead.
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# An OcrRequest is one signed URL and a little metadata; 256 KiB is generous.
MAX_REQUEST_BODY_BYTES = 256 * 1024


def env_int(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
        return value if value > 0 else default
    except ValueError:
        print(f"[ocr-worker] {name}={raw!r} is not a positive integer; using {default}")
        return default


def env_languages(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    codes = tuple(part.strip() for part in raw.replace("+", ",").split(",") if part.strip())
    return codes or default


def config():
    port = env_int("OCR_WORKER_PORT", env_int("PORT", 8585))
    return {
        "worker_token": os.environ.get("OPENPLAN_KB_OCR_WORKER_TOKEN", "").strip(),
        "callback_token": os.environ.get(
            "OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN", ""
        ).strip(),
        "port": port,
        "work_dir": os.environ.get("OCR_WORKER_WORK_DIR", "").strip()
        or os.path.join(tempfile.gettempdir(), "ocr_worker_jobs"),
        "max_queued": env_int("OCR_WORKER_MAX_QUEUED", 4),
        "max_source_bytes": env_int("OCR_WORKER_MAX_SOURCE_BYTES", 200 * 1024 * 1024),
        "max_pages": env_int("OCR_WORKER_MAX_PAGES", 2000),
        "timeout_seconds": env_int("OCR_WORKER_TIMEOUT_SECONDS", 5400),
        "jobs": env_int("OCR_WORKER_JOBS", 0) or None,
        "default_languages": env_languages("OCR_WORKER_DEFAULT_LANGUAGES", ("eng",)),
    }


CONFIG = config()

# ── Job registry ─────────────────────────────────────────────────────────────
# request_id -> job dict. The accepted callback is stored so a retried
# submission (same requestId) gets the SAME answer instead of a second job —
# the contract's idempotency rule.
JOBS = {}
JOBS_LOCK = threading.Lock()
JOB_QUEUE = queue.Queue()


def register_job(request):
    job_reference = f"ocr-{uuid.uuid4().hex[:20]}"
    accepted = contract.build_callback(request["requestId"], job_reference, "accepted")
    job = {
        "request": request,
        "job_reference": job_reference,
        "accepted_callback": accepted,
        "state": "accepted",
    }
    with JOBS_LOCK:
        JOBS[request["requestId"]] = job
    return job


# ── The pipeline ─────────────────────────────────────────────────────────────


def send_job_callback(job, status, **kwargs):
    payload = contract.build_callback(
        job["request"]["requestId"], job["job_reference"], status, **kwargs
    )
    ok, detail = callbacks_module.post_callback(
        job["request"]["callbackUrl"], CONFIG["callback_token"], payload
    )
    if not ok:
        print(
            f"[ocr-worker] callback {status} for {job['request']['requestId']} "
            f"NOT delivered: {detail}"
        )
    return ok


def process_job(job, prepare=None, recognize=None, send=None):
    """Run one job end to end. Every dependency is injectable so the test suite
    can drive this with no ocrmypdf, no tesseract, and no network."""
    send = send or send_job_callback
    prepare = prepare or intake.prepare_source
    recognize = recognize or ocr_module.recognize

    request = job["request"]
    languages = tuple(request.get("languages") or CONFIG["default_languages"])
    work_dir = os.path.join(CONFIG["work_dir"], job["job_reference"])
    os.makedirs(work_dir, exist_ok=True)

    # A request may lower this deployment's page ceiling but never raise it.
    requested_max_pages = request.get("maxPages")
    max_pages = (
        min(requested_max_pages, CONFIG["max_pages"])
        if isinstance(requested_max_pages, int)
        else CONFIG["max_pages"]
    )

    try:
        send(job, "running", progress=2, message="Downloading the document")
        source_pdf = prepare(
            request["source"], work_dir, CONFIG["max_source_bytes"]
        )

        def report(percent, message):
            send(job, "running", progress=percent, message=message)

        pages, page_count, engine_version = recognize(
            source_pdf,
            work_dir,
            languages=languages,
            timeout_seconds=CONFIG["timeout_seconds"],
            max_pages=max_pages,
            jobs=CONFIG["jobs"],
            progress=report,
        )

        pages_with_text = sum(1 for page in pages if page["text"].strip())
        engine = contract.build_engine(
            "ocrmypdf+tesseract",
            version=engine_version,
            languages=languages,
            pages_with_text=pages_with_text,
        )

        succeeded = contract.build_callback(
            request["requestId"],
            job["job_reference"],
            "succeeded",
            progress=100,
            pages=pages,
            page_count=page_count,
            engine=engine,
            message=(
                f"{pages_with_text} of {page_count} pages produced text."
                if pages_with_text < page_count
                else f"All {page_count} pages produced text."
            ),
        )

        # MEASURE BEFORE SENDING. The consumer declares the ceiling its own
        # request body limit will enforce; a payload over it would come back
        # 413 and the job would sit `running` forever with nobody able to say
        # why. Failing HERE, with both numbers, is the honest version.
        ceiling = request.get("maxCallbackBytes")
        if isinstance(ceiling, int):
            _body, length = callbacks_module.encode_payload(succeeded)
            if length > ceiling:
                send(
                    job,
                    "failed",
                    message=(
                        f"This document recognised into {length} bytes of text, over the "
                        f"{ceiling}-byte ceiling the request declared. Nothing was "
                        "delivered. Whoever operates OpenPlan can raise "
                        "OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES; on a hosted platform with a "
                        "fixed request-body limit, this document has to be split."
                    ),
                    page_count=page_count,
                )
                job["state"] = "failed"
                return

        ok, detail = callbacks_module.post_callback(
            request["callbackUrl"], CONFIG["callback_token"], succeeded
        )
        if not ok:
            print(
                f"[ocr-worker] succeeded callback for {request['requestId']} "
                f"NOT delivered: {detail}"
            )
            job["state"] = "undelivered"
            return

        job["state"] = "succeeded"
    except intake.IntakeError as exc:
        send(job, "failed", message=f"Document intake failed: {exc}"[:2048])
        job["state"] = "failed"
    except ocr_module.OcrError as exc:
        send(job, "failed", message=f"Text recognition failed: {exc}"[:2048])
        job["state"] = "failed"
    except contract.PageSequenceError as exc:
        # The invariant refused the payload. This is the failure this worker
        # exists to make impossible to ship, so it gets its own branch and its
        # own sentence rather than the generic one.
        send(
            job,
            "failed",
            message=(
                "The recognised pages did not line up with the document's own page "
                f"numbering, so nothing was delivered: {exc}"
            )[:2048],
        )
        job["state"] = "failed"
    except Exception as exc:  # noqa: BLE001 - the stage name is the honesty
        send(job, "failed", message=f"Processing failed: {exc}"[:2048])
        job["state"] = "failed"
    finally:
        # The source PDF and the recognised copy are both reconstructible from
        # OpenPlan's own storage; the text has already been delivered or the job
        # has failed. Nothing here is worth keeping on disk.
        shutil.rmtree(work_dir, ignore_errors=True)


# Tests replace this to observe scheduling without running the recogniser.
PIPELINE = process_job


def worker_loop():
    while True:
        job = JOB_QUEUE.get()
        if job is None:
            return
        try:
            PIPELINE(job)
        except Exception as exc:  # noqa: BLE001
            print(f"[ocr-worker] pipeline crashed: {exc}")
        finally:
            JOB_QUEUE.task_done()


# ── HTTP surface ─────────────────────────────────────────────────────────────


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "openplan-ocr-worker"

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
                        "OPENPLAN_KB_OCR_WORKER_TOKEN is not set on this worker, so it "
                        "refuses every request rather than serving without "
                        "authentication."
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
            binaries = ocr_module.binaries_present()
            languages = ocr_module.available_languages()
            # Health of the PROCESS, never a promise a job would succeed. The
            # language list is reported because "recognised with the wrong
            # language pack" is the failure nobody can see in the output.
            self._send_json(
                200,
                {
                    "status": "ok",
                    "contract": list(contract.SCHEMA_VERSIONS),
                    "binaries": binaries,
                    "languages": languages,
                    "languagesProbe": "read" if languages else "unavailable",
                    "queued": JOB_QUEUE.qsize(),
                },
            )
            return

        self._send_json(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/api/v1/ocr-requests":
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

        errors = contract.validate_ocr_request(payload)
        if errors:
            self._send_json(422, {"error": "contract_validation_failed", "issues": errors})
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
                        f"This worker already holds {JOB_QUEUE.qsize()} unstarted jobs "
                        "and refuses to accept more than it may reach. Retry after the "
                        "queue drains."
                    ),
                },
            )
            return

        job = register_job(payload)
        JOB_QUEUE.put(job)
        self._send_json(202, job["accepted_callback"])

    def log_message(self, fmt, *args):  # noqa: A003 - quieter default logging
        print(f"[ocr-worker] {self.address_string()} {fmt % args}")


def build_server(host="0.0.0.0", port=None):
    # `port if port is None else …` rather than `port or …`: port 0 means "let
    # the OS pick a free one", which is falsy, and `or` would silently hand back
    # the configured port instead — binding the same port twice.
    return ThreadingHTTPServer((host, CONFIG["port"] if port is None else port), WorkerHandler)


def main():
    missing = [
        name
        for name, key in (
            ("OPENPLAN_KB_OCR_WORKER_TOKEN", "worker_token"),
            ("OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN", "callback_token"),
        )
        if not CONFIG[key]
    ]
    if missing:
        print(
            "[ocr-worker] REFUSING TO START: missing required environment "
            f"variables: {', '.join(missing)}. Both bearer tokens must be set — an "
            "unauthenticated OCR endpoint would let anyone spend this machine's cores "
            "and read whatever documents they can name a link to."
        )
        sys.exit(2)

    absent = [name for name, present in ocr_module.binaries_present().items() if not present]
    if absent:
        # Not fatal: a worker whose PATH is fixed by a mount should still come
        # up and say so on /healthz. But it is printed at the top of the log,
        # because the alternative is discovering it one failed job later.
        print(
            f"[ocr-worker] WARNING: {', '.join(absent)} not found on PATH. Every job "
            "will fail naming the missing program until this is fixed; /healthz reports "
            "it too."
        )

    os.makedirs(CONFIG["work_dir"], exist_ok=True)
    threading.Thread(target=worker_loop, daemon=True, name="ocr-pipeline").start()
    print(
        f"[ocr-worker] serving on :{CONFIG['port']} "
        f"(contract {', '.join(contract.SCHEMA_VERSIONS)}; up to "
        f"{CONFIG['max_pages']} pages per document; default languages "
        f"{'+'.join(CONFIG['default_languages'])})"
    )
    build_server().serve_forever()


if __name__ == "__main__":
    main()
