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


def test_multi_state_registry_shape():
    # Every registered source is a queryable /query URL with a usable field map:
    # a route field + either a single aadt or a back/ahead split.
    for region in ("CA", "WA", "CO", "OR"):
        src = cs.COUNT_SOURCES[region]
        assert src["query_url"].endswith("/query"), region
        f = src["fields"]
        assert "route" in f, region
        assert ("aadt" in f) or ("back_aadt" in f and "ahead_aadt" in f), region


class _FakeResp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _FakeRequests:
    """Records the requested `f` formats and returns per-format canned payloads."""
    def __init__(self, by_format):
        self.by_format = by_format
        self.formats = []

    def get(self, url, params=None, timeout=None):
        fmt = (params or {}).get("f")
        self.formats.append(fmt)
        return self.by_format[fmt]


def _with_fake_requests(fake, fn):
    import sys
    orig = sys.modules.get("requests")
    sys.modules["requests"] = fake
    try:
        return fn()
    finally:
        if orig is not None:
            sys.modules["requests"] = orig
        else:
            sys.modules.pop("requests", None)


def _tmp_out():
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".geojson")
    import os
    os.close(fd)
    return path


def test_fetch_uses_geojson_when_it_succeeds():
    # GeoJSON responds cleanly → no wasteful Esri-JSON retry (WA/CO shape).
    fake = _FakeRequests({
        "geojson": _FakeResp(200, {"type": "FeatureCollection", "features": [
            {"geometry": {"type": "Point", "coordinates": [-122.32, 47.59]},
             "properties": {"RouteIdentifier": "005", "Location": "I-5",
                            "AccumulatedRouteMile": 0.3, "AADT": 16000}},
        ]}),
    })
    out = _tmp_out()
    n = _with_fake_requests(fake, lambda: cs.fetch_aadt_geojson(
        (-122.35, 47.55, -122.30, 47.65), "WA", out))
    assert fake.formats == ["geojson"], fake.formats
    assert n == 1
    import json as _json
    feat = _json.load(open(out))["features"][0]
    assert feat["properties"]["BACK_AADT"] == 16000 and feat["properties"]["AHEAD_AADT"] == 16000


def test_fetch_falls_back_to_esri_json_when_geojson_errors():
    # ODOT shape: GeoJSON 400s on geometry serialization → retry Esri JSON, which
    # returns attributes + {x,y}. The normalizer handles it identically.
    fake = _FakeRequests({
        "geojson": _FakeResp(400, {"error": {"code": 400, "message": "Failed to execute query."}}),
        "json": _FakeResp(200, {"features": [
            {"attributes": {"HWYNUMB": "002", "LOCATION": "I-84", "MP": 4.17, "AADT": 3257},
             "geometry": {"x": -122.59, "y": 45.53}},
        ]}),
    })
    out = _tmp_out()
    n = _with_fake_requests(fake, lambda: cs.fetch_aadt_geojson(
        (-122.75, 45.40, -122.55, 45.60), "OR", out))
    assert fake.formats == ["geojson", "json"], fake.formats  # tried geojson, then json
    assert n == 1
    import json as _json
    feat = _json.load(open(out))["features"][0]
    assert feat["geometry"]["coordinates"] == [-122.59, 45.53]
    assert feat["properties"]["BACK_AADT"] == 3257 and feat["properties"]["RTE"] == "002"


def test_fetch_raises_when_both_formats_fail():
    fake = _FakeRequests({
        "geojson": _FakeResp(400, {"error": {"code": 400}}),
        "json": _FakeResp(500, {}),
    })
    out = _tmp_out()
    try:
        _with_fake_requests(fake, lambda: cs.fetch_aadt_geojson(
            (-122.75, 45.40, -122.55, 45.60), "OR", out))
        assert False, "expected an error when both formats fail"
    except Exception:
        pass
    assert fake.formats == ["geojson", "json"]


def test_fetch_falls_back_when_geojson_returns_http200_error_envelope():
    # Some ArcGIS servers answer HTTP 200 with an {"error": {...}} body instead of
    # a 4xx. That must NOT be read as "zero stations" — it must fall back to Esri
    # JSON, not silently drop the run to screening-grade.
    fake = _FakeRequests({
        "geojson": _FakeResp(200, {"error": {"code": 400, "message": "Failed to execute query."}}),
        "json": _FakeResp(200, {"features": [
            {"attributes": {"HWYNUMB": "002", "LOCATION": "I-84", "MP": 4.17, "AADT": 3257},
             "geometry": {"x": -122.59, "y": 45.53}},
        ]}),
    })
    out = _tmp_out()
    n = _with_fake_requests(fake, lambda: cs.fetch_aadt_geojson(
        (-122.75, 45.40, -122.55, 45.60), "OR", out))
    assert fake.formats == ["geojson", "json"], fake.formats
    assert n == 1
    import json as _json
    assert _json.load(open(out))["features"][0]["properties"]["BACK_AADT"] == 3257


def test_fetch_raises_on_http200_error_envelope_from_both_formats():
    # A 200 {"error"} from BOTH formats must raise (never write a silent empty
    # FeatureCollection that reads as "no counts here").
    fake = _FakeRequests({
        "geojson": _FakeResp(200, {"error": {"code": 400}}),
        "json": _FakeResp(200, {"error": {"code": 400}}),
    })
    out = _tmp_out()
    try:
        _with_fake_requests(fake, lambda: cs.fetch_aadt_geojson(
            (-122.75, 45.40, -122.55, 45.60), "OR", out))
        assert False, "expected an error when both formats return a 200 error envelope"
    except Exception:
        pass
    assert fake.formats == ["geojson", "json"]


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
