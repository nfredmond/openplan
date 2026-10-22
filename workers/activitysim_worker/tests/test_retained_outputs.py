"""ActivitySim KPI and artifact rows go through the saved request journal.

Code-workers review item 8: the poller wrote KPIs and artifacts as plain POSTs
with readback, so a lost acknowledgement left nothing to reconcile and a resend
inserted a second row. The rows now use the AequilibraE worker's legacy KPI and
artifact commands. These checks drive a fake database that commits a row and
then loses the reply, and assert that the saved request survives, that both a
repeated call and `model_command_recovery.py` return the original receipt, and
that the table holds exactly one row afterwards.

No database, network or ActivitySim execution is used.
"""
import ast
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:9")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "synthetic-test-only")
WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

import supabase_poll  # noqa: E402
import model_command_journal  # noqa: E402
import model_command_recovery  # noqa: E402

RUN_ID = "12345678-1234-4123-8123-123456789abc"
STAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
WORKSPACE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
BASE_URL = "http://127.0.0.1:54321"
DEPLOYMENT = "synthetic"


class _Reply:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def close(self):
        pass


class CommittingDatabase:
    """The two legacy RPCs' contract: commit once per row id, return the saved
    receipt for an identical resend, refuse a changed request."""

    def __init__(self):
        self.rows = {"record_legacy_model_kpi": {}, "record_legacy_model_artifact": {}}
        self.posts = []
        self.lose_acknowledgements = 0

    def post(self, url, headers=None, json=None, timeout=None, allow_redirects=None):
        self.posts.append((url, json))
        operation = url.rsplit("/rpc/", 1)[1]
        assert operation in self.rows, f"plain insert or unknown endpoint used: {url}"
        payload = json["p_payload"]
        saved = self.rows[operation].get(payload["id"])
        if saved is None:
            row = {k: v for k, v in payload.items() if not (operation == "record_legacy_model_kpi" and k == "stage_id")}
            saved = {"request": json, "receipt": {**row, "attempt_id": None}}
            self.rows[operation][payload["id"]] = saved
        elif saved["request"] != json:
            return _Reply(400, {"message": "Legacy request changed"})
        if self.lose_acknowledgements:
            self.lose_acknowledgements -= 1
            raise TimeoutError("acknowledgement lost after commit")
        return _Reply(200, saved["receipt"])


def _kpi(value=12.0):
    return {"run_id": RUN_ID, "kpi_category": "general", "kpi_name": "activitysim_bundle_zones",
            "kpi_label": "ActivitySim bundle zones", "value": value, "unit": "zones",
            "breakdown_json": {"provenance": "synthetic scaffold"}}


def _artifact(content_hash="a" * 64):
    return {"run_id": RUN_ID, "stage_id": STAGE_ID, "artifact_type": "evidence_packet",
            "file_url": f"storage://run-artifacts/model-runs/{RUN_ID}/evidence.json",
            "file_size_bytes": 42, "content_hash": content_hash,
            "metadata_json": {"kind": "behavioral_demand_preflight_evidence", "is_forecast": False}}


