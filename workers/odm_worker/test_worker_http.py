#!/usr/bin/env python3
"""The HTTP surface: authenticated, idempotent, contract-strict, and its
artifact links are unguessable and expire.

What is pinned here:
  * no bearer (or the wrong one) starts nothing — 401 before any queueing;
  * a worker with NO configured token refuses with 503 rather than serving
    unauthenticated (the silent-open-endpoint failure mode);
  * a contract-invalid payload gets 422 with the violations listed;
  * BOTH imagery shapes are accepted: an external-worker-shaped v1 zip request
    and a v1.1 photo manifest — the accepted callback echoes each version;
  * the same requestId re-POSTed gets the SAME accepted answer (200), never a
    second job — the contract's idempotency rule;
  * a full queue answers 503 with the reason instead of accepting silently;
  * artifact URLs serve only with the exact token, and answer 410 (not an
    empty 200) once expired.

Run: python3 workers/odm_worker/test_worker_http.py   (stdlib only — the
pipeline is stubbed; NodeODM is never contacted)
"""
import http.client
import json
import os
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The server reads its config at import; set the environment FIRST.
os.environ["OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN"] = "worker-secret"
os.environ["OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN"] = "cb-secret"

import main  # noqa: E402

PROCESSED = []
main.PIPELINE = PROCESSED.append  # observe scheduling; run nothing


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


def zip_request(request_id):
    return {
        "schemaVersion": "natford-aerial-processing.v1",
        "requestId": request_id,
        "callbackUrl": "https://openplan.example.com/api/aerial/processing-callback",
        "externalRef": {"system": "openplan", "missionId": "m-1", "workspaceId": "w-1"},
        "missionTitle": "Corridor survey",
        "imagery": {"type": "zip_url", "url": "https://storage.example.com/imagery.zip"},
        "presetId": "balanced",
    }


def manifest_request(request_id):
    return {
        "schemaVersion": "natford-aerial-processing.v1.1",
        "requestId": request_id,
        "callbackUrl": "https://openplan.example.com/api/aerial/processing-callback",
        "externalRef": {"system": "openplan", "missionId": "m-1", "workspaceId": "w-1"},
        "missionTitle": "Corridor survey",
        "imagery": {
            "type": "photo_manifest",
            "photos": [{"url": "https://storage.example.com/p/a.jpg", "filename": "a.jpg"}],
            "imageCount": 1,
        },
    }


def check_auth(port):
    status, _ = request(port, "POST", "/api/v1/processing-requests",
                        zip_request("req-auth-0001"), token=None)
    assert status == 401, f"no bearer must be 401, got {status}"
    status, _ = request(port, "POST", "/api/v1/processing-requests",
                        zip_request("req-auth-0001"), token="wrong")
    assert status == 401
    assert not PROCESSED, "an unauthenticated caller must start nothing"
    print("  missing/wrong bearer: 401, nothing queued")


def check_unconfigured_token_refuses(port):
    real = main.CONFIG["worker_token"]
    main.CONFIG["worker_token"] = ""
    try:
        status, payload = request(port, "POST", "/api/v1/processing-requests",
                                  zip_request("req-cfg-0001"))
        assert status == 503, status
        assert "OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN" in payload["detail"]
    finally:
        main.CONFIG["worker_token"] = real
    print("  an unconfigured worker refuses (503) rather than serving open")


def check_contract_validation(port):
    bad = zip_request("req-bad-00001")
    bad["schemaVersion"] = "natford-aerial-processing.v1.1"  # zip must declare v1
    status, payload = request(port, "POST", "/api/v1/processing-requests", bad)
    assert status == 422, status
    assert any("versioning rule" in issue for issue in payload["issues"])
    assert not PROCESSED
    print("  a contract violation answers 422 with the violations listed")


