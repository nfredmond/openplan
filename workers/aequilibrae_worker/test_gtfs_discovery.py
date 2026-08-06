#!/usr/bin/env python3
"""Checks for dynamic per-place GTFS discovery (keyless MobilityDB catalog).
Pure selection logic — no network. Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_gtfs_discovery.py
"""
import os
import sys

import gtfs_skim

# Davis, CA study bbox (min_lon, min_lat, max_lon, max_lat).
DAVIS_BBOX = (-121.80, 38.53, -121.68, 38.58)


def _row(data_type, min_lon, min_lat, max_lon, max_lat, latest="", dd="",
         status="", source_id="", redirect_id=""):
    return {
        "data_type": data_type,
        "status": status,
        "mdb_source_id": source_id,
        "redirect.id": redirect_id,
        "urls.latest": latest,
        "urls.direct_download": dd,
        "location.bounding_box.minimum_latitude": str(min_lat),
        "location.bounding_box.maximum_latitude": str(max_lat),
        "location.bounding_box.minimum_longitude": str(min_lon),
        "location.bounding_box.maximum_longitude": str(max_lon),
    }


CATALOG = [
    # A small local Davis-area GTFS feed that covers the study area.
    _row("gtfs", -121.85, 38.50, -121.60, 38.62, latest="http://mdb/latest/davis.zip", dd="http://prod/davis.zip"),
    # A statewide CA feed that also covers — larger bbox, should NOT be preferred.
    _row("gtfs", -124.5, 32.5, -114.0, 42.0, latest="http://mdb/latest/ca-statewide.zip"),
    # A GTFS feed far away (NYC) — must be excluded (no bbox overlap).
    _row("gtfs", -74.3, 40.4, -73.7, 40.9, latest="http://mdb/latest/nyc.zip"),
    # A GBFS (bikeshare) feed covering the area — must be excluded (not gtfs).
    _row("gbfs", -121.85, 38.50, -121.60, 38.62, latest="http://mdb/latest/bikeshare.zip"),
]


def test_selects_smallest_covering_gtfs_feed_and_prefers_latest():
    url = gtfs_skim.select_feed_from_catalog(CATALOG, DAVIS_BBOX)
    # Smallest covering GTFS feed = the local Davis feed; its urls.latest wins
    # over both the statewide feed and its own direct_download.
    assert url == "http://mdb/latest/davis.zip", f"expected local Davis latest url, got {url!r}"


def test_falls_back_to_direct_download_when_no_latest():
    rows = [_row("gtfs", -121.85, 38.50, -121.60, 38.62, latest="", dd="http://prod/only-dd.zip")]
    url = gtfs_skim.select_feed_from_catalog(rows, DAVIS_BBOX)
    assert url == "http://prod/only-dd.zip", f"expected direct_download fallback, got {url!r}"


def test_returns_none_when_nothing_covers():
    # Middle of the Pacific — no feed covers.
    url = gtfs_skim.select_feed_from_catalog(CATALOG, (-140.0, 10.0, -139.0, 11.0))
    assert url is None, f"expected None for uncovered bbox, got {url!r}"


def test_excludes_non_gtfs_and_non_overlapping():
    # Only the GBFS + NYC rows (both must be excluded) → None.
    rows = [CATALOG[2], CATALOG[3]]
    url = gtfs_skim.select_feed_from_catalog(rows, DAVIS_BBOX)
    assert url is None, f"expected None (gbfs + non-overlapping excluded), got {url!r}"


def test_rejects_corrupt_worldwide_bbox_and_non_us():
    corrupt = _row("gtfs", -170.0, -89.9, 179.9, 69.5, latest="http://mdb/latest/corrupt.zip")  # spans the globe
    foreign = {
        **_row("gtfs", -121.85, 38.50, -121.60, 38.62, latest="http://mdb/latest/foreign.zip"),
        "location.country_code": "DE",  # non-US
    }
    url = gtfs_skim.select_feed_from_catalog([corrupt, foreign], DAVIS_BBOX)
    assert url is None, f"expected None (corrupt bbox + non-US both excluded), got {url!r}"


