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


def test_match_prefers_exact_name_then_distance_without_looking_at_volume():
    st = _station("S", 40000, "Grass Valley Highway", "motorway")
    links = [
        _link(1, "Grass Valley Highway", "motorway", -121.0001, 39.0001, 38000),  # exact, closer
        _link(2, "Grass Valley Highway", "motorway", -121.04, 39.03, 99999),  # exact, higher vol
        _link(3, "Some Road", "motorway", -121.05, 39.22, 99999),             # type-only, ignored vs exact
    ]
    best = cv.match_station(st, links)
    assert best["link_id"] == 1 and best["match_score"] == 3, best

    links[0]["volume"], links[1]["volume"] = links[1]["volume"], links[0]["volume"]
    assert cv.match_station(st, links)["link_id"] == 1


def test_candidate_distance_wraps_across_the_antimeridian():
    st = _station("S", 1000, "Dateline Road", "primary", bbox=(179.99, 10.0, -179.99, 10.02))
    near = _link(1, "Dateline Road", "primary", -179.999, 10.01, 1)
    far = _link(2, "Dateline Road", "primary", 179.9, 10.01, 99999)
    assert cv.match_station(st, [far, near])["link_id"] == 1


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


# ── the zone system qualifies the gate ─────────────────────────────────────
#
# A gate awarded by a comparison that could not establish anything is a claim
# tier handed out by a test that could not test. These checks pin BOTH
# directions, because a qualification that only ever explained failures would
# only ever make runs look better.

def _passing_case():
    """3 stations, every APE well inside the thresholds -> a passing gate."""
    stations = [
        _station("A", 45500, "Grass Valley Highway", "motorway"),
        _station("B", 26000, "State Highway 49", "primary"),
        _station("C", 10300, "Colfax Highway", "secondary"),
    ]
    links = [
        _link(1, "Grass Valley Highway", "motorway", -121.05, 39.22, 44000),
        _link(2, "State Highway 49", "primary", -121.03, 39.21, 24000),
        _link(3, "Colfax Highway", "secondary", -121.04, 39.24, 9500),
    ]
    return stations, links


def test_a_coarse_zone_system_withholds_a_passing_gate():
    """THE DEFECT THIS CLOSES.

    Identical inputs to `test_validate_summary_and_gate`, which passes the gate.
    Adding the measured 26-zone/36% precedent must WITHHOLD it: matching the
    counts at this resolution does not establish screening grade, and the gate
    string is what `write_model_run_modeling_evidence` turns into the
    `screening_grade` CLAIM TIER.
    """
    stations, links = _passing_case()
    s = cv.validate_against_counts(stations, links, intrazonal_share_pct=36.0, zone_count=26)

    assert s["screening_gate"] is None, s["screening_gate"]
    zone = s["zone_resolution"]
    assert zone["gate_withheld"] is True, zone
    assert zone["withheld_gate"] == "bounded screening-ready", zone
    assert zone["status"] == cv.ZONE_RESOLUTION_GATE_WITHHELD_STATUS, zone
    assert zone["supports_link_level_validation"] is False, zone

    # The measurements themselves are real and must survive: what is removed is
    # the claim built on top of them, not the evidence.
    assert s["stations_matched"] == 3 and s["median_ape"] is not None

    # And the planner is told it is not a failure.
    joined = " ".join(s["gate_reasons"]).lower()
    assert "not awarded" in joined, s["gate_reasons"]
    assert "finer zone system" in joined, s["gate_reasons"]
    assert "26 zones" in joined, s["gate_reasons"]


def test_a_coarse_zone_system_never_promotes_a_failing_gate():
    """The qualification only ever removes a claim; it cannot grant one."""
    stations = [_station("A", 45500, "Grass Valley Highway", "motorway")]
    links = [_link(1, "Grass Valley Highway", "motorway", -121.05, 39.22, 44000)]
    s = cv.validate_against_counts(stations, links, intrazonal_share_pct=36.0, zone_count=26)

    assert s["screening_gate"] == "internal prototype only", s["screening_gate"]
    assert s["zone_resolution"]["gate_withheld"] is False
    assert s["zone_resolution"]["status"] == "explains_gate_failure"
    # The zone explanation comes FIRST, ahead of the arithmetic reason a planner
    # would otherwise read as "my model failed".
    assert "never reach any link" in s["gate_reasons"][0], s["gate_reasons"]
    # ...and the original reason is kept, not replaced.
    assert any("matched stations" in r for r in s["gate_reasons"]), s["gate_reasons"]


