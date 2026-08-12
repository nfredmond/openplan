"""Deliver OcrCallbacks to the consumer's callbackUrl.

Bearer-authenticated with the shared callback token (the app's
OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN). Retries transient failures with
backoff; a 4xx is NOT retried — the consumer refused the delivery, and
re-sending identical bytes cannot change its mind (401 means the tokens do not
match, which is an operator problem worth a loud log line, not a retry loop;
413 means the payload is over the consumer's ceiling, which re-sending cannot
shrink).

Stdlib urllib so the callback path — the worker's one obligation after
accepting a job — has no dependency that could be missing at 2 a.m. This module
is the odm_worker's callbacks.py with the token's name changed; kept as a
sibling copy on purpose, because the two workers are deployed independently and
a shared module would make one worker's image depend on the other's directory.
"""

import json
import time
import urllib.error
import urllib.request


def encode_payload(payload):
    """Serialize a callback and return (bytes, length). Separate from the POST
    so the pipeline can MEASURE a payload against the consumer's declared
    ceiling before committing to send it."""
    body = json.dumps(payload).encode("utf-8")
    return body, len(body)


def post_callback(
    callback_url,
    bearer_token,
    payload,
    attempts=3,
    backoff_seconds=2.0,
    timeout=120,
    opener=None,
    sleep=time.sleep,
):
    """POST one callback. Returns (ok, detail). `opener` is injectable for
    tests; it must behave like urllib.request.urlopen."""
    open_fn = opener or urllib.request.urlopen
    body, _length = encode_payload(payload)
    last_detail = "not attempted"

    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            callback_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {bearer_token}",
                "User-Agent": "openplan-ocr-worker",
            },
        )
        try:
            with open_fn(request, timeout=timeout) as response:
                status = getattr(response, "status", 200)
                if 200 <= status < 300:
                    return True, f"delivered (HTTP {status})"
                last_detail = f"HTTP {status}"
        except urllib.error.HTTPError as exc:
            last_detail = f"HTTP {exc.code}"
            if 400 <= exc.code < 500:
                return False, (
                    f"the consumer refused the callback ({last_detail}); not retrying — "
                    "check that the callback bearer tokens match on both sides, and "
                    "that the payload is within the consumer's size ceiling"
                )
        except Exception as exc:  # noqa: BLE001 - network errors of any shape
            last_detail = str(exc)

        if attempt < attempts:
            sleep(backoff_seconds * attempt)

    return False, f"undelivered after {attempts} attempts: {last_detail}"