def test_a_blank_status_is_usable_because_most_real_rows_have_one():
    """The deny-list direction, measured: only 54 of 1,177 US rows in the live
    catalog say `active` while 770 are BLANK. An allow-list on "active" would
    discard 93.5% of the usable US feeds — including real published ones like
    Roseville and Yolobus, which simply do not set the column."""
    rows = [_row("gtfs", -121.85, 38.50, -121.60, 38.62,
                 latest="http://mdb/latest/blank-status.zip", status="", source_id="1")]
    url = gtfs_skim.select_feed_from_catalog(rows, DAVIS_BBOX)
    assert url == "http://mdb/latest/blank-status.zip", f"a blank status must be usable, got {url!r}"


def test_a_withdrawn_feed_is_not_selected_over_a_live_one():
    """THE DEFECT THIS FIXES, and it had a mechanism rather than being bad luck.
    Selection prefers the SMALLEST bbox, which is exactly the shape of a
    superseded single-agency row: when a feed is replaced the old narrow entry
    stays in the catalog marked `deprecated` beside its broader replacement, so
    "smallest wins" actively SELECTS FOR the dead one. 344 of 1,177 US rows
    (29.3%) are deprecated or inactive."""
    dead = _row("gtfs", -121.82, 38.52, -121.70, 38.59,   # SMALLER — would win on area
                latest="http://mdb/latest/dead.zip", status="deprecated", source_id="10")
    live = _row("gtfs", -121.85, 38.50, -121.60, 38.62,
                latest="http://mdb/latest/live.zip", status="", source_id="11")
    url = gtfs_skim.select_feed_from_catalog([dead, live], DAVIS_BBOX)
    assert url == "http://mdb/latest/live.zip", f"a deprecated feed must not outrank a live one, got {url!r}"


def test_an_inactive_feed_is_excluded_too():
    rows = [_row("gtfs", -121.85, 38.50, -121.60, 38.62,
                 latest="http://mdb/latest/inactive.zip", status="inactive", source_id="12")]
    url = gtfs_skim.select_feed_from_catalog(rows, DAVIS_BBOX)
    assert url is None, f"an inactive feed must not be selected, got {url!r}"


def test_a_withdrawn_feed_resolves_to_its_replacement():
    """Following `redirect.id` is how a study area whose only local feed was
    replaced still gets an answer instead of a false `no_covering_feed`."""
    dead = _row("gtfs", -121.82, 38.52, -121.70, 38.59, latest="http://mdb/latest/old.zip",
                status="deprecated", source_id="20", redirect_id="21")
    successor = _row("gtfs", -124.5, 32.5, -114.0, 42.0, latest="http://mdb/latest/new.zip",
                     status="active", source_id="21")
    url = gtfs_skim.select_feed_from_catalog([dead, successor], DAVIS_BBOX)
    assert url == "http://mdb/latest/new.zip", f"expected the successor's url, got {url!r}"


def test_a_redirect_to_a_missing_row_is_dropped_rather_than_followed_into_nothing():
    """41 of 244 US redirect targets are not in the catalog at all."""
    dead = _row("gtfs", -121.85, 38.50, -121.60, 38.62, latest="http://mdb/latest/old.zip",
                status="deprecated", source_id="30", redirect_id="99999")
    url = gtfs_skim.select_feed_from_catalog([dead], DAVIS_BBOX)
    assert url is None, f"a dead pointer must not select anything, got {url!r}"


def test_a_redirect_cycle_terminates_instead_of_hanging():
    a = _row("gtfs", -121.85, 38.50, -121.60, 38.62, latest="http://mdb/latest/a.zip",
             status="deprecated", source_id="40", redirect_id="41")
    b = _row("gtfs", -121.85, 38.50, -121.60, 38.62, latest="http://mdb/latest/b.zip",
             status="deprecated", source_id="41", redirect_id="40")
    url = gtfs_skim.select_feed_from_catalog([a, b], DAVIS_BBOX)
    assert url is None, f"a redirect cycle must terminate with no selection, got {url!r}"


