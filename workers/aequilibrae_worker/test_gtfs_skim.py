#!/usr/bin/env python3
"""Checks for the GTFS transit-skim (gtfs_skim.py). Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_gtfs_skim.py

Uses an in-memory GTFS .zip fixture — no network, no CENSUS key. Also smoke-tests
the bundled Nevada County feed if present.
"""
import io
import os
import sys
import tempfile
import zipfile

import numpy as np

import gtfs_skim as gs


def _fixture_zip(with_stops=True):
    """Tiny GTFS: 3 stops on a line (A→B→C), 2 trips 30 min apart, weekday service."""
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\n1,Test,http://t,America/Los_Angeles\n",
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "WKDY,1,1,1,1,1,0,0,20250101,20261231\n"
        ),
        "routes.txt": "route_id,route_short_name,route_type\nR1,1,3\n",
        # outbound A→B→C (dir 0) and return C→B→A (dir 1), 2 trips each
        "trips.txt": (
            "route_id,service_id,trip_id,direction_id\n"
            "R1,WKDY,t1,0\nR1,WKDY,t2,0\nR1,WKDY,t3,1\nR1,WKDY,t4,1\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "t1,08:00:00,08:00:00,A,1\n"
            "t1,08:10:00,08:10:00,B,2\n"
            "t1,08:20:00,08:20:00,C,3\n"
            "t2,08:30:00,08:30:00,A,1\n"
            "t2,08:40:00,08:40:00,B,2\n"
            "t2,08:50:00,08:50:00,C,3\n"
            "t3,09:00:00,09:00:00,C,1\n"
            "t3,09:10:00,09:10:00,B,2\n"
            "t3,09:20:00,09:20:00,A,3\n"
            "t4,09:30:00,09:30:00,C,1\n"
            "t4,09:40:00,09:40:00,B,2\n"
            "t4,09:50:00,09:50:00,A,3\n"
        ),
    }
    if with_stops:
        files["stops.txt"] = (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "A,Stop A,39.200,-121.050\n"
            "B,Stop B,39.210,-121.060\n"
            "C,Stop C,39.220,-121.070\n"
        )
    else:
        files["stops.txt"] = "stop_id,stop_name,stop_lat,stop_lon\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    path = tempfile.mktemp(suffix=".zip")
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    return path


def test_parse_and_headway():
    los = gs.load_feed(path=_fixture_zip())
    assert los.n_routes == 1
    assert los.n_stops == 3
    assert los.service_day == "monday"
    assert len(los.lines) == 2  # outbound + return directions
    # outbound R1/dir0: first-stop departures 08:00, 08:30 → gap 30 min over
    # (2-1) gaps → headway 30 min (NOT arrival-inclusive span/n_trips).
    line = los.lines[("R1", "0")]
    assert abs(line["headway_min"] - 30.0) < 1e-6, line["headway_min"]
    # cum in-vehicle A→C = 20 min (1200 s)
    assert line["cum"]["C"] - line["cum"]["A"] == 1200


def test_skim_available_and_los():
    los = gs.load_feed(path=_fixture_zip())
    # zone 0 near stop A, zone 1 near stop C, zone 2 far from any stop
    lons = np.array([-121.050, -121.070, -120.500])
    lats = np.array([39.200, 39.220, 39.500])
    sk = gs.transit_skim(los, lons, lats)
    assert sk["available"][0, 1] and sk["available"][1, 0]  # A<->C served
    # ivtt A→C = 20 min; wait = headway/2 = 15
    assert abs(sk["ivtt"][0, 1] - 20.0) < 1e-6
    assert abs(sk["wait"][0, 1] - 15.0) < 1e-6
    assert sk["fare"][0, 1] == gs.GTFS_FLAT_FARE
    # zone 2 has no access stop → unavailable for any pair touching it
    assert not sk["available"][0, 2] and not sk["available"][2, 0]
    # intrazonal is unavailable by construction
    assert not sk["available"][0, 0]


def test_empty_feed_raises():
    raised = False
    try:
        gs.load_feed(path=_fixture_zip(with_stops=False))
    except gs.GtfsError:
        raised = True
    assert raised, "a feed with no stops must raise GtfsError (fail loud)"


def test_frequencies_feed_rejected():
    # a frequencies.txt-based feed must fail loud (headway skim reads stop_times)
    path = _fixture_zip()
    import zipfile as _zf
    buf = io.BytesIO()
    with _zf.ZipFile(path) as src, _zf.ZipFile(buf, "w") as dst:
        for name in src.namelist():
            dst.writestr(name, src.read(name))
        dst.writestr("frequencies.txt", "trip_id,start_time,end_time,headway_secs\nt1,08:00:00,10:00:00,600\n")
    path2 = tempfile.mktemp(suffix=".zip")
    with open(path2, "wb") as fh:
        fh.write(buf.getvalue())
    raised = False
    try:
        gs.load_feed(path=path2)
    except gs.GtfsError:
        raised = True
    assert raised, "frequencies.txt feed must raise GtfsError"


def test_missing_feed_raises():
    raised = False
    try:
        gs.load_feed(path="/nonexistent/path/to/feed.zip")
    except gs.GtfsError:
        raised = True
    assert raised


def test_bundled_feed_smoke():
    # The real bundled Nevada County feed, if present, parses and yields a small
    # served-pair set (not a hard requirement in all envs).
    default = gs._DEFAULT_GTFS_PATH
    if not os.path.exists(default):
        print("  (bundled feed absent — skipping smoke)")
        return
    los = gs.load_feed()
    assert los.n_routes >= 1 and los.n_stops >= 1
    lons = np.array([-121.05, -121.02, -120.98])
    lats = np.array([39.23, 39.26, 39.22])
    sk = gs.transit_skim(los, lons, lats)
    assert sk["available"].shape == (3, 3)
    assert bool(np.all(np.diag(sk["available"]) == False))  # intrazonal never available


def test_feed_covers_study_area():
    los = gs.load_feed(path=_fixture_zip())
    # Zones sitting over the feed's stops → covered.
    near_lons = np.array([-121.055, -121.065])
    near_lats = np.array([39.205, 39.215])
    assert gs.feed_covers(los, near_lons, near_lats)
    # Zones in central Texas, far from any Nevada-County stop → NOT covered
    # (this is the case that must report transit as "no_local_feed", not "modeled").
    far_lons = np.array([-97.74, -97.70])
    far_lats = np.array([30.27, 30.30])
    assert not gs.feed_covers(los, far_lons, far_lats)
    # Degenerate empty extent → not covered.
    assert not gs.feed_covers(los, np.array([]), np.array([]))


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} gtfs_skim checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
