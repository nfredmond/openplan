#!/usr/bin/env python3
"""The HTTP surface: authenticated, idempotent and contract-strict; and the
pipeline's own refusals, driven end to end with nothing installed.

What is pinned here:
  * no bearer (or the wrong one) starts nothing — 401 before any queueing;
  * a worker with NO configured token refuses with 503 rather than serving
    unauthenticated (the silent-open-endpoint failure mode);
  * a contract-invalid payload gets 422 with the violations listed;
  * the same requestId re-POSTed gets the SAME accepted answer (200), never a
    second job — the contract's idempotency rule;
  * a full queue answers 503 with the reason instead of accepting silently;
  * /healthz reports which programs the image actually has, so a misbuilt
    image is visible before a job is sent rather than after;
  * the succeeded callback the pipeline sends carries every page, and the
    pipeline REFUSES to send one that is over the consumer's declared ceiling
    (a 413 loop and a job stuck `running` forever is the alternative).

Run: python3 workers/ocr_worker/test_worker_http.py   (stdlib only — the
recogniser is stubbed; ocrmypdf is never contacted)
"""
import http.client
import json
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The server reads its config at import; set the environment FIRST.
os.environ["OPENPLAN_KB_OCR_WORKER_TOKEN"] = "worker-secret"
os.environ["OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN"] = "cb-secret"

import contract  # noqa: E402
import main  # noqa: E402

# No worker loop is started here, so the queue is the observable: a request
# that was accepted is a request sitting in JOB_QUEUE. Asserting on a stubbed
# PIPELINE list instead would pass vacuously when nothing ever drains the queue
# — a "did it run?" check that can only ever see zero.
main.PIPELINE = lambda job: None


def queued():
    return main.JOB_QUEUE.qsize()


