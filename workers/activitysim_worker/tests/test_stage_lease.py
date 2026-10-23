"""ActivitySim stage lease, output-growth progress, unconfirmed writes and shutdown.

The heartbeat proves the process answers; a hung ActivitySim subprocess keeps it
answering. Output growth is recorded separately so a status can say "no new
output for N minutes". Nothing here stops a run for being quiet.
All HTTP is injected. Nothing here contacts a database.
"""
import io
import os
import signal
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://supabase.test")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

import supabase_poll  # noqa: E402
import model_stage_lease  # noqa: E402
from worker_heartbeat import OutputGrowth, WorkerHeartbeat  # noqa: E402

RUN_A = "44444444-4444-4444-8444-444444444444"
RUN_B = "55555555-5555-4555-8555-555555555555"
STAGE_ID = "66666666-6666-4666-8666-666666666666"


class StopPoll(BaseException):
    pass


class ClaimedAfterStop(BaseException):
    """BaseException: the poll loop's generic handler must not swallow it."""


class UnexpectedWrite(BaseException):
    """A compensating write after an unconfirmed one; also unswallowable."""


class Clock:
    def __init__(self, start=1_800_000_000.0):
        self.now = start

    def __call__(self):
        return self.now


class OutputGrowthTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "run"
        self.clock = Clock()

    def test_quiet_output_counts_up_and_new_output_resets_it(self):
        self.root.mkdir()
        (self.root / "activitysim_stdout.log").write_text("step 1\n")
        growth = OutputGrowth(str(self.root), clock=self.clock)
        first = growth.observe()
        self.assertEqual(first["secondsWithoutChange"], 0)
        self.assertEqual((first["fileCount"], first["totalBytes"]), (1, 7))

        self.clock.now += 1500
        quiet = growth.observe()
        self.assertEqual(quiet["secondsWithoutChange"], 1500)
        self.assertEqual(quiet["lastChangeAt"], first["lastChangeAt"])

        with (self.root / "activitysim_stdout.log").open("a") as log:
            log.write("step 2\n")
        self.clock.now += 60
        grown = growth.observe()
        self.assertEqual(grown["secondsWithoutChange"], 0)
        self.assertEqual(grown["totalBytes"], 14)
        self.assertNotEqual(grown["lastChangeAt"], first["lastChangeAt"])

    def test_a_directory_not_yet_created_is_unavailable_not_zero(self):
        observed = OutputGrowth(str(self.root), clock=self.clock).observe()
        self.assertFalse(observed["available"])
        self.assertNotIn("secondsWithoutChange", observed)

    def test_liveness_renews_while_progress_stays_quiet(self):
        self.root.mkdir()
        (self.root / "partial.csv").write_text("a\n")
        heartbeat = WorkerHeartbeat(supabase_url="http://db.invalid", service_key="k", worker_kind="activitysim",
                                    supported_stages=("ActivitySim Bundle & Preflight",), runtime_mode="activitysim_cli")
        heartbeat.set_current_work({"stageId": STAGE_ID}, progress=OutputGrowth(str(self.root), clock=self.clock))
        with mock.patch("worker_heartbeat.requests.post", return_value=mock.Mock(raise_for_status=mock.Mock())) as post:
            heartbeat.emit_once()
            self.clock.now += 900
            heartbeat.emit_once()
        first, second = (call.kwargs["json"] for call in post.call_args_list)
        self.assertLessEqual(first["last_successful_heartbeat_at"], second["last_successful_heartbeat_at"])
        self.assertEqual(second["current_work"]["stageId"], STAGE_ID)
        self.assertEqual(second["current_work"]["progress"]["secondsWithoutChange"], 900)

    def test_a_failing_probe_never_stops_the_heartbeat(self):
        broken = mock.Mock()
        broken.observe.side_effect = RuntimeError("disk vanished")
        heartbeat = WorkerHeartbeat(supabase_url="http://db.invalid", service_key="k", worker_kind="activitysim",
                                    supported_stages=(), runtime_mode="activitysim_cli")
        heartbeat.set_current_work({"stageId": STAGE_ID}, progress=broken)
        with mock.patch("worker_heartbeat.requests.post", return_value=mock.Mock(raise_for_status=mock.Mock())) as post:
            self.assertTrue(heartbeat.emit_once())
        self.assertEqual(post.call_args.kwargs["json"]["current_work"]["progress"],
                         {"available": False, "error": "RuntimeError"})


