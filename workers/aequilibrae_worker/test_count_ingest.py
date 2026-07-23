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


def test_auto_ingest_passes_bbox_as_equals_form():
    """Regression: a negative-longitude bbox (every real US location) must be
    passed as `--fetch-bbox=VALUE`, not `--fetch-bbox VALUE` — otherwise argparse
    treats the leading '-' as an option flag ('expected one argument'), the fetch
    fails, and calibration silently never engages."""
    import os
    import subprocess
    import tempfile

    captured = {}
    real_run = subprocess.run
    orig_flag = main.COUNT_AUTO_INGEST
    orig_env = os.environ.pop("VALIDATION_COUNTS_PATH", None)

    def fake_run(argv, **kw):
        captured["argv"] = argv
        out = argv[argv.index("--out") + 1]
        with open(out, "w") as fh:
            fh.write("header\nrow1\n")  # >= 2 rows → treated as a real fetch
        class _R:
            returncode = 0
        return _R()

    try:
        main.COUNT_AUTO_INGEST = True
        subprocess.run = fake_run
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "project_database.sqlite"), "w").close()
            result = main.auto_ingest_counts((-121.83, 38.51, -121.68, 38.58), d, d)
    finally:
        subprocess.run = real_run
        main.COUNT_AUTO_INGEST = orig_flag
        if orig_env is not None:
            os.environ["VALIDATION_COUNTS_PATH"] = orig_env

    argv = captured.get("argv", [])
    assert "--fetch-bbox=-121.83,38.51,-121.68,38.58" in argv, argv
    assert "--fetch-bbox" not in argv, "bbox must be an =-form single arg, not a bare flag"
    assert result is not None  # a >=2-row csv → the path is returned


if __name__ == "__main__":
    tests = [
        test_region_for_bbox_detects_california,
        test_region_for_bbox_returns_none_outside_registered_regions,
        test_auto_ingest_is_off_by_default,
        test_auto_ingest_passes_bbox_as_equals_form,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-ingest checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
