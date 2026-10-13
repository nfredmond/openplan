"""Stage leases, lapsed-lease reconciliation, unconfirmed writes and shutdown.

KI-2026-10-12-018: a worker that died mid-stage left the stage running forever.
These checks pin the recovery boundary added in model_stage_lease.py:

  * a confirmed claim is leased through the heartbeat and renewed by it,
  * a running stage whose lease lapsed is marked interrupted (still running,
    never failed or complete), and only for the same claim,
  * a stage another live worker holds, or a claim younger than the lapse
    window, is never touched,
  * the poll loop reports an unconfirmed state write with run and stage
    identity instead of the generic error line, and sends no compensating write,
  * SIGTERM in poll mode stops claims and records the held stage as
    interrupted by shutdown inside the supervisor's grace period.

All HTTP is injected. Nothing here contacts a database.
Run: python3 workers/aequilibrae_worker/test_model_stage_lease.py
"""
from __future__ import annotations

import importlib.util
import inspect
import io
import os
import signal
import tempfile
import threading
import unittest
import urllib.parse
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from worker_import_for_tests import import_worker_main
import model_stage_lease as lease
from worker_heartbeat import WorkerHeartbeat

main = import_worker_main()

NOW = datetime(2026, 10, 12, 18, 0, tzinfo=timezone.utc)
RUN = "11111111-1111-4111-8111-111111111111"
STAGE_ID = "22222222-2222-4222-8222-222222222222"
OTHER_STAGE = "33333333-3333-4333-8333-333333333333"
CLAIMED = (NOW - timedelta(hours=30)).isoformat()
STAGE = {"id": STAGE_ID, "run_id": RUN, "stage_name": "Network Assignment", "status": "running",
         "started_at": CLAIMED, "error_message": None}


class StopPoll(BaseException):
    pass


class ClaimedAfterStop(BaseException):
    """BaseException: the poll loop's generic handler must not swallow it."""


class UnexpectedWrite(BaseException):
    """A compensating write after an unconfirmed one; also unswallowable."""


class Response:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeHttp:
    """Answers lease reads and echoes conditional PATCHes as PostgREST would."""

    def __init__(self, stages, heartbeats, patch_rows=None):
        self.stages = stages
        self.heartbeats = heartbeats
        self.patch_rows = patch_rows
        self.gets: list[str] = []
        self.patches: list[tuple[str, dict, float]] = []

    def get(self, url, headers=None, timeout=None):
        self.gets.append(url)
        if "/model_run_stages?" in url:
            return Response(self.stages)
        if "/modeling_worker_heartbeats?" in url:
            return Response(self.heartbeats)
        raise AssertionError(f"unexpected read {url}")

    def patch(self, url, headers=None, json=None, timeout=None):
        self.patches.append((url, json, timeout))
        if self.patch_rows is not None:
            return Response(self.patch_rows)
        record_id = url.split("id=eq.")[1].split("&")[0]
        return Response([{"id": record_id, **json}])


def beat(stage_id, seen):
    return {"worker_kind": "aequilibrae", "instance_id": "old", "current_work": {"stageId": stage_id},
            "last_successful_heartbeat_at": seen.isoformat()}


def reconcile(http):
    out = io.StringIO()
    with redirect_stdout(out):
        marked = lease.reconcile_lapsed_stages(base_url="http://db.invalid", headers={}, stage_filter="stage_name=x",
                                               worker_label="Test worker", now=NOW, http=http)
    return marked, out.getvalue()


