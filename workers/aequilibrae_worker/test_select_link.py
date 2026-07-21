#!/usr/bin/env python3
"""Checks for select-link corridor attribution.

Needs numpy (count_validation is stdlib):

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_select_link.py

Invariant: this DECOMPOSES demand the assignment already routed. The math must
be a partition (local + commute + through == total), never invent or drop trips.
"""
import sys

import numpy as np

import select_link as sl


def _station(**kw):
    base = {
        "station_id": "S1", "label": "S1",
        "candidate_model_names": "SR 20|Golden Center Freeway",
        "candidate_link_types": "motorway|trunk",
        "bbox_min_lon": -121.1, "bbox_min_lat": 39.1,
        "bbox_max_lon": -121.0, "bbox_max_lat": 39.3,
    }
    base.update(kw)
    return base


def _link(lid, name, lt, lon, lat):
    return {"link_id": lid, "name": name, "link_type": lt, "lon": lon, "lat": lat}


def test_screenline_prefers_named_over_type():
    links = [
        _link(1, "SR 20", "motorway", -121.05, 39.2),          # named + in bbox
        _link(2, "Golden Center Freeway", "motorway", -121.06, 39.21),  # facility/name
        _link(3, "Random Local Rd", "motorway", -121.05, 39.2),  # type-only, in bbox
        _link(4, "SR 20", "motorway", -120.5, 39.2),           # named but OUTSIDE bbox
    ]
    out = sl.select_link_screenlines([_station()], links)
    assert out == {"S1": [1, 2]}, out  # named only; type-only(3) dropped, out-of-bbox(4) dropped


def test_screenline_type_fallback_when_no_named_match():
    links = [_link(7, "Unnamed Hwy", "motorway", -121.05, 39.2)]
    st = _station(candidate_model_names="", facility_name="")
    out = sl.select_link_screenlines([st], links)
    assert out == {"S1": [7]}, out


def test_screenline_excludes_and_type_filter():
    links = [
        _link(1, "SR 20", "motorway", -121.05, 39.2),
        _link(2, "SR 20 Frontage", "residential", -121.05, 39.2),  # wrong type
        _link(3, "SR 20 Ramp", "motorway", -121.05, 39.2),
    ]
    st = _station(exclude_model_names="SR 20 Ramp")
    out = sl.select_link_screenlines([st], links)
    assert out == {"S1": [1]}, out  # frontage wrong-type, ramp excluded


def test_screenline_caps_links_per_station():
    links = [_link(i, "SR 20", "motorway", -121.05, 39.2) for i in range(1, 40)]
    out = sl.select_link_screenlines([_station()], links)
    assert len(out["S1"]) == sl.MAX_LINKS_PER_SCREENLINE


def test_classify_partitions_all_demand():
    # 4 centroids: 0,1 internal; 2,3 cordon.
    od = np.arange(16, dtype=float).reshape(4, 4)
    is_cordon = np.array([False, False, True, True])
    c = sl.classify_od_by_endpoint(od, is_cordon)
    assert abs(c["total"] - od.sum()) < 1e-9
    parts = c["internal_internal"] + c["internal_cordon"] + c["cordon_internal"] + c["cordon_cordon"]
    assert abs(parts - c["total"]) < 1e-9, c
    # internal_internal = rows{0,1} x cols{0,1} = 0+1+4+5 = 10
    assert c["internal_internal"] == 10.0, c
    # cordon_cordon = rows{2,3} x cols{2,3} = 10+11+14+15 = 50
    assert c["cordon_cordon"] == 50.0, c


def test_link_attribution_three_way_split():
    is_cordon = np.array([False, False, True, True])
    od = np.zeros((4, 4))
    od[0, 1] = 60.0   # internal->internal : local
    od[1, 2] = 30.0   # internal->cordon   : commute (outbound)
    od[2, 0] = 10.0   # cordon->internal   : commute (inbound)
    od[2, 3] = 100.0  # cordon->cordon     : through
    a = sl.link_attribution(od, is_cordon)
    assert a["local_trips"] == 60.0 and a["commute_trips"] == 40.0 and a["through_trips"] == 100.0, a
    assert a["total_trips"] == 200.0
    assert abs(a["local_share"] - 0.3) < 1e-9
    assert abs(a["commute_share"] - 0.2) < 1e-9
    assert abs(a["through_share"] - 0.5) < 1e-9


def test_link_attribution_unreached_screenline_is_none_not_zero():
    a = sl.link_attribution(np.zeros((3, 3)), np.array([False, True, True]))
    assert a["total_trips"] == 0.0
    assert a["local_share"] is None and a["through_share"] is None, a


def test_classify_rejects_bad_shapes():
    for bad in (np.zeros((2, 3)), np.zeros((2, 2, 2))):
        try:
            sl.classify_od_by_endpoint(bad, np.array([True, False]))
            assert False, "expected ValueError"
        except ValueError:
            pass
    try:
        sl.classify_od_by_endpoint(np.zeros((3, 3)), np.array([True, False]))  # mask len mismatch
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_result_is_json_safe():
    import json
    is_cordon = np.array([False, True])
    a = sl.link_attribution(np.array([[5.0, 3.0], [2.0, 1.0]]), is_cordon)
    json.dumps(a)  # no numpy scalar types leak through


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} select-link checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