def test_a_us_country_code_with_a_trailing_space_is_still_the_united_states():
    """Four live US rows carry `country_code` as 'US ' with a trailing space
    (City of Miami Beach, City of Miami Gardens, Bustang Outrider, Pahto Public
    Passage). The comparison strips, so they are not silently dropped."""
    row = {**_row("gtfs", -121.85, 38.50, -121.60, 38.62,
                  latest="http://mdb/latest/spaced.zip", source_id="50"),
           "location.country_code": "US "}
    url = gtfs_skim.select_feed_from_catalog([row], DAVIS_BBOX)
    assert url == "http://mdb/latest/spaced.zip", f"'US ' must read as US, got {url!r}"


def test_the_catalog_address_is_pinned_and_is_not_a_shortlink():
    """A shortlink is a third party who can silently repoint every deployment's
    feed catalog, and the first thing a deployment does with the result is fetch
    the URLs in it."""
    url = gtfs_skim._MDB_CATALOG_URL
    assert "bit.ly" not in url, f"the catalog address must not be a shortlink: {url!r}"
    assert url.startswith("https://storage.googleapis.com/"), f"unexpected catalog address: {url!r}"


def _with_catalog(loader):
    """Swap gtfs_skim's catalog loader for the duration of one check (no network)."""
    original = gtfs_skim._load_catalog
    gtfs_skim._load_catalog = loader
    try:
        return gtfs_skim.discover_feed(DAVIS_BBOX)
    finally:
        gtfs_skim._load_catalog = original


def test_an_answered_catalog_with_nothing_nearby_is_reported_as_a_coverage_fact():
    result = _with_catalog(lambda: [CATALOG[2]])  # only the far-away NYC feed
    assert result.url is None
    assert result.reason == "no_covering_feed", result.reason


def test_an_unreachable_catalog_is_reported_as_unknown_not_as_no_service():
    # The failure this prevents: a download error rendering as "no transit feed
    # covers this study area", which is a coverage claim nobody ever checked —
    # and which would then sit underneath a VMT number a planner has to defend.
    def _boom():
        raise gtfs_skim.GtfsError("MobilityDB catalog download failed: HTTP 503")

    result = _with_catalog(_boom)
    assert result.url is None
    assert result.reason == "catalog_unavailable", result.reason
    assert "503" in (result.detail or ""), "the real failure must survive to the caller"


def test_a_covering_catalog_returns_the_selected_feed():
    result = _with_catalog(lambda: CATALOG)
    assert result.reason == "selected", result.reason
    assert result.url == "http://mdb/latest/davis.zip", result.url


def test_a_run_looks_for_a_local_feed_unless_the_operator_stops_it():
    # The regression this pins: the flag defaulted to OFF and NOTHING set it, so
    # every study area outside the one bundled county reported a transit share of
    # exactly 0 — which OVERSTATES auto and INFLATES the screening VMT a planner
    # defends. Unset must mean "go look".
    assert gtfs_skim.discovery_enabled(None) is True, "discovery must run when GTFS_DISCOVER is unset"
    for off in ("0", "false", "False", "FALSE", "no", "off", "  0  "):
        assert gtfs_skim.discovery_enabled(off) is False, f"{off!r} must switch discovery off"
    for on in ("1", "true", "True", "yes"):
        assert gtfs_skim.discovery_enabled(on) is True, f"{on!r} must leave discovery on"


def test_an_empty_value_is_read_as_unset_rather_than_as_an_operator_choosing_off():
    # Several hosting platforms materialize a variable nobody defined as an empty
    # string. Reading that as "off" would silently reinstate the very defect the
    # on-by-default flip fixed — every study area outside the bundled county back
    # to a 0 transit share and an inflated VMT — and the evidence panel would
    # present it as a deliberate operator decision nobody actually made.
    for blank in ("", " ", "\t", "\n  "):
        assert gtfs_skim.discovery_enabled(blank) is True, (
            f"{blank!r} is an unset variable, not an operator switching discovery off"
        )


