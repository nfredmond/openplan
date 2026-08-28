#!/usr/bin/env python3
"""Dependency-free checks for observed-count COVERAGE.

Run: python3 workers/aequilibrae_worker/test_count_coverage.py

A study area either has published counts to validate against or it does not,
and that is a different finding from "the model disagreed with the counts".

What these pin: when no count source is registered for a study area's state,
the worker used to fall back to the BUNDLED pilot count file — stations in
Grass Valley, California — match an out-of-state network against it, match
nothing, and report "Only 0 matched station(s); >= 3 required for a screening
claim." A planner in Ohio reads that as "my model failed validation". The truth
was that no count source covers their state.

Source applicability is tested at the frozen run-snapshot/adapter seam. These
checks cover only whether a supplied count set overlaps the study area.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import count_validation as cv  # noqa: E402

# Grass Valley, CA — where the bundled pilot count file's stations live.
_PILOT_BBOX = (-121.06, 39.215, -121.04, 39.235)
# Columbus, OH — no registered count source.
_OHIO_BBOX = (-83.10, 39.92, -82.90, 40.05)
# Davis, CA — registered region (CA), but nowhere near the pilot stations.
_DAVIS_BBOX = (-121.80, 38.53, -121.68, 38.58)


def _station(sid="S1", bbox=_PILOT_BBOX):
    return {
        "station_id": sid,
        "label": sid,
        "observed_volume": "40000",
        "bbox_min_lon": bbox[0], "bbox_min_lat": bbox[1],
        "bbox_max_lon": bbox[2], "bbox_max_lat": bbox[3],
    }


def test_bboxes_intersect():
    assert cv.bboxes_intersect((0, 0, 2, 2), (1, 1, 3, 3))
    assert cv.bboxes_intersect((0, 0, 2, 2), (2, 2, 3, 3))  # touching counts
    assert not cv.bboxes_intersect((0, 0, 1, 1), (2, 2, 3, 3))
    assert not cv.bboxes_intersect((), (2, 2, 3, 3))
    assert not cv.bboxes_intersect((0, 0, 1), (2, 2, 3, 3))


def test_station_set_extent_unions_declared_bboxes():
    stations = [
        _station("A", (-121.06, 39.21, -121.04, 39.23)),
        _station("B", (-121.10, 39.19, -121.05, 39.22)),
    ]
    assert cv.station_set_extent(stations) == (-121.10, 39.19, -121.04, 39.23)


def test_station_set_extent_is_none_without_usable_bboxes():
    assert cv.station_set_extent([]) is None
    assert cv.station_set_extent([{"station_id": "X"}]) is None
    # A partially declared bbox is not usable and must not be half-read.
    assert cv.station_set_extent([{"bbox_min_lon": "-121.0", "bbox_min_lat": "39.2"}]) is None


def test_pilot_counts_cover_the_pilot_area():
    coverage = cv.describe_count_coverage([_station()], _PILOT_BBOX)
    assert coverage["covered"] is True, coverage
    assert coverage["status"] == "covered"
    assert coverage["reason"] is None


def test_out_of_state_run_reports_coverage_not_failure():
    """THE defect. An Ohio run must not be matched against California stations."""
    coverage = cv.describe_count_coverage([_station()], _OHIO_BBOX)
    assert coverage["covered"] is False, coverage
    assert coverage["status"] == "out_of_area"
    assert coverage["region"] is None
    # The reason names the supplied-set gap without blaming the model.
    assert "supplied count set" in coverage["reason"], coverage["reason"]
    for blame in ("failed", "did not meet", "matched station"):
        assert blame not in coverage["reason"], coverage["reason"]


def test_out_of_area_run_does_not_guess_a_source_from_bbox():
    coverage = cv.describe_count_coverage([_station()], _DAVIS_BBOX)
    assert coverage["covered"] is False, coverage
    assert coverage["region"] is None
    assert coverage["registered_regions"] == []
    assert "run snapshot" in coverage["reason"], coverage["reason"]


def test_missing_count_set_is_a_coverage_statement_not_a_failure():
    coverage = cv.describe_count_coverage([], _OHIO_BBOX)
    assert coverage["covered"] is False
    assert coverage["status"] == "no_count_set"
    assert "not a validation failure" in coverage["reason"]


def test_unknown_study_area_does_not_block_validation():
    """No geometry to test against: let station matching be the test."""
    coverage = cv.describe_count_coverage([_station()], None)
    assert coverage["covered"] is True
    assert coverage["status"] == "unknown_study_area"


def test_count_set_without_geography_does_not_block_validation():
    coverage = cv.describe_count_coverage([{"station_id": "X"}], _OHIO_BBOX)
    assert coverage["covered"] is True
    assert coverage["status"] == "count_set_without_geography"


def test_uncovered_summary_carries_no_gate_and_no_metrics():
    """A gate implies a comparison happened. None did."""
    coverage = cv.describe_count_coverage([_station()], _OHIO_BBOX)
    summary = cv.uncovered_validation_summary(coverage)

    assert summary["screening_gate"] is None, summary
    assert summary["gate_reasons"] == []
    assert summary["stations_matched"] == 0
    for metric in ("median_ape", "mean_ape", "max_ape", "percent_rmse", "spearman_rho"):
        assert summary[metric] is None, metric
    assert summary["coverage"]["covered"] is False
    assert "coverage gap, not a validation result" in summary["method"]


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-coverage checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
