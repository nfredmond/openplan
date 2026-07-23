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


def test_region_for_bbox_detects_registered_states():
    # Multi-state count adapters: each state's AADT FeatureServer is picked up by
    # an in-state study bbox (verify_bbox from the live source discovery).
    assert main._region_for_bbox((-122.35, 47.55, -122.30, 47.65)) == "WA"  # Seattle / I-5
    assert main._region_for_bbox((-105.02, 39.70, -104.95, 39.78)) == "CO"  # Denver / I-25
    assert main._region_for_bbox((-122.75, 45.40, -122.55, 45.60)) == "OR"  # Portland
    # Denver is east of California's eastern edge, so CA does NOT swallow it.
    assert main._region_for_bbox((-105.02, 39.70, -104.95, 39.78)) != "CA"


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


def test_resolve_calibration_enabled_snapshot_over_env():
    """Per-run calibrate flag (input_snapshot_json.calibrate) is authoritative
    over the AEQ_CALIBRATE env; an absent flag falls back to the env."""
    orig = main.CALIBRATION_ENABLED
    try:
        # Explicit per-run True wins even when the env default is off.
        main.CALIBRATION_ENABLED = False
        assert main.resolve_calibration_enabled({"input_snapshot_json": {"calibrate": True}}) is True
        # Explicit per-run False wins even when the env default is on.
        main.CALIBRATION_ENABLED = True
        assert main.resolve_calibration_enabled({"input_snapshot_json": {"calibrate": False}}) is False
        # Absent flag → env fallback (on).
        assert main.resolve_calibration_enabled({"input_snapshot_json": {}}) is True
        assert main.resolve_calibration_enabled({}) is True
        assert main.resolve_calibration_enabled(None) is True
        # Absent flag → env fallback (off); an unrelated snapshot key doesn't count.
        main.CALIBRATION_ENABLED = False
        assert main.resolve_calibration_enabled({"input_snapshot_json": {"zoneGeography": "tract"}}) is False
    finally:
        main.CALIBRATION_ENABLED = orig


def test_auto_ingest_runs_for_per_run_calibrate_even_when_deployment_off():
    """A per-run calibrate opt-in must drive count auto-ingest for that run even
    when the deployment-level COUNT_AUTO_INGEST is off — else hosted calibration
    would have no count set to fit. Without the opt-in and with the env off, the
    fetch stays skipped (pilot/CI byte-identical)."""
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
        main.COUNT_AUTO_INGEST = False  # deployment default OFF
        subprocess.run = fake_run
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "project_database.sqlite"), "w").close()
            bbox = (-121.83, 38.51, -121.68, 38.58)  # Davis, CA (registered region)
            # No opt-in + env off → still skipped.
            assert main.auto_ingest_counts(bbox, d, d) is None
            assert main.auto_ingest_counts(bbox, d, d, calibrate_requested=False) is None
            # Per-run opt-in → fetch runs even though COUNT_AUTO_INGEST is off.
            result = main.auto_ingest_counts(bbox, d, d, calibrate_requested=True)
    finally:
        subprocess.run = real_run
        main.COUNT_AUTO_INGEST = orig_flag
        if orig_env is not None:
            os.environ["VALIDATION_COUNTS_PATH"] = orig_env

    assert result is not None, "per-run calibrate should drive auto-ingest even when COUNT_AUTO_INGEST is off"
    assert captured.get("argv"), "a fetch subprocess should have run for the opt-in path"


if __name__ == "__main__":
    tests = [
        test_region_for_bbox_detects_california,
        test_region_for_bbox_detects_registered_states,
        test_region_for_bbox_returns_none_outside_registered_regions,
        test_auto_ingest_is_off_by_default,
        test_auto_ingest_passes_bbox_as_equals_form,
        test_resolve_calibration_enabled_snapshot_over_env,
        test_auto_ingest_runs_for_per_run_calibrate_even_when_deployment_off,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-ingest checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
