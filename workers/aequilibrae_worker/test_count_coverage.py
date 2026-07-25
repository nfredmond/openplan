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

Includes a PARITY check against scripts/modeling/count_sources.py so the
registered-region list cannot drift from the sources that actually exist.
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


def test_region_for_bbox_resolves_registered_states():
    assert cv.region_for_bbox(_DAVIS_BBOX) == "CA"
    assert cv.region_for_bbox((-122.35, 47.55, -122.30, 47.65)) == "WA"
    assert cv.region_for_bbox((-105.02, 39.70, -104.95, 39.78)) == "CO"
    assert cv.region_for_bbox((-122.75, 45.40, -122.55, 45.60)) == "OR"


def test_region_for_bbox_is_none_outside_registered_regions():
    assert cv.region_for_bbox(_OHIO_BBOX) is None
    assert cv.region_for_bbox(None) is None
    assert cv.region_for_bbox((1, 2)) is None


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
    # The reason must name the gap and be actionable, not blame the model.
    assert "No observed-count source is registered" in coverage["reason"], coverage["reason"]
    assert "CA" in coverage["reason"] and "OR" in coverage["reason"], coverage["reason"]
    for blame in ("failed", "did not meet", "matched station"):
        assert blame not in coverage["reason"], coverage["reason"]


def test_in_region_but_out_of_area_run_says_counts_can_be_fetched():
    """Davis is in CA — a registered region — but the pilot file is not local."""
    coverage = cv.describe_count_coverage([_station()], _DAVIS_BBOX)
    assert coverage["covered"] is False, coverage
    assert coverage["region"] == "CA"
    assert "auto-ingest" in coverage["reason"], coverage["reason"]


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


def test_registered_regions_match_the_count_source_registry():
    """PARITY: adding a state must be a registry entry in BOTH places.

    COUNT_REGION_BOUNDS decides which areas can auto-ingest counts;
    COUNT_SOURCES holds the FeatureServer that actually serves them. A region in
    one but not the other is either an area promised coverage it cannot get, or
    a source no run will ever reach.
    """
    scripts_dir = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "modeling")
    )
    sys.path.insert(0, scripts_dir)
    try:
        import count_sources  # noqa: PLC0415
    finally:
        sys.path.remove(scripts_dir)

    bounds_regions = set(cv.COUNT_REGION_BOUNDS)
    source_regions = set(count_sources.COUNT_SOURCES)
    assert bounds_regions == source_regions, (
        f"registered-region drift: bounds-only={sorted(bounds_regions - source_regions)}, "
        f"sources-only={sorted(source_regions - bounds_regions)}"
    )


def test_every_registered_region_has_sane_bounds():
    for region, bounds in cv.COUNT_REGION_BOUNDS.items():
        assert len(bounds) == 4, region
        min_lon, min_lat, max_lon, max_lat = bounds
        assert min_lon < max_lon and min_lat < max_lat, region
        assert -180 <= min_lon <= 180 and -180 <= max_lon <= 180, region
        assert -90 <= min_lat <= 90 and -90 <= max_lat <= 90, region


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