class ActivitySimLeaseWiringTest(unittest.TestCase):
    def test_each_claim_is_leased_with_its_own_time_and_run_directory(self):
        sent = []
        held = []

        def claim(stage_id, payload):
            sent.append(payload["started_at"])
            return True

        def hold(stage, claimed_at, progress=None):
            held.append((stage["run_id"], claimed_at, progress))

        with tempfile.TemporaryDirectory() as work, \
                mock.patch.object(supabase_poll, "ACTIVITYSIM_WORK_DIR", work), \
                mock.patch.object(supabase_poll, "sb_claim_stage", side_effect=claim), \
                mock.patch.object(supabase_poll._CUSTODY, "hold", side_effect=hold), \
                mock.patch.object(supabase_poll._CUSTODY, "release") as release, \
                mock.patch.object(supabase_poll, "sb_patch_run"), mock.patch.object(supabase_poll, "sb_patch_stage"), \
                mock.patch.object(supabase_poll, "sb_get_run", return_value={}), redirect_stdout(io.StringIO()):
            for run in (RUN_A, RUN_B):
                supabase_poll.process_stage({"id": STAGE_ID, "run_id": run, "stage_name": "Synthetic unknown"})
            roots = [progress._root for _run, _claimed, progress in held]
            self.assertEqual(roots, [os.path.join(work, RUN_A), os.path.join(work, RUN_B)])
        self.assertEqual([claimed for _run, claimed, _progress in held], sent)
        self.assertEqual(release.call_count, 2)

    def test_a_lost_claim_is_not_leased(self):
        with mock.patch.object(supabase_poll, "sb_claim_stage", return_value=False), \
                mock.patch.object(supabase_poll._CUSTODY, "hold") as hold, redirect_stdout(io.StringIO()):
            supabase_poll.process_stage({"id": STAGE_ID, "run_id": RUN_A, "stage_name": "Synthetic unknown"})
        hold.assert_not_called()


class ActivitySimPollLoopTest(unittest.TestCase):
    def queued(self):
        return mock.Mock(status_code=200, json=lambda: [{"id": STAGE_ID, "run_id": RUN_A,
                                                         "stage_name": supabase_poll.STAGE_BUNDLE_PREFLIGHT}])

    def test_unconfirmed_operations_keep_their_kind_identity_and_no_compensating_write(self):
        for operation, error_type in (("READ", supabase_poll.WorkerStateReadUnconfirmed),
                                      ("WRITE", supabase_poll.WorkerStateWriteUnconfirmed)):
            with self.subTest(operation=operation):
                out = io.StringIO()
                with mock.patch.object(supabase_poll, "WorkerHeartbeat"), \
                        mock.patch.object(supabase_poll.model_stage_lease, "reconcile_lapsed_stages", return_value=[]), \
                        mock.patch.object(supabase_poll.requests, "get", return_value=self.queued()), \
                        mock.patch.object(supabase_poll, "classify_stage_readiness", return_value=("ready", None)), \
                        mock.patch.object(supabase_poll, "process_stage", side_effect=error_type(
                            "Worker completion operation unconfirmed")), \
                        mock.patch.object(supabase_poll.requests, "patch", side_effect=UnexpectedWrite), \
                        mock.patch.object(supabase_poll.time, "sleep", side_effect=StopPoll), redirect_stdout(out):
                    with self.assertRaises(StopPoll):
                        supabase_poll.poll_for_jobs()
                text = out.getvalue()
                self.assertIn(f"UNCONFIRMED STATE {operation}", text)
                self.assertNotIn("UNCONFIRMED STATE " + ("WRITE" if operation == "READ" else "READ"), text)
                self.assertIn(f"run={RUN_A} stage={STAGE_ID} ({supabase_poll.STAGE_BUNDLE_PREFLIGHT})", text)
                self.assertNotIn("Poll loop error", text)

    def test_reconciles_first_and_claims_nothing_after_sigterm(self):
        order = []
        custody = model_stage_lease.PollCustody(base_url="http://db.invalid", headers={}, heartbeat=lambda: None,
                                                worker_label="Test", exit_process=lambda _code: None,
                                                log=lambda _message: None)

        def read(url, **_kwargs):
            order.append("fetch")
            custody._on_signal(signal.SIGTERM, None)
            return self.queued()

        with mock.patch.object(supabase_poll, "WorkerHeartbeat"), mock.patch.object(supabase_poll, "_CUSTODY", custody), \
                mock.patch.object(supabase_poll.model_stage_lease, "reconcile_lapsed_stages",
                                  side_effect=lambda **kwargs: order.append(kwargs["stage_filter"]) or []), \
                mock.patch.object(supabase_poll.requests, "get", side_effect=read), \
                mock.patch.object(supabase_poll, "process_stage", side_effect=ClaimedAfterStop), \
                redirect_stdout(io.StringIO()):
            supabase_poll.poll_for_jobs()
        self.assertEqual(order, [supabase_poll._STAGE_FILTER, "fetch"])


if __name__ == "__main__":
    unittest.main()
