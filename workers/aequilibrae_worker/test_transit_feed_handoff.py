#!/usr/bin/env python3
"""A run may name one of its workspace's own ingested GTFS feeds (transit-feed-v1).

The handoff carries a UUID and nothing else. The worker resolves that id against
`gtfs_feed_versions` under its own tenancy filter, reads the EXACT archive
OpenPlan parsed out of private storage, verifies the checksum the ingest
recorded, and skims those bytes. It never refetches `source_url` on this path,
and it never substitutes a different feed when the chosen one cannot be used.

These checks exist because every interesting failure here is a HONESTY failure
rather than a crash — a run that quietly skims some other feed while the KPI
provenance sentence names the one a planner picked looks exactly like a run that
worked. Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python \
        workers/aequilibrae_worker/test_transit_feed_handoff.py
"""
import ast
import hashlib
import io
import os
import re
import sys
import types
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import gtfs_skim as gs  # noqa: E402


def _stub_missing_dependency(name: str, build) -> None:
    """Install a minimal stand-in ONLY when the real package is absent.

    Same device `test_zone_attributes.py` uses, and for the same reason: `main`
    imports the scientific stack at module scope while everything exercised below
    is pure or stubbed. In the worker venv these never install.
    """
    try:
        __import__(name)
        return
    except ImportError:
        pass
    for module_name, module in build().items():
        sys.modules.setdefault(module_name, module)


def _pandas_stub():
    module = types.ModuleType("pandas")
    module.DataFrame = object
    module.concat = lambda *a, **k: None
    module.to_numeric = lambda *a, **k: None
    module.read_csv = lambda *a, **k: None
    return {"pandas": module}


def _shapely_stub():
    geometry = types.ModuleType("shapely.geometry")
    geometry.Point = object
    geometry.shape = lambda *a, **k: None
    geometry.box = lambda *a, **k: None
    wkt = types.ModuleType("shapely.wkt")
    wkt.loads = lambda *a, **k: None
    root = types.ModuleType("shapely")
    root.geometry = geometry
    root.wkt = wkt
    return {"shapely": root, "shapely.geometry": geometry, "shapely.wkt": wkt}


def _dotenv_stub():
    module = types.ModuleType("dotenv")
    module.load_dotenv = lambda *a, **k: False
    return {"dotenv": module}


def _aequilibrae_stub():
    class OSMBuilder:  # noqa: D401 - stand-in
        pass

    osm_builder = types.ModuleType("aequilibrae.project.network.osm.osm_builder")
    osm_builder.OSMBuilder = OSMBuilder
    names = [
        "aequilibrae",
        "aequilibrae.project",
        "aequilibrae.project.network",
        "aequilibrae.project.network.osm",
    ]
    modules = {name: types.ModuleType(name) for name in names}
    modules["aequilibrae.project.network.osm.osm_builder"] = osm_builder
    return modules


_stub_missing_dependency("pandas", _pandas_stub)
_stub_missing_dependency("shapely", _shapely_stub)
_stub_missing_dependency("dotenv", _dotenv_stub)
_stub_missing_dependency("aequilibrae", _aequilibrae_stub)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

import main  # noqa: E402

WORKSPACE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
OTHER_WORKSPACE = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
FEED_ID = "cccccccc-3333-4333-8333-cccccccccccc"
VERSION_ID = "dddddddd-4444-4444-8444-dddddddddddd"
PUBLISHER_URL = "http://agency.example/gtfs.zip"


# --------------------------------------------------------------------------- #
# Fixtures                                                                     #
# --------------------------------------------------------------------------- #


