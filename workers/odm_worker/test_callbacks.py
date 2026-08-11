#!/usr/bin/env python3
"""Callback delivery: authenticated, retried on transient failure, and never
retried against a consumer that REFUSED the delivery.

The callback trail is the worker's only obligation after accepting a job — a
silently dropped callback is a job OpenPlan believes is still running. So a
5xx or connection error is retried with backoff, while a 4xx (the consumer
said no — almost always mismatched bearer tokens) stops immediately with a
message that names the token pair, because retrying identical bytes cannot
change the consumer's mind.

Run: python3 workers/odm_worker/test_callbacks.py   (stdlib only — the opener
is injected, no socket is used)
"""
import io
import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import callbacks


class FakeResponse:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    """Records every request; answers from a scripted list of responses
    (an int status, or an exception instance to raise)."""

    def __init__(self, script):
        self.script = list(script)
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return FakeResponse(step)


PAYLOAD = {
    "schemaVersion": "natford-aerial-processing.v1.1",
    "requestId": "req-00000001",
    "callbackId": "odm-abcdef1234",
    "jobReference": "job-1",
    "status": "running",
    "occurredAt": "2026-08-11T12:00:00Z",
}


def check_delivery_carries_bearer_and_json():
    opener = FakeOpener([200])
    ok, detail = callbacks.post_callback(
        "https://openplan.example.com/api/aerial/processing-callback",
        "cb-secret",
        PAYLOAD,
        opener=opener,
        sleep=lambda _s: None,
    )
    assert ok, detail
    request = opener.requests[0]
    assert request.get_header("Authorization") == "Bearer cb-secret"
    assert json.loads(request.data.decode("utf-8")) == PAYLOAD
    assert request.get_header("Content-type") == "application/json"
    print("  delivery carries the bearer token and the exact payload")


def check_transient_failures_are_retried():
    slept = []
    opener = FakeOpener([ConnectionError("refused"), 502, 200])
    ok, detail = callbacks.post_callback(
        "https://openplan.example.com/cb",
        "cb-secret",
        PAYLOAD,
        attempts=3,
        opener=opener,
        sleep=slept.append,
    )
    assert ok, detail
    assert len(opener.requests) == 3, "two failures then success = three attempts"
    assert len(slept) == 2 and slept[1] > slept[0], "backoff must grow between attempts"
    print("  connection errors and 5xx are retried with growing backoff")


def check_exhausted_retries_report_the_last_cause():
    opener = FakeOpener([500, 500, 500])
    ok, detail = callbacks.post_callback(
        "https://openplan.example.com/cb", "cb-secret", PAYLOAD,
        attempts=3, opener=opener, sleep=lambda _s: None,
    )
    assert not ok
    assert "3 attempts" in detail and "500" in detail, detail
    print("  exhausted retries say how many attempts and the last cause")


def check_a_refusal_is_not_retried():
    refusal = urllib.error.HTTPError(
        "https://openplan.example.com/cb", 401, "Unauthorized", {}, io.BytesIO(b"")
    )
    opener = FakeOpener([refusal, 200])  # the 200 must never be reached
    ok, detail = callbacks.post_callback(
        "https://openplan.example.com/cb", "wrong-secret", PAYLOAD,
        attempts=3, opener=opener, sleep=lambda _s: None,
    )
    assert not ok
    assert len(opener.requests) == 1, "a 4xx must stop delivery immediately"
    assert "tokens match" in detail, f"the detail must point at the token pair: {detail}"
    print("  a 4xx refusal stops immediately and names the token pair")


def main():
    print("callback checks:")
    check_delivery_carries_bearer_and_json()
    check_transient_failures_are_retried()
    check_exhausted_retries_report_the_last_cause()
    check_a_refusal_is_not_retried()
    print("all callback checks passed")


if __name__ == "__main__":
    main()