class LeaseRenewalTest(unittest.TestCase):
    def heartbeat(self):
        return WorkerHeartbeat(supabase_url="http://db.invalid", service_key="k", worker_kind="aequilibrae",
                               supported_stages=("Network Assignment",), runtime_mode="poll")

    def test_a_held_claim_is_named_and_renewed_by_every_heartbeat(self):
        heartbeat = self.heartbeat()
        custody = lease.PollCustody(base_url="http://db.invalid", headers={}, heartbeat=lambda: heartbeat,
                                    worker_label="Test", http=FakeHttp([], []))
        with patch("worker_heartbeat.requests.post", return_value=Mock(raise_for_status=Mock())) as post:
            custody.hold(STAGE, CLAIMED)
            heartbeat.emit_once()
            heartbeat.emit_once()
            custody.release()
            heartbeat.emit_once()
        works = [call.kwargs["json"]["current_work"] for call in post.call_args_list]
        # hold() renews at once, then each scheduled heartbeat renews again.
        self.assertEqual(len(works), 4)
        for work in works[:3]:
            self.assertEqual(work, {"runId": RUN, "stageId": STAGE_ID, "stageName": "Network Assignment",
                                    "claimedAt": CLAIMED, "lease": "held"})
        renewals = [call.kwargs["json"]["last_successful_heartbeat_at"] for call in post.call_args_list[:3]]
        self.assertEqual(renewals, sorted(renewals))
        self.assertIsNone(works[3], "a released stage must not stay leased")

    def test_the_worker_leases_only_a_confirmed_claim_with_the_claim_time_it_sent(self):
        heartbeat = Mock()
        sent = []

        def claim(stage_id, payload):
            sent.append(payload["started_at"])
            return True

        stage = {"id": STAGE_ID, "run_id": RUN, "stage_name": "Synthetic unknown stage"}
        work_root = tempfile.TemporaryDirectory()
        self.addCleanup(work_root.cleanup)
        with patch.object(main, "_WORKER_HEARTBEAT", heartbeat), patch.object(main, "sb_claim_stage", side_effect=claim), \
                patch.object(main, "sb_patch_run"), patch.object(main, "sb_patch_stage"), \
                patch.object(main, "RUN_WORK_ROOT", work_root.name), redirect_stdout(io.StringIO()):
            self.assertTrue(main.process_stage(stage))
        held = heartbeat.set_current_work.call_args_list[0]
        self.assertEqual(held.args[0]["stageId"], STAGE_ID)
        self.assertEqual(held.args[0]["claimedAt"], sent[0])
        heartbeat.emit_once.assert_called()
        self.assertEqual(heartbeat.set_current_work.call_args_list[-1].args, (None,))

        heartbeat.reset_mock()
        with patch.object(main, "_WORKER_HEARTBEAT", heartbeat), patch.object(main, "sb_claim_stage", return_value=False):
            self.assertFalse(main.process_stage(stage))
        leased = [c for c in heartbeat.set_current_work.call_args_list if c.args and c.args[0]]
        self.assertEqual(leased, [], "a lost claim must never be leased")


class LapsedLeaseReconciliationTest(unittest.TestCase):
    def test_a_lapsed_lease_marks_the_same_claim_interrupted_and_nothing_else(self):
        http = FakeHttp([STAGE], [beat(STAGE_ID, NOW - timedelta(minutes=40))])
        marked, out = reconcile(http)
        self.assertEqual(marked, [STAGE_ID])
        stage_url, body, _ = http.patches[0]
        self.assertIn(f"id=eq.{STAGE_ID}", stage_url)
        self.assertIn("status=eq.running", stage_url)
        self.assertIn("error_message=is.null", stage_url)
        self.assertIn("started_at=eq." + urllib.parse.quote(CLAIMED, safe=""), stage_url)
        self.assertEqual(set(body), {"error_message"}, "status, outputs and completion must be untouched")
        self.assertTrue(body["error_message"].startswith("Interrupted: no model worker has held this stage since"))
        self.assertIn("2026-10-12 17:20 UTC", body["error_message"])
        run_url, run_body, _ = http.patches[1]
        self.assertIn(f"/model_runs?id=eq.{RUN}&status=eq.running&error_message=is.null", run_url)
        self.assertEqual(set(run_body), {"error_message"})
        self.assertIn(f"run={RUN} stage={STAGE_ID}", out)
        # The reads ask for exactly what the decision uses.
        stage_read, beat_read = http.gets
        self.assertIn("status=eq.running", stage_read)
        self.assertIn("error_message=is.null", stage_read)
        self.assertIn("stage_name=x", stage_read)
        self.assertIn("select=id,run_id,stage_name,status,started_at,error_message", stage_read)
        self.assertIn("current_work=not.is.null", beat_read)
        self.assertIn("select=worker_kind,instance_id,current_work,last_successful_heartbeat_at", beat_read)

    def test_a_stage_no_heartbeat_names_is_interrupted_once_its_claim_is_old(self):
        http = FakeHttp([STAGE], [beat(OTHER_STAGE, NOW)])
        self.assertEqual(reconcile(http)[0], [STAGE_ID])
        self.assertIn("since 2026-10-11 12:00 UTC", http.patches[0][1]["error_message"])

    def test_a_stage_that_moved_on_is_left_alone(self):
        http = FakeHttp([STAGE], [], patch_rows=[])
        marked, out = reconcile(http)
        self.assertEqual(marked, [])
        self.assertEqual(len(http.patches), 1, "no run note without a stage note")
        self.assertIn("left unchanged", out)