def _feed_bytes(files: dict[str, str] | None = None) -> bytes:
    """A tiny valid GTFS: 3 stops on one line, 2 trips 30 minutes apart."""
    base = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\n1,T,http://t,America/Los_Angeles\n",
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "WKDY,1,1,1,1,1,0,0,20250101,20261231\n"
        ),
        "routes.txt": "route_id,route_short_name,route_type\nR1,1,3\n",
        "trips.txt": "route_id,service_id,trip_id,direction_id\nR1,WKDY,t1,0\nR1,WKDY,t2,0\n",
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "A,Stop A,39.200,-121.050\nB,Stop B,39.210,-121.060\nC,Stop C,39.220,-121.070\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "t1,08:00:00,08:00:00,A,1\nt1,08:10:00,08:10:00,B,2\nt1,08:20:00,08:20:00,C,3\n"
            "t2,08:30:00,08:30:00,A,1\nt2,08:40:00,08:40:00,B,2\nt2,08:50:00,08:50:00,C,3\n"
        ),
    }
    base.update(files or {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in base.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _version_row(**overrides) -> dict:
    raw = overrides.pop("_bytes", None)
    row = {
        "id": VERSION_ID,
        "feed_id": FEED_ID,
        "workspace_id": WORKSPACE,
        "source_kind": "upload",
        "source_url": None,
        "storage_path": f"{WORKSPACE}/{FEED_ID}/{VERSION_ID}.zip",
        "checksum_sha256": hashlib.sha256(raw if raw is not None else _feed_bytes()).hexdigest(),
        "byte_size": 1,
        "service_start_date": "2025-01-01",
        "service_end_date": "2026-12-31",
        "status": "ready",
        "is_current": True,
    }
    row.update(overrides)
    return row


class _Response:
    def __init__(self, status_code=200, payload=None, content=b""):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.text = ""

    def json(self):
        return self._payload


class _FakeRequests:
    """Records every URL the worker asks for, so a test can assert what it did
    NOT ask for. That negative is the point: a refetch of the publisher's URL is
    invisible in the result and visible only here."""

    def __init__(self, version_rows=None, agency_rows=None, object_bytes=None,
                 object_status=200, version_status=200, rows_by_id=None,
                 current_rows=None, objects=None):
        self.urls = []
        self.version_rows = version_rows
        self.agency_rows = agency_rows if agency_rows is not None else [{"agency_name": "Test Transit"}]
        self.object_bytes = object_bytes
        self.object_status = object_status
        self.version_status = version_status
        #: version id -> row. A query naming no known id gets `current_rows`,
        #: which is what a worker filtering on `is_current` would receive.
        self.rows_by_id = rows_by_id
        self.current_rows = current_rows if current_rows is not None else []
        #: storage_path -> bytes. Any other key answers 404, as Storage does.
        self.objects = objects

    def version_query_urls(self):
        return [u for u in self.urls if "/rest/v1/gtfs_feed_versions" in u]

    def storage_urls(self):
        return [u for u in self.urls if "/storage/v1/object/" in u]

    def get(self, url, **kwargs):
        self.urls.append(url)
        if "/rest/v1/gtfs_feed_versions" in url:
            if self.rows_by_id is not None:
                match = re.search(r"[?&]id=eq\.([^&]+)", url)
                row = self.rows_by_id.get(match.group(1)) if match else None
                return _Response(self.version_status, [row] if row else self.current_rows)
            return _Response(self.version_status, self.version_rows)
        if "/rest/v1/gtfs_feeds" in url:
            return _Response(200, self.agency_rows)
        if "/storage/v1/object/" in url:
            if self.objects is not None:
                key = url.split(f"/storage/v1/object/{main.GTFS_UPLOADS_BUCKET}/", 1)[-1]
                if key not in self.objects:
                    return _Response(404, None, b"")
                return _Response(200, None, self.objects[key])
            return _Response(self.object_status, None, self.object_bytes or b"")
        raise AssertionError(f"the worker asked for an unexpected URL: {url}")


def _with_requests(fake, fn):
    original = main.requests
    main.requests = fake
    try:
        return fn()
    finally:
        main.requests = original


def _stamp(**overrides) -> dict:
    stamp = {
        "version": gs.TRANSIT_FEED_STAMP_VERSION,
        "status": "selected",
        "feedVersionId": VERSION_ID,
        "reason": None,
    }
    stamp.update(overrides)
    return {"input_snapshot_json": {"transitFeed": stamp}}


# --------------------------------------------------------------------------- #
# The stamp: what the worker will and will not act on                          #
# --------------------------------------------------------------------------- #


def test_the_wire_format_string_is_pinned_against_a_literal_on_this_side():
    # A CROSS-LANGUAGE CONSTANT NOTHING PINNED. `parse_feed_selection` refuses
    # any stamp whose `version` it does not recognise — correctly, since guessing
    # at an unknown shape is how a run silently skims a feed nobody chose. So the
    # two sides agreeing on this string is the whole feature, and drifting either
    # by one character kills it with all 21 worker suites green.
    #
    # The app pins the same literal in `src/test/transit-feed-handoff.test.ts`.
    # Two literals in two languages means a change to the contract has to appear
    # as a deliberate edit on BOTH sides of a diff, which is the only form of
    # this that a reviewer can see.
    assert gs.TRANSIT_FEED_STAMP_VERSION == "transit-feed-v1", gs.TRANSIT_FEED_STAMP_VERSION


def test_a_run_that_says_nothing_about_transit_behaves_exactly_as_before():
    # The compatibility guarantee, made structural rather than promised: an absent
    # stamp produces None, and a None selection reaches no new branch anywhere.
    # Every run launched before this feature existed, and every run from an engine
    # that never reaches the transit stage, is in this case.
    for row in (None, {}, {"input_snapshot_json": None}, {"input_snapshot_json": {}},
                {"input_snapshot_json": {"transitFeed": None}},
                {"input_snapshot_json": {"transitFeed": "yes please"}},
                {"input_snapshot_json": "not a dict"}):
        assert gs.parse_feed_selection(row) is None, row


def test_leaving_automatic_discovery_on_is_not_a_selection():
    # `not_selected` is the planner declining to pick, which must be identical to
    # not being asked. Collapsing it into the same None as "absent" is what makes
    # that identical rather than merely similar.
    assert gs.parse_feed_selection(_stamp(status="not_selected", feedVersionId=None)) is None


def test_a_selected_feed_is_handed_over_as_an_id_and_nothing_else():
    selection = gs.parse_feed_selection(_stamp())
    assert selection is not None
    assert selection.status == "selected"
    assert selection.feed_version_id == VERSION_ID
    # There is no field on FeedSelection through which a member-written snapshot
    # could supply a storage path, a checksum, an agency name or a service date.
    # The worker reads all of those from the database itself, which is why a
    # forged snapshot cannot reach the evidence packet.
    forbidden = {"storage_path", "storagePath", "checksum", "checksum_sha256",
                 "agency_name", "source_url", "service_end_date"}
    assert not (set(gs.FeedSelection.__slots__) & forbidden), gs.FeedSelection.__slots__


def test_only_a_uuid_may_reach_the_database_query():
    # `input_snapshot_json` is writable by any workspace member and the worker
    # reads with the service-role key, which has no RLS above it. The tenancy
    # filter the worker appends is only load-bearing if the id cannot escape from
    # inside itself.
    for hostile in (
        "not-a-uuid",
        f"{VERSION_ID}&workspace_id=is.null",
        f"{VERSION_ID}*",
        "*",
        f"  {VERSION_ID}/../../secret",
        "",
        None,
        12345,
        {"id": VERSION_ID},
    ):
        selection = gs.parse_feed_selection(_stamp(feedVersionId=hostile))
        assert selection is not None, hostile
        assert selection.status != "selected", hostile
        assert selection.feed_version_id is None, hostile
        assert selection.no_feed_reason == "selected_feed_handoff_failed", hostile
    # And the rule itself, so the two callers of it cannot drift apart.
    assert gs.is_uuid(VERSION_ID) is True
    assert gs.is_uuid(f"{VERSION_ID} or true") is False


def test_a_stamp_this_worker_cannot_read_is_refused_rather_than_ignored():
    # The tempting behaviour is to ignore an unrecognised stamp and carry on with
    # discovery. That is the worst option available: the app's surfaces would
    # still name the feed the planner chose while the numbers came from whatever
    # the catalog offered — two surfaces agreeing on a feed that produced none of
    # the results, which is manufactured corroboration rather than a gap.
    future = gs.parse_feed_selection(_stamp(version="transit-feed-v9"))
    assert future is not None and future.status != "selected"
    assert future.no_feed_reason == "selected_feed_stamp_version_unsupported"
    assert "upgrade the worker" in (future.reason or ""), future.reason

    unknown = gs.parse_feed_selection(_stamp(status="probably_fine"))
    assert unknown is not None and unknown.status != "selected"
    assert unknown.no_feed_reason == "selected_feed_handoff_failed"


def test_the_apps_own_refusal_reasons_survive_to_the_planner():
    # The app knows things the worker cannot: that the version failed to ingest,
    # that it is frequency-based, that the handoff itself broke. Repeating its
    # sentence verbatim is the only way the worker's refusal names something a
    # planner can act on.
    cases = {
        "unavailable": "selected_feed_unavailable",
        "unsupported_by_skim": "selected_feed_uses_frequencies",
        "handoff_failed": "selected_feed_handoff_failed",
    }
    for status, expected in cases.items():
        selection = gs.parse_feed_selection(
            _stamp(status=status, feedVersionId=None, reason="The feed's ingest failed on 3 Aug.")
        )
        assert selection is not None and selection.no_feed_reason == expected, status
        assert selection.reason == "The feed's ingest failed on 3 Aug.", status
    # A refusal with no stated reason still says something rather than nothing.
    silent = gs.parse_feed_selection(_stamp(status="unavailable", feedVersionId=None, reason=None))
    assert silent is not None and (silent.reason or "").strip(), silent.reason


# --------------------------------------------------------------------------- #
# Precedence                                                                   #
# --------------------------------------------------------------------------- #


def test_a_runs_own_feed_outranks_the_operators_env_feed_and_says_so():
    # THIS REVERSES THE DOCUMENTED PRECEDENCE, deliberately. GTFS_URL/GTFS_PATH
    # are a deployment-wide DEFAULT for runs that name nothing; a selection is an
    # explicit human act on one run. A default that silently beat a per-run choice
    # would make the launch form's feed picker a control that does nothing, on
    # exactly the deployments most likely to have an env feed set.
    selection = gs.parse_feed_selection(_stamp())
    plan = gs.plan_feed(None, discovering=False, env_url="http://ops/pinned.zip", selection=selection)
    assert plan.origin == "workspace_feed_version", plan.origin
    assert plan.feed_version_id == VERSION_ID
    assert plan.load is True
    # Never silent. An operator who pinned a feed and finds a run skimmed
    # something else is owed the reason, on the run.
    assert plan.operator_env_overridden is True

    path_plan = gs.plan_feed(None, discovering=False, env_path="/feeds/ops.zip", selection=selection)
    assert path_plan.origin == "workspace_feed_version" and path_plan.operator_env_overridden is True

    # With no env feed set there is nothing to disclose, and claiming an override
    # that did not happen would be its own dishonesty.
    plain = gs.plan_feed(None, discovering=False, selection=selection)
    assert plain.operator_env_overridden is False


def test_a_selection_outranks_a_feed_discovery_already_found():
    discovered = gs.FeedDiscovery("http://mdb/latest/somewhere-else.zip", "selected")
    plan = gs.plan_feed(discovered, discovering=True, selection=gs.parse_feed_selection(_stamp()))
    assert plan.origin == "workspace_feed_version", plan.origin
    assert plan.url is None, "a selection is resolved from storage, never from a catalog URL"


def test_a_selection_failure_never_falls_back_to_another_feed():
    # The failure this forbids: the chosen feed cannot be used, the worker quietly
    # skims the catalog's or the operator's feed instead, and the run's KPI
    # provenance sentence names the feed the planner picked over numbers that came
    # from a different one. That is worse than reporting no transit at all,
    # because it manufactures corroboration out of a failure.
    discovered = gs.FeedDiscovery("http://mdb/latest/somewhere-else.zip", "selected")
    for status in ("unavailable", "unsupported_by_skim", "handoff_failed", "who_knows"):
        selection = gs.parse_feed_selection(_stamp(status=status, feedVersionId=None))
        plan = gs.plan_feed(
            discovered, discovering=True, env_url="http://ops/pinned.zip",
            env_path="/feeds/ops.zip", selection=selection,
        )
        assert plan.load is False, status
        assert plan.url is None, status
        assert plan.feed_version_id is None, status
        assert plan.fallback_after_catalog_failure is False, status
        assert plan.origin == "workspace_feed_version", (status, plan.origin)


def test_a_refused_selection_is_never_reported_as_a_fact_about_the_study_area():
    # `no_local_feed` asserts that a feed was LOOKED FOR and none covers this
    # area. "The feed you chose could not be used" establishes nothing whatever
    # about the area — and that unchecked claim would then sit underneath a VMT
    # number a planner has to defend.
    for status in ("unavailable", "unsupported_by_skim", "handoff_failed", "who_knows"):
        plan = gs.plan_feed(
            None, discovering=False,
            selection=gs.parse_feed_selection(_stamp(status=status, feedVersionId=None)),
        )
        assert plan.status == "feed_unavailable", (status, plan.status)
        assert plan.status != "no_local_feed", status
        assert (plan.no_feed_reason or "").startswith("selected_feed_"), plan.no_feed_reason


def test_no_selection_leaves_every_existing_precedence_rule_untouched():
    # The regression bound: adding a branch above the others must not move any of
    # them. These are the same expectations test_gtfs_discovery.py pins, restated
    # here against the new signature so a default-argument mistake cannot pass
    # both files.
    assert gs.plan_feed(gs.FeedDiscovery("http://x/f.zip", "selected"),
                        discovering=True, selection=None).origin == "discovered_catalog"
    assert gs.plan_feed(None, discovering=False, env_url="http://a/f.zip",
                        selection=None).origin == "operator_url"
    assert gs.plan_feed(None, discovering=False, env_path="/f.zip",
                        selection=None).origin == "operator_path"
    assert gs.plan_feed(None, discovering=False, selection=None).origin == "bundled_default"
    unreachable = gs.plan_feed(gs.FeedDiscovery(None, "catalog_unavailable", "HTTP 503"),
                               discovering=True, selection=None)
    assert unreachable.origin == "bundled_after_catalog_unavailable" and unreachable.load is True
    answered = gs.plan_feed(gs.FeedDiscovery(None, "no_covering_feed"), discovering=True, selection=None)
    assert answered.load is False and answered.status == "no_local_feed"


# --------------------------------------------------------------------------- #
# An expired schedule is the ordinary case, and must not be silent              #
# --------------------------------------------------------------------------- #


def test_an_ended_service_window_is_reported_and_an_unknown_one_is_not_guessed():
    # Three of four real Sacramento-area feeds are expired — SacRT's schedule
    # ended 2025-04-05, sixteen months ago. Modelling with the last schedule an
    # agency published is usually right; doing it silently is not.
    assert gs.schedule_expired("2025-04-05", today="2026-08-06") is True
    assert gs.schedule_expired("2026-12-31", today="2026-08-06") is False
    # Boundary: the day service ends, it has not ended.
    assert gs.schedule_expired("2026-08-06", today="2026-08-06") is False
    # UNKNOWN IS NOT "NOT EXPIRED". A boolean that collapsed the two would let a
    # feed that states no end date render as a reassurance.
    for unknown in (None, "", "   ", "not a date", "2026-13", 20261231):
        assert gs.schedule_expired(unknown, today="2026-08-06") is None, unknown


# --------------------------------------------------------------------------- #
# The database read, under the worker's own tenancy filter                     #
# --------------------------------------------------------------------------- #


def _refusal(fn):
    try:
        fn()
    except gs.SelectedFeedError as exc:
        return exc
    raise AssertionError("expected a SelectedFeedError refusal, got none")


def test_the_exact_bytes_openplan_parsed_are_what_the_model_skims():
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row()], object_bytes=raw)
    los, meta = _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)
    )
    assert los.n_routes == 1 and los.n_stops == 3
    assert meta["feed_version_id"] == VERSION_ID
    # The checksum recorded is the one the worker VERIFIED against these bytes.
    assert meta["feed_checksum_sha256"] == hashlib.sha256(raw).hexdigest()
    assert meta["feed_agency_name"] == "Test Transit"
    assert meta["feed_source_kind"] == "upload"
    # The ingest's window and the parser's window are kept APART. Migration
    # 20260805000006 records that they legitimately disagree in real feeds;
    # collapsing them destroys the evidence that they did.
    assert meta["feed_service_start_date"] == "2025-01-01"
    assert meta["feed_service_end_date"] == "2026-12-31"
    assert meta["feed_expiry_evaluated_at"], "expiry is a claim about a moment"
    # An upload has no URL, so the agency's own name is the identity a planner is
    # shown. Leaving both empty would render the feed as "feed not identified" in
    # the KPI provenance sentence.
    assert los.source_url is None and los.source_name == "Test Transit"