class RetainedOutputs(unittest.TestCase):
    def setUp(self):
        self.database = CommittingDatabase()
        work = tempfile.mkdtemp(prefix="astest-retained-")
        self.addCleanup(shutil.rmtree, work, True)
        for patcher in (
            mock.patch.object(supabase_poll, "ACTIVITYSIM_WORK_DIR", work),
            mock.patch.object(supabase_poll, "SUPABASE_URL", BASE_URL),
            mock.patch.object(supabase_poll.requests, "post", side_effect=self.database.post),
            mock.patch.dict(os.environ, {"OPENPLAN_DEPLOYMENT_ID": DEPLOYMENT}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        os.environ.pop("OPENPLAN_HOSTED_ARTIFACT_MIRROR", None)
        self.journal = Path(supabase_poll.stage_journal_dir(RUN_ID, STAGE_ID))

    def _pending(self):
        return model_command_recovery.pending_summaries(self.journal, base_url=BASE_URL, deployment_id=DEPLOYMENT)

    def _recover(self, request_id):
        return model_command_recovery.recover_request(
            self.journal, request_id, base_url=BASE_URL, deployment_id=DEPLOYMENT,
            service_key="synthetic-test-only", post=self.database.post)

    def test_a_kpi_survives_a_lost_acknowledgement_and_is_not_duplicated_on_retry(self):
        self.database.lose_acknowledgements = 1
        with self.assertRaisesRegex(supabase_poll.WorkerStateWriteUnconfirmed, "recover the saved request"):
            supabase_poll.sb_record_retained_kpi(_kpi(), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID)
        # The row was committed; only the reply was lost. The request is saved.
        self.assertEqual(len(self.database.rows["record_legacy_model_kpi"]), 1)
        pending = self._pending()
        self.assertEqual([p["operation"] for p in pending], ["record_legacy_model_kpi"])
        self.assertEqual((pending[0]["run_id"], pending[0]["stage_id"]), (RUN_ID, STAGE_ID))

        # Operator recovery resends the SAVED request and keeps the original receipt.
        receipt = self._recover(pending[0]["request_id"])
        self.assertEqual(receipt["value"], 12.0)
        self.assertEqual(self._pending(), [])
        # A repeated worker call reads the saved receipt and sends nothing.
        posts = len(self.database.posts)
        self.assertEqual(supabase_poll.sb_record_retained_kpi(_kpi(), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID), receipt)
        self.assertEqual(len(self.database.posts), posts)
        # Every send carried one identical request, and the table holds one row.
        sent = [body for _, body in self.database.posts]
        self.assertEqual(len(sent), 2)
        self.assertEqual(sent[0], sent[1])
        self.assertEqual(len(self.database.rows["record_legacy_model_kpi"]), 1)

    def test_a_repeated_call_after_a_lost_acknowledgement_resends_the_same_request(self):
        self.database.lose_acknowledgements = 1
        with self.assertRaises(supabase_poll.WorkerStateWriteUnconfirmed):
            supabase_poll.sb_record_retained_kpi(_kpi(), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID)
        receipt = supabase_poll.sb_record_retained_kpi(_kpi(), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID)
        self.assertEqual(receipt["kpi_name"], "activitysim_bundle_zones")
        self.assertEqual(len(self.database.rows["record_legacy_model_kpi"]), 1)
        self.assertEqual(self.database.posts[0][1], self.database.posts[1][1])

    def test_changed_kpi_values_under_the_same_identity_are_refused(self):
        supabase_poll.sb_record_retained_kpi(_kpi(12.0), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID)
        with self.assertRaises(supabase_poll.WorkerStateWriteUnconfirmed):
            supabase_poll.sb_record_retained_kpi(_kpi(13.0), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID)
        rows = list(self.database.rows["record_legacy_model_kpi"].values())
        self.assertEqual([r["receipt"]["value"] for r in rows], [12.0])

    def test_an_artifact_survives_a_lost_acknowledgement_and_is_not_duplicated_on_retry(self):
        self.database.lose_acknowledgements = 1
        with self.assertRaises(supabase_poll.WorkerStateWriteUnconfirmed):
            supabase_poll.sb_record_retained_artifact(_artifact(), workspace_id=WORKSPACE_ID, logical_name="evidence_packet")
        pending = self._pending()
        self.assertEqual([p["operation"] for p in pending], ["record_legacy_model_artifact"])
        receipt = self._recover(pending[0]["request_id"])
        self.assertEqual(receipt["content_hash"], "a" * 64)
        self.assertEqual(supabase_poll.sb_record_retained_artifact(
            _artifact(), workspace_id=WORKSPACE_ID, logical_name="evidence_packet"), receipt)
        self.assertEqual(len(self.database.rows["record_legacy_model_artifact"]), 1)
        # New bytes under the same logical slot are refused, not added.
        with self.assertRaises(supabase_poll.WorkerStateWriteUnconfirmed):
            supabase_poll.sb_record_retained_artifact(_artifact("b" * 64), workspace_id=WORKSPACE_ID, logical_name="evidence_packet")
        self.assertEqual(len(self.database.rows["record_legacy_model_artifact"]), 1)

    def test_the_journal_lives_outside_every_execution_directory(self):
        self.assertEqual(self.journal, Path(supabase_poll.ACTIVITYSIM_WORK_DIR, RUN_ID, "stage-journals", STAGE_ID))
        for hostile in ("../outside", STAGE_ID.upper(), ""):
            with self.subTest(stage=hostile), self.assertRaises(ValueError):
                supabase_poll.stage_journal_dir(RUN_ID, hostile)

    def test_without_a_deployment_identity_nothing_is_sent(self):
        with mock.patch.dict(os.environ, {"OPENPLAN_DEPLOYMENT_ID": ""}):
            with self.assertRaises(supabase_poll.WorkerStateWriteUnconfirmed):
                supabase_poll.sb_record_retained_kpi(_kpi(), workspace_id=WORKSPACE_ID, stage_id=STAGE_ID)
            with self.assertRaises(supabase_poll.WorkerStateWriteUnconfirmed):
                supabase_poll.sb_record_retained_artifact(_artifact(), workspace_id=WORKSPACE_ID, logical_name="evidence_packet")
        self.assertEqual(self.database.posts, [])


class StageWritesUseTheJournal(unittest.TestCase):
    """The stage code reaches the retained writers, not the plain inserts."""

    def _calls(self, function_name):
        tree = ast.parse(Path(supabase_poll.__file__).read_text(encoding="utf-8"))
        function = next(node for node in ast.walk(tree)
                        if isinstance(node, ast.FunctionDef) and node.name == function_name)
        return [node.func.id for node in ast.walk(function)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]

    def test_stage_outputs_are_written_only_through_the_retained_writers(self):
        stage = self._calls("run_bundle_and_preflight_stage")
        executed = self._calls("_write_executed_behavioral_kpis")
        self.assertEqual(stage.count("sb_record_retained_artifact"), 2)
        self.assertEqual(stage.count("sb_record_retained_kpi"), 1)
        self.assertEqual(executed.count("sb_record_retained_kpi"), 1)
        for name in ("sb_post_kpi", "sb_post_artifact", "_confirmed_record_insert"):
            self.assertNotIn(name, stage + executed, name)


if __name__ == "__main__":
    unittest.main()
