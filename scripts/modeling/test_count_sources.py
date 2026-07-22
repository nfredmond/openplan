#!/usr/bin/env python3
"""Stdlib-only checks for the multi-state count-source normalizer (no network)."""
import sys

import count_sources as cs


def test_caltrans_back_ahead_point_normalizes():
    # GeoJSON point + BACK/AHEAD fields (Caltrans shape).
    raw = [{"geometry": {"type": "Point", "coordinates": [-121.06, 39.20]},
            "properties": {"RTE": "20", "PM": "12.24", "DESCRIPTION": "JCT 49",
                           "BACK_AADT": "22600", "AHEAD_AADT": "45500"}}]
    out = cs.normalize_features(raw, cs.COUNT_SOURCES["CA"]["fields"])
    assert len(out) == 1
    p = out[0]["properties"]
    assert p["RTE"] == "20" and p["BACK_AADT"] == "22600" and p["AHEAD_AADT"] == "45500"
    assert out[0]["geometry"]["coordinates"] == [-121.06, 39.20]


def test_single_aadt_field_expands_to_back_ahead():
    fields = {"route": "ROUTE", "description": "LOC", "aadt": "AADT"}
    raw = [{"geometry": {"type": "Point", "coordinates": [-122.0, 47.0]},
            "properties": {"ROUTE": "US 50", "LOC": "Main St", "AADT": 31000}}]
    out = cs.normalize_features(raw, fields)
    p = out[0]["properties"]
    assert p["BACK_AADT"] == 31000 and p["AHEAD_AADT"] == 31000 and p["RTE"] == "US 50"


def test_linestring_segment_reduces_to_centroid():
    fields = {"route": "R", "aadt": "AADT"}
    raw = [{"geometry": {"type": "LineString", "coordinates": [[-120.0, 38.0], [-120.2, 38.4]]},
            "properties": {"R": "49", "AADT": 12000}}]
    out = cs.normalize_features(raw, fields)
    lon, lat = out[0]["geometry"]["coordinates"]
    assert abs(lon - (-120.1)) < 1e-9 and abs(lat - 38.2) < 1e-9, (lon, lat)


def test_esri_attributes_xy_form():
    fields = {"route": "R", "aadt": "AADT"}
    raw = [{"geometry": {"x": -121.5, "y": 39.1}, "attributes": {"R": "174", "AADT": 8800}}]
    out = cs.normalize_features(raw, fields)
    assert out[0]["geometry"]["coordinates"] == [-121.5, 39.1]
    assert out[0]["properties"]["AHEAD_AADT"] == 8800


def test_missing_geometry_skipped():
    out = cs.normalize_features([{"properties": {"RTE": "20"}}], cs.COUNT_SOURCES["CA"]["fields"])
    assert out == []


def test_unknown_region_raises():
    try:
        cs.fetch_aadt_geojson((-121, 39, -120, 40), "ZZ", "/tmp/x.geojson")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "ZZ" in str(e)


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} count-source checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
