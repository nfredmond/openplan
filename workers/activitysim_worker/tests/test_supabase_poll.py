"""Tests for the ActivitySim behavioral-preflight Supabase poll/claim loop.

These mock `requests` entirely — no network. They assert the honest preflight
contract: atomic conditional-PATCH claim, no double-processing on a lost race,
an evidence packet + artifact written to the run-artifacts bucket, a single
non-forecast general KPI, and honest failure when the study area is missing.
"""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

# supabase_poll validates credentials at import time — set them before import.
os.environ.setdefault("SUPABASE_URL", "http://supabase.test")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

import supabase_poll  # noqa: E402


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.text = text

    def json(self):
        return self._payload


class FakeRequests:
    """Routes (method, url) to configured responses and records every call."""

    def __init__(self):
        self.calls = []  # (method, url, payload/data)
        self.claim_returns_rows = True  # False simulates a lost claim race
        self.storage_status = 200

    def _record(self, method, url, body):
        self.calls.append((method, url, body))

    def get(self, url, headers=None, timeout=None):
        self._record("GET", url, None)
        if "/rest/v1/model_runs?id=eq" in url:
            return FakeResponse(200, [{
                "id": "run-1",
                "workspace_id": "ws-1",
                "corridor_geojson": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
                "query_text": "downtown corridor",
                "engine_key": "behavioral_demand",
                "run_title": "Preflight run",
                "input_snapshot_json": {},
            }])
        if "model_run_stages" in url and "status=neq.succeeded" in url:
            return FakeResponse(200, [])  # completion check: nothing left -> run succeeds
        if "model_run_stages" in url and "sort_order=lt" in url:
            return FakeResponse(200, [])
        return FakeResponse(200, [])

    def patch(self, url, headers=None, json=None, timeout=None):
        self._record("PATCH", url, json)
        if "status=eq.queued" in url:  # the conditional claim
            return FakeResponse(200, [{"id": "stage-1"}] if self.claim_returns_rows else [])
        return FakeResponse(204, [])

    def post(self, url, headers=None, json=None, data=None, timeout=None):
        self._record("POST", url, json if json is not None else data)
        if "/storage/v1/object/run-artifacts/" in url:
            return FakeResponse(self.storage_status, {})
        return FakeResponse(201, [{}])


def make_stage(name, sort_order):
    return {"id": "stage-1", "run_id": "run-1", "stage_name": name, "sort_order": sort_order, "status": "queued"}


class SupabasePollTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeRequests()
        self._patcher = mock.patch.object(supabase_poll, "requests", self.fake)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    # ---- claim semantics -------------------------------------------------
    def test_claim_returns_true_when_rows_present(self):
        self.assertTrue(supabase_poll.sb_claim_stage("stage-1", {"status": "running"}))

    def test_claim_returns_false_on_lost_race(self):
        self.fake.claim_returns_rows = False
        self.assertFalse(supabase_poll.sb_claim_stage("stage-1", {"status": "running"}))

    def test_lost_claim_race_does_not_process(self):
        self.fake.claim_returns_rows = False
        supabase_poll.process_stage(make_stage(supabase_poll.STAGE_RUNTIME_STAGING, 2))
        # No run fetch, no evidence upload — the loser must not touch the run.
        self.assertFalse(any("model_runs?id=eq" in url and m == "GET" for m, url, _ in self.fake.calls))
        self.assertFalse(any("/storage/v1/object/" in url for _, url, _ in self.fake.calls))

    # ---- stage ownership -------------------------------------------------
    def test_stage_filter_scopes_to_owned_names_only(self):
        import urllib.parse

        decoded = urllib.parse.unquote(supabase_poll._STAGE_FILTER)
        self.assertIn("ActivitySim Bundle Preflight", decoded)
        self.assertIn("Runtime Staging & Readiness", decoded)
        self.assertNotIn("Network Assignment", decoded)

    # ---- runtime staging stage: evidence + honest KPI --------------------
    def test_runtime_staging_writes_evidence_artifact_and_kpi(self):
        supabase_poll.process_stage(make_stage(supabase_poll.STAGE_RUNTIME_STAGING, 2))

        # Evidence packet uploaded to the private run-artifacts bucket.
        uploads = [
            (url, body) for m, url, body in self.fake.calls
            if m == "POST" and "/storage/v1/object/run-artifacts/model-runs/run-1/" in url
        ]
        self.assertEqual(len(uploads), 1)
        evidence = json.loads(uploads[0][1].decode("utf-8"))
        self.assertFalse(evidence["is_forecast"])
        self.assertEqual(evidence["runtime_mode"], "preflight_only")
        self.assertEqual(evidence["preflight_status"], "complete")

        # An artifact row references the storage:// evidence packet.
        artifacts = [
            body for m, url, body in self.fake.calls
            if m == "POST" and url.endswith("/rest/v1/model_run_artifacts")
        ]
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0]["artifact_type"], "evidence_packet")
        self.assertTrue(artifacts[0]["file_url"].startswith("storage://run-artifacts/"))

        # Exactly one general KPI, and it is NOT a demand/forecast metric.
        kpis = [
            body for m, url, body in self.fake.calls
            if m == "POST" and url.endswith("/rest/v1/model_run_kpis")
        ]
        self.assertEqual(len(kpis), 1)
        self.assertEqual(kpis[0]["kpi_category"], "general")
        self.assertEqual(kpis[0]["kpi_name"], "activitysim_runtime_mode")
        self.assertIsNone(kpis[0]["value"])  # a label, not a metric
        forbidden = {"daily_vmt", "vmt_per_capita", "trips", "mode_share_auto", "resident_vmt"}
        self.assertNotIn(kpis[0]["kpi_name"], forbidden)

    def test_stage_succeeds_and_run_marked_succeeded(self):
        supabase_poll.process_stage(make_stage(supabase_poll.STAGE_RUNTIME_STAGING, 2))
        stage_patches = [
            body for m, url, body in self.fake.calls
            if m == "PATCH" and "model_run_stages?id=eq" in url and "status=eq.queued" not in url
        ]
        self.assertTrue(any(p.get("status") == "succeeded" for p in stage_patches))
        run_patches = [
            body for m, url, body in self.fake.calls if m == "PATCH" and "model_runs?id=eq" in url
        ]
        self.assertTrue(any(p.get("status") == "succeeded" for p in run_patches))

    # ---- honesty: no silent fallback ------------------------------------
    def test_missing_corridor_fails_honestly(self):
        # Override the run fetch to return no corridor.
        def get_no_corridor(url, headers=None, timeout=None):
            if "/rest/v1/model_runs?id=eq" in url:
                return FakeResponse(200, [{
                    "id": "run-1", "workspace_id": "ws-1", "corridor_geojson": None,
                    "query_text": None, "engine_key": "behavioral_demand",
                    "run_title": "x", "input_snapshot_json": {},
                }])
            if "status=neq.succeeded" in url:
                return FakeResponse(200, [{"id": "s"}])
            return FakeResponse(200, [])

        self.fake.get = get_no_corridor
        supabase_poll.process_stage(make_stage(supabase_poll.STAGE_RUNTIME_STAGING, 2))
        stage_patches = [
            body for m, url, body in self.fake.calls
            if m == "PATCH" and "model_run_stages?id=eq" in url and "status=eq.queued" not in url
        ]
        self.assertTrue(any(p.get("status") == "failed" for p in stage_patches))
        run_patches = [
            body for m, url, body in self.fake.calls if m == "PATCH" and "model_runs?id=eq" in url
        ]
        self.assertTrue(any(p.get("status") == "failed" for p in run_patches))

    def test_bundle_preflight_stage_validates_and_logs(self):
        result = supabase_poll.run_bundle_preflight_stage(
            "run-1",
            {"corridor_geojson": {"type": "Polygon", "coordinates": []}},
            "stage-1",
        )
        self.assertIn("bundle", result["log"].lower())


if __name__ == "__main__":
    unittest.main()