class LiveOwnerRefusalTest(unittest.TestCase):
    def assertUntouched(self, stages, heartbeats):
        http = FakeHttp(stages, heartbeats)
        marked, _ = reconcile(http)
        self.assertEqual(marked, [])
        self.assertEqual(http.patches, [])

    def test_a_stage_another_live_worker_holds_is_never_touched(self):
        # A run that has computed for 30 hours and still renews its lease.
        self.assertUntouched([STAGE], [beat(STAGE_ID, NOW - timedelta(minutes=1)),
                                       beat(STAGE_ID, NOW - timedelta(hours=3))])

    def test_a_recent_claim_is_never_touched_before_its_owner_could_renew(self):
        young = {**STAGE, "started_at": (NOW - timedelta(minutes=5)).isoformat()}
        self.assertUntouched([young], [])

    def test_doubt_protects_the_stage(self):
        self.assertUntouched([STAGE], [{"current_work": {"stageId": STAGE_ID}, "last_successful_heartbeat_at": "garbled"}])
        self.assertUntouched([{**STAGE, "error_message": "already recorded"}], [])
        self.assertUntouched([{**STAGE, "started_at": None}], [])

    def test_a_read_at_its_row_limit_marks_nothing(self):
        crowded = [beat(OTHER_STAGE, NOW - timedelta(hours=1))] * lease.MAX_ROWS
        self.assertUntouched([STAGE], crowded)

    def test_a_failed_read_marks_nothing_and_does_not_raise(self):
        http = FakeHttp([STAGE], [])
        http.get = Mock(return_value=Response({"message": "x"}, status_code=503))
        marked, out = reconcile(http)
        self.assertEqual((marked, http.patches), ([], []))
        self.assertIn("reconciliation skipped", out)


class UnconfirmedWriteTest(unittest.TestCase):
    def test_the_poll_loop_reports_identity_and_sends_no_compensating_write(self):
        queued = {"id": STAGE_ID, "run_id": RUN, "stage_name": "Network Assignment", "sort_order": 2}
        out = io.StringIO()
        with patch.object(main.model_stage_lease, "reconcile_lapsed_stages", return_value=[]), \
                patch.object(main, "fetch_queued_stages", return_value=[queued]), \
                patch.object(main, "classify_stage_readiness", return_value=("ready", None)), \
                patch.object(main, "process_stage", side_effect=main.WorkerStateWriteUnconfirmed(
                    "Worker state write unconfirmed for model_run_stages (HTTP 504)")), \
                patch.object(main.requests, "patch", side_effect=UnexpectedWrite), \
                patch.object(main.time, "sleep", side_effect=StopPoll), redirect_stdout(out):
            with self.assertRaises(StopPoll):
                main.poll_for_jobs()
        text = out.getvalue()
        self.assertIn("UNCONFIRMED STATE WRITE", text)
        self.assertIn(f"run={RUN} stage={STAGE_ID} (Network Assignment)", text)
        self.assertIn("HTTP 504", text)
        self.assertNotIn("Poll loop error", text)


