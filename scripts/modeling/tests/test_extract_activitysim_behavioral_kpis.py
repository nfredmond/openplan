from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from extract_activitysim_behavioral_kpis import extract_activitysim_behavioral_kpis
from ingest_activitysim_runtime_outputs import ingest_activitysim_runtime_outputs


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_runtime(
    root: Path,
    *,
    mode: str,
    status: str,
    caveats: list[str] | None = None,
    output_rows: dict[str, list[dict[str, object]]] | None = None,
) -> Path:
    runtime_dir = root / "runtime"
    (runtime_dir / "logs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "010-validate-inputs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "020-prepare-activitysim-inputs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "030-run-activitysim").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "040-collect-outputs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "logs" / "runtime.log").write_text("runtime log\n")

    collected_outputs: list[str] = []
    if output_rows:
        for relative_name, rows in output_rows.items():
            path = runtime_dir / "output" / relative_name
            write_csv(path, rows)
            collected_outputs.append(str(path.relative_to(runtime_dir)))

    manifest = {
        "schema_version": "openplan.activitysim_runtime.v0",
        "runtime_type": "activitysim_worker_runtime",
        "created_at_utc": "2026-03-27T00:00:00+00:00",
        "bundle": {
            "bundle_dir": str(root / "bundle"),
            "manifest_path": str(root / "bundle" / "manifest.json"),
        },
        "runtime_dir": str(runtime_dir),
        "mode": mode,
        "status": status,
        "caveats": caveats or [],
        "errors": [],
        "artifacts": {
            "runtime_log": "logs/runtime.log",
            "collected_outputs": collected_outputs,
        },
        "stages": [
            {"stage_key": "validate_inputs", "status": "succeeded"},
            {"stage_key": "prepare_activitysim_inputs", "status": "succeeded"},
            {"stage_key": "run_activitysim", "status": "blocked" if status == "blocked" else "succeeded"},
            {"stage_key": "collect_outputs", "status": "succeeded"},
        ],
    }
    write_json(runtime_dir / "runtime_manifest.json", manifest)
    write_json(
        runtime_dir / "runtime_summary.json",
        {
            "runtime_dir": str(runtime_dir),
            "runtime_manifest_path": str(runtime_dir / "runtime_manifest.json"),
            "mode": mode,
            "status": status,
        },
    )
    return runtime_dir


class ExtractActivitySimBehavioralKpisTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_marks_preflight_blocked_runtime_as_not_enough_behavioral_outputs(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="preflight_only",
            status="blocked",
            caveats=["ActivitySim CLI is not installed or not on PATH"],
        )

        result = extract_activitysim_behavioral_kpis(runtime_dir=str(runtime_dir))

        self.assertEqual(result["availability_status"], "not_enough_behavioral_outputs")
        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["totals"]["trips"], None)
        self.assertFalse(summary["coverage"]["trip_volumes_by_purpose"])
        self.assertIn("preflight_only", " ".join(summary["availability"]["reasons"]))

        packet_text = Path(result["packet_path"]).read_text()
        self.assertIn("not_enough_behavioral_outputs", packet_text)
        self.assertIn("does not claim calibration quality", packet_text)

    def test_extracts_supportable_kpis_from_runtime_dir(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="activitysim_cli",
            status="succeeded",
            output_rows={
                "final_households.csv": [
                    {"household_id": 1, "income": 20000, "household_type": "family"},
                    {"household_id": 2, "income": 80000, "household_type": "nonfamily"},
                ],
                "final_persons.csv": [
                    {"person_id": 1, "household_id": 1, "person_type": "worker"},
                    {"person_id": 2, "household_id": 1, "person_type": "student"},
                    {"person_id": 3, "household_id": 2, "person_type": "worker"},
                ],
                "final_tours.csv": [
                    {"tour_id": 1, "person_id": 1, "household_id": 1},
                    {"tour_id": 2, "person_id": 2, "household_id": 1},
                    {"tour_id": 3, "person_id": 3, "household_id": 2},
                ],
                "final_trips.csv": [
                    {"trip_id": 1, "person_id": 1, "household_id": 1, "purpose": "work", "trip_mode": "drive"},
                    {"trip_id": 2, "person_id": 1, "household_id": 1, "purpose": "work", "trip_mode": "drive"},
                    {"trip_id": 3, "person_id": 2, "household_id": 1, "purpose": "school", "trip_mode": "walk"},
                    {"trip_id": 4, "person_id": 3, "household_id": 2, "purpose": "shopping", "trip_mode": "transit"},
                ],
            },
        )

        result = extract_activitysim_behavioral_kpis(runtime_dir=str(runtime_dir))

        self.assertEqual(result["availability_status"], "behavioral_kpis_available")
        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["totals"]["households"], 2)
        self.assertEqual(summary["totals"]["persons"], 3)
        self.assertEqual(summary["totals"]["tours"], 3)
        self.assertEqual(summary["totals"]["trips"], 4)
        self.assertEqual(summary["trip_volumes_by_purpose"]["source_column"], "purpose")
        self.assertEqual(summary["trip_volumes_by_purpose"]["values"][0]["label"], "work")
        self.assertEqual(summary["trip_volumes_by_purpose"]["values"][0]["count"], 2)
        self.assertEqual(summary["mode_shares"]["source_column"], "trip_mode")
        self.assertEqual(summary["mode_shares"]["values"][0]["label"], "drive")
        self.assertEqual(summary["mode_shares"]["values"][0]["count"], 2)

        segment_keys = {(item["target_kind"], item["segment"]) for item in summary["segment_summaries"]}
        self.assertIn(("persons", "person_type"), segment_keys)
        self.assertIn(("households", "income_bin"), segment_keys)
        self.assertIn(("trips", "person_type"), segment_keys)
        self.assertIn(("trips", "income_bin"), segment_keys)

    def test_accepts_ingestion_summary_path_as_input(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="activitysim_cli",
            status="succeeded",
            output_rows={
                "final_households.csv": [
                    {"household_id": 1, "income": 120000},
                ],
                "final_persons.csv": [
                    {"person_id": 1, "household_id": 1, "person_type": "worker"},
                ],
                "final_trips.csv": [
                    {"trip_id": 1, "person_id": 1, "household_id": 1, "trip_purpose": "work", "mode": "drive"},
                    {"trip_id": 2, "person_id": 1, "household_id": 1, "trip_purpose": "work", "mode": "drive"},
                ],
            },
        )
        ingestion = ingest_activitysim_runtime_outputs(runtime_dir=str(runtime_dir))

        result = extract_activitysim_behavioral_kpis(ingestion_summary=ingestion["summary_path"])

        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["source"]["ingestion_summary_path"], ingestion["summary_path"])
        self.assertEqual(summary["trip_volumes_by_purpose"]["source_column"], "trip_purpose")
        self.assertEqual(summary["mode_shares"]["source_column"], "mode")
        self.assertIn("trips:income_bin", summary["coverage"]["segment_summaries"])

    def test_marks_failed_runtime_outputs_as_partial_not_full_behavioral_readiness(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="activitysim_cli",
            status="failed",
            caveats=["Synthetic failure after partial output collection"],
            output_rows={
                "final_households.csv": [
                    {"household_id": 1, "income": 45000},
                ],
                "final_persons.csv": [
                    {"person_id": 1, "household_id": 1, "person_type": "worker"},
                ],
                "final_trips.csv": [
                    {"trip_id": 1, "person_id": 1, "household_id": 1, "purpose": "work", "trip_mode": "drive"},
                    {"trip_id": 2, "person_id": 1, "household_id": 1, "purpose": "shop", "trip_mode": "walk"},
                ],
            },
        )

        result = extract_activitysim_behavioral_kpis(runtime_dir=str(runtime_dir))

        self.assertEqual(result["availability_status"], "partial_behavioral_outputs")
        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["totals"]["trips"], 2)
        self.assertTrue(summary["coverage"]["trip_volumes_by_purpose"])
        self.assertTrue(summary["coverage"]["mode_shares"])
        self.assertIn("partial outputs", " ".join(summary["availability"]["reasons"]))


if __name__ == "__main__":
    unittest.main()