def check_both_shapes_accepted_and_versions_echoed(port):
    status, accepted = request(port, "POST", "/api/v1/processing-requests",
                               zip_request("req-zip-00001"))
    assert status == 202, (status, accepted)
    assert accepted["status"] == "accepted"
    assert accepted["schemaVersion"] == "natford-aerial-processing.v1"
    assert accepted["requestId"] == "req-zip-00001"
    assert len(accepted["callbackId"]) >= 8 and accepted["jobReference"]

    status, accepted_manifest = request(port, "POST", "/api/v1/processing-requests",
                                        manifest_request("req-man-00001"))
    assert status == 202
    assert accepted_manifest["schemaVersion"] == "natford-aerial-processing.v1.1", (
        "the accepted callback must ECHO the request's version"
    )
    print("  both imagery shapes accepted; the callback echoes each version")


def check_idempotency(port):
    status, first = request(port, "POST", "/api/v1/processing-requests",
                            zip_request("req-idem-0001"))
    assert status == 202
    status, second = request(port, "POST", "/api/v1/processing-requests",
                             zip_request("req-idem-0001"))
    assert status == 200, "a retried requestId is answered, not re-created"
    assert second == first, "the retry must get the SAME accepted callback"
    same_id_jobs = [j for j in PROCESSED if j["request"]["requestId"] == "req-idem-0001"]
    assert len(same_id_jobs) <= 1, "a retried requestId must not queue a second job"
    print("  a retried requestId gets the same answer and no second job")


def check_queue_full(port):
    real = main.CONFIG["max_queued"]
    main.CONFIG["max_queued"] = 0
    try:
        status, payload = request(port, "POST", "/api/v1/processing-requests",
                                  zip_request("req-full-0001"))
        assert status == 503, status
        assert payload["error"] == "queue_full"
    finally:
        main.CONFIG["max_queued"] = real
    print("  a full queue refuses with the reason instead of accepting silently")


def check_artifact_links(port):
    staged = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    staged.write(b"png-bytes")
    staged.close()
    token, _iso = main.publish_artifacts("job-art-1", {"orthophoto.png": staged.name},
                                         ttl_seconds=3600)

    status, body = request(port, "GET", f"/artifacts/job-art-1/{token}/orthophoto.png")
    assert status == 200 and body == b"png-bytes", (status, body)

    status, _ = request(port, "GET", "/artifacts/job-art-1/wrong-token/orthophoto.png")
    assert status == 404, "a wrong token must read as no-such-artifact"

    expired_token, _ = main.publish_artifacts("job-art-2", {"orthophoto.png": staged.name},
                                              ttl_seconds=-1)
    status, payload = request(port, "GET",
                              f"/artifacts/job-art-2/{expired_token}/orthophoto.png")
    assert status == 410, "an expired link must say expired, not pretend absence"
    assert payload["error"] == "artifact_link_expired"
    os.unlink(staged.name)
    print("  artifact links: exact token only, 410 once expired")


def check_healthz_is_honest_about_nodeodm(port):
    # NODEODM_URL points at the compose default, which is not running here —
    # health must say the PROCESS is up and NodeODM is not reachable, never
    # collapse the two into one bit.
    status, payload = request(port, "GET", "/healthz", token=None)
    assert status == 200
    assert payload["status"] == "ok"
    assert payload["nodeodm"]["reachable"] is False
    assert payload["nodeodm"]["detail"], "the unreachability must carry a detail"
    print("  healthz separates 'process up' from 'NodeODM reachable'")


def main_check():
    print("worker http checks:")
    server, port = start_server()
    try:
        check_auth(port)
        check_unconfigured_token_refuses(port)
        check_contract_validation(port)
        check_both_shapes_accepted_and_versions_echoed(port)
        check_idempotency(port)
        check_queue_full(port)
        check_artifact_links(port)
        check_healthz_is_honest_about_nodeodm(port)
    finally:
        server.shutdown()
    print("all worker http checks passed")


if __name__ == "__main__":
    main_check()
