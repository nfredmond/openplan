#!/usr/bin/env python3
"""Callback delivery: retry what can succeed, stop on what cannot.

Run: python3 workers/ocr_worker/test_callbacks.py   (stdlib only)
"""
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

    def __exit__(self, *_exc):
        return False


def opener_sequence(outcomes, seen=None):
    """Each call pops one outcome: an int status, or an exception to raise."""
    queue = list(outcomes)

    def opener(request, timeout=None):
        if seen is not None:
            seen.append(request)
        outcome = queue.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(outcome)

    return opener


def main():
    print("callback checks:")
    payload = {"schemaVersion": "openplan-ocr-extraction.v1", "status": "succeeded"}

    seen = []
    ok, detail = callbacks.post_callback(
        "https://app.example.com/api/knowledge-base/ocr-callback",
        "shared-secret",
        payload,
        opener=opener_sequence([202], seen),
        sleep=lambda _s: None,
    )
    assert ok, detail
    request = seen[0]
    assert request.get_header("Authorization") == "Bearer shared-secret"
    assert request.get_header("Content-type") == "application/json"
    assert json.loads(request.data.decode()) == payload
    print("  a delivered callback carries the bearer token and the exact payload")

    ok, detail = callbacks.post_callback(
        "https://app.example.com/cb",
        "t",
        payload,
        opener=opener_sequence([urllib.error.URLError("connection refused"), 500, 200]),
        sleep=lambda _s: None,
    )
    assert ok, detail
    print("  a network error and a 500 are retried; the third attempt lands")

    slept = []
    ok, detail = callbacks.post_callback(
        "https://app.example.com/cb",
        "wrong-token",
        payload,
        opener=opener_sequence([urllib.error.HTTPError("u", 401, "Unauthorized", {}, None)]),
        sleep=slept.append,
    )
    assert not ok
    assert "not retrying" in detail and "tokens match" in detail, detail
    assert slept == [], "a 4xx must not sleep between retries it is not making"
    print("  a 401 stops immediately and says the tokens do not match")

    ok, detail = callbacks.post_callback(
        "https://app.example.com/cb",
        "t",
        payload,
        opener=opener_sequence([urllib.error.HTTPError("u", 413, "Too Large", {}, None)]),
        sleep=lambda _s: None,
    )
    assert not ok
    assert "size ceiling" in detail, detail
    print("  a 413 stops immediately and points at the size ceiling")

    ok, detail = callbacks.post_callback(
        "https://app.example.com/cb",
        "t",
        payload,
        attempts=2,
        opener=opener_sequence([500, 503]),
        sleep=lambda _s: None,
    )
    assert not ok
    assert "undelivered after 2 attempts" in detail, detail
    print("  an exhausted retry budget reports how many attempts were made")

    body, length = callbacks.encode_payload({"pages": [{"page": 1, "text": "x" * 100}]})
    assert length == len(body) and length > 100
    assert callbacks.encode_payload(payload)[0] == json.dumps(payload).encode()
    print("  encode_payload measures the bytes the POST would actually send")

    print("all callback checks passed")


if __name__ == "__main__":
    main()