def test_a_workable_zone_system_leaves_a_passing_gate_alone():
    """12.6% is the measured block-group figure. It must still pass.

    A qualification that withheld every gate would be safe and useless.
    """
    stations, links = _passing_case()
    s = cv.validate_against_counts(stations, links, intrazonal_share_pct=12.6, zone_count=80)

    assert s["screening_gate"] == "bounded screening-ready", s["screening_gate"]
    assert s["zone_resolution"]["supports_link_level_validation"] is True
    assert s["zone_resolution"]["gate_withheld"] is False


def test_the_threshold_boundary():
    """Exactly at the threshold is supported; a tenth past it is not."""
    assert cv.link_validation_is_supported(20.0) is True
    assert cv.link_validation_is_supported(20.1) is False
    assert cv.link_validation_is_supported(0.0) is True
    # None in, None out — an unmeasured share is not a fine zone system.
    assert cv.link_validation_is_supported(None) is None


def test_an_unmeasured_share_is_not_a_fine_zone_system():
    """Omitting the share must not silently assert the best possible answer.

    The gate is deliberately left alone (a missing measurement is a plumbing
    fault, not a coarse zone system), but it must be RECORDED as unqualified
    rather than quietly presented as qualified.
    """
    stations, links = _passing_case()
    s = cv.validate_against_counts(stations, links)

    assert s["screening_gate"] == "bounded screening-ready"
    zone = s["zone_resolution"]
    assert zone["measured"] is False, zone
    assert zone["supports_link_level_validation"] is None, zone
    assert zone["intrazonal_share_pct"] is None, zone
    assert zone["gate_withheld"] is False, zone


def test_every_summary_carries_the_qualification():
    """Auditable even when it changed nothing.

    A silent no-op and a considered pass have to be distinguishable after the
    fact, or nobody can tell whether the qualification ran at all.
    """
    stations, links = _passing_case()
    for share in (None, 5.0, 36.0):
        s = cv.validate_against_counts(stations, links, intrazonal_share_pct=share)
        assert "zone_resolution" in s, share
        assert "heuristic_note" in s["zone_resolution"], share
        # Always named as OpenPlan's own judgement, never as a standard.
        assert "not an adopted standard" in s["zone_resolution"]["heuristic_note"]


def test_metric_status_warns_rather_than_passing_at_coarse_resolution():
    """The metric row must agree with the claim decision beside it."""
    # Same numbers that pass at a fine zone system...
    assert cv.metric_status_for_gate(28.0, 40.0, 3)[0] == "pass"
    assert cv.metric_status_for_gate(28.0, 40.0, 3, intrazonal_share_pct=12.6)[0] == "pass"
    # ...are only a 'warn' where the comparison establishes nothing. NOT 'fail':
    # nothing failed, and calling it a failure restates the misreading this
    # qualification exists to prevent.
    status, detail = cv.metric_status_for_gate(28.0, 40.0, 3, intrazonal_share_pct=36.0)
    assert status == "warn", (status, detail)
    assert "never reach a link" in detail, detail
    assert "either direction" in detail, detail


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



# ── Divided highways: a count measures the road, OSM maps the carriageways ──
#
# MEASURED 2026-08-17 across 24 counties and 1,324 stations, within each road
# class so nothing else could explain it: a two-way link reads 2.09x (trunk)
# and 2.14x (primary) higher than a one-way link of the SAME class. 99% of
# motorway links are one-way carriageways against 3% of residential, so the
# defect landed hardest exactly where the model looked worst — freeways at 0.78
# of observed while the arterials around them read 2-3.

def _carriageway(link_id, name, lon, lat, volume, one_way=True, link_type="motorway"):
    return {
        "link_id": link_id, "name": name, "link_type": link_type,
        "lon": lon, "lat": lat, "volume": volume, "is_one_way": one_way,
    }


def test_a_two_way_link_is_never_doubled():
    link = _carriageway(1, "Main Street", -121.0, 39.2, 12000, one_way=False, link_type="primary")
    assert cv.corridor_volume(link, [link]) == (12000, 1)


def test_two_carriageways_of_one_highway_are_summed():
    north = _carriageway(1, "Golden State Highway", -121.0, 39.2, 20000)
    south = _carriageway(2, "Golden State Highway", -121.0, 39.2008, 18000)
    assert cv.corridor_volume(north, [north, south]) == (38000, 2)


def test_an_unpaired_one_way_road_is_left_alone():
    # A one-way couplet through a town centre is real; doubling it on suspicion
    # would invent traffic that is not there.
    lone = _carriageway(1, "First Street", -121.0, 39.2, 5000)
    assert cv.corridor_volume(lone, [lone]) == (5000, 1)


def test_a_road_of_the_same_name_far_away_is_not_a_carriageway():
    here = _carriageway(1, "Main Street", -121.0, 39.2, 9000)
    away = _carriageway(2, "Main Street", -121.4, 39.6, 9000)
    assert cv.corridor_volume(here, [here, away]) == (9000, 1)