def start_server():
    server = main.build_server(host="127.0.0.1", port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def request(port, method, path, body=None, token="worker-secret"):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    connection.request(method, path, body=json.dumps(body) if body else None, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    connection.close()
    try:
        payload = json.loads(raw) if raw else None
    except ValueError:
        payload = raw
    return response.status, payload


def ocr_request(request_id="11111111-1111-4111-8111-111111111111", **overrides):
    body = {
        "schemaVersion": "openplan-ocr-extraction.v1",
        "requestId": request_id,
        "callbackUrl": "https://openplan.example.com/api/knowledge-base/ocr-callback",
        "externalRef": {
            "system": "openplan",
            "documentId": "22222222-2222-4222-8222-222222222222",
            "workspaceId": "33333333-3333-4333-8333-333333333333",
        },
        "documentTitle": "2022 Regional Transportation Plan",
        "source": {"url": "https://storage.example.com/kb/plan.pdf?sig=a"},
        "languages": ["eng"],
    }
    body.update(overrides)
    return body


def check_http_surface(port):
    status, _ = request(port, "POST", "/api/v1/ocr-requests", ocr_request(), token=None)
    assert status == 401, status
    status, _ = request(port, "POST", "/api/v1/ocr-requests", ocr_request(), token="wrong")
    assert status == 401, status
    assert queued() == 0, "an unauthenticated request must queue nothing"
    print("  no bearer and a wrong bearer both get 401, and queue nothing")

    status, payload = request(port, "POST", "/api/v1/ocr-requests", {"schemaVersion": "nope"})
    assert status == 422, status
    assert payload["error"] == "contract_validation_failed"
    assert len(payload["issues"]) >= 4, payload["issues"]
    print("  a contract-invalid payload gets 422 with the violations listed")

    status, payload = request(port, "POST", "/api/v1/ocr-requests", ocr_request())
    assert status == 202, (status, payload)
    assert payload["status"] == "accepted"
    assert payload["schemaVersion"] == contract.SCHEMA_VERSION_V1
    assert queued() == 1
    first_reference = payload["jobReference"]

    status, repeat = request(port, "POST", "/api/v1/ocr-requests", ocr_request())
    assert status == 200, status
    assert repeat["jobReference"] == first_reference, "a retry must not start a second job"
    assert queued() == 1, "a retried requestId must queue nothing new"
    print("  a valid request is accepted once; the same requestId gets the same answer")

    status, payload = request(port, "GET", "/healthz")
    assert status == 200
    assert payload["contract"] == list(contract.SCHEMA_VERSIONS)
    assert set(payload["binaries"]) == {"ocrmypdf", "pdfinfo", "pdftotext"}
    assert payload["languagesProbe"] in ("read", "unavailable")
    print("  /healthz names the three programs the image needs and the language probe")

    status, _ = request(port, "POST", "/api/v1/nope", ocr_request())
    assert status == 404, status
    print("  an unknown path is 404")


def check_queue_full(port):
    original = main.CONFIG["max_queued"]
    main.CONFIG["max_queued"] = 0
    try:
        status, payload = request(
            port, "POST", "/api/v1/ocr-requests", ocr_request("99999999-9999-4999-8999-999999999999")
        )
        assert status == 503, status
        assert payload["error"] == "queue_full"
        assert "refuses to accept more" in payload["detail"]
    finally:
        main.CONFIG["max_queued"] = original
    print("  a full queue answers 503 with the reason, never a silent accept")


def check_unconfigured_worker_refuses_rather_than_serving_open():
    original = main.CONFIG["worker_token"]
    main.CONFIG["worker_token"] = ""
    try:
        server, port = start_server()
        try:
            status, payload = request(port, "POST", "/api/v1/ocr-requests", ocr_request())
            assert status == 503, status
            assert payload["error"] == "worker_not_configured"
            assert "OPENPLAN_KB_OCR_WORKER_TOKEN" in payload["detail"]
        finally:
            server.shutdown()
            server.server_close()
    finally:
        main.CONFIG["worker_token"] = original
    print("  a worker with no token refuses every request instead of serving open")


def run_pipeline(request_body, pages, page_count=None, sent=None):
    """Drive process_job with the intake and the recogniser both stubbed."""
    sent = sent if sent is not None else []
    job = {
        "request": request_body,
        "job_reference": "ocr-test",
        "accepted_callback": {},
        "state": "accepted",
    }

    def prepare(_source, work_dir, _max_bytes):
        return os.path.join(work_dir, "source.pdf")

    def recognize(_path, _work_dir, **_kwargs):
        return pages, page_count if page_count is not None else len(pages), "16.4.0"

    def send(_job, status, **kwargs):
        sent.append((status, kwargs))
        return True

    posted = []

    def post_callback(url, token, payload, **_kwargs):
        posted.append((url, token, payload))
        return True, "delivered (HTTP 200)"

    original_post = main.callbacks_module.post_callback
    main.callbacks_module.post_callback = post_callback
    try:
        main.process_job(job, prepare=prepare, recognize=recognize, send=send)
    finally:
        main.callbacks_module.post_callback = original_post
    return job, sent, posted


def check_pipeline_delivers_every_page():
    pages = [{"page": 1, "text": "Front matter"}, {"page": 2, "text": ""}, {"page": 3, "text": "p3"}]
    job, sent, posted = run_pipeline(ocr_request(), pages)

    assert job["state"] == "succeeded", (job["state"], sent)
    assert len(posted) == 1
    _url, token, payload = posted[0]
    assert token == "cb-secret"
    assert payload["status"] == "succeeded"
    assert payload["pageCount"] == 3
    assert [p["page"] for p in payload["pages"]] == [1, 2, 3]
    assert payload["pages"][1]["text"] == "", "the blank page must survive to the wire"
    assert payload["engine"]["pagesWithText"] == 2
    assert "2 of 3 pages produced text" in payload["message"]
    # The count is a count, never a grade.
    assert "confidence" not in json.dumps(payload).lower()
    print("  the succeeded callback carries every page, blank ones included")


def check_pipeline_refuses_to_send_over_the_consumer_ceiling():
    big = [{"page": 1, "text": "x" * 5000}]
    job, sent, posted = run_pipeline(ocr_request(maxCallbackBytes=2048), big)

    assert job["state"] == "failed", job["state"]
    assert posted == [], "nothing may be POSTed over the consumer's ceiling"
    failed = [kwargs for status, kwargs in sent if status == "failed"]
    assert failed, sent
    message = failed[0]["message"]
    assert "2048-byte ceiling" in message, message
    assert "OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES" in message, message
    print("  a payload over the consumer's ceiling fails with both numbers, never a 413 loop")


def check_pipeline_refuses_a_broken_page_sequence():
    broken = [{"page": 1, "text": "a"}, {"page": 3, "text": "c"}]
    job, sent, posted = run_pipeline(ocr_request(), broken, page_count=2)

    assert job["state"] == "failed", job["state"]
    assert posted == [], "a broken page sequence must never reach the wire"
    failed = [kwargs for status, kwargs in sent if status == "failed"]
    assert failed, sent
    assert "did not line up with the document's own page numbering" in failed[0]["message"]
    print("  a page sequence the invariant rejects fails the job instead of shipping")


def main_test():
    print("worker HTTP + pipeline checks:")
    server, port = start_server()
    try:
        check_http_surface(port)
        check_queue_full(port)
    finally:
        server.shutdown()
        server.server_close()
    check_unconfigured_worker_refuses_rather_than_serving_open()
    check_pipeline_delivers_every_page()
    check_pipeline_refuses_to_send_over_the_consumer_ceiling()
    check_pipeline_refuses_a_broken_page_sequence()
    print("all worker HTTP + pipeline checks passed")


if __name__ == "__main__":
    main_test()
