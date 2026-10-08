"""HTTP custody checks; synthetic handlers do not execute ActivitySim."""
import contextlib
import io
import os
import sys
import unittest
from pathlib import Path
from unittest import mock
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:9")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "synthetic-test-only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import supabase_poll as worker

class StateReceipts(unittest.TestCase):
    def test_writes_and_claims_require_exact_receipts(self):
        payload = {"status": "running", "started_at": "2026-10-08T07:00:00+00:00"}
        row = {"id": "fixture", **payload}
        for writer in (worker.sb_patch_stage, worker.sb_patch_run, worker.sb_claim_stage):
            for status, rows, accepted in [(200, [{**row, "started_at": "2026-10-08T07:00:00Z", "extra": 1}], True), (503, [row], False), (200, [{**row, "id": "other"}], False), (200, [{**row, "status": "failed"}], False), (200, [row, row], False), (200, None, False)]:
                with self.subTest(writer=writer.__name__, status=status, rows=rows):
                    response = mock.Mock(status_code=status)
                    response.json.return_value = rows
                    with mock.patch.object(worker.requests, "patch", return_value=response) as patch:
                        if accepted:
                            writer("fixture", payload)
                        else:
                            with self.assertRaisesRegex(RuntimeError, "unconfirmed"):
                                writer("fixture", payload)
                    self.assertEqual(patch.call_args.kwargs.get("timeout"), 30)
                    self.assertEqual("status=eq.queued" in patch.call_args.args[0], writer == worker.sb_claim_stage)
        with mock.patch.object(worker.requests, "patch", return_value=mock.Mock(status_code=200, json=lambda: [])):
            self.assertFalse(worker.sb_claim_stage("fixture", payload))
            with self.assertRaises(RuntimeError): worker.sb_patch_stage("fixture", payload)

    def test_insert_requires_the_exact_persisted_record(self):
        payload = {"run_id": "run-fixture", "value": None, "metadata_json": {"uncalibrated": True}}
        row = {"id": "record-fixture", **payload}
        for writer in (worker.sb_post_kpi, worker.sb_post_artifact):
            for status, rows, accepted in ((201, [row], True), (503, [row], False), (204, None, False), (201, [], False), (201, [{**row, "run_id": "other"}], False), (201, [{**row, "metadata_json": {"uncalibrated": False}}], False), (201, [{k: v for k, v in row.items() if k != "value"}], False), (201, [payload], False), (201, [row, row], False)):
                with self.subTest(writer=writer.__name__, status=status, rows=rows):
                    response = mock.Mock(status_code=status)
                    response.json.return_value = rows
                    with mock.patch.object(worker.requests, "post", return_value=response) as post:
                        if accepted: writer(payload)
                        else:
                            with self.assertRaisesRegex(RuntimeError, "unconfirmed"): writer(payload)
                    self.assertEqual(post.call_args.kwargs.get("timeout"), 30)
                    self.assertEqual(post.call_args.kwargs["headers"]["Prefer"], "return=representation")
            with mock.patch.object(worker.requests, "post", side_effect=worker.requests.Timeout("private transport")):
                with self.assertRaisesRegex(RuntimeError, "unconfirmed") as caught: writer(payload)
                self.assertNotIn("private transport", str(caught.exception))

    def test_uncertain_insert_does_not_report_stage_success(self):
        for writer in (worker.sb_post_kpi, worker.sb_post_artifact):
            def handler(*args):
                writer({"run_id": "fixture"})
                return {"log": "done"}
            with self.subTest(writer=writer.__name__), mock.patch.object(worker, "sb_claim_stage", return_value=True), mock.patch.object(worker, "sb_get_run", return_value={}), mock.patch.dict(worker.STAGE_DISPATCH, {"synthetic": handler}), mock.patch.object(worker, "sb_patch_stage") as stage_write, mock.patch.object(worker, "sb_patch_run") as run_write, mock.patch.object(worker.requests, "post", side_effect=worker.requests.Timeout("acknowledgement lost")), mock.patch.object(worker, "maybe_mark_run_succeeded") as complete:
                with self.assertRaisesRegex(RuntimeError, "unconfirmed"):
                    worker.process_stage({"id": "fixture", "run_id": "fixture", "stage_name": "synthetic"})
                stage_write.assert_not_called()
                self.assertEqual(run_write.call_args_list, [mock.call("fixture", {"status": "running"})])
                complete.assert_not_called()

    def test_completion_read_requires_a_list(self):
        for status, value in ((200, None), (200, {}), (200, False), (200, ""), (503, [])):
            with self.subTest(value=value, status=status), mock.patch.object(worker.requests, "get", return_value=mock.Mock(status_code=status, json=lambda: value)), mock.patch.object(worker, "sb_patch_run") as write:
                with self.assertRaisesRegex(RuntimeError, "completion read unconfirmed"):
                    worker.maybe_mark_run_succeeded("fixture")
                write.assert_not_called()
        with mock.patch.object(worker.requests, "get", side_effect=worker.requests.Timeout("private transport")), mock.patch.object(worker, "sb_patch_run") as write:
            with self.assertRaisesRegex(RuntimeError, "completion read unconfirmed") as caught:
                worker.maybe_mark_run_succeeded("fixture")
            self.assertNotIn("private transport", str(caught.exception))
            write.assert_not_called()
        for rows, count in (([], 1), ([{"id": "stage"}], 0)):
            with mock.patch.object(worker.requests, "get", return_value=mock.Mock(status_code=200, json=lambda: rows)), mock.patch.object(worker, "sb_patch_run") as write:
                worker.maybe_mark_run_succeeded("fixture")
                self.assertEqual(write.call_count, count)

    def test_uncertain_completion_never_rewrites_success_as_failure(self):
        for failure in ("stage", "run", "read"):
            stage_writes, run_writes = [], []
            def patch(url, *, json, **kwargs):
                is_stage = "model_run_stages" in url
                (stage_writes if is_stage else run_writes).append(json["status"])
                if json["status"] == "succeeded" and failure == ("stage" if is_stage else "run"):
                    raise worker.requests.Timeout("private detail")
                return mock.Mock(status_code=200, json=lambda: [{"id": "fixture", **json}])
            output = io.StringIO()
            with self.subTest(failure=failure), contextlib.redirect_stdout(output), mock.patch.object(worker, "sb_claim_stage", return_value=True), mock.patch.object(worker, "sb_get_run", return_value={}), mock.patch.dict(worker.STAGE_DISPATCH, {"synthetic": lambda *args: {"log": "done"}}), mock.patch.object(worker.requests, "patch", side_effect=patch), mock.patch.object(worker.requests, "get", return_value=mock.Mock(status_code=200, json=lambda: None if failure == "read" else [])):
                with self.assertRaisesRegex(RuntimeError, "unconfirmed"):
                    worker.process_stage({"id": "fixture", "run_id": "fixture", "stage_name": "synthetic"})
            self.assertNotIn("failed", stage_writes)
            self.assertNotIn("failed", run_writes)
            self.assertNotIn("complete", output.getvalue())
            self.assertNotIn("private detail", output.getvalue())

if __name__ == "__main__": unittest.main()
