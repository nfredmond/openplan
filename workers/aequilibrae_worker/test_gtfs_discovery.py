#!/usr/bin/env python3
"""Checks for dynamic per-place GTFS discovery (keyless MobilityDB catalog).
Pure selection logic — no network. Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_gtfs_discovery.py
"""
import sys

import gtfs_skim

# Davis, CA study bbox (min_lon, min_lat, max_lon, max_lat).
DAVIS_BBOX = (-121.80, 38.53, -121.68, 38.58)


def _row(data_type, min_lon, min_lat, max_lon, max_lat, latest="", dd=""):
    return {
        "data_type": data_type,
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


if __name__ == "__main__":
    tests = [
        test_selects_smallest_covering_gtfs_feed_and_prefers_latest,
        test_falls_back_to_direct_download_when_no_latest,
        test_returns_none_when_nothing_covers,
        test_excludes_non_gtfs_and_non_overlapping,
        test_rejects_corrupt_worldwide_bbox_and_non_us,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} GTFS-discovery checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