def test_the_worker_reads_the_storage_object_the_chosen_version_names():
    # PROVEN NECESSARY BY MUTATION. Replacing the storage path in main.py with a
    # hardcoded wrong key left all 42 checks in this file green: they asserted
    # only what the worker did NOT fetch and that SOME storage URL was asked for.
    # Nothing tied the object read to the version row — which is the whole
    # guarantee, since the bytes fetched are the bytes the model skims.
    #
    # TWO DIFFERENT PATHS, because one fixture cannot tell "reads the row's path"
    # apart from "hardcodes the value this fixture happens to use".
    for suffix in ("first", "second"):
        path = f"{WORKSPACE}/{FEED_ID}/{VERSION_ID}-{suffix}.zip"
        raw = _feed_bytes({"agency.txt":
                           "agency_id,agency_name,agency_url,agency_timezone\n"
                           f"1,T-{suffix},http://t,America/Los_Angeles\n"})
        row = _version_row(storage_path=path, _bytes=raw)
        # Only THIS key exists in the bucket. A request for any other 404s, the
        # way Storage answers a key that is not there.
        fake = _FakeRequests(version_rows=[row], objects={path: raw})

        los, meta = _with_requests(
            fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE))

        # The URL the worker ACTUALLY requested, compared against the fixture's
        # own value rather than a literal repeated from main.py.
        assert fake.storage_urls(), fake.urls
        assert len(fake.storage_urls()) == 1, fake.storage_urls()
        assert fake.storage_urls()[0].endswith(
            f"/storage/v1/object/{main.GTFS_UPLOADS_BUCKET}/{row['storage_path']}"
        ), (fake.storage_urls()[0], row["storage_path"])
        # And it is those bytes that were parsed — a 404 would have refused.
        assert los.n_routes == 1
        assert meta["feed_checksum_sha256"] == hashlib.sha256(raw).hexdigest()


