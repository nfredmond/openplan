#!/usr/bin/env python3
"""Checks for auto count-ingestion region resolution + the default-off gate.
Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_count_ingest.py
"""
import os
import sys

# main.py raises at import when Supabase credentials are absent, which is right
# for a worker process and a trap for a test: it passes on a machine holding
# .env.local and fails in CI. Nothing at import time contacts a project.
os.environ.setdefault("SUPABASE_URL", "http://worker-import-only.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "import-only-not-a-key")

import main


def _run(*subdivisions, resolution="resolved", country="US"):
    return {
        "corridor_geojson": {
            "type": "Polygon",
            "coordinates": [[[-122, 38], [-121, 38], [-121, 39], [-122, 39], [-122, 38]]],
        },
        "input_snapshot_json": {
            "observedCountGeography": {
                "schema": "openplan.observed-count-geography.v1",
                "resolution": resolution,
                "countryCode": country,
                "subdivisions": [{"fips": f"{index + 1:02d}", "code": code} for index, code in enumerate(subdivisions)],
                "detail": "fixture",
            }
        },
    }


def test_source_plan_asks_for_every_state_and_national_adapter():
    plan = main.resolve_observed_count_source_plan(_run("OR", "CA"))
    assert plan["state"] == "resolved"
    assert plan["subdivisions"] == ["CA", "OR"]
    assert plan["sources"] == [
        "us-fhwa-tmas-2024",
        "us-state-ca",
        "us-state-or",
        "us-fhwa-hpms-2024",
    ]


def test_source_plan_keeps_unresolved_and_unsupported_distinct():
    assert main.resolve_observed_count_source_plan(_run(resolution="unresolved"))["state"] == "unresolved"
    assert main.resolve_observed_count_source_plan(_run(resolution="unsupported", country="NZ"))["state"] == "unsupported"
    assert main.resolve_observed_count_source_plan({})["state"] == "unresolved"


def test_auto_ingest_is_off_by_default():
    # COUNT_AUTO_INGEST defaults OFF, so the pilot/CI stay on the curated file.
    assert main.COUNT_AUTO_INGEST is False
    # Even for a CA bbox, disabled → None (no fetch attempted).
    assert main.auto_ingest_counts(_run("CA"), (-121.80, 38.53, -121.68, 38.58), "/nonexistent", "/tmp") is None


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
            result = main.auto_ingest_counts(_run("CA"), (-121.83, 38.51, -121.68, 38.58), d, d)
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
            run = _run("CA")
            assert main.auto_ingest_counts(run, bbox, d, d) is None
            assert main.auto_ingest_counts(run, bbox, d, d, calibrate_requested=False) is None
            # Per-run opt-in → fetch runs even though COUNT_AUTO_INGEST is off.
            result = main.auto_ingest_counts(run, bbox, d, d, calibrate_requested=True)
    finally:
        subprocess.run = real_run
        main.COUNT_AUTO_INGEST = orig_flag
        if orig_env is not None:
            os.environ["VALIDATION_COUNTS_PATH"] = orig_env

    assert result is not None, "per-run calibrate should drive auto-ingest even when COUNT_AUTO_INGEST is off"
    assert captured.get("argv"), "a fetch subprocess should have run for the opt-in path"


def test_should_run_calibration_gate():
    """The stage-assignment gate predicate: calibration runs only when opted in
    AND count validation is enabled AND a count set exists on disk. This is the
    decision the per-run toggle ultimately controls, extracted so it is testable
    without a full AequilibraE run."""
    import os
    import tempfile

    orig = main.COUNT_VALIDATION_ENABLED
    try:
        with tempfile.NamedTemporaryFile() as tf:
            main.COUNT_VALIDATION_ENABLED = True
            assert main.should_run_calibration(True, tf.name) is True
            # Not opted in → skip, even with counts present.
            assert main.should_run_calibration(False, tf.name) is False
            # Count validation disabled → skip, even when opted in with counts.
            main.COUNT_VALIDATION_ENABLED = False
            assert main.should_run_calibration(True, tf.name) is False
        # Opted in + validation on, but no count set on disk → skip (honest
        # fallback: no counts → stays screening).
        main.COUNT_VALIDATION_ENABLED = True
        assert main.should_run_calibration(True, "/nonexistent/auto_aadt_counts.csv") is False
    finally:
        main.COUNT_VALIDATION_ENABLED = orig


def test_immutable_validation_upload_failure_is_not_recorded_as_local_custody():
    """A failed private-storage write must enter the explicit unchecked path.

    Returning a local URL here would let the custody RPC succeed while binding
    a mutable worker path, which is not immutable evidence.
    """
    import tempfile

    real_post = main.requests.post

    class FailedUpload:
        status_code = 503
        text = "fixture unavailable"

    try:
        main.requests.post = lambda *args, **kwargs: FailedUpload()
        with tempfile.NamedTemporaryFile() as artifact:
            try:
                main.upload_immutable_validation_json("run-1", "assessment-1", artifact.name)
            except RuntimeError as exc:
                assert "validation evidence write failed" in str(exc)
            else:
                raise AssertionError("a failed immutable upload was accepted as custody")
    finally:
        main.requests.post = real_post


if __name__ == "__main__":
    tests = [
        test_source_plan_asks_for_every_state_and_national_adapter,
        test_source_plan_keeps_unresolved_and_unsupported_distinct,
        test_auto_ingest_is_off_by_default,
        test_auto_ingest_passes_bbox_as_equals_form,
        test_resolve_calibration_enabled_snapshot_over_env,
        test_auto_ingest_runs_for_per_run_calibrate_even_when_deployment_off,
        test_should_run_calibration_gate,
        test_immutable_validation_upload_failure_is_not_recorded_as_local_custody,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-ingest checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