def test_an_unreachable_catalog_still_tries_the_bundled_feed():
    # The capability regression this pins: turning discovery on removed transit
    # from the ONE area that had it. When the catalog cannot be reached the worker
    # stopped loading any feed at all, so an offline or network-blocked deployment
    # lost the bundled feed's own area and gained nothing anywhere else. Falling
    # back is safe in ANY study area by construction — feed_covers() rejects a feed
    # whose stops are elsewhere — so the fallback can only add coverage.
    unreachable = gtfs_skim.FeedDiscovery(None, "catalog_unavailable", "HTTP 503")
    plan = gtfs_skim.plan_feed(unreachable, discovering=True)
    assert plan.load is True, "an unreachable catalog must not cost a run its bundled feed"
    assert plan.url is None, "the fallback is the bundled feed, not some other place's URL"
    assert plan.fallback_after_catalog_failure is True


def test_the_bundled_fallback_does_not_read_as_a_successful_discovery():
    # A fallback that looks like a discovery hit is worse than the regression: it
    # lets a planner believe the catalog was consulted for their area when it never
    # answered. The origin must name the fallback, and the catalog failure must
    # survive onto the run even though a feed was ultimately loaded.
    plan = gtfs_skim.plan_feed(
        gtfs_skim.FeedDiscovery(None, "catalog_unavailable", "HTTP 503"), discovering=True
    )
    assert plan.origin == "bundled_after_catalog_unavailable", plan.origin
    assert plan.origin != "discovered_catalog"
    assert plan.discovery_error == "HTTP 503", plan.discovery_error


def test_an_answered_catalog_with_no_covering_feed_does_not_reach_for_the_bundled_feed():
    # The asymmetry that matters: a catalog that ANSWERED and listed nothing is a
    # checked coverage fact, so the run says so. Reaching for a single-county
    # bundled feed in an arbitrary place would only invite a coverage miss dressed
    # up as an answer.
    plan = gtfs_skim.plan_feed(gtfs_skim.FeedDiscovery(None, "no_covering_feed"), discovering=True)
    assert plan.load is False
    assert plan.status == "no_local_feed", plan.status
    assert plan.no_feed_reason == "discovery_found_no_covering_feed", plan.no_feed_reason
    assert plan.fallback_after_catalog_failure is False


def test_an_operator_named_feed_outranks_discovery_and_the_bundled_fallback():
    selected = gtfs_skim.FeedDiscovery("http://mdb/latest/davis.zip", "selected")
    assert gtfs_skim.plan_feed(selected, discovering=True).origin == "discovered_catalog"
    # The precedence this test is named for, asserted rather than assumed: an
    # operator who pinned a feed must keep it even if a caller also discovered
    # one. main.py never does both today, so only this check stops the order in
    # plan_feed from drifting away from what its docstring promises.
    assert (
        gtfs_skim.plan_feed(selected, discovering=True, env_url="http://agency/gtfs.zip").origin
        == "operator_url"
    )
    assert (
        gtfs_skim.plan_feed(selected, discovering=True, env_path="/feeds/agency.zip").origin
        == "operator_path"
    )
    # discovering=False is what an explicit GTFS_URL/GTFS_PATH produces in main.py.
    url_plan = gtfs_skim.plan_feed(None, discovering=False, env_url="http://agency/gtfs.zip")
    assert url_plan.origin == "operator_url" and url_plan.load is True
    assert url_plan.url is None, "load_feed resolves the operator's env var itself"
    path_plan = gtfs_skim.plan_feed(None, discovering=False, env_path="/feeds/agency.zip")
    assert path_plan.origin == "operator_path" and path_plan.load is True
    # Discovery switched off with no operator feed: the bundled feed, named as such.
    off_plan = gtfs_skim.plan_feed(None, discovering=False)
    assert off_plan.origin == "bundled_default" and off_plan.load is True
    assert off_plan.fallback_after_catalog_failure is False


def test_a_missing_discovery_result_is_an_unknown_not_a_coverage_fact():
    # Defensive: a caller that says it discovered but hands over no result has told
    # us nothing about the area. That is the same state as an unreachable catalog,
    # and must never collapse into "no feed covers this area".
    plan = gtfs_skim.plan_feed(None, discovering=True)
    assert plan.load is True and plan.fallback_after_catalog_failure is True
    assert plan.status != "no_local_feed"