def test_the_worker_looks_up_the_version_the_planner_picked_not_the_current_one():
    # PROVEN NECESSARY BY MUTATION. Replacing `?id=eq.{feed_version_id}` with
    # `?is_current=eq.true` left every one of the 21 worker suites green, because
    # the fake returned its single row for any query at all. So nothing proved
    # the worker read the feed version the planner CHOSE rather than whatever the
    # Data Hub currently shows — and byte-pinning a run to the version it was
    # launched with is the entire point of the handoff.
    chosen_raw = _feed_bytes()
    current_raw = _feed_bytes({
        "routes.txt": "route_id,route_short_name,route_type\nR1,1,3\nR2,2,3\n",
        "trips.txt": "route_id,service_id,trip_id,direction_id\n"
                     "R1,WKDY,t1,0\nR1,WKDY,t2,0\nR2,WKDY,t3,0\n",
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "t1,08:00:00,08:00:00,A,1\nt1,08:10:00,08:10:00,B,2\nt1,08:20:00,08:20:00,C,3\n"
            "t2,08:30:00,08:30:00,A,1\nt2,08:40:00,08:40:00,B,2\nt2,08:50:00,08:50:00,C,3\n"
            "t3,09:00:00,09:00:00,A,1\nt3,09:15:00,09:15:00,C,2\n"
        ),
    })
    newer_id = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee"

    # The planner's run names the SUPERSEDED version; a newer ingest of the same
    # feed has since been promoted, which is the ordinary state of a feed that
    # gets refreshed while runs are queued behind it.
    chosen = _version_row(is_current=False, _bytes=chosen_raw)
    newer = _version_row(id=newer_id, is_current=True,
                         storage_path=f"{WORKSPACE}/{FEED_ID}/{newer_id}.zip",
                         _bytes=current_raw)

    fake = _FakeRequests(
        rows_by_id={VERSION_ID: chosen, newer_id: newer},
        # What a query filtering on `is_current` instead of the id would get.
        current_rows=[newer],
        objects={chosen["storage_path"]: chosen_raw, newer["storage_path"]: current_raw},
    )

    los, meta = _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE))

    # THE QUERY NAMES THE REQUESTED ID. Asserted on the URL the worker built, so
    # a filter swapped for any other predicate fails here rather than downstream.
    assert fake.version_query_urls(), fake.urls
    assert f"id=eq.{VERSION_ID}" in fake.version_query_urls()[0], fake.version_query_urls()[0]

    # AND THE CHOSEN ONE WINS. These assertions are what fail when the worker
    # asks for `is_current` — it would be handed the newer row and skim it while
    # every surface named the version the planner picked.
    assert meta["feed_version_id"] == VERSION_ID, meta["feed_version_id"]
    assert meta["feed_version_is_current"] is False
    assert meta["feed_checksum_sha256"] == hashlib.sha256(chosen_raw).hexdigest()
    assert los.n_routes == 1, "the newer version has 2 routes; this run is pinned to the older"


def test_the_worker_never_refetches_the_publishers_url_on_this_path():
    # THE WHOLE REASON BYTES ARE STORED. `load_feed` caches a downloaded feed
    # under a URL hash with no TTL and no revalidation, so a refetch is not "maybe
    # newer bytes" but "whatever the worker first saw, forever" — while the
    # service-levels page a planner reads moves. And the divergence would be
    # camouflaged, because the KPI sentence cites the same URL the Data Hub card
    # does. This negative is invisible in the result and visible only here.
    raw = _feed_bytes()
    fake = _FakeRequests(
        version_rows=[_version_row(source_kind="url", source_url=PUBLISHER_URL)],
        object_bytes=raw,
    )
    _with_requests(fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE))
    assert not [u for u in fake.urls if "agency.example" in u], fake.urls
    assert any("/storage/v1/object/gtfs-uploads/" in u for u in fake.urls), fake.urls


def test_one_workspaces_feed_cannot_be_read_by_another_workspaces_run():
    # Reported as MISSING rather than as forbidden: a member who can write the run
    # snapshot must not be able to use the worker's answers to learn which feed
    # ids exist in other workspaces.
    fake = _FakeRequests(version_rows=[_version_row(workspace_id=OTHER_WORKSPACE)])
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_not_found", exc.no_feed_reason
    assert "no longer exists" in str(exc), str(exc)
    # And no bytes were fetched on the way to finding out.
    assert not [u for u in fake.urls if "/storage/v1/object/" in u], fake.urls


def test_a_public_preloaded_feed_is_shared_on_purpose():
    # `workspace_id IS NULL` means a public preloaded feed; refusing it would
    # break the one case the null column exists for. Its archive still has to sit
    # somewhere the containment rule accepts, and a public feed has no workspace
    # prefix — so it refuses at the BYTES, with the honest reason, rather than
    # being reported as somebody else's feed.
    fake = _FakeRequests(version_rows=[_version_row(workspace_id=None)], object_bytes=_feed_bytes())
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_bytes_unavailable", exc.no_feed_reason


