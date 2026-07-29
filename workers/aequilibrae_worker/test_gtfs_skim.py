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
import time
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


def test_a_loaded_feed_can_name_itself():
    # Provenance the run-detail evidence panel shows: a planner defending a VMT
    # number has to be able to say WHICH feed produced the transit share. A
    # disk-loaded feed reports its file name and no URL; the absolute path is
    # deliberately not carried, being the operator's server layout rather than
    # planning provenance.
    path = _fixture_zip()
    los = gs.load_feed(path=path)
    assert los.source_name == os.path.basename(path), los.source_name
    assert los.source_url is None
    assert os.path.dirname(path) not in (los.source_name or ""), "must not carry the server path"


def _fixture_zip_with_dangling_stop():
    """The same feed, plus a stop_times row naming a stop stops.txt never defines.

    A real and common publisher mistake — the skim has to survive it, because with
    per-place discovery on by default the worker now reads whatever feed the
    catalog names, not a feed anyone curated.
    """
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\n1,Test,http://t,America/Los_Angeles\n",
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "WKDY,1,1,1,1,1,0,0,20250101,20261231\n"
        ),
        "routes.txt": "route_id,route_short_name,route_type\nR1,1,3\n",
        "trips.txt": "route_id,service_id,trip_id,direction_id\nR1,WKDY,t1,0\nR1,WKDY,t2,0\n",
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "A,Stop A,39.200,-121.050\n"
            "C,Stop C,39.220,-121.070\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "t1,08:00:00,08:00:00,A,1\n"
            "t1,08:10:00,08:10:00,GHOST,2\n"
            "t1,08:20:00,08:20:00,C,3\n"
            "t2,08:30:00,08:30:00,A,1\n"
            "t2,08:40:00,08:40:00,GHOST,2\n"
            "t2,08:50:00,08:50:00,C,3\n"
        ),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    path = tempfile.mktemp(suffix=".zip")
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    return path


def test_a_feed_naming_an_undefined_stop_still_produces_a_skim():
    # The failure this pins: the walk-access search looked up the coordinates of
    # every stop with service, so one stop_times row naming a stop stops.txt does
    # not define raised a bare KeyError. The worker caught it, reported
    # feed_unavailable, and the run lost its transit share — turning a publisher's
    # typo into an inflated VMT number for a place with real transit service.
    los = gs.load_feed(path=_fixture_zip_with_dangling_stop())
    # The undefined stop is not a SERVED stop: it cannot be boarded, and it must
    # not be counted in the served-stop total the evidence panel shows.
    assert "GHOST" not in los.stop_lines
    assert los.n_stops == 2, los.n_stops
    # It remains a timing point, so in-vehicle time across it is still correct.
    assert los.lines[("R1", "0")]["cum"]["C"] == 1200

    lons = np.array([-121.050, -121.070])
    lats = np.array([39.200, 39.220])
    sk = gs.transit_skim(los, lons, lats)
    assert bool(sk["available"][0, 1]), "A→C is a direct scheduled trip and must be available"
    assert abs(sk["ivtt"][0, 1] - 20.0) < 1e-6, sk["ivtt"][0, 1]


def test_a_skim_that_runs_past_its_budget_stops_instead_of_stalling_the_queue():
    # The worker runs its stages serially inside one queued job, so an unbounded
    # transit skim does not merely delay its own run — a dense multi-operator feed
    # against a large zone system stalls every run queued behind it, with nothing
    # anywhere saying why. The budget converts that into a named refusal the
    # evidence panel can print. It is a WALL CLOCK bound, not a size threshold:
    # nothing here inspects how big a feed is or refuses one for being large.
    los = gs.load_feed(path=_fixture_zip())
    lons = np.array([-121.050, -121.070])
    lats = np.array([39.200, 39.220])

    raised = None
    try:
        # A deadline already in the past — the same state as a skim that has been
        # grinding for longer than the operator's budget allows.
        gs.transit_skim(los, lons, lats, deadline=time.monotonic() - 1.0)
    except gs.GtfsTimeout as exc:
        raised = exc
    assert raised is not None, "an exhausted budget must abandon the skim, not run forever"
    # The refusal names what ran long. "Timed out" alone would send a planner
    # hunting through a feed that is fine.
    assert "wall-clock budget" in str(raised), str(raised)
    # A GtfsError subclass, so every existing handler still degrades to "transit
    # not modeled" rather than killing the whole model run.
    assert isinstance(raised, gs.GtfsError)


def test_a_budget_that_is_not_exhausted_changes_nothing_about_the_answer():
    # The budget must not be able to alter a modeled number — it only decides
    # whether the run finishes or says it could not.
    los = gs.load_feed(path=_fixture_zip())
    lons = np.array([-121.050, -121.070])
    lats = np.array([39.200, 39.220])
    unbounded = gs.transit_skim(los, lons, lats)
    generous = gs.transit_skim(los, lons, lats, deadline=time.monotonic() + 3600.0)
    assert bool(generous["available"][0, 1]) is bool(unbounded["available"][0, 1])
    assert abs(generous["ivtt"][0, 1] - unbounded["ivtt"][0, 1]) < 1e-9


def test_an_operator_can_switch_the_budget_off_entirely():
    # A long-running batch machine with no queue behind it should be able to let a
    # skim take as long as it takes. Zero (or negative) means unbounded, and an
    # empty value — which some hosts hand over for a variable nobody set — falls
    # back to the bounded default rather than silently removing the bound.
    assert gs.stage_deadline(0) is None
    assert gs.stage_deadline(-1) is None
    assert gs.stage_deadline(30) is not None
    # An exhausted-budget check with no deadline at all must be a no-op.
    gs.check_deadline(None, "doing nothing in particular")

    # The empty-value claim above, asserted rather than merely stated: a host that
    # materializes an undefined variable as "" must land on the bounded default,
    # not on an accidental "unbounded", and a typo must not do it either.
    prior = os.environ.get("GTFS_STAGE_BUDGET_S")
    try:
        for blank in ("", "   ", "\t"):
            os.environ["GTFS_STAGE_BUDGET_S"] = blank
            assert gs._stage_budget_seconds() == gs._DEFAULT_STAGE_BUDGET_S, blank
        os.environ["GTFS_STAGE_BUDGET_S"] = "twenty minutes"
        assert gs._stage_budget_seconds() == gs._DEFAULT_STAGE_BUDGET_S
        os.environ["GTFS_STAGE_BUDGET_S"] = "45"
        assert gs._stage_budget_seconds() == 45.0
        os.environ["GTFS_STAGE_BUDGET_S"] = "0"
        assert gs.stage_deadline(gs._stage_budget_seconds()) is None
    finally:
        if prior is None:
            os.environ.pop("GTFS_STAGE_BUDGET_S", None)
        else:
            os.environ["GTFS_STAGE_BUDGET_S"] = prior


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