def test_a_road_of_another_class_is_not_a_carriageway():
    motorway = _carriageway(1, "Highway 20", -121.0, 39.2, 30000)
    ramp = _carriageway(2, "Highway 20", -121.0, 39.2005, 3000, link_type="primary")
    assert cv.corridor_volume(motorway, [motorway, ramp]) == (30000, 1)


def test_the_nearest_carriageway_is_the_one_summed():
    here = _carriageway(1, "Golden State Highway", -121.0, 39.2, 20000)
    near = _carriageway(2, "Golden State Highway", -121.0, 39.2004, 18000)
    further = _carriageway(3, "Golden State Highway", -121.0, 39.2012, 100)
    assert cv.corridor_volume(here, [here, near, further])[0] == 38000


def test_a_link_without_coordinates_is_left_alone_rather_than_guessed():
    blind = _carriageway(1, "Highway 20", None, None, 15000)
    partner = _carriageway(2, "Highway 20", -121.0, 39.2, 15000)
    assert cv.corridor_volume(blind, [blind, partner]) == (15000, 1)


def test_a_matched_station_reports_the_whole_corridor():
    """End to end: the station's modelled volume must be the whole road."""
    station = {
        "station_id": "CT_1", "label": "SR 99 mainline", "observed_volume": 38000,
        "candidate_model_names": "Golden State Highway",
        "bbox_min_lon": -122, "bbox_min_lat": 38, "bbox_max_lon": -120, "bbox_max_lat": 40,
    }
    links = [
        _carriageway(1, "Golden State Highway", -121.0, 39.2, 20000),
        _carriageway(2, "Golden State Highway", -121.0, 39.2008, 18000),
    ]
    result = cv.validate_against_counts([station], links)["results"][0]
    assert result["match_status"] == "matched", result
    assert result["modeled_daily_pce"] == 38000, result
    assert result["carriageways_summed"] == 2, result
    # ~0% error now, against the ~47% a half-road produced.
    assert result["absolute_percent_error"] < 1.0, result


# ---------------------------------------------------------------------------
# Several stations on ONE model link. A link holds one volume, so grading each
# station weights that link several times, and where the stations disagree at
# most one of them belongs there. This ran only in the county-script lane until
# 2026-08-18 — every figure a planner saw from a worker run graded 33% of its
# stations that way, and the worst real pair is 2 vehicles a day against 33,723
# on one link.
# ---------------------------------------------------------------------------


def _one_link_two_stations(obs_a, obs_b, modelled=10000.0):
    """Both stations name the same road, so both match the single link."""
    stations = [
        _station("A", obs_a, "Shared Road", "primary"),
        _station("B", obs_b, "Shared Road", "primary"),
    ]
    links = [_link(7, "Shared Road", "primary", -121.0, 39.0, modelled)]
    return cv.validate_against_counts(stations, links, required_matches=1)


def test_two_agreeing_stations_on_one_link_are_compared_once():
    summary = _one_link_two_stations(9500, 10500)
    assert summary["stations_matched"] == 1, summary["stations_matched"]
    shared = summary["shared_model_links"]
    assert shared["groups_merged_as_consistent"] == 1, shared
    assert shared["stations_merged_away"] == 1, shared


def test_two_disagreeing_stations_grade_nothing():
    # The real worst case, scaled: nothing in the data says which belongs.
    summary = _one_link_two_stations(2, 33723, modelled=72220.0)
    assert summary["stations_matched"] == 0, summary["stations_matched"]
    shared = summary["shared_model_links"]
    assert shared["groups_excluded_as_ambiguous"] == 1, shared
    assert shared["stations_excluded_as_ambiguous"] == 2, shared


def test_an_excluded_station_carries_no_error_into_the_median():
    # Left in place, a 3,600,000% error would sit in the same list the gate reads.
    summary = _one_link_two_stations(2, 33723, modelled=72220.0)
    assert summary["median_ape"] is None, summary["median_ape"]
    for row in summary["results"]:
        assert row["absolute_percent_error"] == "", row


def test_one_station_per_link_is_untouched():
    stations = [
        _station("A", 10000, "First Road", "primary"),
        _station("B", 12000, "Second Road", "primary"),
    ]
    links = [
        _link(1, "First Road", "primary", -121.0, 39.0, 10000.0),
        _link(2, "Second Road", "primary", -121.5, 39.5, 12000.0),
    ]
    summary = cv.validate_against_counts(stations, links, required_matches=1)
    assert summary["stations_matched"] == 2, summary["stations_matched"]
    assert summary["shared_model_links"]["links_shared_by_several_stations"] == 0, summary