def test_a_version_that_never_finished_ingesting_is_refused():
    for status in ("pending", "fetching", "parsing", "failed", "refused"):
        fake = _FakeRequests(version_rows=[_version_row(status=status)], object_bytes=_feed_bytes())
        exc = _refusal(lambda: _with_requests(
            fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
        assert exc.no_feed_reason == "selected_feed_not_ready", (status, exc.no_feed_reason)
        assert not [u for u in fake.urls if "/storage/v1/object/" in u], status


def test_a_missing_version_row_is_refused_rather_than_replaced():
    fake = _FakeRequests(version_rows=[])
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_not_found", exc.no_feed_reason


def test_bytes_that_do_not_match_the_recorded_checksum_are_not_skimmed():
    # Without this the byte handoff is just a slower refetch. The guarantee being
    # bought is that the archive the MODEL skimmed is the archive whose route and
    # stop counts the planner read on the service-levels page.
    fake = _FakeRequests(
        version_rows=[_version_row(checksum_sha256="0" * 64)], object_bytes=_feed_bytes()
    )
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_checksum_mismatch", exc.no_feed_reason

    # A version with NO checksum is refused too: an unverifiable archive proves
    # nothing about which bytes produced the numbers, and silently accepting it
    # would make the guarantee above conditional on a column nobody checked.
    #
    # The MESSAGE is asserted, not just the code, and that is deliberate: a
    # missing checksum would be caught by the mismatch comparison anyway (nothing
    # equals ""), so the outcome alone cannot tell the two branches apart. What
    # the dedicated branch buys is a sentence that names the real problem instead
    # of reporting an expected checksum of "…" against a real one — and only an
    # assertion on the text can protect that.
    for empty in (None, "", "   "):
        fake2 = _FakeRequests(version_rows=[_version_row(checksum_sha256=empty)],
                              object_bytes=_feed_bytes())
        exc2 = _refusal(lambda: _with_requests(
            fake2, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
        assert exc2.no_feed_reason == "selected_feed_checksum_mismatch", exc2.no_feed_reason
        assert "records no checksum" in str(exc2), (empty, str(exc2))


def test_a_version_with_no_stored_archive_is_refused_instead_of_refetched():
    # Catalog and URL ingests historically kept only the address, not the bytes.
    # The tempting recovery — fetch source_url — is exactly what this design
    # refuses, so the refusal has to be the behaviour rather than a comment.
    fake = _FakeRequests(
        version_rows=[_version_row(source_kind="catalog", source_url=PUBLISHER_URL, storage_path=None)]
    )
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_bytes_unavailable", exc.no_feed_reason
    assert not [u for u in fake.urls if "agency.example" in u], fake.urls


def test_an_archive_outside_its_own_workspaces_prefix_is_not_read():
    # Defence in depth: `storage_path` is service-role written today, so this is
    # not a live hole. It exists because a bucket read with the service-role key
    # has no RLS above it, and the day anything else writes that column the
    # confinement should already be there rather than needing to be remembered.
    for hostile in (f"{OTHER_WORKSPACE}/{FEED_ID}/{VERSION_ID}.zip",
                    f"{WORKSPACE}/../{OTHER_WORKSPACE}/x.zip",
                    "/etc/passwd"):
        fake = _FakeRequests(version_rows=[_version_row(storage_path=hostile)],
                             object_bytes=_feed_bytes())
        exc = _refusal(lambda: _with_requests(
            fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
        assert exc.no_feed_reason == "selected_feed_bytes_unavailable", (hostile, exc.no_feed_reason)
        assert not [u for u in fake.urls if "/storage/v1/object/" in u], hostile


def test_an_archive_that_cannot_be_downloaded_is_refused_with_that_reason():
    fake = _FakeRequests(version_rows=[_version_row()], object_bytes=b"", object_status=404)
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_bytes_unavailable", exc.no_feed_reason


def test_an_expired_schedule_reaches_the_evidence_instead_of_being_hidden():
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row(service_end_date="2025-04-05", _bytes=raw)],
                         object_bytes=raw)
    _los, meta = _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE))
    assert meta["feed_schedule_expired"] is True
    assert meta["feed_service_end_date"] == "2025-04-05"
    # A feed that states no end date must read as UNKNOWN, never as "current".
    fake2 = _FakeRequests(version_rows=[_version_row(service_end_date=None, _bytes=raw)],
                          object_bytes=raw)
    _los2, meta2 = _with_requests(
        fake2, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE))
    assert meta2["feed_schedule_expired"] is None, meta2["feed_schedule_expired"]


def test_a_superseded_version_is_still_skimmed_and_the_difference_is_disclosed():
    # A run is byte-pinned to the version it was launched with, so re-running it
    # reproduces its numbers even after the feed is refetched and a newer version
    # promoted. A planner comparing the run against the Data Hub is owed the
    # reason the two differ.
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row(is_current=False)], object_bytes=raw)
    los, meta = _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE))
    assert los.n_routes == 1, "a superseded version is still readable"
    assert meta["feed_version_is_current"] is False


def test_a_chosen_feed_of_pure_headway_bands_is_refused_by_its_own_name():
    # `GtfsFrequencyOnly` must not reach the caller as a generic parse failure:
    # "this agency publishes headway bands rather than a timetable" and "your feed
    # could not be read" send a planner to entirely different places.
    raw = _feed_bytes({
        "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nt1,08:00:00,10:00:00,600\n"
                           "t2,08:00:00,10:00:00,600\n",
    })
    fake = _FakeRequests(version_rows=[_version_row(_bytes=raw)], object_bytes=raw)
    exc = _refusal(lambda: _with_requests(
        fake, lambda: main.load_selected_feed_version(VERSION_ID, WORKSPACE)))
    assert exc.no_feed_reason == "selected_feed_uses_frequencies", exc.no_feed_reason


# --------------------------------------------------------------------------- #
# The whole selected-feed path, driven                                          #
# --------------------------------------------------------------------------- #

# Zones sitting over the fixture feed's own stops, and zones in central Texas.
COVERED_LONS = np.array([-121.050, -121.070])
COVERED_LATS = np.array([39.200, 39.220])
ELSEWHERE_LONS = np.array([-97.74, -97.70])
ELSEWHERE_LATS = np.array([30.27, 30.30])


def test_the_selected_feed_path_produces_a_skim_and_the_evidence_for_it():
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row()], object_bytes=raw)
    meta, skim, log = _with_requests(fake, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS))
    assert bool(skim["available"][0, 1]), "a covering feed must produce served pairs"
    # The provenance the evidence panel and the KPI sentence read.
    assert meta["feed_version_id"] == VERSION_ID
    assert meta["feed_checksum_sha256"] == hashlib.sha256(raw).hexdigest()
    assert meta["source_name"] == "Test Transit"
    assert meta["n_routes"] == 1 and meta["n_served_stops"] == 3
    assert meta["service_day"] == "monday"
    assert "Transit LOS from Test Transit" in log, log