def test_the_worker_takes_its_discovery_default_and_feed_plan_from_gtfs_skim():
    # A text check rather than an import: main.py pulls in aequilibrae/pandas/
    # shapely, which this stdlib suite deliberately does not require. What must
    # hold is that the worker has exactly ONE documented place where each of these
    # decisions lives, so neither can quietly regress inside a file no test can
    # import — which is how the off-by-default literal survived in the first place.
    main_src = open(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py"), encoding="utf-8"
    ).read()
    assert "GTFS_DISCOVER = gtfs_skim.discovery_enabled(" in main_src, (
        "main.py must resolve GTFS_DISCOVER through gtfs_skim.discovery_enabled"
    )
    assert 'os.getenv("GTFS_DISCOVER", "0")' not in main_src, (
        "the off-by-default literal is back in main.py"
    )
    assert "gtfs_skim.plan_feed(" in main_src, (
        "main.py must choose its feed through gtfs_skim.plan_feed, not inline branching"
    )


def test_no_env_switch_in_the_worker_reads_an_empty_value_as_a_deliberate_off():
    # The same defect GTFS_DISCOVER had, generalised so it cannot reappear on the
    # next switch: several hosting platforms materialize a variable nobody defined
    # as an empty string. A default-ON capability whose off-list contains "" —
    # or whose on-list is an allow-list that "" simply fails — turns a deployment
    # that made no choice at all into one that silently dropped the capability,
    # and the evidence panel then presents it as an operator's decision.
    # Empty means UNSET; only an explicit falsy word may switch something off.
    import re

    main_src = open(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py"), encoding="utf-8"
    ).read()
    offenders = []
    for lineno, line in enumerate(main_src.splitlines(), start=1):
        if "os.getenv(" not in line:
            continue
        match = re.search(r"(?:not )?in \(([^)]*)\)", line)
        if not match:
            continue
        values = [v.strip() for v in match.group(1).split(",") if v.strip()]
        if '""' in values or "''" in values:
            offenders.append(f"{lineno}: {line.strip()}")
    assert not offenders, (
        "an empty environment value must not be treated as an explicit 'off': "
        + "; ".join(offenders)
    )


if __name__ == "__main__":
    tests = [
        test_selects_smallest_covering_gtfs_feed_and_prefers_latest,
        test_falls_back_to_direct_download_when_no_latest,
        test_returns_none_when_nothing_covers,
        test_excludes_non_gtfs_and_non_overlapping,
        test_rejects_corrupt_worldwide_bbox_and_non_us,
        test_a_blank_status_is_usable_because_most_real_rows_have_one,
        test_a_withdrawn_feed_is_not_selected_over_a_live_one,
        test_an_inactive_feed_is_excluded_too,
        test_a_withdrawn_feed_resolves_to_its_replacement,
        test_a_redirect_to_a_missing_row_is_dropped_rather_than_followed_into_nothing,
        test_a_redirect_cycle_terminates_instead_of_hanging,
        test_a_us_country_code_with_a_trailing_space_is_still_the_united_states,
        test_the_catalog_address_is_pinned_and_is_not_a_shortlink,
        test_an_answered_catalog_with_nothing_nearby_is_reported_as_a_coverage_fact,
        test_an_unreachable_catalog_is_reported_as_unknown_not_as_no_service,
        test_a_covering_catalog_returns_the_selected_feed,
        test_a_run_looks_for_a_local_feed_unless_the_operator_stops_it,
        test_an_empty_value_is_read_as_unset_rather_than_as_an_operator_choosing_off,
        test_an_unreachable_catalog_still_tries_the_bundled_feed,
        test_the_bundled_fallback_does_not_read_as_a_successful_discovery,
        test_an_answered_catalog_with_no_covering_feed_does_not_reach_for_the_bundled_feed,
        test_an_operator_named_feed_outranks_discovery_and_the_bundled_fallback,
        test_a_missing_discovery_result_is_an_unknown_not_a_coverage_fact,
        test_the_worker_takes_its_discovery_default_and_feed_plan_from_gtfs_skim,
        test_no_env_switch_in_the_worker_reads_an_empty_value_as_a_deliberate_off,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} GTFS-discovery checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
