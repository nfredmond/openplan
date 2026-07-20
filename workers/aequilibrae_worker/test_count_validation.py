#!/usr/bin/env python3
"""Dependency-free checks for the observed-count validation.

Run: python3 workers/aequilibrae_worker/test_count_validation.py
Includes a PARITY check vs the county lane's screening_metrics.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import count_validation as cv  # noqa: E402


def _station(sid, obs, names, ltypes, facility="", bbox=(-122, 38, -120, 40)):
    return {
        "station_id": sid, "label": sid, "facility_name": facility,
        "observed_volume": str(obs), "candidate_model_names": names,
        "candidate_link_types": ltypes,
        "bbox_min_lon": bbox[0], "bbox_min_lat": bbox[1],
        "bbox_max_lon": bbox[2], "bbox_max_lat": bbox[3],
    }


def _link(lid, name, ltype, lon, lat, vol):
    return {"link_id": lid, "name": name, "link_type": ltype, "lon": lon, "lat": lat, "volume": vol}


def test_match_prefers_exact_name_then_volume():
    st = _station("S", 40000, "Grass Valley Highway", "motorway")
    links = [
        _link(1, "Grass Valley Highway", "motorway", -121.05, 39.22, 38000),  # exact
        _link(2, "Grass Valley Highway", "motorway", -121.04, 39.23, 41000),  # exact, higher vol
        _link(3, "Some Road", "motorway", -121.05, 39.22, 99999),             # type-only, ignored vs exact
    ]
    best = cv.match_station(st, links)
    assert best["link_id"] == 2 and best["match_score"] == 3, best


def test_bbox_and_type_gates():
    st = _station("S", 40000, "Highway X", "motorway", bbox=(-121.06, 39.21, -121.04, 39.23))
    # outside bbox
    assert cv.match_station(st, [_link(1, "Highway X", "motorway", -120.0, 39.0, 40000)]) is None
    # wrong link type
    assert cv.match_station(st, [_link(1, "Highway X", "residential", -121.05, 39.22, 40000)]) is None


def test_validate_summary_and_gate():
    stations = [
        _station("A", 45500, "Grass Valley Highway", "motorway"),
        _station("B", 26000, "State Highway 49", "primary"),
        _station("C", 10300, "Colfax Highway", "secondary"),
    ]
    links = [
        _link(1, "Grass Valley Highway", "motorway", -121.05, 39.22, 44000),   # APE ~3.3%
        _link(2, "State Highway 49", "primary", -121.03, 39.21, 24000),        # APE ~7.7%
        _link(3, "Colfax Highway", "secondary", -121.04, 39.24, 9500),         # APE ~7.8%
    ]
    s = cv.validate_against_counts(stations, links)
    assert s["stations_matched"] == 3 and s["stations_total"] == 3
    assert s["median_ape"] is not None and s["max_ape"] is not None
    assert s["percent_rmse"] is not None and s["geh"]["mean"] is not None
    assert s["spearman_rho"] == 1.0  # ranks agree
    # 3 matches, all APEs < 30% median / < 50% critical -> ready
    assert s["screening_gate"] == "bounded screening-ready", (s["screening_gate"], s["median_ape"], s["max_ape"])
    assert "not a calibration" in s["method"].lower()


def test_gate_internal_when_too_few_matches():
    stations = [_station("A", 45500, "Grass Valley Highway", "motorway")]
    links = [_link(1, "Grass Valley Highway", "motorway", -121.05, 39.22, 44000)]
    s = cv.validate_against_counts(stations, links)  # 1 match < required 3
    assert s["screening_gate"] == "internal prototype only"


def test_unmatched_station_reported():
    stations = [_station("A", 45500, "Nonexistent Rd", "motorway")]
    s = cv.validate_against_counts(stations, [_link(1, "Other Rd", "residential", -121.05, 39.22, 100)])
    assert s["stations_matched"] == 0
    assert s["results"][0]["match_status"] == "unmatched"


def test_metric_status_for_gate():
    # >=3 matches + median <=30 -> pass
    assert cv.metric_status_for_gate(28.0, 40.0, 3)[0] == "pass"
    # median between 30 and 50 -> warn
    assert cv.metric_status_for_gate(32.95, 42.0, 3)[0] == "warn"
    # median >50 (or facility >50) -> fail
    assert cv.metric_status_for_gate(60.0, 70.0, 3)[0] == "fail"
    assert cv.metric_status_for_gate(20.0, 55.0, 3)[0] == "fail"  # a facility over critical
    # too few matches -> fail regardless of APE
    assert cv.metric_status_for_gate(10.0, 12.0, 2)[0] == "fail"
    # no median -> fail
    assert cv.metric_status_for_gate(None, None, 3)[0] == "fail"


def test_metrics_parity_with_screening_metrics():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "modeling"))
    try:
        import screening_metrics as sm  # type: ignore
    except Exception as e:  # pragma: no cover
        print(f"  (parity skipped — screening_metrics not importable: {e})")
        return
    obs = [45500, 26000, 10300, 35500]
    mod = [44000, 24000, 9500, 33000]
    assert abs(cv.percent_rmse(obs, mod) - sm.percent_rmse(obs, mod)) < 1e-9
    assert abs(cv.geh_summary(obs, mod)["mean"] - sm.geh_summary(obs, mod)["mean"]) < 1e-9


def test_peak_hour_geh_scales_from_avg_hourly():
    import math
    obs = [45500, 26000, 10300, 35500]
    mod = [44000, 24000, 9500, 33000]
    avg = cv.geh_summary(obs, mod)["mean"]
    peak = cv.peak_hour_geh_summary(obs, mod)["mean"]
    # avg uses daily/24, peak uses daily*K → peak/avg = sqrt(K*24). Peak-hour GEH
    # is the stricter, customary basis for the < 5 rule.
    assert abs(peak / avg - math.sqrt(0.09 * 24.0)) < 1e-9, (peak, avg)
    assert peak > avg


def test_peak_hour_geh_reports_factor_and_handles_empty():
    empty = cv.peak_hour_geh_summary([], [])
    assert empty["mean"] is None
    assert empty["factor"] == 0.09
    assert "K-factor" in empty["basis"]


def test_validate_emits_both_geh_bases():
    stations = [
        _station("S1", 40000, "Grass Valley Highway", "motorway"),
        _station("S2", 26000, "Idaho Maryland Road", "primary"),
        _station("S3", 10000, "Brunswick Road", "secondary"),
    ]
    links = [
        _link(1, "Grass Valley Highway", "motorway", -121.05, 39.22, 41000),
        _link(2, "Idaho Maryland Road", "primary", -121.04, 39.23, 24000),
        _link(3, "Brunswick Road", "secondary", -121.03, 39.24, 9500),
    ]
    out = cv.validate_against_counts(stations, links)
    assert out["geh"]["mean"] is not None
    assert out["peak_hour_geh"]["mean"] is not None
    assert out["peak_hour_geh"]["factor"] == 0.09
    assert "peak-hour" in out["method"]


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-validation checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