def test_a_chosen_feed_that_does_not_serve_this_study_area_is_a_fact_about_the_feed():
    # `no_local_feed` asserts that a feed was looked for and none covers this
    # area. Here the planner named a feed and it does not serve the area — which
    # establishes nothing about whether some other feed does. Reporting it as
    # `no_local_feed` would put an unchecked coverage claim under a VMT number.
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row()], object_bytes=raw)
    exc = _refusal(lambda: _with_requests(fake, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, ELSEWHERE_LONS, ELSEWHERE_LATS)))
    assert exc.no_feed_reason == "selected_feed_has_no_stops_in_study_area", exc.no_feed_reason
    assert exc.no_feed_reason != "no_local_feed"
    assert "no stops inside this study area" in str(exc), str(exc)


def test_an_expired_schedule_says_so_in_the_run_log_as_well_as_the_meta():
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row(service_end_date="2025-04-05", _bytes=raw)],
                         object_bytes=raw)
    meta, _skim, log = _with_requests(fake, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS))
    assert meta["feed_schedule_expired"] is True
    assert "published service ended on 2025-04-05" in log, log
    # A live feed says nothing about expiry — a warning nobody needs is a warning
    # everybody learns to skip.
    fake2 = _FakeRequests(version_rows=[_version_row()], object_bytes=raw)
    _meta2, _skim2, log2 = _with_requests(fake2, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS))
    assert "published service ended" not in log2, log2


def test_every_feed_origin_discloses_an_expired_schedule_not_only_a_chosen_one():
    # `schedule_expired` had exactly ONE caller — the chosen-feed path — so a run
    # that used the operator's GTFS_URL, a discovered catalog feed, or the feed
    # BUNDLED WITH THE WORKER modeled from a schedule of any age with nothing on
    # any surface admitting it. That is the ordinary deployment, not an edge
    # case: every install without a workspace feed uses the bundled one, and the
    # bundled feed is expired today.
    #
    # Driven through `_transit_feed_summary`, which is the ONE function both skim
    # paths build their evidence from — so the disclosure cannot be present on
    # one origin and missing on another.
    expired = gs.load_feed(raw=_feed_bytes({
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "WKDY,1,1,1,1,1,0,0,20240101,20250405\n"
        ),
    }), source_name="Bundled Feed")
    summary = main._transit_feed_summary(expired)
    # calendar.txt writes dates COMPACTLY; `schedule_expired` compares ISO
    # strings and answers None for anything else, so without the conversion this
    # whole lane reports "unknown" — which reads as reassurance.
    assert summary["feed_service_end_date"] == "2025-04-05", summary["feed_service_end_date"]
    assert summary["feed_schedule_expired"] is True, summary["feed_schedule_expired"]
    assert summary["feed_expiry_evaluated_at"], "expiry is a claim about a moment"

    # A live schedule says nothing. A warning nobody needs is one everybody skips.
    live = gs.load_feed(raw=_feed_bytes(), source_name="Live Feed")
    live_summary = main._transit_feed_summary(live)
    assert live_summary["feed_schedule_expired"] is False, live_summary["feed_schedule_expired"]

    # And a feed whose calendar states no window is UNKNOWN, never "not expired".
    silent = gs.load_feed(raw=_feed_bytes({
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday\nWKDY,1,1,1,1,1,0,0\n",
    }), source_name="Undated Feed")
    assert main._transit_feed_summary(silent)["feed_schedule_expired"] is None

    # THE SENTENCE ITSELF, from the shared helper both paths print — so an
    # expired bundled feed cannot be silent in the run log either.
    assert "published service ended on 2025-04-05" in main._feed_expiry_log_note(summary)
    assert main._feed_expiry_log_note(live_summary) == ""

    # And it reaches the KPI provenance a reviewer reads under the VMT number.
    prov = main.build_mode_provenance({
        "transit_status": "modeled",
        "transit_los": {"feed_origin": "bundled_default", **summary},
    })
    assert "published service ended on 2025-04-05" in prov, prov
    assert "NOT the schedule in force today" in prov, prov


def test_a_chosen_feeds_own_ingest_window_still_wins_over_the_parsers():
    # The two windows legitimately disagree in real feeds (migration
    # 20260805000006 records it), and the chosen-feed path is the one with a
    # database row behind it. Adding the parser-derived expiry to the SHARED
    # summary must not quietly re-source what the chosen path reports — that
    # would change what the expiry statement was computed from, invisibly.
    raw = _feed_bytes()   # the parser's calendar runs to 2026-12-31
    fake = _FakeRequests(version_rows=[_version_row(service_end_date="2025-04-05", _bytes=raw)],
                         object_bytes=raw)
    meta, _skim, log = _with_requests(fake, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS))
    assert meta["feed_service_end_date"] == "2025-04-05", meta["feed_service_end_date"]
    assert meta["feed_schedule_expired"] is True
    # The parser's own window is still carried, under its own separate keys.
    assert meta["service_end"] == "20261231", meta["service_end"]
    assert "published service ended on 2025-04-05" in log, log


def test_a_superseded_version_says_so_in_the_run_log():
    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row(is_current=False)], object_bytes=raw)
    _meta, _skim, log = _with_requests(fake, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS))
    assert "a newer ingest of this feed exists" in log, log


def test_a_partly_frequency_based_feed_is_skimmed_and_discloses_what_it_left_out():
    # A transit share built from part of a feed must never present itself as one
    # built from all of it.
    raw = _feed_bytes({
        "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nt1,08:00:00,10:00:00,600\n",
    })
    fake = _FakeRequests(version_rows=[_version_row(_bytes=raw)], object_bytes=raw)
    meta, skim, log = _with_requests(fake, lambda: main.skim_selected_feed_version(
        VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS))
    assert bool(skim["available"][0, 1]), "the scheduled half of the feed must still be skimmed"
    assert meta["frequency_trips_excluded"] == 1, meta["frequency_trips_excluded"]
    assert meta["scheduled_trips_used"] == 1, meta["scheduled_trips_used"]
    assert "frequencies.txt" in log and "excluded" in log, log


def test_the_selected_feed_path_respects_the_stage_budget():
    # The transit stage's wall-clock bound must apply to this path too. Without
    # it a chosen feed against a large zone system stalls every run queued behind
    # it, with nothing anywhere saying why.
    import time as _time

    raw = _feed_bytes()
    fake = _FakeRequests(version_rows=[_version_row()], object_bytes=raw)
    raised = None
    try:
        _with_requests(fake, lambda: main.skim_selected_feed_version(
            VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS,
            deadline=_time.monotonic() - 1.0))
    except gs.GtfsTimeout as exc:
        raised = exc
    assert raised is not None, "an exhausted budget must abandon the chosen-feed skim too"


