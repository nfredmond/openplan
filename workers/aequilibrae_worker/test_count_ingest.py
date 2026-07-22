#!/usr/bin/env python3
"""Checks for auto count-ingestion region resolution + the default-off gate.
Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_count_ingest.py
"""
import sys

import main


def test_region_for_bbox_detects_california():
    assert main._region_for_bbox((-121.80, 38.53, -121.68, 38.58)) == "CA"  # Davis
    assert main._region_for_bbox((-121.06, 39.21, -121.04, 39.23)) == "CA"  # Nevada County


def test_region_for_bbox_returns_none_outside_registered_regions():
    assert main._region_for_bbox((-74.02, 40.70, -73.90, 40.80)) is None  # NYC (no registered source)


def test_auto_ingest_is_off_by_default():
    # COUNT_AUTO_INGEST defaults OFF, so the pilot/CI stay on the curated file.
    assert main.COUNT_AUTO_INGEST is False
    # Even for a CA bbox, disabled → None (no fetch attempted).
    assert main.auto_ingest_counts((-121.80, 38.53, -121.68, 38.58), "/nonexistent", "/tmp") is None


if __name__ == "__main__":
    tests = [
        test_region_for_bbox_detects_california,
        test_region_for_bbox_returns_none_outside_registered_regions,
        test_auto_ingest_is_off_by_default,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-ingest checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