class ShutdownTest(unittest.TestCase):
    def custody(self, http, exits):
        return lease.PollCustody(base_url="http://db.invalid", headers={}, heartbeat=lambda: None,
                                 worker_label="Test", http=http, exit_process=exits.append,
                                 log=lambda _message: None, clock=lambda: NOW)

    def test_sigterm_records_the_held_stage_as_interrupted_by_shutdown_and_exits(self):
        http, exits = FakeHttp([], []), []
        gate_at_exit = []
        custody = self.custody(http, exits)
        custody._exit = lambda code: (gate_at_exit.append(lease.STATE_WRITE_GATE.locked()), exits.append(code))
        restore = custody.install_signal_handlers()
        try:
            custody.hold(STAGE, CLAIMED)
            os.kill(os.getpid(), signal.SIGTERM)
            for thread in threading.enumerate():
                if thread.name == "stage-shutdown-record":
                    thread.join(10)
        finally:
            restore()
        self.assertTrue(custody.stop_requested())
        self.assertEqual(exits, [0])
        self.assertEqual(gate_at_exit, [True], "no state write may land after the shutdown record")
        stage_url, body, timeout = http.patches[0]
        self.assertIn("started_at=eq." + urllib.parse.quote(CLAIMED, safe=""), stage_url)
        self.assertTrue(body["error_message"].startswith(
            "Interrupted: the model worker shut down at 2026-10-12 18:00 UTC"))
        self.assertLessEqual(timeout, lease.SHUTDOWN_WRITE_TIMEOUT_SECONDS)
        self.assertFalse(lease.STATE_WRITE_GATE.locked())

    def test_the_shutdown_record_fits_the_supervisor_grace_period(self):
        path = Path(__file__).resolve().parents[1] / "hosted-models" / "supervise.py"
        spec = importlib.util.spec_from_file_location("hosted_supervise_for_lease_test", path)
        supervise = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(supervise)
        grace = inspect.signature(supervise.supervise).parameters["grace_seconds"].default
        worst = lease.SHUTDOWN_GATE_WAIT_SECONDS + 2 * lease.SHUTDOWN_WRITE_TIMEOUT_SECONDS
        self.assertLess(worst, grace)

    def test_sigterm_while_idle_stops_claiming_without_writing(self):
        http, exits = FakeHttp([], []), []
        custody = self.custody(http, exits)
        custody._on_signal(signal.SIGTERM, None)
        self.assertTrue(custody.stop_requested())
        self.assertEqual((http.patches, exits), ([], []))

    def test_a_claim_that_lands_after_sigterm_is_recorded_at_once(self):
        http, exits = FakeHttp([], []), []
        custody = self.custody(http, exits)
        custody._on_signal(signal.SIGTERM, None)
        custody.hold(STAGE, CLAIMED)
        self.assertEqual(exits, [0])
        self.assertEqual(len([p for p in http.patches if "/model_run_stages?" in p[0]]), 1)

    def test_the_poll_loop_claims_nothing_after_sigterm(self):
        queued = {"id": STAGE_ID, "run_id": RUN, "stage_name": "Network Assignment", "sort_order": 2}

        def fetch():
            main._CUSTODY._on_signal(signal.SIGTERM, None)
            return [queued]

        with patch.object(main, "_CUSTODY", self.custody(FakeHttp([], []), [])), \
                patch.object(main.model_stage_lease, "reconcile_lapsed_stages", return_value=[]) as reconciled, \
                patch.object(main, "fetch_queued_stages", side_effect=fetch), \
                patch.object(main, "process_first_actionable_stage", side_effect=ClaimedAfterStop), \
                redirect_stdout(io.StringIO()):
            main.poll_for_jobs()
        self.assertEqual(reconciled.call_args.kwargs["stage_filter"], main._AEQ_STAGE_FILTER)

    def test_the_poll_loop_reconciles_before_its_first_claim(self):
        order = []
        with patch.object(main.model_stage_lease, "reconcile_lapsed_stages",
                          side_effect=lambda **kwargs: order.append(("reconcile", kwargs["stage_filter"])) or []), \
                patch.object(main, "fetch_queued_stages", side_effect=lambda: order.append(("fetch",)) or []), \
                patch.object(main.time, "sleep", side_effect=StopPoll), redirect_stdout(io.StringIO()):
            with self.assertRaises(StopPoll):
                main.poll_for_jobs()
        self.assertEqual(order, [("reconcile", main._AEQ_STAGE_FILTER), ("fetch",)])


if __name__ == "__main__":
    unittest.main()