def test_the_budget_reaches_the_skim_itself_and_not_only_the_check_before_it():
    # The check above is satisfied by the `check_deadline` call that runs BEFORE
    # the skim, so it stayed green with the deadline dropped from `transit_skim`
    # entirely — proven by mutation. The skim is the part that takes minutes on a
    # dense feed against a large zone system, so an unbounded one is exactly the
    # stall the budget exists to prevent.
    #
    # TWO different budgets, because one fixture cannot tell "threads the binding"
    # apart from "hardcodes a value".
    import time as _time

    raw = _feed_bytes()
    seen = []
    original = gs.transit_skim

    def recording(los, lons, lats, deadline=None):
        seen.append(deadline)
        return original(los, lons, lats, deadline=deadline)

    gs.transit_skim = recording
    try:
        for offset in (111.0, 222.0):
            fake = _FakeRequests(version_rows=[_version_row()], object_bytes=raw)
            _with_requests(fake, lambda: main.skim_selected_feed_version(
                VERSION_ID, WORKSPACE, COVERED_LONS, COVERED_LATS,
                deadline=_time.monotonic() + offset))
    finally:
        gs.transit_skim = original

    assert len(seen) == 2, seen
    assert all(d is not None for d in seen), (
        "the chosen-feed skim must be given the stage budget, not left unbounded"
    )
    assert abs((seen[1] - seen[0]) - 111.0) < 5.0, (
        f"the skim must receive THIS run's budget rather than a fixed one: {seen}"
    )


# --------------------------------------------------------------------------- #
# The KPI provenance sentence — the highest-stakes string the worker produces   #
# --------------------------------------------------------------------------- #


def test_a_refused_selection_never_claims_the_study_area_has_no_transit():
    # THE HONESTY RULE OF THIS WHOLE LANE, at the surface where it matters most.
    # "No usable GTFS feed covered this study area" is a fact about the AREA and
    # is earned only when a feed was actually looked for. When the planner named a
    # feed and it could not be used, nothing was established about the area — and
    # this is the sentence a reviewer reads underneath the VMT number.
    prov = main.build_mode_provenance({
        "transit_status": "feed_unavailable",
        "transit_los": {
            "feed_origin": "workspace_feed_version",
            "no_feed_reason": "selected_feed_has_no_stops_in_study_area",
            "selection_reason": "That feed serves Sacramento, not this area.",
        },
    })
    assert "no usable GTFS feed covered this study area" not in prov, prov
    assert "the transit feed chosen for this run could not be used" in prov, prov
    assert "was NOT determined" in prov, prov
    assert "No other feed was substituted" in prov, prov
    assert "selected_feed_has_no_stops_in_study_area" in prov, prov
    assert "That feed serves Sacramento" in prov, prov

    # THE SECOND CLAUSE, exercised on its own. Both halves of the condition were
    # written, but every fixture set BOTH — so the reason-prefix half was doing
    # nothing a test could see, and a mutation removing it passed. It is the belt
    # to the origin's braces: a refusal that reaches this sentence carrying a
    # `selected_feed_*` reason but no origin (a future path, a partially built
    # meta) must still be forbidden from claiming coverage.
    reason_only = main.build_mode_provenance({
        "transit_status": "feed_unavailable",
        "transit_los": {"no_feed_reason": "selected_feed_checksum_mismatch"},
    })
    assert "no usable GTFS feed covered this study area" not in reason_only, reason_only
    assert "was NOT determined" in reason_only, reason_only

    # And the braces on their own: an origin with no reason at all.
    origin_only = main.build_mode_provenance({
        "transit_status": "feed_unavailable",
        "transit_los": {"feed_origin": "workspace_feed_version"},
    })
    assert "no usable GTFS feed covered this study area" not in origin_only, origin_only
    assert "was NOT determined" in origin_only, origin_only


def test_a_genuine_coverage_miss_still_says_so():
    # The other half of the rule: discovery that ANSWERED and found nothing IS a
    # coverage fact, and softening it would be its own dishonesty.
    prov = main.build_mode_provenance({
        "transit_status": "no_local_feed",
        "transit_los": {
            "feed_origin": "discovered_catalog",
            "no_feed_reason": "discovery_found_no_covering_feed",
        },
    })
    assert "no usable GTFS feed covered this study area" in prov, prov
    assert "NOT 'no transit demand'" in prov, prov


def test_a_modeled_run_names_its_feed_and_discloses_an_expired_schedule():
    prov = main.build_mode_provenance({
        "transit_status": "modeled",
        "transit_los": {
            "feed_origin": "workspace_feed_version",
            "source_name": "Sacramento Regional Transit",
            "service_period": "20240101..20250405",
            "feed_schedule_expired": True,
            "feed_service_end_date": "2025-04-05",
        },
    })
    assert "Sacramento Regional Transit" in prov, prov
    assert "published service ended on 2025-04-05" in prov, prov
    assert "NOT the schedule in force today" in prov, prov


def test_a_live_schedule_carries_no_expiry_warning():
    # A warning nobody needs is a warning everybody learns to skip.
    prov = main.build_mode_provenance({
        "transit_status": "modeled",
        "transit_los": {"source_name": "Live Transit", "feed_schedule_expired": False},
    })
    assert "published service ended" not in prov, prov
    # And an UNKNOWN end date must not produce a reassurance either — it simply
    # says nothing, which is the honest answer.
    unknown = main.build_mode_provenance({
        "transit_status": "modeled",
        "transit_los": {"source_name": "Live Transit", "feed_schedule_expired": None},
    })
    assert "published service ended" not in unknown, unknown


def test_a_partly_skimmed_feed_says_what_it_left_out():
    prov = main.build_mode_provenance({
        "transit_status": "modeled",
        "transit_los": {
            "source_name": "Big Transit",
            "frequency_trips_excluded": 2,
            "scheduled_trips_used": 18148,
        },
    })
    assert "2 trip(s)" in prov and "EXCLUDED" in prov, prov
    assert "18148 scheduled trip(s) were used" in prov, prov
    # A feed with nothing excluded says nothing about exclusions.
    clean = main.build_mode_provenance({
        "transit_status": "modeled",
        "transit_los": {"source_name": "Big Transit", "frequency_trips_excluded": 0},
    })
    assert "EXCLUDED" not in clean, clean


def test_a_feed_the_run_could_not_identify_says_so_rather_than_inventing_one():
    prov = main.build_mode_provenance({"transit_status": "modeled", "transit_los": {}})
    assert "feed not identified" in prov, prov
    assert "service window not stated in the feed calendar" in prov, prov


# --------------------------------------------------------------------------- #
# The worker's own wiring, checked as text because main.py's transit stage is   #
# 400 lines inside a function no test can call                                  #
# --------------------------------------------------------------------------- #


def _main_src() -> str:
    return open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py"),
                encoding="utf-8").read()