def test_the_resolution_travels_in_the_summary():
    # A station that vanishes without a recorded reason is indistinguishable
    # from one that was never there.
    summary = _one_link_two_stations(9500, 10500)
    assert "network resolution" in summary["shared_model_links"]["note"]


# ---------------------------------------------------------------------------
# A ramp count measures a facility the screening network does not contain.
# Matched anyway it pairs with the mainline it leaves: three WSDOT ramps
# counting 410, 510 and 530 vehicles a day all matched a mainline carrying
# 29,040, reporting 71x, 57x and 55x. 23% of matched stations across eleven
# counties, at a median error of 258%. Excluded in the county-script lane since
# 2026-08-17 and in the worker only from 2026-08-18.
# ---------------------------------------------------------------------------


def _ramp_and_mainline():
    ramp = _station("RAMP", 510, "State Route 4", "trunk")
    ramp["station_role"] = "ramp"
    ramp["station_role_reason"] = "WSDOT description says RAMP"
    mainline = _station("MAIN", 29040, "State Route 4", "trunk")
    mainline["station_role"] = "mainline"
    links = [_link(3, "State Route 4", "trunk", -121.0, 39.0, 29040.0)]
    return cv.validate_against_counts([ramp, mainline], links, required_matches=1)


def test_a_ramp_count_never_grades_the_mainline_it_leaves():
    summary = _ramp_and_mainline()
    assert summary["stations_matched"] == 1, summary["stations_matched"]
    assert summary["stations_excluded_not_mainline"] == 1, summary
    matched = [r for r in summary["results"] if r["match_status"] == "matched"]
    assert matched[0]["station_id"] == "MAIN", matched
    # The mainline matches its own link correctly; the ramp would have reported 57x.
    assert matched[0]["absolute_percent_error"] < 1.0, matched


def test_the_exclusion_says_why_rather_than_dropping_the_station():
    summary = _ramp_and_mainline()
    excluded = [r for r in summary["results"] if r["match_status"] == "excluded_not_mainline"]
    assert excluded and "RAMP" in excluded[0]["notes"], excluded


def test_a_count_set_that_declares_no_role_is_unaffected():
    # The curated Nevada County file and any hand-supplied CSV have no role
    # column. Treating a missing role as "not mainline" would silently discard
    # every station in them.
    stations = [_station("A", 29040, "State Route 4", "trunk")]
    links = [_link(3, "State Route 4", "trunk", -121.0, 39.0, 29040.0)]
    summary = cv.validate_against_counts(stations, links, required_matches=1)
    assert summary["stations_matched"] == 1, summary
    assert summary["stations_excluded_not_mainline"] == 0, summary

def test_a_station_on_a_link_the_model_never_loaded_is_reported_not_dropped():
    """The comparison is kept, and labelled for what it measures.

    Measured 2026-08-20 across 11 counties in four states: 77-85% of the links
    inside a study boundary carry no assigned volume, because travel moves
    centroid to centroid and loads a skeleton — 34-69% of tertiary roads and
    96-100% of residential and service roads. A count on such a link scores a
    100% error that says nothing about the demand estimate.

    Dropping it would be the obvious move and the wrong one: removing a
    comparison because the model loses it is how a model gets flattered by its
    own validator. So the station stays in every figure and the summary says
    how many of them there are.
    """
    on_air = _station("LOADED", 20000, "State Route 4", "trunk")
    unloaded = _station("UNLOADED", 24000, "Selah Road", "tertiary")
    links = [
        _link(1, "State Route 4", "trunk", -121.0, 39.0, 19000.0),
        _link(2, "Selah Road", "tertiary", -121.1, 39.1, 0.0),
    ]
    summary = cv.validate_against_counts([on_air, unloaded], links, required_matches=1)

    assert summary["stations_matched"] == 2, summary["stations_matched"]
    assert summary["stations_on_unloaded_links"] == 1, summary
    assert "1 of 2 matched station" in summary["stations_on_unloaded_links_note"], summary
    # …and it is still in the error figures, dragging them down.
    matched = [r for r in summary["results"] if r["match_status"] == "matched"]
    assert any(float(r["modeled_daily_pce"]) == 0.0 for r in matched), matched
    assert summary["max_ape"] == 100.0, summary["max_ape"]


def test_a_run_that_loaded_every_matched_link_says_so_plainly():
    """The absence has to read as measured, not as a field nobody filled in."""
    st = _station("A", 29040, "State Route 4", "trunk")
    links = [_link(3, "State Route 4", "trunk", -121.0, 39.0, 29040.0)]
    summary = cv.validate_against_counts([st], links, required_matches=1)
    assert summary["stations_on_unloaded_links"] == 0, summary
    assert "Every matched station" in summary["stations_on_unloaded_links_note"], summary



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
