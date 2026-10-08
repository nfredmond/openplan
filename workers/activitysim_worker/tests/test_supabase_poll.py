"""Tests for the ActivitySim behavioral-preflight Supabase poll/claim loop (L2).

These mock `requests` but run the REAL bundle-build + preflight pipeline against a
synthetic screening fixture (AequilibraE zone_attributes schema — deliberately
missing worker_residents + area_share, so the adapter is exercised) and a fake
skim (copied, not parsed). They assert: atomic conditional-PATCH claim, no
double-processing on a lost race, a real bundle preflight producing an evidence
packet + scaffold (non-forecast) KPIs, and honest failures.
"""
import json
import hashlib
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
    setup = os.path.join(dirpath, "network_setup_summary.json")
    with open(setup, "w") as f:
        json.dump({"network_settings": {"classes": ["car"]}}, f)
    return za, skim, setup


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b""):
        self.content = content
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.text = ""

    def json(self):
        return self._payload


class FakeRequests:
    def __init__(self, za_path, skim_path, setup_path):
        self.calls = []
        self.objects = {}
        self.claim_returns_rows = True
        self.za_path = za_path
        self.skim_path = skim_path
        self.setup_path = setup_path

    def get(self, url, headers=None, timeout=None):
        self.calls.append(("GET", url, None))
        if "/storage/v1/object/authenticated/" in url:
            key = url.split("/storage/v1/object/authenticated/", 1)[1]
            return FakeResponse(200 if key in self.objects else 404, content=self.objects.get(key, b""))
        if "/rest/v1/model_runs?id=eq" in url:
            return FakeResponse(200, [{
                "id": "12345678-1234-4123-8123-123456789abc", "workspace_id": "ws-1",
                "corridor_geojson": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
                "query_text": "q", "engine_key": "behavioral_demand",
                "run_title": "Preflight", "input_snapshot_json": {},
            }])
        if "/rest/v1/model_run_artifacts?run_id=eq" in url:
            return FakeResponse(200, [
                {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "run_id": "12345678-1234-4123-8123-123456789abc", "artifact_type": "skim_matrix", "file_url": f"local://{self.skim_path}", "file_size_bytes": Path(self.skim_path).stat().st_size, "content_hash": hashlib.sha256(Path(self.skim_path).read_bytes()).hexdigest(), "metadata_json": {}},
                {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "run_id": "12345678-1234-4123-8123-123456789abc", "artifact_type": "zone_attributes", "file_url": f"local://{self.za_path}", "file_size_bytes": Path(self.za_path).stat().st_size, "content_hash": hashlib.sha256(Path(self.za_path).read_bytes()).hexdigest(), "metadata_json": {}},
                {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "run_id": "12345678-1234-4123-8123-123456789abc", "artifact_type": "network_setup_summary", "file_url": f"local://{self.setup_path}", "file_size_bytes": Path(self.setup_path).stat().st_size, "content_hash": hashlib.sha256(Path(self.setup_path).read_bytes()).hexdigest(), "metadata_json": {}},
            ])
        if "model_run_stages" in url and "status=neq.succeeded" in url:
            return FakeResponse(200, [])
        return FakeResponse(200, [])

    def patch(self, url, headers=None, json=None, timeout=None):
        self.calls.append(("PATCH", url, json))
        if "status=eq.queued" in url:
            return FakeResponse(200, [{"id": "stage-1", **json}] if self.claim_returns_rows else [])
        return FakeResponse(200, [{"id": "stage-1" if "model_run_stages" in url else "12345678-1234-4123-8123-123456789abc", **json}])

    def post(self, url, headers=None, json=None, data=None, timeout=None):
        self.calls.append(("POST", url, json if json is not None else data))
        if "/storage/v1/object/run-artifacts/" in url:
            key = url.split("/storage/v1/object/", 1)[1]
            assert headers["x-upsert"] == "false"
            if key in self.objects:
                return FakeResponse(409, {})
            self.objects[key] = data
            return FakeResponse(201, {})
        return FakeResponse(201, [{"id": "retained-record", **json}])


def make_stage():
    return {"id": "stage-1", "run_id": "12345678-1234-4123-8123-123456789abc", "stage_name": supabase_poll.STAGE_BUNDLE_PREFLIGHT, "sort_order": 4, "status": "queued"}