def test_the_worker_asks_gtfs_skim_for_the_selection_and_hands_it_to_plan_feed():
    # Two ways the seam could exist and do nothing: the stamp parsed but never
    # passed to plan_feed (the selection is ignored), or plan_feed called without
    # it (the same). Both type-check and both leave every other test here green,
    # because everything above tests the pieces rather than the join.
    src = _main_src()
    assert "gtfs_skim.parse_feed_selection(run_row)" in src, (
        "main.py must read the run's transit feed stamp through gtfs_skim"
    )
    assert "selection=feed_selection," in src, (
        "the parsed selection must reach gtfs_skim.plan_feed, or it decides nothing"
    )
    # THE EXACT DISPATCH, not merely the symbol somewhere in the file. A
    # substring check on `feed_plan.feed_version_id` passed with this branch
    # switched off entirely (`elif False:`), because the same symbol appears in
    # the call INSIDE the branch — proven by mutation, which is the only reason
    # this assertion is written the way it is.
    assert "                elif feed_plan.feed_version_id:\n" in src, (
        "the transit stage must dispatch to the selected-feed path on the planned version id"
    )
    assert "_sel_meta, transit_skim, _sel_log = skim_selected_feed_version(" in src, (
        "the selected-feed path must produce the run's transit skim, not just its metadata"
    )
    assert "                    log += _sel_log" in src, (
        "the selected feed's disclosures — expiry, superseded version, excluded frequency "
        "trips — must reach the run log"
    )
    assert "                    transit_los_meta.update(_sel_meta)" in src, (
        "the selected feed's provenance must reach the evidence packet"
    )


def _skim_selected_feed_call() -> ast.Call:
    """The one `skim_selected_feed_version(...)` call inside the transit stage.

    Found by PARSING main.py rather than by matching a string. `stage_assignment`
    needs a built AequilibraE project, a demand matrix and a graph, so this call
    cannot be driven from a test — and the substring checks that stand in for
    driving it are satisfied by the text appearing anywhere in a 4,000-line file.
    An AST walk asks what the call actually IS.
    """
    tree = ast.parse(_main_src())
    calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "skim_selected_feed_version"
    ]
    assert len(calls) == 1, f"expected exactly one dispatch, found {len(calls)}"
    return calls[0]


def test_the_tenancy_boundary_comes_from_the_RUN_ROW_not_from_member_written_json():
    # PROVEN NECESSARY BY MUTATION. Replacing `run_row.get("workspace_id")` with
    # `(run_row.get("input_snapshot_json") or {}).get("workspaceId")` left every
    # one of the 21 worker suites green — re-opening, in silence, the exact
    # cross-tenant read oracle this design claims to have closed BY
    # CONSTRUCTION.
    #
    # Why it is that serious: `input_snapshot_json` is writable by any workspace
    # member, the worker reads with the service-role key, and the whole tenancy
    # argument for the handoff is that the snapshot supplies a uuid and NOTHING
    # ELSE the worker acts on. A workspace id taken from the snapshot is a
    # member-authored value used as the filter that decides whose feed may be
    # read — a member could then name another tenant's workspace and version and
    # have the worker fetch that tenant's archive.
    #
    # `resolve_selected_feed_version` compares `row["workspace_id"]` against this
    # argument, so it cannot detect the substitution: both sides would be the
    # attacker's value. The boundary has to be right where it is READ.
    call = _skim_selected_feed_call()
    assert len(call.args) >= 2, ast.dump(call)
    workspace_arg = call.args[1]

    # `ast.unparse` normalises to single quotes; compare quote-agnostically.
    rendered = ast.unparse(workspace_arg).replace("'", '"')
    assert rendered == 'run_row.get("workspace_id")', rendered

    # And the shape, not only the text, so a rename cannot make this vacuous: it
    # must be a `.get` on the bare `run_row` name with the literal column.
    assert isinstance(workspace_arg, ast.Call), ast.dump(workspace_arg)
    assert isinstance(workspace_arg.func, ast.Attribute), ast.dump(workspace_arg)
    assert workspace_arg.func.attr == "get"
    assert isinstance(workspace_arg.func.value, ast.Name), ast.dump(workspace_arg)
    assert workspace_arg.func.value.id == "run_row", ast.dump(workspace_arg)
    assert [ast.literal_eval(a) for a in workspace_arg.args] == ["workspace_id"]

    # NOTHING in that argument may read the snapshot, however it is spelled —
    # `input_snapshot_json`, a walrus, a helper, a nested get.
    for node in ast.walk(workspace_arg):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            assert "snapshot" not in node.value.lower(), ast.dump(workspace_arg)
            assert "workspaceid" != node.value.lower(), ast.dump(workspace_arg)
        if isinstance(node, ast.Attribute):
            assert "snapshot" not in node.attr.lower(), ast.dump(workspace_arg)


def test_the_chosen_feed_version_id_is_the_only_thing_taken_from_the_snapshot():
    # The other half of the same boundary, stated over the FIRST argument. The
    # version id is member-supplied ON PURPOSE — it is a uuid the worker then
    # resolves under a tenancy filter it applies itself — so what makes that safe
    # is precisely that the FILTER does not come from the same place.
    call = _skim_selected_feed_call()
    assert ast.unparse(call.args[0]) == "feed_plan.feed_version_id", ast.unparse(call.args[0])


def test_the_worker_does_not_discover_a_feed_it_has_already_been_given():
    src = _main_src()
    assert "GTFS_DISCOVER and not explicit_feed and feed_selection is None" in src, (
        "a run that names its own feed must not also fetch the catalog"
    )


def test_the_transit_stage_prints_the_expiry_note_for_the_workers_OWN_feed_too():
    # The chosen-feed path's expiry note is driven directly by the checks above.
    # The other three origins — operator env, discovered catalog, and the feed
    # BUNDLED WITH THE WORKER — live inside `stage_assignment`, which no test can
    # call. That is precisely where the disclosure was missing, and the bundled
    # feed is expired today, so this is the ordinary deployment.
    #
    # Asserted as an AST call rather than a substring: `_feed_expiry_log_note`
    # appears in this file several times, and a substring check is satisfied by
    # any of them.
    tree = ast.parse(_main_src())
    calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_feed_expiry_log_note"
    ]
    argued = sorted({ast.unparse(c.args[0]) for c in calls if c.args})
    assert "transit_los_meta" in argued, argued
    assert "meta" in argued, argued
    assert len(calls) >= 2, f"both skim paths must print it, found {len(calls)}"


def test_the_artifact_stage_publishes_the_provenance_sentence_that_was_tested():
    # Every claim above is proven against `build_mode_provenance`. That proves
    # nothing at all unless the stage that writes KPIs is the thing calling it —
    # the classic shape of a tested unit nobody reaches.
    src = _main_src()
    assert "    mode_provenance = build_mode_provenance(mode_split)\n" in src, (
        "the artifact stage must publish the provenance sentence these checks exercise"
    )


def test_a_selected_feeds_failure_keeps_its_specific_reason():
    # The generic handler flattens every GtfsError into feed_load_failed /
    # transit_skim_failed. A SelectedFeedError carries the one thing that makes
    # letting a planner choose worth anything — which of seven distinct things
    # went wrong with the feed THEY picked.
    src = _main_src()
    assert "isinstance(te, gtfs_skim.SelectedFeedError)" in src, (
        "main.py must preserve a selected feed's own refusal reason"
    )
    assert "te.no_feed_reason" in src


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} transit-feed-handoff checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
