#!/usr/bin/env python3
"""A pushed run executes through the same claim as a polled one, or not at all.

The worker could only ever be started one way: an always-on process polling
Supabase. That made "give your deployment modeling compute" mean "keep a machine
running", and an operator on a platform that scales to zero could not follow the
instruction at all. The push trigger is the second way to START the worker — and
the danger in adding one is that it becomes a second way to RUN it, where a
pushed run and a polling worker execute the same stage twice.

These checks pin that it did not:
  * the trigger is a thin transport; execution goes through the same
    process_first_actionable_stage the poll loop calls,
  * a stage is still taken with the conditional queued -> running PATCH, so the
    loser of a race stops instead of proceeding,
  * an unauthenticated caller cannot start compute,
  * a pushed run drains its own stages rather than needing one push per stage,
    and cannot spin when it no longer owns the run.

Run: python3 workers/aequilibrae_worker/test_push_trigger.py
"""
import json
import os
import sys
import time
import types
import http.client
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _stub_missing_dependency(name: str, build) -> None:
    """Install a minimal stand-in ONLY when the real package is absent.

    Same device as test_zone_attributes.py: `main` imports the scientific stack
    at module scope but nothing exercised here touches it, so on a bare checkout
    these stubs keep the suite runnable, and in the worker venv they never
    install and the real modules are used.
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
    class OSMBuilder:  # noqa: D401 - stand-in for the import-time monkeypatch
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

RUN_ID = "11111111-1111-4111-8111-111111111111"
TOKEN = "shared-secret-value"


# ── HTTP transport ──────────────────────────────────────────────────────────


class _Server:
    """A trigger server on a loopback port, with `submit` recorded not executed."""

    def __init__(self, token=TOKEN, submit_state="queued"):
        self.submitted = []
        self.submit_state = submit_state
        self.server = main.build_trigger_server(token, self._submit, host="127.0.0.1", port=0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def _submit(self, run_id):
        self.submitted.append(run_id)
        return "job-reference-1", self.submit_state

    def request(self, method, path, body=None, token=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        payload = json.dumps(body).encode() if body is not None else None
        if payload is not None:
            headers["Content-Length"] = str(len(payload))
        conn.request(method, path, body=payload, headers=headers)
        res = conn.getresponse()
        raw = res.read()
        conn.close()
        try:
            parsed = json.loads(raw or b"{}")
        except ValueError:
            parsed = {}
        return res.status, parsed

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def _dispatch_body():
    return {
        "contract": main.MODEL_RUN_DISPATCH_CONTRACT,
        "requestId": "22222222-2222-4222-8222-222222222222",
        "runId": RUN_ID,
        "engineKey": "aequilibrae",
        "stageNames": list(main.AEQ_STAGE_NAMES),
        "occurredAt": "2026-07-29T00:00:00Z",
    }


def test_an_authenticated_push_is_accepted_and_queued():
    server = _Server()
    try:
        status, body = server.request("POST", main.MODEL_RUN_DISPATCH_PATH, _dispatch_body(), token=TOKEN)
        assert status == 202, status
        assert body["status"] == "accepted", body
        assert body["runId"] == RUN_ID, body
        assert body["jobReference"], body
        assert server.submitted == [RUN_ID], server.submitted
    finally:
        server.close()


def test_an_unauthenticated_caller_cannot_start_compute():
    """The endpoint spends the deployment's compute; a missing or wrong token
    must not reach the queue at all."""
    server = _Server()
    try:
        for token in (None, "", "wrong-token"):
            status, _ = server.request("POST", main.MODEL_RUN_DISPATCH_PATH, _dispatch_body(), token=token)
            assert status == 401, (token, status)
        assert server.submitted == [], server.submitted
    finally:
        server.close()


def test_a_payload_shape_the_worker_does_not_understand_is_refused_by_name():
    server = _Server()
    try:
        body = _dispatch_body()
        body["contract"] = "some-future-contract.v9"
        status, payload = server.request("POST", main.MODEL_RUN_DISPATCH_PATH, body, token=TOKEN)
        assert status == 400, status
        assert payload["error"] == "unsupported_contract", payload
        assert payload["expected"] == main.MODEL_RUN_DISPATCH_CONTRACT, payload

        missing = _dispatch_body()
        del missing["runId"]
        status, payload = server.request("POST", main.MODEL_RUN_DISPATCH_PATH, missing, token=TOKEN)
        assert status == 400, status
        assert payload["error"] == "missing_run_id", payload

        assert server.submitted == [], server.submitted
    finally:
        server.close()


def test_health_reports_the_process_and_claims_nothing_about_a_run():
    server = _Server()
    try:
        status, body = server.request("GET", main.TRIGGER_HEALTH_PATH)
        assert status == 200, status
        assert body["status"] == "ok", body
        # It advertises which stages this worker owns, so an operator running a
        # pool can see it is the right image — and nothing about run success.
        assert body["stages"] == list(main.AEQ_STAGE_NAMES), body
        assert "run" not in body, body

        status, _ = server.request("GET", "/", None)
        assert status == 404, status
        status, _ = server.request("POST", "/some/other/path", _dispatch_body(), token=TOKEN)
        assert status == 404, status
    finally:
        server.close()


def test_the_trigger_refuses_to_serve_without_a_shared_secret():
    original = main.TRIGGER_TOKEN
    main.TRIGGER_TOKEN = ""
    try:
        main.serve_push_trigger()
    except SystemExit as exit_error:
        message = str(exit_error)
        assert "OPENPLAN_MODELING_WORKER_TOKEN" in message, message
        # It names the alternative rather than leaving the operator stuck.
        assert "AEQ_WORKER_MODE=poll" in message, message
    else:
        raise AssertionError("serving with no token must refuse")
    finally:
        main.TRIGGER_TOKEN = original


# ── Execution: one path, two entrypoints ────────────────────────────────────


class _StageFixture:
    """Stands in for the two Supabase-touching functions, recording calls."""

    def __init__(self, results, stage_batches):
        self.results = list(results)
        self.stage_batches = list(stage_batches)
        self.fetched_run_ids = []
        self.processed_batches = []

    def fetch(self, run_id=None, limit=25):
        self.fetched_run_ids.append(run_id)
        return self.stage_batches.pop(0) if self.stage_batches else []

    def process(self, stages):
        self.processed_batches.append(stages)
        return self.results.pop(0) if self.results else "idle"


def _with_stage_fixture(fixture, fn):
    original_fetch, original_process = main.fetch_queued_stages, main.process_first_actionable_stage
    main.fetch_queued_stages = fixture.fetch
    main.process_first_actionable_stage = fixture.process
    try:
        return fn()
    finally:
        main.fetch_queued_stages = original_fetch
        main.process_first_actionable_stage = original_process


def test_one_push_drains_a_whole_run_rather_than_one_stage():
    """A push-only pool gets ONE trigger per run. If a trigger ran a single
    stage, stages two and three would sit queued forever, because nothing tells
    the app to ring again."""
    stage = [{"id": "s", "run_id": RUN_ID, "stage_name": "AequilibraE Setup", "sort_order": 1}]
    fixture = _StageFixture(
        results=["processed", "processed", "processed"],
        stage_batches=[stage, stage, stage, []],
    )
    outcome = _with_stage_fixture(fixture, lambda: main.execute_run_from_trigger(RUN_ID))

    assert outcome == "processed", outcome
    assert len(fixture.processed_batches) == 3, fixture.processed_batches
    # Every read is scoped to the pushed run: a trigger must not start draining
    # other tenants' queued work as a side effect.
    assert set(fixture.fetched_run_ids) == {RUN_ID}, fixture.fetched_run_ids


def test_a_trigger_that_loses_the_claim_stops_instead_of_spinning():
    """The whole safety story: a pushed worker owns nothing. When another
    process claimed the stage, this one must stop — retrying would put two
    processes on one run, which is what the atomic claim exists to prevent."""
    stage = [{"id": "s", "run_id": RUN_ID, "stage_name": "AequilibraE Setup", "sort_order": 1}]
    fixture = _StageFixture(results=["lost"], stage_batches=[stage, stage, stage])
    outcome = _with_stage_fixture(fixture, lambda: main.execute_run_from_trigger(RUN_ID))

    assert outcome == "lost", outcome
    assert len(fixture.processed_batches) == 1, fixture.processed_batches


def test_a_trigger_waiting_on_another_process_stops_instead_of_spinning():
    stage = [{"id": "s", "run_id": RUN_ID, "stage_name": "Network Assignment", "sort_order": 2}]
    fixture = _StageFixture(results=["idle"], stage_batches=[stage, stage, stage])
    outcome = _with_stage_fixture(fixture, lambda: main.execute_run_from_trigger(RUN_ID))

    assert outcome == "idle", outcome
    assert len(fixture.processed_batches) == 1, fixture.processed_batches


def test_a_pushed_stage_is_taken_with_the_same_conditional_claim_as_a_polled_one():
    """No double execution: the claim PATCH is conditional on the row still
    being queued, so exactly one process can move it, whichever arrived first
    and however it was started."""
    calls = []

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return []

    def fake_patch(url, headers=None, json=None):
        calls.append(url)
        return _Response()

    original = main.requests.patch
    main.requests.patch = fake_patch
    try:
        claimed = main.sb_claim_stage("stage-id", {"status": "running"})
    finally:
        main.requests.patch = original

    assert calls, "the claim must issue a PATCH"
    assert "id=eq.stage-id" in calls[0], calls[0]
    assert "status=eq.queued" in calls[0], calls[0]
    # PostgREST returned no rows: the row had already left `queued`, so this
    # worker did NOT win it.
    assert claimed is False


def test_process_stage_reports_a_lost_claim_so_a_drain_can_stop():
    """`process_first_actionable_stage` distinguishes 'we ran it' from 'someone
    else has it' purely by this return value — if process_stage swallowed a lost
    claim, a pushed worker would report success for work it never did."""
    original = main.sb_claim_stage
    main.sb_claim_stage = lambda stage_id, payload: False
    try:
        result = main.process_stage(
            {"id": "s", "run_id": RUN_ID, "stage_name": "AequilibraE Setup", "sort_order": 1}
        )
    finally:
        main.sb_claim_stage = original

    assert result is False


def test_a_stage_read_can_be_scoped_to_one_run_without_changing_the_poll_query():
    """Both entrypoints share one read. The only difference a push makes is a
    run filter — the owned-stage filter and ordering are identical, so a pushed
    worker cannot claim a stage a polling worker would have refused (e.g. the
    ActivitySim stage another worker owns)."""
    seen = []

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return []

    def fake_get(url, headers=None, timeout=None):
        seen.append(url)
        return _Response()

    original = main.requests.get
    main.requests.get = fake_get
    try:
        main.fetch_queued_stages()
        main.fetch_queued_stages(run_id=RUN_ID)
    finally:
        main.requests.get = original

    poll_url, push_url = seen
    assert "status=eq.queued" in poll_url and "status=eq.queued" in push_url
    assert main._AEQ_STAGE_FILTER in poll_url and main._AEQ_STAGE_FILTER in push_url
    assert "run_id=eq." not in poll_url, poll_url
    assert f"run_id=eq.{RUN_ID}" in push_url, push_url


def test_the_default_start_mode_is_still_polling():
    """An existing deployment upgrading this file must not suddenly open a port
    or stop serving its queue."""
    started = []
    original_poll, original_serve = main.poll_for_jobs, main.serve_push_trigger
    main.poll_for_jobs = lambda: started.append("poll")
    main.serve_push_trigger = lambda *a, **k: started.append("push")
    original_mode = os.environ.pop("AEQ_WORKER_MODE", None)
    try:
        main.run_worker()
        assert started == ["poll"], started

        started.clear()
        main.run_worker("push")
        assert started == ["push"], started

        try:
            main.run_worker("sometimes")
        except SystemExit as exit_error:
            assert "poll" in str(exit_error), str(exit_error)
        else:
            raise AssertionError("an unrecognized mode must refuse rather than guess")
    finally:
        main.poll_for_jobs = original_poll
        main.serve_push_trigger = original_serve
        if original_mode is not None:
            os.environ["AEQ_WORKER_MODE"] = original_mode


def test_the_executor_survives_a_run_that_raises():
    """A drain thread that dies leaves a pool answering 202 and executing
    nothing — the exact 'looks fine, does nothing' failure this lane removes."""
    done = threading.Event()
    seen = []

    def execute(run_id):
        seen.append(run_id)
        if len(seen) == 1:
            raise RuntimeError("boom")
        done.set()
        return "processed"

    executor = main.RunTriggerExecutor(execute=execute, workers=1)
    executor.submit("run-one")
    executor._queue.join()
    executor.submit("run-two")
    assert done.wait(timeout=10), seen
    assert seen == ["run-one", "run-two"], seen


def test_a_duplicate_push_is_accepted_and_deduplicated():
    """De-duplication is an efficiency, not the safety property — so it must not
    reject, because the app's planner-facing answer ('something has it') is true
    either way."""
    executor = main.RunTriggerExecutor(execute=lambda run_id: "processed", workers=1)
    with executor._lock:
        executor._inflight.add("run-one")
    reference, state = executor.submit("run-one")
    assert state == "already_queued", state
    assert reference, "a duplicate still gets its own job reference"


# ── An acceptance has to mean something ─────────────────────────────────────


def test_a_full_pool_refuses_instead_of_accepting_what_it_may_never_start():
    """202 is a promise, made before any work happens, by a process that may be
    reclaimed in a minute. An unbounded queue turns that promise into a pile: the
    planner is told a worker took the run, and the run is never started or even
    failed. Refusing past the bound keeps 'accepted' meaning 'there is a slot'."""
    blocked = threading.Event()
    executor = main.RunTriggerExecutor(
        execute=lambda run_id: blocked.wait(timeout=10) and "processed",
        workers=1,
        max_queued=1,
    )
    try:
        # One is picked up by the (blocked) drain thread; one fills the queue.
        _, first = executor.submit("run-one")
        assert first == "queued", first
        for _ in range(200):
            if executor._queue.qsize() == 0 and len(executor.pending_run_ids()) == 1:
                break
            time.sleep(0.01)
        _, second = executor.submit("run-two")
        assert second == "queued", second

        _, third = executor.submit("run-three")
        assert third == "refused_full", third
        # A refused run was never taken on: nothing may go on believing this
        # process has it.
        assert "run-three" not in executor.pending_run_ids(), executor.pending_run_ids()
    finally:
        blocked.set()


def test_a_refused_push_answers_503_with_the_reason_not_202():
    """The app turns a non-2xx into a planner-visible 'nothing took it, here is
    why'. Answering 202 here would be the same lie as a queued run nothing will
    ever look at."""
    server = _Server(submit_state="refused_full")
    try:
        status, body = server.request("POST", main.MODEL_RUN_DISPATCH_PATH, _dispatch_body(), token=TOKEN)
        assert status == 503, status
        assert body["error"] == "pool_at_capacity", body
        assert "still queued" in body["detail"], body
    finally:
        server.close()


def test_shutdown_finishes_what_was_accepted_and_names_what_it_could_not():
    """The failure that must not be silent. The trigger answers and executes
    afterwards, so a platform that reclaims an idle-looking instance can stop one
    mid-run — and in push-only mode there is no poller to notice. Draining is the
    first defence; NAMING the runs it could not finish is the second, because a
    dropped run has to leave a trace with a run id in it."""
    release = threading.Event()
    started = threading.Event()

    def execute(run_id):
        started.set()
        release.wait(timeout=10)
        return "processed"

    executor = main.RunTriggerExecutor(execute=execute, workers=1)
    executor.submit("run-one")
    assert started.wait(timeout=10)

    # Grace expires with the run still going: it is reported, not swallowed.
    unfinished = executor.wait_for_drain(0.05)
    assert unfinished == ["run-one"], unfinished

    release.set()
    assert executor.wait_for_drain(10) == [], executor.pending_run_ids()


# ── The concurrency knob ────────────────────────────────────────────────────


def test_more_than_one_run_per_process_is_refused_with_the_real_reason():
    """The most dangerous setting this worker could offer. Two runs in one
    process would not merely be slow — AequilibraE keeps the open project in a
    process-wide global, so run A would validate and CALIBRATE against run B's
    counts, for a different study area, and the wrong number would look exactly
    like a right one on the surface that decides a claim tier."""
    assert main.resolve_max_concurrent_runs({}) == 1
    assert main.resolve_max_concurrent_runs({"AEQ_MAX_CONCURRENT_RUNS": "1"}) == 1
    assert main.resolve_max_concurrent_runs({"AEQ_MAX_CONCURRENT_RUNS": "  "}) == 1

    try:
        main.resolve_max_concurrent_runs({"AEQ_MAX_CONCURRENT_RUNS": "4"})
    except SystemExit as exit_error:
        message = str(exit_error)
        # The refusal names the real cause and the real alternative, rather than
        # clamping to 1 and leaving the operator believing they got concurrency.
        assert "process" in message, message
        assert "counts" in message or "calibrat" in message, message
        assert "instances" in message, message
    else:
        raise AssertionError("a concurrency above 1 must be refused, not clamped")

    try:
        main.resolve_max_concurrent_runs({"AEQ_MAX_CONCURRENT_RUNS": "lots"})
    except SystemExit as exit_error:
        assert "whole number" in str(exit_error), str(exit_error)
    else:
        raise AssertionError("an unparseable value must be refused, not ignored")


def test_the_counts_a_run_validates_against_are_not_process_state():
    """The other half of the same defect: a module global holding 'the current
    run's counts'. The artifact stage validates a run against a count set the
    ASSIGNMENT stage resolved, and it can run in a different process — so the
    path has to travel with the run, not with whatever the process did last."""
    assert not hasattr(main, "_active_counts_path"), (
        "a module-global counts path is what let one run be validated against another's stations"
    )
    # It is a required keyword on the calibration entrypoint: a caller cannot
    # forget it and silently fall back to a default count set.
    import inspect
    calibration_params = inspect.signature(main._run_calibration).parameters
    assert calibration_params["counts_path"].kind is inspect.Parameter.KEYWORD_ONLY
    assert calibration_params["counts_path"].default is inspect.Parameter.empty

    # And validation takes it per call, defaulting only to the configured file.
    validation_params = inspect.signature(main._run_count_validation).parameters
    assert "counts_path" in validation_params


def test_a_draining_worker_refuses_new_pushes_instead_of_leaving_them_hanging():
    """`shutdown()` stops the accept loop but leaves the socket BOUND, so a push
    arriving during the drain window would be accepted by the kernel into the
    backlog and never answered — the app would wait out its own timeout before
    telling the planner anything. Closing the listener first turns that into an
    immediate refusal, which the app reports as 'nothing took this run'."""
    drained = []

    class _Dispatcher:
        def submit(self, run_id):
            return "job-reference-1", "queued"

        def pending_run_ids(self):
            return []

        def wait_for_drain(self, timeout_seconds):
            drained.append(timeout_seconds)
            # Long enough that a still-bound socket is measurably a hang: a real
            # drain lasts minutes, so the window under test is the drain itself,
            # not the moment after it.
            time.sleep(1.5)
            return []

    dispatcher = _Dispatcher()
    server = main.build_trigger_server(TOKEN, dispatcher.submit, host="127.0.0.1", port=0)
    port = server.server_address[1]
    serving = threading.Thread(
        target=main._serve_until_drained, args=(server, dispatcher), daemon=True
    )
    serving.start()
    time.sleep(0.2)

    threading.Thread(target=server.shutdown, daemon=True).start()
    time.sleep(0.1)

    # The distinction that matters is REFUSED vs HUNG: a bound-but-unserved
    # socket also "fails", eventually, by timing out — which is the ten seconds
    # of silence this exists to remove. So the refusal has to be fast.
    started = time.monotonic()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("GET", main.TRIGGER_HEALTH_PATH)
        status = conn.getresponse().status
        raise AssertionError(f"a draining worker was still accepting pushes ({status})")
    except TimeoutError:
        raise AssertionError(
            "a push during the drain window hung on a still-bound socket instead of being refused"
        )
    except (ConnectionError, OSError):
        pass
    elapsed = time.monotonic() - started
    assert elapsed < 0.75, f"the refusal took {elapsed:.2f}s, which is a hang, not a refusal"

    serving.join(timeout=10)
    assert not serving.is_alive(), "the serve loop never finished draining"
    assert drained, "shutdown must wait for accepted runs before exiting"


def test_two_threads_in_one_process_cannot_execute_two_stages_at_once():
    """`AEQ_WORKER_MODE=both` runs the poll loop and the push drain in ONE
    process. The atomic claim stops them taking the same stage; it does nothing
    about them taking two DIFFERENT stages, of two different runs, and executing
    them side by side — which is precisely the corruption AEQ_MAX_CONCURRENT_RUNS
    is refused above 1 to prevent, arriving through the other door. AequilibraE
    keeps the open project in a process-global, so the second run's
    `Project.open()` redirects the first run's assignment at the second run's
    database, and the wrong number looks exactly like a right one.

    So execution is serialized process-wide. This pins that a second thread
    WAITS rather than interleaving."""
    overlapped = []
    inside = threading.Event()
    release = threading.Event()
    entered_second = threading.Event()

    def fake_claim(stage_id, payload):
        # Runs inside the lock. The first caller parks here holding it.
        if stage_id == "stage-a":
            inside.set()
            release.wait(timeout=10)
        else:
            overlapped.append(inside.is_set() and not release.is_set())
            entered_second.set()
        return False

    original = main.sb_claim_stage
    main.sb_claim_stage = fake_claim
    try:
        first = threading.Thread(
            target=main.process_stage,
            args=({"id": "stage-a", "run_id": RUN_ID, "stage_name": "AequilibraE Setup", "sort_order": 1},),
            daemon=True,
        )
        first.start()
        assert inside.wait(timeout=10), "the first stage never started"

        second = threading.Thread(
            target=main.process_stage,
            args=({"id": "stage-b", "run_id": RUN_ID, "stage_name": "AequilibraE Setup", "sort_order": 1},),
            daemon=True,
        )
        second.start()
        # The second stage must NOT have run while the first held the lock.
        assert not entered_second.wait(timeout=1.0), (
            "a second stage executed while another was mid-flight in the same process"
        )

        release.set()
        assert entered_second.wait(timeout=10), "the second stage never got its turn"
        assert overlapped == [False], overlapped
        first.join(timeout=10)
        second.join(timeout=10)
    finally:
        release.set()
        main.sb_claim_stage = original


def test_the_push_config_puts_the_drain_window_where_fly_reads_it():
    """The mitigation for an accepted run that vanishes is the shutdown drain,
    and the drain only happens if the platform waits. In TOML a bare key belongs
    to the last table header above it, so `kill_timeout` written after
    `[http_service]` or `[[vm]]` — which is where the explanation naturally wants
    to sit — is filed under that table, silently unread, leaving Fly's 5-second
    default while this file and DEPLOY.md both claim five minutes."""
    import tomllib

    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "fly.push.toml"), "rb") as handle:
        config = tomllib.load(handle)

    assert config.get("kill_timeout") == "5m", config.get("kill_timeout")
    assert config.get("kill_signal") == "SIGTERM", config.get("kill_signal")
    # Not swallowed by the health check or the vm block.
    assert "kill_timeout" not in config["http_service"]["checks"][0]
    assert "kill_timeout" not in config["vm"][0]
    # The worker's own grace must fit inside what the platform allows.
    assert config["env"]["AEQ_SHUTDOWN_GRACE_SECONDS"] == "300"
    # And the mode that opens a port is the one this file deploys.
    assert config["env"]["AEQ_WORKER_MODE"] == "push"
    assert config["http_service"]["internal_port"] == 8080


def test_neither_fly_config_ships_one_operator_s_region():
    """A region baked into a shared config is one place's convenience presented
    as everyone's default. `fly launch` asks; this repo does not answer."""
    import tomllib

    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("fly.toml", "fly.push.toml"):
        with open(os.path.join(here, name), "rb") as handle:
            config = tomllib.load(handle)
        assert "primary_region" not in config, name


def test_the_run_work_directory_is_not_named_for_one_place():
    """A default scratch path named for a single county put one jurisdiction's
    name on every run's working directory, anywhere in the world — and stated
    something untrue about a run in Ohio."""
    assert not hasattr(main, "PILOT_WORK_DIR")
    assert "nevada" not in main.RUN_WORK_ROOT.lower(), main.RUN_WORK_ROOT
    assert "pilot" not in main.RUN_WORK_ROOT.lower(), main.RUN_WORK_ROOT


TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    failures = 0
    for test in TESTS:
        try:
            test()
            print(f"ok  {test.__name__}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {test.__name__}: {error}")
    print()
    if failures:
        print(f"{failures} of {len(TESTS)} push-trigger checks FAILED.")
        sys.exit(1)
    print(f"{len(TESTS)} push-trigger checks passed.")
