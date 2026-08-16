#!/usr/bin/env python3
"""
A MISSING CENSUS KEY MUST SAY SO, NOT CRASH TWO MINUTES LATER.

Run: python3 scripts/modeling/test_census_key_failure.py

WHERE THIS CAME FROM. On 2026-08-15 a county screening run was walked end to end for
the first time. Without a Census key it died after ~2.5 minutes of boundary downloads
with `JSONDecodeError: Expecting value: line 1 column 1` — no cause, no remedy.

The reason `raise_for_status()` did not catch it is the whole point of this file: the
Census Bureau does not answer a keyless request with an error status. It 302-redirects
to `missing_key.html` and serves that page with **HTTP 200**. Verified against the live
API that day, including the smallest possible query — keyless access is refused
outright, not rate-limited. The code was written when a key was optional, which the
Census API allowed once and allows nowhere now.

These checks use stubs, so they run offline and in CI. They prove the CLASSIFIER, not
the network. What no stub can prove is what the live API does today; that was
established by measurement and is recorded above and in the function's own comment.
"""
from __future__ import annotations

import screening_runtime as sr

CHECKS: list[str] = []


class FakeResponse:
    def __init__(self, url: str, text: str) -> None:
        self.url = url
        self.text = text


def check(label: str, condition: bool) -> None:
    CHECKS.append(f"{'ok  ' if condition else 'FAIL'} {label}")
    if not condition:
        raise AssertionError(label)


MISSING_KEY_HTML = "<html>\n<head><title>Missing Key</title></head>\n<body>...</body></html>"
REAL_ANSWER = '[["NAME","state"],["California","06"]]'


def main() -> int:
    # 1. The redirect the live API actually performs.
    #
    #    THE MUTATION THAT SURVIVED, and why this case is shaped the way it is. The
    #    first version fed the redirect URL together with the HTML body, so deleting
    #    the URL check entirely changed nothing: the HTML branch caught the same input
    #    and every assertion still passed. Two things fix it — assert the SPECIFIC
    #    message the URL branch produces, and offer the URL with a body that is not
    #    HTML so only that branch can answer.
    failure = sr.census_key_failure(
        FakeResponse("https://api.census.gov/data/missing_key.html", MISSING_KEY_HTML),
        MISSING_KEY_HTML,
    )
    check("a redirect to missing_key.html is caught", failure == sr.CENSUS_KEY_MISSING_MESSAGE)
    check(
        "the redirect is caught by the URL, not by the body happening to be HTML",
        sr.census_key_failure(FakeResponse("https://api.census.gov/data/missing_key.html", ""), "")
        == sr.CENSUS_KEY_MISSING_MESSAGE,
    )
    check("it names the free sign-up URL", sr.CENSUS_KEY_SIGNUP_URL in (failure or ""))
    check("it names the variable to set", "CENSUS_API_KEY" in (failure or ""))
    # The sentence a planner reads must not be a stack trace or a status code.
    check("it does not lead with jargon", not (failure or "").lstrip().startswith(("Traceback", "HTTP")))

    # 2. HTML from the data URL itself — an invalid or unactivated key lands here.
    failure_html = sr.census_key_failure(
        FakeResponse("https://api.census.gov/data/2022/acs/acs5?get=NAME", MISSING_KEY_HTML),
        MISSING_KEY_HTML,
    )
    check("HTML where JSON was promised is caught", failure_html is not None)
    check(
        "it mentions activation, because an unactivated key answers this way too",
        "activation" in (failure_html or "").lower(),
    )
    # WHO REFUSED. An earlier draft read "because OpenPlan rejected the key it was
    # given" — the opposite of what happened, and it would send a reader hunting for a
    # bug in OpenPlan instead of checking their key.
    saved_key = sr.CENSUS_API_KEY
    try:
        sr.CENSUS_API_KEY = "a-key-that-is-set"
        with_key = sr.census_key_failure(
            FakeResponse("https://api.census.gov/data/2022/acs/acs5", MISSING_KEY_HTML), MISSING_KEY_HTML
        )
        check("it blames the Census Bureau, not OpenPlan", "OpenPlan rejected" not in (with_key or ""))
        check("and says whose key was refused", "key OpenPlan sent" in (with_key or ""))
    finally:
        sr.CENSUS_API_KEY = saved_key

    # 3. THE NEGATIVE CONTROL. A classifier that flags everything protects nothing:
    #    a real answer must pass, or the fix breaks every working install.
    check(
        "a real JSON answer is NOT treated as a key failure",
        sr.census_key_failure(FakeResponse("https://api.census.gov/data/2022/acs/acs5", REAL_ANSWER), REAL_ANSWER)
        is None,
    )
    check(
        "leading whitespace does not hide a real answer",
        sr.census_key_failure(FakeResponse("https://api.census.gov/x", REAL_ANSWER), "\n  " + REAL_ANSWER) is None,
    )

    # 4. No key at all is answered before any request is made, so the failure arrives
    #    in the first second rather than after minutes of downloads.
    #    THE SECOND MUTATION THAT SURVIVED. This block first asserted "no network
    #    call" by checking the message did not mention reaching the API — which is
    #    not a detector at all. With the unset-key guard deleted, preflight fell
    #    through to a real request, the live API refused it, the same class of error
    #    came back, and every assertion still passed. The stub below is the detector:
    #    if anything calls requests.get, the test fails on the spot.
    saved_key = sr.CENSUS_API_KEY
    saved_get = sr.requests.get
    called: list[str] = []

    def forbidden_get(*args, **kwargs):
        called.append(str(args[:1]))
        raise AssertionError("preflight made a network call for an unset key")

    try:
        sr.CENSUS_API_KEY = ""
        sr.requests.get = forbidden_get
        raised = None
        try:
            sr.preflight_census_access()
        except sr.ConfigurationError as exc:
            raised = str(exc)
        check("an unset key fails preflight", raised is not None)
        check("without making any network call", called == [])
        check("and says what to do about it", sr.CENSUS_KEY_SIGNUP_URL in (raised or ""))
        check("as a ConfigurationError, so the CLI prints it as a sentence", raised is not None)
    finally:
        sr.requests.get = saved_get
        sr.CENSUS_API_KEY = saved_key

    print("\n".join(CHECKS))
    print(f"\n{len(CHECKS)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
