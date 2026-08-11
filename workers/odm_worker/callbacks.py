"""Deliver ProcessingCallbacks to the consumer's callbackUrl.

Bearer-authenticated with the shared callback token (the app's
OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN). Retries transient failures
with backoff; a 4xx is NOT retried — the consumer refused the delivery, and
re-sending identical bytes cannot change its mind (401 means the tokens do not
match, which is an operator problem worth a loud log line, not a retry loop).

Stdlib urllib so the callback path — the worker's one obligation after
accepting a job — has no dependency that could be missing at 2 a.m.
"""

import json
import time
import urllib.error
import urllib.request


def post_callback(
    callback_url,
    bearer_token,
    payload,
    attempts=3,
    backoff_seconds=2.0,
    timeout=30,
    opener=None,
    sleep=time.sleep,
):
    """POST one callback. Returns (ok, detail). `opener` is injectable for
    tests; it must behave like urllib.request.urlopen."""
    open_fn = opener or urllib.request.urlopen
    body = json.dumps(payload).encode("utf-8")
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
                "User-Agent": "openplan-odm-worker",
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
                    "check that the callback bearer tokens match on both sides"
                )
        except Exception as exc:  # noqa: BLE001 - network errors of any shape
            last_detail = str(exc)

        if attempt < attempts:
            sleep(backoff_seconds * attempt)

    return False, f"undelivered after {attempts} attempts: {last_detail}"
