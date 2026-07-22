"""Tests for the ActivitySim behavioral-preflight Supabase poll/claim loop (L2).

These mock `requests` but run the REAL bundle-build + preflight pipeline against a
synthetic screening fixture (AequilibraE zone_attributes schema — deliberately
missing worker_residents + area_share, so the adapter is exercised) and a fake
skim (copied, not parsed). They assert: atomic conditional-PATCH claim, no
double-processing on a lost race, a real bundle preflight producing an evidence
packet + scaffold (non-forecast) KPIs, and honest failures.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://supabase.test")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
_WORK = tempfile.mkdtemp(prefix="astest-work-")
os.environ["ACTIVITYSIM_WORK_DIR"] = _WORK

WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

import supabase_poll  # noqa: E402

# AequilibraE-worker zone_attributes schema (NO worker_residents / area_share).
_ZONE_HEADER = (
    "GEOID,NAMELSAD,zone_id,centroid_lon,centroid_lat,area_sq_mi,total_jobs,"
    "retail_jobs,health_jobs,education_jobs,accommodation_jobs,govt_jobs,est_population,households"
)
_ZONE_ROWS = [
    "06001001,Tract 1,1,-121.7,38.55,2.5,400,80,40,30,20,10,3000,1200",
    "06001002,Tract 2,2,-121.6,38.50,1.5,250,50,25,20,10,5,2000,800",
    "06001003,Tract 3,3,-121.5,38.60,3.0,600,120,60,40,30,15,4000,1600",
]


def _write_fixtures(dirpath: str):
    za = os.path.join(dirpath, "zone_attributes.csv")
    with open(za, "w") as f:
        f.write(_ZONE_HEADER + "\n" + "\n".join(_ZONE_ROWS) + "\n")
    skim = os.path.join(dirpath, "travel_time_skims.omx")
    with open(skim, "wb") as f:
        f.write(b"OMX-FAKE-SKIM-BYTES")  # copied, never parsed, in the preflight path
    return za, skim


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.text = ""

    def json(self):
        return self._payload


class FakeRequests:
    def __init__(self, za_path, skim_path):
        self.calls = []
        self.claim_returns_rows = True
        self.za_path = za_path
        self.skim_path = skim_path

    def get(self, url, headers=None, timeout=None):
        self.calls.append(("GET", url, None))
        if "/rest/v1/model_runs?id=eq" in url:
            return FakeResponse(200, [{
                "id": "run-1", "workspace_id": "ws-1",
                "corridor_geojson": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
                "query_text": "q", "engine_key": "behavioral_demand",
                "run_title": "Preflight", "input_snapshot_json": {},
            }])
        if "/rest/v1/model_run_artifacts?run_id=eq" in url:
            return FakeResponse(200, [
                {"artifact_type": "skim_matrix", "file_url": f"local://{self.skim_path}", "metadata_json": {}},
                {"artifact_type": "zone_attributes", "file_url": f"local://{self.za_path}", "metadata_json": {}},
            ])
        if "model_run_stages" in url and "status=neq.succeeded" in url:
            return FakeResponse(200, [])
        return FakeResponse(200, [])

    def patch(self, url, headers=None, json=None, timeout=None):
        self.calls.append(("PATCH", url, json))
        if "status=eq.queued" in url:
            return FakeResponse(200, [{"id": "stage-1"}] if self.claim_returns_rows else [])
        return FakeResponse(204, [])

    def post(self, url, headers=None, json=None, data=None, timeout=None):
        self.calls.append(("POST", url, json if json is not None else data))
        if "/storage/v1/object/run-artifacts/" in url:
            return FakeResponse(200, {})
        return FakeResponse(201, [{}])


def make_stage():
    return {"id": "stage-1", "run_id": "run-1", "stage_name": supabase_poll.STAGE_BUNDLE_PREFLIGHT, "sort_order": 4, "status": "queued"}


class SupabasePollTests(unittest.TestCase):
    def setUp(self):
        self._fixdir = tempfile.mkdtemp(prefix="astest-fix-")
        za, skim = _write_fixtures(self._fixdir)
        self.fake = FakeRequests(za, skim)
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
        supabase_poll.process_stage(make_stage())
        self.assertFalse(any("model_run_artifacts" in url for _, url, _ in self.fake.calls))

    # ---- stage ownership -------------------------------------------------
    def test_stage_filter_scopes_to_owned_name_only(self):
        import urllib.parse

        decoded = urllib.parse.unquote(supabase_poll._STAGE_FILTER)
        self.assertIn("ActivitySim Bundle & Preflight", decoded)
        self.assertNotIn("Network Assignment", decoded)

    # ---- adapter: adds the missing columns -------------------------------
    def test_adapter_adds_worker_residents_and_area_share(self):
        out = os.path.join(self._fixdir, "adapted.csv")
        n = supabase_poll._adapt_zone_attributes(self.fake.za_path, out)
        self.assertEqual(n, 3)
        import csv

        with open(out, newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertIn("worker_residents", rows[0])
        self.assertIn("area_share", rows[0])
        # worker_residents = households * 1.25 scaffold
        self.assertEqual(int(rows[0]["worker_residents"]), round(1200 * 1.25))
        # area_share sums to ~1.0
        self.assertAlmostEqual(sum(float(r["area_share"]) for r in rows), 1.0, places=5)

    # ---- full L2 stage: real bundle + preflight --------------------------
    def test_bundle_and_preflight_produces_evidence_and_scaffold_kpis(self):
        supabase_poll.process_stage(make_stage())

        # Evidence packet uploaded, honest + non-forecast.
        uploads = [b for m, url, b in self.fake.calls if m == "POST" and "/storage/v1/object/run-artifacts/" in url]
        self.assertEqual(len(uploads), 1)
        evidence = json.loads(uploads[0].decode("utf-8"))
        self.assertFalse(evidence["is_forecast"])
        self.assertEqual(evidence["pipeline_status"], "prototype_preflight_complete")
        self.assertEqual(evidence["runtime_mode"], "preflight_only")
        self.assertIsNotNone(evidence["bundle"]["zones"])

        # KPIs: scaffold structural counts only — NO demand/forecast metric.
        kpis = [b for m, url, b in self.fake.calls if m == "POST" and url.endswith("/rest/v1/model_run_kpis")]
        names = {k["kpi_name"] for k in kpis}
        self.assertIn("activitysim_bundle_zones", names)
        self.assertIn("activitysim_bundle_synthetic_households", names)
        self.assertTrue(all(k["kpi_category"] == "general" for k in kpis))
        forbidden = {"daily_vmt", "vmt_per_capita", "resident_vmt", "trips", "mode_share_auto", "total_trips"}
        self.assertEqual(names & forbidden, set())
        # every scaffold KPI carries honest provenance
        for k in kpis:
            self.assertIn("provenance", k["breakdown_json"])

        # Run marked succeeded.
        run_patches = [b for m, url, b in self.fake.calls if m == "PATCH" and "model_runs?id=eq" in url]
        self.assertTrue(any(p.get("status") == "succeeded" for p in run_patches))

    # ---- honesty: missing screening handoff fails cleanly ----------------
    def test_missing_screening_handoff_fails(self):
        def get_no_artifacts(url, headers=None, timeout=None):
            if "/rest/v1/model_runs?id=eq" in url:
                return FakeResponse(200, [{
                    "id": "run-1", "workspace_id": "ws-1",
                    "corridor_geojson": {"type": "Polygon", "coordinates": []},
                    "query_text": "q", "engine_key": "behavioral_demand",
                    "run_title": "x", "input_snapshot_json": {},
                }])
            if "/rest/v1/model_run_artifacts" in url:
                return FakeResponse(200, [])  # no handoff artifacts
            if "status=neq.succeeded" in url:
                return FakeResponse(200, [{"id": "s"}])
            return FakeResponse(200, [])

        self.fake.get = get_no_artifacts
        supabase_poll.process_stage(make_stage())
        stage_patches = [b for m, url, b in self.fake.calls if m == "PATCH" and "model_run_stages?id=eq" in url and "status=eq.queued" not in url]
        self.assertTrue(any(p.get("status") == "failed" for p in stage_patches))

    def test_missing_corridor_fails_honestly(self):
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
        supabase_poll.process_stage(make_stage())
        run_patches = [b for m, url, b in self.fake.calls if m == "PATCH" and "model_runs?id=eq" in url]
        self.assertTrue(any(p.get("status") == "failed" for p in run_patches))


if __name__ == "__main__":
    unittest.main()