class RunWorkspaceTests(unittest.TestCase):
    def test_full_run_identity_and_repeat_execution_preserve_previous_files(self):
        first = "12345678-1234-4123-8123-123456789abc"
        second = "12345678-1234-4567-8567-987654321abc"
        with tempfile.TemporaryDirectory() as root, mock.patch.object(supabase_poll, "ACTIVITYSIM_WORK_DIR", root):
            legacy = Path(root, first[:12]); legacy.mkdir()
            (legacy / "original.txt").write_text("legacy")
            paths = []
            for run in (first, second, first):
                directory = Path(supabase_poll.create_run_workspace(run))
                self.assertEqual(directory.parent, Path(root, run))
                paths.append(directory)
                (directory / "owner.txt").write_text(run)
            self.assertEqual(len(set(paths)), 3)
            for directory, run in zip(paths, (first, second, first)):
                self.assertEqual((directory / "owner.txt").read_text(), run)
            self.assertEqual((legacy / "original.txt").read_text(), "legacy")

    def test_bad_identity_cannot_claim(self):
        with mock.patch.object(supabase_poll, "sb_claim_stage", return_value=False) as claim:
            for identity in ("../outside", "12345678-123", "12345678-1234-4123-8123-123456789ABC"):
                stage = make_stage(); stage["run_id"] = identity
                with self.assertRaises(ValueError):
                    supabase_poll.process_stage(stage)
            claim.assert_not_called()


class HandoffCopyTests(unittest.TestCase):
    def test_registered_bytes_are_retained_independently_of_source_changes(self):
        run = "12345678-1234-4123-8123-123456789abc"
        with tempfile.TemporaryDirectory() as root, mock.patch.dict(os.environ, {"AEQ_WORK_DIR": root}):
            source = Path(root, "runs", run, "input.csv"); source.parent.mkdir(parents=True)
            source.write_bytes(b"original")
            destination = Path(root, "execution"); destination.mkdir()
            row = {"id": run, "run_id": run, "artifact_type": "zone_attributes", "file_url": "local://" + str(source), "file_size_bytes": 8, "content_hash": hashlib.sha256(b"original").hexdigest()}
            retained = Path(supabase_poll._retain_handoff_file([row], "zone_attributes", run, str(destination)))
            source.write_bytes(b"replaced")
            self.assertEqual(retained.read_bytes(), b"original")

    def test_boolean_size_cannot_describe_empty_bytes(self):
        run = "12345678-1234-4123-8123-123456789abc"
        with tempfile.TemporaryDirectory() as root, mock.patch.dict(os.environ, {"AEQ_WORK_DIR": root}):
            source = Path(root, "runs", run, "empty"); source.parent.mkdir(parents=True)
            source.write_bytes(b"")
            destination = Path(root, "execution"); destination.mkdir()
            row = {"id": run, "run_id": run, "artifact_type": "zone_attributes", "file_url": "local://" + str(source), "file_size_bytes": False, "content_hash": hashlib.sha256(b"").hexdigest()}
            with self.assertRaisesRegex(RuntimeError, "byte size is unavailable"):
                supabase_poll._retain_handoff_file([row], "zone_attributes", run, str(destination))

    def test_scope_hash_size_and_inventory_faults_are_refused(self):
        run = "12345678-1234-4123-8123-123456789abc"
        with tempfile.TemporaryDirectory() as root, mock.patch.dict(os.environ, {"AEQ_WORK_DIR": root}):
            source = Path(root, "runs", run, "input.csv"); source.parent.mkdir(parents=True)
            source.write_bytes(b"original")
            outside = Path(root, "other.csv"); outside.write_bytes(b"original")
            linked = source.parent / "linked.csv"; linked.symlink_to(outside)
            row = {"id": run, "run_id": run, "artifact_type": "zone_attributes", "file_url": "local://" + str(source), "file_size_bytes": 8, "content_hash": hashlib.sha256(b"original").hexdigest()}
            bad_rows = [[{**row, **patch}] for patch in [
                {"run_id": "12345678-1234-4567-8567-987654321abc"},
                {"file_url": "local://" + str(outside)}, {"file_url": "local://" + str(linked)},
                {"content_hash": None}, {"content_hash": "0" * 64},
                {"file_size_bytes": None}, {"file_size_bytes": True}, {"file_size_bytes": 7}, {"file_size_bytes": 9},
            ]] + [[row, row], [], [None]]
            for index, rows in enumerate(bad_rows):
                with self.subTest(index=index):
                    destination = Path(root, str(index)); destination.mkdir()
                    with self.assertRaises((RuntimeError, ValueError)):
                        supabase_poll._retain_handoff_file(rows, "zone_attributes", run, str(destination))


class SupabasePollTests(unittest.TestCase):
    def setUp(self):
        self._fixdir = tempfile.mkdtemp(prefix="astest-fix-")
        self._root_env = mock.patch.dict(os.environ, {"AEQ_WORK_DIR": self._fixdir})
        self._root_env.start()
        source_dir = Path(self._fixdir, "runs", "12345678-1234-4123-8123-123456789abc")
        source_dir.mkdir(parents=True)
        za, skim, setup = _write_fixtures(str(source_dir))
        self.fake = FakeRequests(za, skim, setup)
        self._patcher = mock.patch.object(supabase_poll, "requests", self.fake)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._root_env.stop()

    def test_normal_preflight_retains_prior_execution_files(self):
        stage = make_stage()
        with tempfile.TemporaryDirectory() as root, mock.patch.object(supabase_poll, "ACTIVITYSIM_WORK_DIR", root):
            legacy = Path(root, stage["run_id"][:12]); legacy.mkdir()
            (legacy / "legacy.txt").write_text("untouched")
            supabase_poll.process_stage(stage)
            executions = list(Path(root, stage["run_id"]).iterdir())
            self.assertEqual(len(executions), 1)
            retained = executions[0] / "retained.txt"
            retained.write_text("first execution")
            supabase_poll.process_stage(stage)
            self.assertEqual(len(list(Path(root, stage["run_id"]).iterdir())), 2)
            self.assertEqual(retained.read_text(), "first execution")
            self.assertEqual((legacy / "legacy.txt").read_text(), "untouched")
            for execution in Path(root, stage["run_id"]).iterdir():
                manifest = json.loads((execution / "screening/bundle_manifest.json").read_text())
                self.assertEqual(manifest["run_name"], "behavioral-" + stage["run_id"])

    def test_handoff_query_retains_identity_and_byte_fields(self):
        supabase_poll.sb_get_run_artifacts(make_stage()["run_id"])
        url = self.fake.calls[-1][1]
        self.assertIn("run_id=eq." + make_stage()["run_id"], url)
        self.assertEqual(url.split("&select=")[1], "id,run_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json")

    def test_unverified_handoff_never_reaches_preflight_materialization(self):
        stage = make_stage()
        rows = supabase_poll.sb_get_run_artifacts(stage["run_id"])
        rows[0]["content_hash"] = "0" * 64
        with mock.patch.object(supabase_poll, "sb_get_run_artifacts", return_value=rows), mock.patch.object(supabase_poll, "_materialize_screening_dir") as materialize:
            with self.assertRaisesRegex(RuntimeError, "bytes differ"):
                supabase_poll.run_bundle_and_preflight_stage(stage["run_id"], {"corridor_geojson": {"type": "Polygon"}}, stage["id"])
            materialize.assert_not_called()

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
                    "id": "12345678-1234-4123-8123-123456789abc", "workspace_id": "ws-1",
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

    # ---- L3: real behavioral KPIs only when a run executed ---------------
    def test_exec_config_unset_defaults_to_preflight(self):
        for var in (
            "ACTIVITYSIM_CLI", "ACTIVITYSIM_CLI_TEMPLATE", "ACTIVITYSIM_CONFIG_DIR",
            "ACTIVITYSIM_CONTAINER_IMAGE", "ACTIVITYSIM_CONTAINER_ENGINE",
            "ACTIVITYSIM_CONTAINER_CLI_TEMPLATE",
        ):
            os.environ.pop(var, None)
        cfg = supabase_poll._activitysim_exec_config()
        self.assertIsNone(cfg["activitysim_cli"])
        self.assertIsNone(cfg["activitysim_container_image"])
        self.assertEqual(
            supabase_poll._bundle_profile_for_execution(cfg),
            {"population_source": "scaffold", "config_package": "starter"},
        )

    def test_configured_execution_requires_census_population_and_named_coefficients(self):
        profile = supabase_poll._bundle_profile_for_execution(
            {"activitysim_cli": "activitysim", "activitysim_container_image": None}
        )
        self.assertEqual(
            profile,
            {"population_source": "census", "config_package": "mtc"},
        )

    def test_executed_trip_table_becomes_vehicle_demand_package(self):
        root = Path(self._fixdir)
        screening = root / "screening"
        (screening / "package").mkdir(parents=True)
        (screening / "package" / "zone_attributes.csv").write_text(
            "zone_id,GEOID,NAMELSAD,centroid_lon,centroid_lat,area_sq_mi,est_population,households,total_jobs,zone_kind\n"
            "1,06001001,One,-121.0,39.0,1,10,4,3,internal\n"
            "2,06001002,Two,-120.9,39.1,1,10,4,3,internal\n"
        )
        trips = root / "final_trips.csv"
        trips.write_text(
            "origin,destination,trip_mode\n"
            "1,2,DRIVEALONEFREE\n"
            "1,2,SHARED2FREE\n"
            "2,1,WALK\n"
        )
        ingestion = root / "ingestion.json"
        ingestion.write_text(
            json.dumps(
                {
                    "runtime": {"runtime_dir": str(root)},
                    "common_tables": {"trips": {"relative_path": trips.name}},
                }
            )
        )
        result = supabase_poll._build_executed_demand_package(
            {"ingestion_summary_path": str(ingestion), "manifest_path": "pipeline.json"},
            str(screening),
            str(root / "run"),
        )
        self.assertAlmostEqual(result["conversion"]["vehicle_trips"], 1.5)
        self.assertEqual(result["conversion"]["non_auto_person_trips"], 1)
        self.assertTrue(Path(result["files"]["od_trip_matrix"]).exists())

    def test_executed_kpis_written_and_labeled_uncalibrated(self):
        summary_path = os.path.join(self._fixdir, "kpi_summary.json")
        with open(summary_path, "w") as f:
            json.dump({
                "availability_status": "available",
                "totals": {"households": 100, "persons": 250, "tours": 400, "trips": 900},
            }, f)
        n = supabase_poll._write_executed_behavioral_kpis("12345678-1234-4123-8123-123456789abc", {"kpi_summary_path": summary_path})
        self.assertEqual(n, 4)
        kpis = [b for m, url, b in self.fake.calls if m == "POST" and url.endswith("/rest/v1/model_run_kpis")]
        names = {k["kpi_name"] for k in kpis}
        self.assertEqual(names, {"activitysim_households", "activitysim_persons", "activitysim_tours", "activitysim_trips"})
        for k in kpis:
            self.assertEqual(k["breakdown_json"]["calibration"], "uncalibrated")
            self.assertIn("UNCALIBRATED", k["breakdown_json"]["provenance"])

    def test_executed_kpis_none_when_no_outputs(self):
        # The common starter/zero-model case: real run executed, no behavioral tables.
        summary_path = os.path.join(self._fixdir, "kpi_summary_empty.json")
        with open(summary_path, "w") as f:
            json.dump({"availability_status": None, "totals": {"households": None, "persons": None, "tours": None, "trips": None}}, f)
        n = supabase_poll._write_executed_behavioral_kpis("12345678-1234-4123-8123-123456789abc", {"kpi_summary_path": summary_path})
        self.assertEqual(n, 0)

    def test_executed_kpi_provenance_names_the_accepted_component(self):
        summary_path = os.path.join(self._fixdir, "kpi_summary_accepted.json")
        with open(summary_path, "w") as f:
            json.dump({
                "availability_status": "available",
                "totals": {"households": 100},
            }, f)

        supabase_poll._write_executed_behavioral_kpis(
            "12345678-1234-4123-8123-123456789abc",
            {"kpi_summary_path": summary_path},
            [{"component": "auto_ownership"}],
        )

        kpis = [b for m, url, b in self.fake.calls if m == "POST" and url.endswith("/rest/v1/model_run_kpis")]
        self.assertIn("Accepted components: auto_ownership", kpis[-1]["breakdown_json"]["provenance"])

    def test_missing_corridor_fails_honestly(self):
        def get_no_corridor(url, headers=None, timeout=None):
            if "/rest/v1/model_runs?id=eq" in url:
                return FakeResponse(200, [{
                    "id": "12345678-1234-4123-8123-123456789abc", "workspace_id": "ws-1", "corridor_geojson": None,
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
